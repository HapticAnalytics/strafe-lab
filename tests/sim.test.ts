import { describe, expect, it } from "vitest";
import { mulberry32 } from "../src/core/rng";
import { DRILLS } from "../src/sim/drills";
import { advanceMover, createMover } from "../src/sim/mover";
import { CROUCH_GUN, SPRINT, WALK_GUN } from "../src/sim/constants";

const mk = (seed = DRILLS.close.seed) => {
  const d = DRILLS.close;
  return createMover({ mix: d.mix!, sub: d.sub!, bound: d.bound! }, mulberry32(seed));
};

/** Advance frame by frame at a given rate and return the state at time T. */
function runAt(fps: number, T: number, seed?: number) {
  const m = mk(seed);
  for (let t = 0; t < T; t += 1 / fps) advanceMover(m, t);
  advanceMover(m, T);
  return { x: m.x, y: m.y, vx: m.vx, h: m.h, steps: m.steps };
}

describe("mover", () => {
  it("is identical at 37, 60, 144 and 240 fps (pure function of time and seed)", () => {
    const a = runAt(60, 9);
    expect(runAt(144, 9)).toEqual(a);
    expect(runAt(240, 9)).toEqual(a);
    expect(runAt(37, 9)).toEqual(a);
  });
  it("one big jump equals many small steps", () => {
    const m = mk();
    advanceMover(m, 9);
    expect({ x: m.x, y: m.y, vx: m.vx, h: m.h, steps: m.steps }).toEqual(runAt(144, 9));
  });
  it("same seed -> same path; different seed -> different path", () => {
    expect(runAt(60, 5, 1)).toEqual(runAt(144, 5, 1));
    expect(runAt(60, 5, 1).x).not.toBe(runAt(60, 5, 2).x);
  });
  it("respects lane bounds and speed limits", () => {
    const m = mk();
    const B = DRILLS.close.bound!;
    let maxV = 0, maxX = 0;
    for (let t = 0; t < 12; t += 1 / 240) {
      advanceMover(m, t);
      maxV = Math.max(maxV, Math.abs(m.vx));
      maxX = Math.max(maxX, Math.abs(m.x));
    }
    expect(maxV).toBeLessThanOrEqual(SPRINT + 1e-9);
    expect(maxX).toBeLessThan(B + 1);
    expect(WALK_GUN).toBeCloseTo(4.4109, 3);
    expect(CROUCH_GUN).toBeCloseTo(2.0358, 3);
  });
});

describe("rng", () => {
  it("mulberry32 is deterministic and in [0,1)", () => {
    const a = mulberry32(7), b = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
