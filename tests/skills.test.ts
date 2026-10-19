import { describe, expect, it } from "vitest";
import { computeV3 } from "../src/analysis/result3";
import { combinedScore, scoreSkill, SKILL_WEIGHTS, SKILLS } from "../src/analysis/skills";
import { radPerCount } from "../src/core/units";
import { newDiagnostics } from "../src/input/capture";
import { synthPlayerEvents } from "../src/input/synthetic";
import { DRILLS, type DrillId } from "../src/sim/drills";
import { replay } from "../src/sim/evaluator";
import { planSweep } from "../src/sim/protocol";
import { buildScenario } from "../src/sim/scenario";
import type { BlockLog, EventDrillLog, SessionLog } from "../src/telemetry/schema";

const K = radPerCount(32, 800);
const log = (id: DrillId, seed: number, dur: number, lag: number, k = K): EventDrillLog => {
  const sc = buildScenario(id, seed, dur);
  return { id, seed, dur, tEnd: dur, k, events: synthPlayerEvents(sc, k, { lag, gain: 0.5, seed: 1 }, 1000) };
};

describe("spawn drills", () => {
  it("targets chain at the configured bearing offsets and are pure functions of the seed", () => {
    const a = buildScenario("turn", 5, 10), b = buildScenario("turn", 5, 10);
    expect(a.spawn!.targets.map(t => t.theta)).toEqual(b.spawn!.targets.map(t => t.theta));
    for (let i = 1; i < a.spawn!.targets.length; i++) {
      const d = Math.abs(a.spawn!.targets[i].theta - a.spawn!.targets[i - 1].theta) * 180 / Math.PI;
      expect(d).toBeGreaterThanOrEqual(140 - 1e-9); expect(d).toBeLessThanOrEqual(180 + 1e-9);
    }
  });
  it("a fast synthetic player completes flick targets; a slower one scores lower", () => {
    const fast = scoreSkill(log("flick", 909, 10, 0.12), 800)!, slow = scoreSkill(log("flick", 909, 10, 0.35), 800)!;
    expect(fast.detail.completed!).toBeGreaterThan(5);
    expect(fast.score).toBeGreaterThan(slow.score);
  });
  it("180 turns are completed (wrap-around handled)", () => {
    const r = scoreSkill(log("turn", 808, 10, 0.15), 800)!;
    expect(r.detail.completed!).toBeGreaterThan(2);
  });
  it("clicking: clicks while on target complete it; clicks off target are misses", () => {
    const sc = buildScenario("click", 1010, 10);
    // first target appears at `delay`; a click before that has no target, a click at the start of the target while
    // the crosshair is still at 0 is a miss
    const at = sc.spawn!.def.delay;
    const ev = replay(sc, K, [{ t: at + 0.01, dx: 0, dy: 0, b: 1 }], 10);
    expect(ev.spawns[0].misses).toBe(1);
    const good = scoreSkill(log("click", 1010, 10, 0.12), 800)!;
    expect(good.detail.completed!).toBeGreaterThan(3);
    expect(good.detail.misses).toBe(0);
  });
  it("hold completion takes exactly holdMs on target", () => {
    const sc = buildScenario("flick", 909, 10);
    const r = scoreSkill(log("flick", 909, 10, 0.1), 800)!;
    for (const s of r.spawns!.filter(x => x.done != null)) expect(s.done! - s.at).toBeGreaterThanOrEqual(sc.spawn!.def.holdMs / 1000 - 1e-9);
  });
});

describe("skill scores", () => {
  it("weights sum to 1 and long range is the smallest weight", () => {
    expect(SKILLS.reduce((a, s) => a + SKILL_WEIGHTS[s], 0)).toBeCloseTo(1, 12);
    expect(Math.min(...SKILLS.map(s => SKILL_WEIGHTS[s]))).toBe(SKILL_WEIGHTS.long);
  });
  it("combined score renormalises over the skills present", () => {
    expect(combinedScore({ pb: 50 })).toBe(50);
    expect(combinedScore({ pb: 100, long: 0 })).toBeCloseTo(100 * 0.18 / 0.24, 9);
  });
  it("vertical and long-range tracking produce on-target scores", () => {
    expect(scoreSkill(log("vert", 606, 8, 0.05), 800)!.score).toBeGreaterThan(20);
    expect(scoreSkill(log("long", 707, 8, 0.05), 800)!.score).toBeGreaterThan(20);
  });
});

describe("end-to-end v3 session through the real drills", () => {
  it("a synthetic Quick session analyses into an estimate with per-skill fits", () => {
    const dpi = 800, base = 32;
    const plan = planSweep(base, "quick", 77);
    const blocks: BlockLog[] = plan.map((b, index) => {
      const k = radPerCount(b.cm, dpi);
      // this synthetic player gets laggier the further the sens is from 30 cm/360, so the best sens is ~30
      const lag = 0.06 + 0.25 * Math.abs(Math.log(b.cm / 30));
      const drills: BlockLog["drills"] = {};
      for (const s of b.segments) drills[s.id] = log(s.id, s.seed, s.dur, lag, k);
      return { index, warm: false, round: 1, cm360: b.cm, drills };
    });
    const s: SessionLog = { schema: 2, id: "q", startedAt: "x", finishedAt: "y", status: "complete", settings: { dpi, sens: 1.6, fovScale: 1.4675, display: { aspect: null, scaling: "stretched" } }, rawInput: true, sampling: "event", capture: newDiagnostics("synthetic", true), protocol: "v3", mode: "quick", sessionSeed: 77, blocks };
    const r = computeV3(s);
    expect(r.scored.length).toBe(5);
    expect(r.overall).not.toBeNull();
    expect(r.overall!.peakCm).toBeGreaterThan(20);
    expect(r.overall!.peakCm).toBeLessThan(45);
    expect(Object.keys(r.perSkill).sort()).toEqual(["duo", "flick", "mid", "pb"]);
  }, 120_000);
});

it("DRILLS has a definition for every skill", () => {
  for (const s of SKILLS) expect(DRILLS[s]).toBeDefined();
});
