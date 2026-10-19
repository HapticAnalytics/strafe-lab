import { describe, expect, it } from "vitest";
import { levelsFrom, scoreNemesis, segments, trainedVsHeldOut } from "../src/analysis/training";
import { radPerCount } from "../src/core/units";
import { mulberry32 } from "../src/core/rng";
import { synthPlayerEvents } from "../src/input/synthetic";
import { isBatterySeed } from "../src/sim/battery";
import { BAND, FAMILIES, LEVEL_STEP, nextLevel, paramsFor, START_LEVEL } from "../src/sim/nemesis";
import { buildScenario } from "../src/sim/scenario";
import { trainingOrder, trainingSeed, TRAIN_BLOCKS, SEG_PER_BLOCK } from "../src/sim/training";
import { BlockRecorder } from "../src/telemetry/recorder";
import type { EventDrillLog, SessionLog } from "../src/telemetry/schema";
import type { TrendSeries } from "../src/analysis/dashboard";

const K = radPerCount(32, 800);

describe("Nemesis generator", () => {
  it("level 0 and 1 hit the easy and hard anchors; mixes stay normalised", () => {
    const e = paramsFor("close", 0), h = paramsFor("close", 1);
    expect(e.dist).toBe(7); expect(h.dist).toBe(3.5);
    expect(h.speedScale).toBeGreaterThan(e.speedScale);
    for (const f of FAMILIES) for (const L of [0, 0.37, 1]) expect(Object.values(paramsFor(f, L).mix).reduce((a, b) => a + b!, 0)).toBeCloseTo(1, 12);
    expect(paramsFor("switch", 0.5).targets).toBe(2);
  });
  it("harder levels are harder for the same synthetic player", () => {
    const score = (L: number) => {
      const p = paramsFor("close", L), sc = buildScenario("nem", 99, 20, p);
      const ev = synthPlayerEvents(sc, K, { lag: 0.12, gain: 0.5, seed: 1 }, 1000);
      return scoreNemesis({ id: "nem", seed: 99, dur: 20, tEnd: 20, k: K, events: ev, params: p });
    };
    expect(score(0)).toBeGreaterThan(score(1) + 15);
  });
  it("speed scale and size change the scenario deterministically", () => {
    const a = buildScenario("nem", 5, 10, paramsFor("mid", 0.2)), b = buildScenario("nem", 5, 10, paramsFor("mid", 0.2));
    expect(Array.from(a.traj[0].x)).toEqual(Array.from(b.traj[0].x));
    expect(a.lanes[0].size).toBeCloseTo(paramsFor("mid", 0.2).size, 12);
  });
});

describe("staircase (difficulty adapts to the success band)", () => {
  it("harder above the band, easier below, unchanged inside, clamped to [0,1]", () => {
    expect(nextLevel(0.5, BAND[1] + 1)).toBeCloseTo(0.5 + LEVEL_STEP, 12);
    expect(nextLevel(0.5, BAND[0] - 1)).toBeCloseTo(0.5 - LEVEL_STEP, 12);
    expect(nextLevel(0.5, (BAND[0] + BAND[1]) / 2)).toBe(0.5);
    expect(nextLevel(1, 100)).toBe(1); expect(nextLevel(0, 0)).toBe(0);
  });
  it("a simulated player converges to a level inside the band", () => {
    let L = START_LEVEL;
    const lv: number[] = [];
    for (let i = 0; i < 25; i++) {
      const p = paramsFor("mid", L), sc = buildScenario("nem", 1000 + i, 20, p);
      const s = scoreNemesis({ id: "nem", seed: 1000 + i, dur: 20, tEnd: 20, k: K, events: synthPlayerEvents(sc, K, { lag: 0.1, gain: 0.5, seed: i }, 1000), params: p });
      L = nextLevel(L, s); lv.push(L);
    }
    // the tail oscillates around one level rather than running to an end
    const tail = lv.slice(-8);
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThanOrEqual(3 * LEVEL_STEP + 1e-9);
    expect(tail.some(x => x > 0 && x < 1)).toBe(true);
  }, 120_000);
});

describe("training sessions", () => {
  it("variable order interleaves every family per block; blocked repeats them", () => {
    const v = trainingOrder("variable", mulberry32(1)), b = trainingOrder("blocked", mulberry32(1));
    expect(v.length).toBe(TRAIN_BLOCKS);
    for (const blk of v) expect(new Set(blk).size).toBe(SEG_PER_BLOCK);
    const flat = b.flat();
    let runs = 1; for (let i = 1; i < flat.length; i++) if (flat[i] !== flat[i - 1]) runs++;
    expect(runs).toBe(FAMILIES.length);
  });
  it("training seeds never collide with battery (held-out) seeds", () => {
    let i = 0; const bad = [7_000_005, 7_001_100, 42];
    expect(trainingSeed(() => bad[i++])).toBe(42);
  });
  it("levels for the next session are reconstructed from the logs alone", () => {
    const rec = new BlockRecorder(0, false, null, 32);
    const p = paramsFor("close", 0.3), sc = buildScenario("nem", 7, 20, p);
    rec.startDrill("nem", 7, 20, K, p);
    rec.events(synthPlayerEvents(sc, K, { lag: 0.02, gain: 0.8, seed: 1 }, 1000));
    const stored = rec.endDrill(20)!;
    const s: SessionLog = { schema: 2, id: "t1", startedAt: "2026-03-01T10:00:00.000Z", finishedAt: "x", status: "complete", settings: { dpi: 800, sens: 1.6, fovScale: 1.4675, display: { aspect: null, scaling: "stretched" } }, rawInput: true, sampling: "event", protocol: "train", trainMode: "variable", blocks: [rec.log] };
    expect(levelsFrom([s]).close).toBeCloseTo(nextLevel(0.3, scoreNemesis(stored)), 12);
    expect(levelsFrom([s]).mid).toBe(START_LEVEL);
    expect(segments([s]).length).toBe(1);
  });
  it("multiple Nemesis segments in one block are all kept", () => {
    const rec = new BlockRecorder(0, false, null, 32);
    for (let i = 0; i < 3; i++) { rec.startDrill("nem", i, 20, K, paramsFor("mid", 0.3)); rec.endDrill(20); }
    expect(Object.keys(rec.log.drills)).toEqual(["nem", "nem1", "nem2"]);
    expect((rec.log.drills as Record<string, EventDrillLog>).nem2.id).toBe("nem");
  });
});

describe("Milestone 7 acceptance: held-out improvement reported separately from trained", () => {
  it("trained = Nemesis levels; held-out = battery metrics vs baseline in noise-floor units", () => {
    const seg = (sid: string, at: string, level: number) => {
      const rec = new BlockRecorder(0, false, null, 32);
      rec.startDrill("nem", 1, 20, K, paramsFor("close", level)); rec.endDrill(20);
      return { schema: 2, id: sid, startedAt: at, finishedAt: "x", status: "complete", settings: { dpi: 800, sens: 1.6, fovScale: 1.4675, display: { aspect: null, scaling: "stretched" } }, rawInput: true, sampling: "event", protocol: "train", blocks: [rec.log] } as SessionLog;
    };
    const train = [seg("t1", "2026-03-01T10:00:00Z", 0.3), seg("t2", "2026-03-05T10:00:00Z", 0.6)];
    const trends: TrendSeries[] = [{ key: "skill:pb", label: "pb", unit: "pts", higherIsBetter: true,
      points: [{ at: "a", sessionId: "b1", value: 60 }, { at: "b", sessionId: "b2", value: 61 }, { at: "c", sessionId: "b3", value: 59 }, { at: "d", sessionId: "b9", value: 66 }],
      floor: { key: "skill:pb", label: "pb", unit: "pts", higherIsBetter: true, days: 3, mean: 60, sd: 1, sdc95: 2.77, sdCi: [0.5, 6], ready: true } }];
    const r = trainedVsHeldOut(train, trends, ["b1", "b2", "b3"]);
    expect(r.trained.map(t => [t.family, +t.change.toFixed(2)])).toEqual([["close", 0.3]]);
    expect(r.heldOut.length).toBe(1);
    expect(r.heldOut[0].changeFloors).toBeCloseTo(6 / 2.77, 9);
    // the two sections never share sources: training sessions vs battery sessions
    const trainIds = new Set(r.trained.flatMap(t => t.sources));
    expect(r.heldOut.flatMap(h => h.sources).some(id => trainIds.has(id))).toBe(false);
  });
});
