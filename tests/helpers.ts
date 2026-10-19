import { radPerCount } from "../src/core/units";
import { newDiagnostics } from "../src/input/capture";
import { synthPlayerEvents } from "../src/input/synthetic";
import { buildScenario } from "../src/sim/scenario";
import { mulberry32 } from "../src/core/rng";
import { DRILLS } from "../src/sim/drills";
import { angTo, enemyChest } from "../src/sim/geometry";
import { advanceMover, createMover } from "../src/sim/mover";
import type { BlockLog, FrameDrillLog, Frame, SessionLog } from "../src/telemetry/schema";

/** Synthetic player: aims at the target `lag` seconds late with a fixed vertical offset. Fully deterministic. */
export function synthDrill(id: "pb" | "close" | "mid", fps: number, lag: number, pitchOff = 0): FrameDrillLog {
  const d = DRILLS[id];
  const m = createMover({ mix: d.mix!, sub: d.sub!, bound: d.bound! }, mulberry32(d.seed));
  const hist: { t: number; yaw: number }[] = [];
  const frames: Frame[] = [];
  let c = 0;
  for (let i = 0; i / fps <= d.dur + 1e-9; i++) {
    const t = i / fps;
    advanceMover(m, t);
    const p = enemyChest(m, 0, d.dist!), a = angTo(p);
    hist.push({ t, yaw: a.yaw });
    let yaw = hist[0].yaw;
    for (const h of hist) if (h.t <= t - lag + 1e-12) yaw = h.yaw;
    const pitch = a.pitch + pitchOff;
    const hw = Math.atan(0.3 / Math.hypot(p.x, p.z));
    const on = Math.abs(a.yaw - yaw) < hw && Math.abs(a.pitch - pitch) < hw * 1.5 ? 1 : 0;
    if (frames.length) c += Math.abs(yaw - frames[frames.length - 1].yaw) * 1000;
    frames.push({ t, yaw: yaw + 0, pitch: pitch + 0, ty: a.yaw + 0, tp: a.pitch + 0, on, hw, c: c + 0 }); // +0 normalises -0 like the recorder
  }
  return { id, seed: d.seed, frames };
}

export function synthBlock(index: number, cm: number, fps: number, lag: number): BlockLog {
  return { index, warm: false, round: 1, cm360: cm, drills: { pb: synthDrill("pb", fps, lag), close: synthDrill("close", fps, lag), mid: synthDrill("mid", fps, lag) } };
}

export function synthSession(id = "s1"): SessionLog {
  return {
    schema: 1, id, startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:12:00.000Z", status: "complete",
    settings: { dpi: 800, sens: 1.6, fovScale: 1.4675, display: { aspect: null, scaling: "stretched" } }, rawInput: true, sampling: "per-frame",
    blocks: [synthBlock(0, 32.47, 60, 0.05), synthBlock(1, 20, 60, 0.08)],
  };
}

/** A schema-v2 (event-level) session driven by the synthetic harness: 4 scored blocks at different cm/360. */
export function synthSessionV2(id = "v2"): SessionLog {
  const dpi = 800;
  const blocks: BlockLog[] = [20, 30, 45, 60].map((cm, index) => {
    const k = radPerCount(cm, dpi);
    const drills: BlockLog["drills"] = {};
    for (const d of ["pb", "close", "mid", "duo"] as const) {
      const sc = buildScenario(d, DRILLS[d].seed, DRILLS[d].dur);
      // slower sens = a little more lag in this synthetic player, so the curve has a shape
      const events = synthPlayerEvents(sc, k, { lag: 0.04 + Math.abs(Math.log(cm / 32)) * 0.08, gain: 0.5, seed: index + 1 }, 1000);
      drills[d] = { id: d, seed: DRILLS[d].seed, dur: DRILLS[d].dur, tEnd: DRILLS[d].dur, k, events };
    }
    return { index, warm: false, round: 1, cm360: cm, drills };
  });
  return {
    schema: 2, id, startedAt: "2026-02-01T00:00:00.000Z", finishedAt: "2026-02-01T00:12:00.000Z", status: "complete",
    settings: { dpi, sens: 1.6, fovScale: 1.4675, display: { aspect: null, scaling: "stretched" } }, rawInput: true, sampling: "event",
    capture: newDiagnostics("synthetic", true), blocks,
  };
}
