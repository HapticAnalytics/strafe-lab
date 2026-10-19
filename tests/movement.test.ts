import { describe, expect, it } from "vitest";
import { movementReport, scoreMovement, type MoveSegment } from "../src/analysis/movement";
import { radPerCount } from "../src/core/units";
import { synthPlayerEvents } from "../src/input/synthetic";
import { CELLS, movementParams, promptAt, type MovementSpec } from "../src/sim/movement";
import { lateral, newPlayer, PLAYER_MAX, stepPlayer } from "../src/sim/player";
import { replay } from "../src/sim/evaluator";
import { buildScenario } from "../src/sim/scenario";
import type { EventDrillLog } from "../src/telemetry/schema";

const K = radPerCount(32, 800);
function seg(spec: MovementSpec, seed: number, lag = 0.08): MoveSegment {
  const p = movementParams(spec), sc = buildScenario("nem", seed, 12, p);
  const events = synthPlayerEvents(sc, K, { lag, gain: 0.5, seed, followPrompts: true }, 1000);
  const d: EventDrillLog = { id: "nem", seed, dur: 12, tEnd: 12, k: K, events, params: p };
  return scoreMovement(d, `s${seed}`)!;
}

describe("player movement", () => {
  it("D held at yaw 0 strafes right at Apex walk-with-gun speed", () => {
    const p = newPlayer(); p.keys.d = true;
    for (let i = 0; i < 1000; i++) stepPlayer(p, 0, 0.001);
    expect(p.vx).toBeCloseTo(PLAYER_MAX, 9); expect(p.vz).toBeCloseTo(0, 9);
    expect(lateral(p, 0)).toBeCloseTo(PLAYER_MAX, 9);
  });
  it("W moves along the view direction; diagonals are normalised", () => {
    const p = newPlayer(); p.keys.w = true; p.keys.d = true;
    for (let i = 0; i < 1000; i++) stepPlayer(p, Math.PI / 2, 0.001);
    expect(Math.hypot(p.vx, p.vz)).toBeCloseTo(PLAYER_MAX, 9);
  });
  it("the evaluator moves the eye from logged key events only, and targets are seen relative to it", () => {
    const sc = buildScenario("nem", 3, 4, movementParams({ cond: "indep", targetMoving: false }));
    const ev = replay(sc, K, [{ t: 0.1, dx: 0, dy: 0, key: "d" }, { t: 1.1, dx: 0, dy: 0, key: "d", up: 1 }], 4);
    const s = ev.samples[2000];
    expect(s.px).toBeGreaterThan(3.5);
    // a stationary target straight ahead now appears to the left (positive yaw)
    expect(s.ty).toBeGreaterThan(0.3);
  });
  it("prompts: seeded for independent/direction changes, from target motion for mirror/counter", () => {
    const sc = buildScenario("nem", 9, 12, movementParams({ cond: "mirror", targetMoving: true }));
    const m = promptAt(sc, { cond: "mirror", targetMoving: true }, 2), c = promptAt(sc, { cond: "counter", targetMoving: true }, 2);
    expect(m).toBe(-c as -1 | 0 | 1);
    const si = buildScenario("nem", 9, 12, movementParams({ cond: "indep", targetMoving: true }));
    expect(promptAt(si, { cond: "indep", targetMoving: true }, 5)).toBe(promptAt(buildScenario("nem", 9, 12, movementParams({ cond: "indep", targetMoving: true })), { cond: "indep", targetMoving: true }, 5));
  });
});

describe("Milestone 9 acceptance: effect size of movement on tracking, with a CI", () => {
  it("a synthetic player that follows prompts yields movement, target and interaction effects with CIs", () => {
    const segs: MoveSegment[] = [];
    for (const c of CELLS) for (let r = 0; r < 4; r++) segs.push(seg(c, 100 + r * 17 + CELLS.indexOf(c)));
    for (const s of segs.filter(x => x.spec.cond !== "still")) expect(s.compliancePct).toBeGreaterThan(60);
    const rep = movementReport(segs);
    const move = rep.effects.find(e => e.label.startsWith("Movement (main"))!;
    expect(move.estimate).not.toBeNull();
    expect(move.ci).not.toBeNull();
    expect(move.ci![0]).toBeLessThanOrEqual(move.estimate!); expect(move.ci![1]).toBeGreaterThanOrEqual(move.estimate!);
    expect(move.d).not.toBeNull();
    expect(rep.effects.find(e => e.label.startsWith("Mirrored"))!.ci).not.toBeNull();
  }, 300_000);
  it("non-compliant segments are excluded and counted", () => {
    const s = seg({ cond: "indep", targetMoving: true }, 5);
    const rep = movementReport([{ ...s, compliancePct: 10 }]);
    expect(rep.cells.find(c => c.key === "indep:moving")!.excluded).toBe(1);
  });
});
