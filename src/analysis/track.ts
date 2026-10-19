import { clamp, mean, wrap } from "../core/math";
import { DEG } from "../core/units";
import { DPS_BODY } from "../sim/constants";
import { DRILLS } from "../sim/drills";
import { buildScenario } from "../sim/scenario";
import { replay } from "../sim/evaluator";
import { isEventLog, type BlockLog, type DrillLog, type DuoExtra, type Frame } from "../telemetry/schema";
import { computeM1, type M1Metrics } from "./metrics";
import {
  JITTER_HALF_WINDOW, MAX_FRAME_GAP, MOVING_THRESHOLD, NEAR_DEG, OSC_HALFWIDTHS, PEAK_MIN_DT, PEAK_WINDOW,
  RECOVER_GRACE, RECOVER_LOOKBACK, RECOVER_UNRECOVERED_MS, RECOVER_WINDOW, SCORE_WEIGHTS,
} from "./constants";

export interface TrackMetrics {
  on: number; head: number; behind: number; vertMiss: number; left: number; right: number;
  recover: number; jitter: number; oscPerSec: number; pitchErr: number; targetSpeed: number;
  handTravel: number; handPeak: number;
}
export interface DuoMetrics extends TrackMetrics {
  killTime: number | null; firstKill: number | null; dealt: number; headDmgPct: number;
  switchMs: number | null; score: number;
}
export interface BlockMetrics {
  pb: TrackMetrics; close: TrackMetrics; mid: TrackMetrics; duo: DuoMetrics;
  score: number; order: number;
  /** Milestone 1 metrics; null for v1 (per-frame) sessions */
  m1: Record<"pb" | "close" | "mid" | "duo", M1Metrics> | null;
}

/** Pure function of the logged frames. Percent metrics are time-weighted. */
export function analyzeTrack(fr: Frame[], dpi: number): TrackMetrics {
  let tot = 0, on = 0, head = 0, behind = 0, ahead = 0, vert = 0, off = 0, osc = 0, tgtSpeed = 0;
  const L = { t: 0, on: 0 }, R = { t: 0, on: 0 };
  const revs: number[] = [], close: { t: number; e: number }[] = [], perr: number[] = [];
  let lastSign = 0, lastE = 0;
  for (let i = 1; i < fr.length; i++) {
    const a = fr[i], p = fr[i - 1], dt = clamp(a.t - p.t, 0, MAX_FRAME_GAP);
    if (!dt) continue;
    tot += dt; if (a.on) on += dt; if (a.on === 2) head += dt;
    const dTy = wrap(a.ty - p.ty) / dt, e = wrap(a.ty - a.yaw);
    tgtSpeed += (Math.abs(dTy) / DEG) * dt;
    perr.push((a.tp - a.pitch) / DEG);
    if (Math.abs(e) < NEAR_DEG * DEG) close.push({ t: a.t, e: e / DEG });
    if (Math.abs(e) < a.hw * OSC_HALFWIDTHS && lastE && Math.sign(e) !== Math.sign(lastE)) osc++;
    lastE = e;
    const moving = Math.abs(dTy) > MOVING_THRESHOLD;
    if (moving) {
      const side = dTy > 0 ? L : R; side.t += dt; if (a.on) side.on += dt;
      const sg = Math.sign(dTy); if (lastSign && sg !== lastSign) revs.push(i); lastSign = sg;
    }
    if (!a.on) {
      off += dt;
      if (Math.abs(e) < a.hw) vert += dt;
      else if (moving) { if (Math.sign(e) === Math.sign(dTy)) behind += dt; else ahead += dt; }
    }
  }
  // recovery after the enemy changes direction
  const rec: number[] = [];
  for (const i0 of revs) {
    const rt = fr[i0].t;
    let wasOn = false;
    for (let k = i0 - 1; k >= 0 && rt - fr[k].t < RECOVER_LOOKBACK; k--) if (fr[k].on) wasOn = true;
    if (!wasOn) continue;
    let lostAt: number | null = null, back: number | null = null;
    for (let i = i0; i < fr.length && fr[i].t - rt < RECOVER_WINDOW; i++) {
      if (lostAt === null) { if (!fr[i].on) lostAt = fr[i].t; else if (fr[i].t - rt > RECOVER_GRACE) break; }
      else if (fr[i].on) { back = fr[i].t; break; }
    }
    rec.push(lostAt === null ? 0 : back === null ? RECOVER_UNRECOVERED_MS : (back - rt) * 1000);
  }
  // jitter: wobble of the aim error around its own local average while near the target
  let j2 = 0, jn = 0;
  for (let i = 0; i < close.length; i++) {
    let s = 0, c = 0;
    for (let k = i; k >= 0 && close[i].t - close[k].t <= JITTER_HALF_WINDOW; k--) { s += close[k].e; c++; }
    for (let k = i + 1; k < close.length && close[k].t - close[i].t <= JITTER_HALF_WINDOW; k++) { s += close[k].e; c++; }
    const d = close[i].e - s / c; j2 += d * d; jn++;
  }
  // hand movement: travel and peak speed (cm, cm/s), from raw counts
  const cm = (c: number) => (c / dpi) * 2.54;
  let peak = 0;
  for (let i = 0, j = 0; i < fr.length; i++) {
    while (fr[i].t - fr[j].t > PEAK_WINDOW) j++;
    const dt = fr[i].t - fr[j].t;
    if (dt >= PEAK_MIN_DT) peak = Math.max(peak, cm(fr[i].c - fr[j].c) / dt);
  }
  const lr = behind + ahead || 1;
  return {
    on: tot ? (on / tot) * 100 : 0, head: tot ? (head / tot) * 100 : 0,
    behind: (behind / lr) * 100, vertMiss: off ? (vert / off) * 100 : 0,
    left: L.t ? (L.on / L.t) * 100 : 0, right: R.t ? (R.on / R.t) * 100 : 0,
    recover: rec.length ? mean(rec) : 0, jitter: jn ? Math.sqrt(j2 / jn) : 0,
    oscPerSec: tot ? osc / tot : 0, pitchErr: mean(perr),
    targetSpeed: tot ? tgtSpeed / tot : 0,
    handTravel: fr.length ? cm(fr[fr.length - 1].c - fr[0].c) : 0, handPeak: peak,
  };
}

export type RangeId = "pb" | "close" | "mid" | "duo";
export const RANGE_IDS: RangeId[] = ["pb", "close", "mid", "duo"];

/** Everything derived from one drill log. v1 (frames) logs have no M1 metrics. */
interface DrillView { frames: Frame[]; extra: DuoExtra | null; m1: M1Metrics | null; elapsed: number }

/** Replay an event log through the shared evaluator; frames for the V2 metrics come from the 1 kHz samples. */
export function viewDrill(d: DrillLog | undefined, dpi: number): DrillView {
  if (!d) return { frames: [], extra: null, m1: null, elapsed: 0 };
  if (!isEventLog(d)) return { frames: d.frames, extra: d.extra ?? null, m1: null, elapsed: d.extra?.elapsed || DRILLS.duo.dur };
  const sc = buildScenario(d.id, d.seed, d.dur);
  const ev = replay(sc, d.k, d.events, d.tEnd);
  const frames: Frame[] = ev.samples.map(s => ({ t: s.t, yaw: s.yaw, pitch: s.pitch, ty: s.ty, tp: s.tp, on: s.on, hw: s.hw, c: s.c }));
  const extra: DuoExtra | null = sc.damage ? { kills: ev.kills, dmgBody: ev.dmgBody, dmgHead: ev.dmgHead, elapsed: ev.endT, dealt: ev.dealt } : null;
  return { frames, extra, m1: computeM1(ev.samples, dpi, ev.kills), elapsed: ev.endT };
}

const cache = new WeakMap<BlockLog, { dpi: number; m: BlockMetrics }>();

/** Reads only the block's log (never rendered state). Memoised per block object (logs are immutable once stored). */
export function analyzeBlock(b: BlockLog, dpi: number): BlockMetrics {
  const hit = cache.get(b);
  if (hit && hit.dpi === dpi) return hit.m;
  const m = analyzeBlockUncached(b, dpi);
  cache.set(b, { dpi, m });
  return m;
}

function analyzeBlockUncached(b: BlockLog, dpi: number): BlockMetrics {
  const v = Object.fromEntries(RANGE_IDS.map(id => [id, viewDrill(b.drills[id], dpi)])) as Record<RangeId, DrillView>;
  const pb = analyzeTrack(v.pb.frames, dpi), close = analyzeTrack(v.close.frames, dpi), mid = analyzeTrack(v.mid.frames, dpi);
  const base = analyzeTrack(v.duo.frames, dpi);
  const x = v.duo.extra;
  const elapsed = v.duo.elapsed || DRILLS.duo.dur, dealt = x?.dealt || 0, k = x?.kills ?? [];
  const dmgTotal = (x?.dmgBody ?? 0) + (x?.dmgHead ?? 0);
  let switchMs: number | null = null;
  if (v.duo.m1) switchMs = v.duo.m1.switchMs;
  else if (k.length) {
    const fr = v.duo.frames, t0 = fr.length ? fr[0].t + k[0].t : 0;
    const back = fr.find(f => f.t > t0 + 0.02 && f.on);
    switchMs = back ? (back.t - t0) * 1000 : null;
  }
  const duo: DuoMetrics = {
    ...base,
    killTime: k.length === 2 ? k[1].t : null,
    firstKill: k.length ? k[0].t : null,
    dealt,
    headDmgPct: dmgTotal ? ((x?.dmgHead ?? 0) / dmgTotal) * 100 : 0,
    switchMs,
    // duo score: damage rate vs perfect body-only R-99 tracking (198 DPS); 100 = never off target
    score: clamp((dealt / (DPS_BODY * elapsed)) * 100, 0, 100),
  };
  const score = SCORE_WEIGHTS.pb * pb.on + SCORE_WEIGHTS.close * close.on + SCORE_WEIGHTS.mid * mid.on + SCORE_WEIGHTS.duo * duo.score;
  const m1 = v.pb.m1 ? { pb: v.pb.m1, close: v.close.m1!, mid: v.mid.m1!, duo: v.duo.m1! } : null;
  return { pb, close, mid, duo, score, order: b.index, m1 };
}
