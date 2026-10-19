import { describe, expect, it } from "vitest";
import { changeInFloors, dayOf, externalSeries, noiseFloor, SDC_FACTOR } from "../src/analysis/baseline";
import { batteryMetrics } from "../src/analysis/battery";
import { chi2Cdf, chi2Inv, gammaP, lnGamma, sd, sdCiFactors, slope } from "../src/analysis/stats";
import { radPerCount } from "../src/core/units";
import { newDiagnostics } from "../src/input/capture";
import { synthPlayerEvents } from "../src/input/synthetic";
import { batteryPlan, isBatterySeed, SEED_SETS } from "../src/sim/battery";
import { buildScenario } from "../src/sim/scenario";
import type { SessionLog } from "../src/telemetry/schema";

describe("stats (against published table values)", () => {
  it("lnGamma: Γ(5) = 24, Γ(0.5) = √π", () => {
    expect(Math.exp(lnGamma(5))).toBeCloseTo(24, 9);
    expect(Math.exp(lnGamma(0.5))).toBeCloseTo(Math.sqrt(Math.PI), 9);
  });
  it("chi-square quantiles match standard tables", () => {
    expect(chi2Inv(0.95, 1)).toBeCloseTo(3.8415, 3);
    expect(chi2Inv(0.975, 2)).toBeCloseTo(7.3778, 3);
    expect(chi2Inv(0.025, 2)).toBeCloseTo(0.0506, 4);
    expect(chi2Inv(0.975, 10)).toBeCloseTo(20.4832, 3);
    expect(chi2Cdf(2, 2)).toBeCloseTo(1 - Math.exp(-1), 12);
    expect(gammaP(1, 3)).toBeCloseTo(1 - Math.exp(-3), 12);
  });
  it("SD CI factors for df = 2 are about 0.52x to 6.3x", () => {
    const [lo, hi] = sdCiFactors(2);
    expect(lo).toBeCloseTo(0.521, 2); expect(hi).toBeCloseTo(6.28, 1);
  });
  it("sd and slope", () => {
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(slope([0, 1, 2], [1, 3, 5])).toBe(2);
  });
});

describe("noise floor", () => {
  const series = (vals: [string, number][]) => ({ key: "k", label: "L", unit: "u", higherIsBetter: true, byDay: vals.map(([day, value]) => ({ day, value })) });
  it("averages within a day, uses days as replicates, SDC95 = 1.96·√2·SD", () => {
    const f = noiseFloor(series([["d1", 10], ["d1", 12], ["d2", 14], ["d3", 13]]));
    expect(f.days).toBe(3);
    expect(f.sd).toBeCloseTo(sd([11, 14, 13]), 12);
    expect(f.sdc95).toBeCloseTo(SDC_FACTOR * sd([11, 14, 13]), 12);
    expect(f.ready).toBe(true);
    expect(f.sdCi![0]).toBeLessThan(f.sd!); expect(f.sdCi![1]).toBeGreaterThan(f.sd!);
  });
  it("is not ready with fewer than 3 days", () => {
    expect(noiseFloor(series([["d1", 1], ["d2", 2]])).ready).toBe(false);
    expect(noiseFloor(series([["d1", 1]])).sd).toBeNull();
  });
  it("change in noise-floor units respects direction", () => {
    const f = { ...noiseFloor(series([["a", 10], ["b", 12], ["c", 14]])), higherIsBetter: false };
    expect(changeInFloors(f, 100, 100 - f.sdc95!)).toBeCloseTo(1, 12);
  });
  it("dayOf uses the local calendar day", () => {
    expect(dayOf(new Date(2026, 4, 3, 23, 59).toISOString())).toBe("2026-05-03");
  });
  it("external results group by protocol + measure", () => {
    const s = externalSeries([
      { id: "1", at: new Date(2026, 0, 1).toISOString(), kind: "firing-range", measure: "R-99 60 s damage", value: 3000, unit: "dmg", higherIsBetter: true, notes: "" },
      { id: "2", at: new Date(2026, 0, 2).toISOString(), kind: "firing-range", measure: "R-99 60 s damage", value: 3300, unit: "dmg", higherIsBetter: true, notes: "" },
      { id: "3", at: new Date(2026, 0, 2).toISOString(), kind: "trainer", measure: "Close Long Strafes", value: 900, unit: "pts", higherIsBetter: true, notes: "" },
    ]);
    expect(s.length).toBe(2);
    expect(s[0].byDay.length).toBe(2);
  });
});

describe("battery", () => {
  it("uses fixed seed sets that rotate and are recognisable as battery seeds", () => {
    expect(batteryPlan(0)).toEqual(batteryPlan(SEED_SETS));
    expect(batteryPlan(0)[0].segments[0].seed).not.toBe(batteryPlan(1)[0].segments[0].seed);
    expect(batteryPlan(2).flatMap(b => b.segments).every(s => isBatterySeed(s.seed))).toBe(true);
    expect(isBatterySeed(123456789)).toBe(false);
    expect(batteryPlan(0).map(b => b.segments.length)).toEqual([8, 8]);
    expect(batteryPlan(0)[1].segments.map(s => s.id)).toEqual([...batteryPlan(0)[0].segments.map(s => s.id)].reverse());
  });
  it("produces tracked metrics for every skill from a synthetic battery", () => {
    const dpi = 800, cm = 32, k = radPerCount(cm, dpi), plan = batteryPlan(1);
    const blocks: SessionLog["blocks"] = plan.map((pb, r) => ({ index: r, warm: false, round: null, cm360: cm, drills: Object.fromEntries(pb.segments.map((sg, i) => {
      const sc = buildScenario(sg.id, sg.seed, sg.dur);
      return [sg.id, { id: sg.id, seed: sg.seed, dur: sg.dur, tEnd: sg.dur, k, events: synthPlayerEvents(sc, k, { lag: 0.1, gain: 0.5, seed: r * 10 + i }, 1000) }];
    })) }));
    const s: SessionLog = { schema: 2, id: "b", startedAt: "2026-01-01T10:00:00.000Z", finishedAt: "x", status: "complete", settings: { dpi, sens: 1.6, fovScale: 1.4675, display: { aspect: null, scaling: "stretched" } }, rawInput: true, sampling: "event", capture: newDiagnostics("synthetic", true), protocol: "battery", seedSet: 1, blocks };
    const m = batteryMetrics(s);
    const keys = m.map(p => p.key);
    expect(keys).toContain("battery:combined");
    for (const id of ["pb", "mid", "duo", "vert", "turn", "click", "flick", "long"]) expect(keys).toContain(`skill:${id}`);
    expect(keys).toContain("m1:pb:reversalLatencyMs");
    expect(keys).toContain("spawn:flick:ms");
  }, 60_000);
});
