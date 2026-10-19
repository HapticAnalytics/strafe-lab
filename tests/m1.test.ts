import { describe, expect, it } from "vitest";
import { computeM1 } from "../src/analysis/metrics";
import { viewDrill } from "../src/analysis/track";
import { DEG, radPerCount } from "../src/core/units";
import { CaptureBuffer, estimatePollingHz, frameAlignedFraction, newDiagnostics } from "../src/input/capture";
import { deliver, synthPlayerEvents, type PlayerModel } from "../src/input/synthetic";
import { EYE } from "../src/sim/constants";
import { DRILLS, type DrillId } from "../src/sim/drills";
import { replay } from "../src/sim/evaluator";
import { aimDir, BODY_HEIGHT, HEAD_OFFSET, hitTest } from "../src/sim/hit";
import { buildScenario, targetView } from "../src/sim/scenario";
import { buildTrajectories, sampleTrajectory } from "../src/sim/trajectory";
import type { EventDrillLog, InputSample } from "../src/telemetry/schema";

const K = radPerCount(32.47, 800);
const T0 = 123456.789; // arbitrary performance.now() drill start (ms)

function capture(samples: InputSample[], fps: number, mode: "per-event" | "coalesced" | "frame-aligned") {
  const buf = new CaptureBuffer(T0, newDiagnostics("synthetic", mode === "coalesced"));
  for (const p of deliver(samples, fps, T0, mode)) buf.ingest(p);
  return buf;
}
const logOf = (id: DrillId, events: InputSample[]): EventDrillLog => ({ id, seed: DRILLS[id].seed, dur: DRILLS[id].dur, tEnd: DRILLS[id].dur, k: K, events });
const PLAYERS: Record<string, PlayerModel> = {
  steady: { lag: 0.06, gain: 0.6, seed: 1 },
  shaky: { lag: 0.12, gain: 0.35, tremorDeg: 0.25, tremorHz: 11, noiseDeg: 0.05, pitchOffsetDeg: 0.4, seed: 2 },
};

describe("analytic hit test", () => {
  const feet = { x: 0, y: 0, z: -8 };
  const aimAt = (p: { x: number; y: number; z: number }) => ({ yaw: Math.atan2(-p.x, -p.z), pitch: Math.atan2(p.y - EYE, Math.hypot(p.x, p.z)) });
  it("chest is body, head centre is head, beside is a miss", () => {
    const c = aimAt({ x: 0, y: 1.0, z: -8 });
    expect(hitTest(c.yaw, c.pitch, feet, 1).kind).toBe(1);
    const h = aimAt({ x: 0, y: BODY_HEIGHT + HEAD_OFFSET, z: -8 });
    expect(hitTest(h.yaw, h.pitch, feet, 1).kind).toBe(2);
    const m = aimAt({ x: 0.45, y: 1.0, z: -8 });
    expect(hitTest(m.yaw, m.pitch, feet, 1).kind).toBe(0);
  });
  it("edge of the cylinder: just inside hits, just outside misses (radius 0.3 m)", () => {
    // horizontal angular half-width of a cylinder of radius r at distance d is asin(r/d)
    const hw = Math.asin(0.3 / 8), pitch = Math.atan2(1.0 - EYE, 8);
    expect(hitTest(hw * 0.999, pitch, feet, 1).kind).toBe(1);
    expect(hitTest(hw * 1.001, pitch, feet, 1).kind).toBe(0);
  });
  it("crouch lowers the head and aiming over a crouched enemy misses", () => {
    const h = aimAt({ x: 0, y: BODY_HEIGHT + HEAD_OFFSET, z: -8 });
    expect(hitTest(h.yaw, h.pitch, feet, 0.62).kind).toBe(0);
  });
  it("aimDir is a unit vector and yaw 0 looks down -z", () => {
    const d = aimDir(0.3, -0.2);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 12);
    expect(aimDir(0, 0)).toEqual({ x: -0, y: 0, z: -1 });
  });
  it("looking down onto the top cap from close range hits the body", () => {
    const f = { x: 0, y: 0, z: -0.5 };
    // aim at the near part of the top cap of a crouched enemy (the head sits over the centre)
    const yaw = 0, pitch = Math.atan2(BODY_HEIGHT * 0.62 - EYE, 0.25);
    expect(hitTest(yaw, pitch, f, 0.62).kind).toBe(1);
  });
});

describe("trajectories", () => {
  it("are a pure function of seed: identical when rebuilt, interpolate between steps", () => {
    const p = { mix: DRILLS.close.mix!, sub: DRILLS.close.sub!, bound: DRILLS.close.bound! };
    const a = buildTrajectories([{ profile: p, x0: 0 }], 202, 12)[0], b = buildTrajectories([{ profile: p, x0: 0 }], 202, 12)[0];
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    const s = sampleTrajectory(a, 2.5 * a.dt);
    expect(s.x).toBeCloseTo((a.x[2] + a.x[3]) / 2, 12);
  });
  it("2v1 enemies are built in lockstep from one seed (no dependence on how they are advanced)", () => {
    const s1 = buildScenario("duo", 404, 10), s2 = buildScenario("duo", 404, 10);
    expect(Array.from(s1.traj[1].x)).toEqual(Array.from(s2.traj[1].x));
    expect(Array.from(s1.traj[0].x)).not.toEqual(Array.from(s1.traj[1].x));
  });
});

describe("capture", () => {
  it("uses coalesced events when they sum to the parent, otherwise logs the parent and counts the mismatch", () => {
    const buf = new CaptureBuffer(0, newDiagnostics("pointermove", true));
    buf.ingest({ timeStamp: 10, movementX: 3, movementY: 0, coalesced: [{ timeStamp: 9, movementX: 1, movementY: 0 }, { timeStamp: 10, movementX: 2, movementY: 0 }] });
    expect(buf.samples.map(s => s.dx)).toEqual([1, 2]);
    buf.ingest({ timeStamp: 20, movementX: 5, movementY: 0, coalesced: [{ timeStamp: 20, movementX: 1, movementY: 0 }] });
    expect(buf.samples.map(s => s.dx)).toEqual([1, 2, 5]);
    expect(buf.diag.coalescedMismatch).toBe(1);
  });
  it("never loses or duplicates counts; clamps backwards timestamps", () => {
    const buf = new CaptureBuffer(0, newDiagnostics("pointerrawupdate", false));
    buf.ingest({ timeStamp: 5, movementX: 1, movementY: 1, coalesced: null });
    buf.ingest({ timeStamp: 4, movementX: 2, movementY: 0, coalesced: null });
    expect(buf.samples.reduce((a, s) => a + s.dx, 0)).toBe(3);
    expect(buf.diag.nonMonotonic).toBe(1);
    expect(buf.samples[1].t).toBe(buf.samples[0].t);
  });
  it("ignores movement before the drill start", () => {
    const buf = new CaptureBuffer(100, newDiagnostics("pointermove", false));
    buf.ingest({ timeStamp: 99, movementX: 7, movementY: 0, coalesced: null });
    expect(buf.samples).toEqual([]);
  });
  it("estimates polling rate from intervals and flags frame-aligned delivery", () => {
    const ev = Array.from({ length: 500 }, (_, i) => ({ t: i / 1000, dx: 1, dy: 0 }));
    expect(estimatePollingHz(ev).hz).toBeCloseTo(1000, 6);
    expect(estimatePollingHz(ev.slice(0, 10)).hz).toBeNull();
    const aligned = Array.from({ length: 200 }, (_, i) => ({ t: i / 144, dx: 5, dy: 0 }));
    expect(frameAlignedFraction(aligned, 1000 / 144)).toBeGreaterThan(0.95);
    expect(frameAlignedFraction(ev, 1000 / 144)).toBeLessThan(0.2);
  });
});

describe("Milestone 1 acceptance: frame-rate invariance", () => {
  for (const id of ["close", "duo"] as DrillId[]) {
    it(`${id}: same synthetic trace gives identical event logs and metrics at 60, 144 and 240 fps`, () => {
      const sc = buildScenario(id, DRILLS[id].seed, DRILLS[id].dur);
      const raw = synthPlayerEvents(sc, K, PLAYERS.steady, 1000);
      const results = [60, 144, 240].map(fps => {
        const buf = capture(raw, fps, "coalesced");
        return { events: buf.samples, m: viewDrill(logOf(id, buf.samples), 800) };
      });
      expect(results[1].events).toEqual(results[0].events);
      expect(results[2].events).toEqual(results[0].events);
      expect(results[1].m.m1).toEqual(results[0].m.m1);
      expect(results[2].m.m1).toEqual(results[0].m.m1);
      // per-event delivery (pointerrawupdate) gives the same log too
      expect(capture(raw, 144, "per-event").samples).toEqual(results[0].events);
    });
  }
  it("frame-aligned delivery without coalesced events changes the result and is detected", () => {
    const sc = buildScenario("close", DRILLS.close.seed, DRILLS.close.dur);
    const raw = synthPlayerEvents(sc, K, PLAYERS.steady, 1000);
    const good = capture(raw, 60, "coalesced"), bad = capture(raw, 60, "frame-aligned");
    expect(frameAlignedFraction(bad.samples, 1000 / 60)).toBeGreaterThan(0.95);
    expect(estimatePollingHz(good.samples).hz).toBeCloseTo(1000, 0);
    // total counts are identical (nothing lost), only timing differs
    expect(bad.samples.reduce((a, s) => a + s.dx, 0)).toBe(good.samples.reduce((a, s) => a + s.dx, 0));
  });
});

describe("evaluator", () => {
  it("2v1: perfect chest tracking kills enemy 1 in 200/198 s, then switches", () => {
    const sc = buildScenario("duo", DRILLS.duo.seed, DRILLS.duo.dur);
    const raw = synthPlayerEvents(sc, K, { lag: 0, seed: 3 }, 1000);
    const ev = replay(sc, K, raw, sc.dur);
    expect(ev.kills.length).toBe(2);
    expect(ev.kills[0].t).toBeCloseTo(200 / 198, 2);
    expect(ev.dealt).toBeCloseTo(400, 6);
    expect(ev.endT).toBe(ev.kills[1].t);
  });
  it("replay is deterministic: same log, same result", () => {
    const sc = buildScenario("pb", DRILLS.pb.seed, DRILLS.pb.dur);
    const raw = synthPlayerEvents(sc, K, PLAYERS.shaky, 1000);
    expect(replay(sc, K, raw, sc.dur).samples).toEqual(replay(sc, K, raw, sc.dur).samples);
  });
});

describe("M1 metrics: known answers", () => {
  const run = (id: DrillId, p: PlayerModel) => {
    const sc = buildScenario(id, DRILLS[id].seed, DRILLS[id].dur);
    const ev = replay(sc, K, synthPlayerEvents(sc, K, p, 1000), sc.dur);
    return computeM1(ev.samples, 800, ev.kills);
  };
  it("a near-perfect tracker is on target ~100%, with tiny error and jitter", () => {
    const m = run("mid", { lag: 0, seed: 1 });
    expect(m.onPct).toBeGreaterThan(99);
    expect(m.errHNorm).toBeLessThan(0.1);
    expect(m.jitterHDeg).toBeLessThan(0.02); // integer-count quantisation only
  });
  it("a lagging tracker trails, loses the target and needs time to recover", () => {
    const m = run("close", { lag: 0.2, seed: 1 });
    expect(m.trailingPct).toBeGreaterThan(70);
    expect(m.losses).toBeGreaterThan(0);
    expect(m.reacquireMs).not.toBeNull();
    expect(m.reversalLatencyMs!).toBeGreaterThan(100);
  });
  it("reversal latency tracks the player's lag", () => {
    const a = run("close", { lag: 0.1, seed: 1 }), b = run("close", { lag: 0.25, seed: 1 });
    expect(b.reversalLatencyMs! - a.reversalLatencyMs!).toBeGreaterThan(80);
    expect(b.reversalLatencyMs! - a.reversalLatencyMs!).toBeLessThan(220);
  });
  it("tremor shows up as jitter of roughly amplitude/sqrt(2)", () => {
    const m = run("mid", { lag: 0, tremorDeg: 0.3, tremorHz: 15, seed: 1 });
    expect(m.jitterHDeg).toBeGreaterThan(0.3 / Math.SQRT2 * 0.6);
    expect(m.jitterHDeg).toBeLessThan(0.3 / Math.SQRT2 * 1.2);
  });
  it("a constant pitch offset shows as vertical error in degrees", () => {
    const m = run("mid", { lag: 0, pitchOffsetDeg: 0.5, seed: 1 });
    expect(m.errVDeg).toBeCloseTo(0.5, 1);
  });
  it("hand speed: constant 1000 counts/s at 800 DPI = 3.175 cm/s", () => {
    const S = Array.from({ length: 4000 }, (_, i) => ({ t: i / 1000, yaw: 0, pitch: 0, ty: 0, tp: 0, hw: 0.05, vh: 0.1, on: 1 as const, target: 0, c: i, trig: 0 as const, press: 0 }));
    const m = computeM1(S, 800);
    expect(m.handSpeedMean).toBeCloseTo(3.175, 1);
    expect(m.handSpeedPeak).toBeCloseTo(3.175, 6);
    expect(m.onPct).toBe(100);
    expect(m.windowSdPct).toBe(0);
  });
  it("left/right asymmetry: a target moving one way only has no value for the other side", () => {
    const S = Array.from({ length: 1000 }, (_, i) => ({ t: i / 1000, yaw: 0, pitch: 0, ty: (i / 1000) * 25 * DEG, tp: 0, hw: 0.05, vh: 0.1, on: 0 as const, target: 0, c: 0, trig: 0 as const, press: 0 }));
    const m = computeM1(S, 800);
    expect(m.leftOnPct).toBe(0);
    expect(m.rightOnPct).toBeNull();
    expect(m.speedBins.find(b => b.lo === 20)!.seconds).toBeGreaterThan(0.9);
  });
});

describe("golden: M1 metrics locked for every drill and two synthetic players", () => {
  const r = (v: unknown): unknown => typeof v === "number" ? +v.toFixed(4) : Array.isArray(v) ? v.map(r) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, r(x)])) : v;
  for (const [name, p] of Object.entries(PLAYERS)) {
    for (const id of ["pb", "close", "mid", "duo"] as DrillId[]) {
      it(`${name} / ${id}`, () => {
        const sc = buildScenario(id, DRILLS[id].seed, DRILLS[id].dur);
        const raw = synthPlayerEvents(sc, K, p, 1000);
        expect(r(viewDrill(logOf(id, capture(raw, 144, "coalesced").samples), 800).m1)).toMatchSnapshot();
      });
    }
  }
});

it("targetView half-width matches asin(r/d)", () => {
  const sc = buildScenario("close", 202, 12), tv = targetView(sc, 0, 0);
  expect(tv.hw).toBeCloseTo(Math.asin(0.3 / Math.hypot(tv.feet.x, tv.feet.z)), 9);
});
