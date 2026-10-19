// Synthetic input harness: scripted "players" that produce integer mouse counts at a polling rate, plus helpers
// that deliver those counts the way a browser would (per-event, frame-batched with coalesced lists, or
// frame-aligned without them). Drives the same CaptureBuffer -> event log -> replay -> metrics path as real play.
import { applyDelta } from "../core/crosshair";
import { mulberry32 } from "../core/rng";
import { DrillEvaluator } from "../sim/evaluator";
import { targetView, type Scenario } from "../sim/scenario";
import type { InputSample } from "../telemetry/schema";
import type { RawParent } from "./capture";

export interface PlayerModel {
  /** reaction lag (s): aims where the target was `lag` seconds ago */
  lag: number;
  /** fraction of the remaining error corrected each poll (1 = snap); models under-correction */
  gain?: number;
  /** horizontal hand tremor: sine amplitude (deg) and frequency (Hz) */
  tremorDeg?: number; tremorHz?: number;
  /** constant vertical aim offset (deg; + aims high) */
  pitchOffsetDeg?: number;
  /** white noise on the desired yaw (deg, uniform +/-) from a seeded RNG */
  noiseDeg?: number;
  seed?: number;
}

const DEGR = Math.PI / 180;

/**
 * Generate raw samples for one drill. Engages the lowest-index living enemy (uses the shared evaluator to know
 * who is alive), so 2v1 kills/switches happen naturally.
 */
export function synthPlayerEvents(sc: Scenario, k: number, p: PlayerModel, pollHz = 1000): InputSample[] {
  const rng = mulberry32(p.seed ?? 1);
  const ev = new DrillEvaluator(sc, k, false);
  const aim = { yaw: 0, pitch: 0 };
  const out: InputSample[] = [];
  const gain = p.gain ?? 1;
  for (let i = 1; i / pollHz <= sc.dur; i++) {
    const t = i / pollHz;
    ev.advanceTo(t - 1 / pollHz);
    let tgt = 0;
    while (tgt < sc.lanes.length - 1 && !ev.alive(tgt)) tgt++;
    const tv = targetView(sc, tgt, Math.max(0, t - p.lag));
    let wantYaw = tv.yaw;
    if (p.tremorDeg) wantYaw += p.tremorDeg * DEGR * Math.sin(2 * Math.PI * (p.tremorHz ?? 10) * t);
    if (p.noiseDeg) wantYaw += (rng() * 2 - 1) * p.noiseDeg * DEGR;
    const wantPitch = tv.pitch + (p.pitchOffsetDeg ?? 0) * DEGR;
    const dx = Math.round(((aim.yaw - wantYaw) * gain) / k), dy = Math.round(((aim.pitch - wantPitch) * gain) / k);
    if (!dx && !dy) continue;
    applyDelta(aim, dx, dy, k);
    const s = { t, dx, dy };
    out.push(s);
    ev.push([s]);
  }
  return out;
}

export type Delivery = "per-event" | "coalesced" | "frame-aligned";

/**
 * Turn samples into browser-like parent events for a given frame rate. t0 is the drill start (ms).
 *  per-event:     one parent per sample (pointerrawupdate)
 *  coalesced:     one parent per frame; the individual samples are in its coalesced list (pointermove + getCoalescedEvents)
 *  frame-aligned: one parent per frame stamped at the frame time, no coalesced list (Chrome mousemove)
 */
export function deliver(samples: InputSample[], fps: number, t0: number, mode: Delivery): RawParent[] {
  const ts = (t: number) => t0 + t * 1000;
  if (mode === "per-event") return samples.map(s => ({ timeStamp: ts(s.t), movementX: s.dx, movementY: s.dy, coalesced: null }));
  const frames = new Map<number, InputSample[]>();
  for (const s of samples) {
    const f = Math.ceil(s.t * fps - 1e-9);
    if (!frames.has(f)) frames.set(f, []);
    frames.get(f)!.push(s);
  }
  const out: RawParent[] = [];
  for (const [f, list] of [...frames.entries()].sort((a, b) => a[0] - b[0])) {
    const mx = list.reduce((a, s) => a + s.dx, 0), my = list.reduce((a, s) => a + s.dy, 0);
    if (mode === "coalesced") {
      out.push({ timeStamp: ts(list[list.length - 1].t), movementX: mx, movementY: my, coalesced: list.map(s => ({ timeStamp: ts(s.t), movementX: s.dx, movementY: s.dy })) });
    } else {
      out.push({ timeStamp: ts(f / fps), movementX: mx, movementY: my, coalesced: null });
    }
  }
  return out;
}
