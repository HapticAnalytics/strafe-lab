// Milestone 1 metrics. Pure functions of the 1 kHz replay samples (sim/evaluator.ts), so every value is a
// function of the logged input events and the scenario seed only, never of the render frame rate.
// All "percent" metrics are time-weighted. Angles in degrees unless noted.
import { mean, wrap } from "../core/math";
import { DEG } from "../core/units";
import type { Kill, Sample } from "../sim/evaluator";

// APPROX: angular velocities are central differences over +/-10 ms; crosshair angle is a step function between
// mouse events, so some smoothing is required. 10 ms covers >= 10 polls at 1000 Hz.
export const VEL_HALF_WINDOW = 0.01;
// APPROX: a target counts as moving above 5 deg/s
export const MOVING_DEG_S = 5;
// APPROX: "near" the target for jitter: within 3 deg (V2 value)
export const NEAR_DEG = 3;
// APPROX: jitter high-pass = deviation from a +/-40 ms moving average (V2 value; ~12 Hz corner)
export const JITTER_HALF_WINDOW = 0.04;
// APPROX: a correction is a run of relative (crosshair minus target) angular speed above 15 deg/s lasting >= 20 ms
export const CORR_THRESH_DEG_S = 15;
export const CORR_MIN_DUR = 0.02;
// APPROX: overshoot = after the error changes sign, it grows past one target half-width within 200 ms
export const OVERSHOOT_WINDOW = 0.2;
// APPROX: a reversal needs the target moving above MOVING_DEG_S, averaged over 50-100 ms before and after the sign
// change (skipping the first 50 ms either side, where speed passes through zero)
export const REVERSAL_SIDE = 0.05;
// APPROX: the player has responded once crosshair yaw velocity matches the new direction above MOVING_DEG_S; look up to 600 ms
export const REVERSAL_WINDOW = 0.6;
// APPROX: a "loss" needs at least 50 ms on target first, then at least 30 ms off (shorter spells are edge flicker,
// found in Milestone 4 replays); reacquisition searched until drill end
export const LOSS_MIN_ON = 0.05;
export const LOSS_MIN_OFF = 0.03;
// APPROX: stabilised = relative speed below 10 deg/s for 100 ms while on target, within 1 s of acquisition
export const STAB_THRESH_DEG_S = 10;
export const STAB_HOLD = 0.1;
export const STAB_WINDOW = 1.0;
// APPROX: consistency/drift use 2 s windows
export const WINDOW_S = 2;
// APPROX: target angular-speed bins (deg/s) for on-target vs speed
export const SPEED_BINS = [0, 10, 20, 40, 80, Infinity];
// APPROX: hand speed/accel smoothing +/-10 ms (same as VEL_HALF_WINDOW)

export interface SpeedBin { lo: number; hi: number; seconds: number; on: number | null }

export interface M1Metrics {
  seconds: number;
  onPct: number; headPct: number;
  errHDeg: number; errVDeg: number;
  /** mean |error| / target angular half-width (horizontal) and half-height (vertical) */
  errHNorm: number; errVNorm: number;
  trailingPct: number; leadingPct: number;
  overshootPerS: number; overshootMagNorm: number | null;
  undershootPerS: number;
  jitterHDeg: number; jitterVDeg: number;
  correctionsPerS: number; correctionAmpDeg: number | null;
  handSpeedMean: number; handSpeedPeak: number; handAccelPeak: number;
  reversalLatencyMs: number | null; reversalsSeen: number; reversalsMissed: number;
  reacquireMs: number | null; losses: number;
  stabilizeMs: number | null;
  switchMs: number | null;
  speedBins: SpeedBin[];
  leftOnPct: number | null; rightOnPct: number | null; asymmetryPct: number | null;
  windowSdPct: number | null; driftPctPerS: number | null;
}

const median = (a: number[]): number | null => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Central-difference derivative of an unwrapped series over +/-w seconds on a uniform grid. */
function deriv(v: Float64Array, dt: number, w: number): Float64Array {
  const n = v.length, h = Math.max(1, Math.round(w / dt)), out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - h), b = Math.min(n - 1, i + h);
    out[i] = b > a ? (v[b] - v[a]) / ((b - a) * dt) : 0;
  }
  return out;
}

/** Centered moving average over +/-w seconds, via prefix sums. */
function movingAvg(v: Float64Array, dt: number, w: number): Float64Array {
  const n = v.length, h = Math.max(1, Math.round(w / dt)), p = new Float64Array(n + 1), out = new Float64Array(n);
  for (let i = 0; i < n; i++) p[i + 1] = p[i] + v[i];
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - h), b = Math.min(n - 1, i + h); out[i] = (p[b + 1] - p[a]) / (b - a + 1); }
  return out;
}

/** Unwrap an angle series so derivatives don't jump at ±π. */
function unwrap(xs: number[]): Float64Array {
  const out = new Float64Array(xs.length);
  for (let i = 0; i < xs.length; i++) out[i] = i ? out[i - 1] + wrap(xs[i] - xs[i - 1]) : xs[i];
  return out;
}

/** Flagged moments, from exactly the same detection as the metrics (Milestone 4 replay). Times in seconds. */
export interface FlaggedEvents {
  reversals: { t: number; latencyMs: number | null }[];
  losses: { t: number; reacquireMs: number | null }[];
  overshoots: { t: number; magNorm: number }[];
}
/** Per-tick series for timelines: target / crosshair yaw rates (rad/s), horizontal / vertical error (rad). */
export interface M1Series { wt: Float64Array; wc: Float64Array; eh: Float64Array; ev: Float64Array }

export function computeM1(S: Sample[], dpi: number, kills: Kill[] = []): M1Metrics {
  return analyzeM1(S, dpi, kills).metrics;
}

export function analyzeM1(S: Sample[], dpi: number, kills: Kill[] = []): { metrics: M1Metrics; events: FlaggedEvents; series: M1Series } {
  const events: FlaggedEvents = { reversals: [], losses: [], overshoots: [] };
  const n = S.length, dt = n > 1 ? S[1].t - S[0].t : 0.001;
  const T = n * dt;
  const yaw = unwrap(S.map(s => s.yaw));
  // the engaged target can switch (2v1): remove the bearing jump at a switch so it isn't read as target motion
  const ty = new Float64Array(n);
  for (let i = 0; i < n; i++) ty[i] = i ? ty[i - 1] + (S[i].target === S[i - 1].target ? wrap(S[i].ty - S[i - 1].ty) : 0) : S[i].ty;
  const wt = deriv(ty, dt, VEL_HALF_WINDOW), wc = deriv(yaw, dt, VEL_HALF_WINDOW);
  const eh = new Float64Array(n), ev = new Float64Array(n);
  for (let i = 0; i < n; i++) { eh[i] = wrap(S[i].ty - S[i].yaw); ev[i] = S[i].tp - S[i].pitch; }
  const mv = MOVING_DEG_S * DEG;

  // time on target, errors
  let on = 0, head = 0, aeh = 0, aev = 0, neh = 0, nev = 0;
  for (let i = 0; i < n; i++) {
    if (S[i].on) on++; if (S[i].on === 2) head++;
    aeh += Math.abs(eh[i]); aev += Math.abs(ev[i]);
    neh += Math.abs(eh[i]) / S[i].hw; nev += Math.abs(ev[i]) / Math.max(1e-6, S[i].vh);
  }

  // trailing / leading: off target horizontally while the target moves
  let trail = 0, lead = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(wt[i]) <= mv || Math.abs(eh[i]) <= S[i].hw) continue;
    if (Math.sign(eh[i]) === Math.sign(wt[i])) trail++; else lead++;
  }

  // overshoot: error changes sign then exceeds one half-width on the new side within the window
  let overs = 0; const overMag: number[] = [];
  const ow = Math.round(OVERSHOOT_WINDOW / dt);
  for (let i = 1; i < n; i++) {
    if (S[i].target !== S[i - 1].target) continue;
    if (eh[i - 1] === 0 || Math.sign(eh[i]) === Math.sign(eh[i - 1])) continue;
    const sg = Math.sign(eh[i]);
    let peak = 0;
    for (let j = i; j < Math.min(n, i + ow) && Math.sign(eh[j]) === sg; j++) peak = Math.max(peak, Math.abs(eh[j]) / S[j].hw);
    if (peak > 1) { overs++; overMag.push(peak); events.overshoots.push({ t: S[i].t, magNorm: peak }); }
  }

  // corrections: runs of relative angular speed above threshold with constant sign
  const wr = new Float64Array(n);
  for (let i = 0; i < n; i++) wr[i] = wc[i] - wt[i];
  const ct = CORR_THRESH_DEG_S * DEG, cmin = Math.round(CORR_MIN_DUR / dt);
  let corr = 0, under = 0; const amps: number[] = [];
  for (let i = 0; i < n;) {
    if (Math.abs(wr[i]) <= ct) { i++; continue; }
    const sg = Math.sign(wr[i]); let j = i, amp = 0;
    while (j < n && Math.abs(wr[j]) > ct && Math.sign(wr[j]) === sg) { amp += wr[j] * dt; j++; }
    if (j - i >= cmin) {
      corr++; amps.push(Math.abs(amp) / DEG);
      const end = Math.min(n - 1, j);
      // undershoot: the correction ended still off target on the same side it started from
      if (Math.abs(eh[end]) > S[end].hw && Math.sign(eh[end]) === Math.sign(eh[i]) && Math.abs(eh[i]) > S[i].hw) under++;
    }
    i = j;
  }

  // jitter: RMS of the high-passed error while near the target
  const mh = movingAvg(eh, dt, JITTER_HALF_WINDOW), mvv = movingAvg(ev, dt, JITTER_HALF_WINDOW);
  let jh = 0, jv = 0, jn = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(eh[i]) >= NEAR_DEG * DEG) continue;
    jh += (eh[i] - mh[i]) ** 2; jv += (ev[i] - mvv[i]) ** 2; jn++;
  }

  // hand speed and acceleration (cm/s, cm/s^2) from cumulative counts
  const cm = new Float64Array(n);
  for (let i = 0; i < n; i++) cm[i] = (S[i].c / dpi) * 2.54;
  const vh = deriv(cm, dt, VEL_HALF_WINDOW), ah = deriv(vh, dt, VEL_HALF_WINDOW);
  let vsum = 0, vpk = 0, apk = 0;
  for (let i = 0; i < n; i++) { vsum += vh[i]; vpk = Math.max(vpk, vh[i]); apk = Math.max(apk, Math.abs(ah[i])); }

  // reversal response latency
  const side = Math.round(REVERSAL_SIDE / dt), rw = Math.round(REVERSAL_WINDOW / dt);
  const lat: number[] = []; let revSeen = 0, revMissed = 0;
  for (let i = 2 * side; i < n - 2 * side; i++) {
    if (Math.sign(wt[i]) === Math.sign(wt[i - 1]) || S[i].target !== S[i - 1].target) continue;
    let before = 0, after = 0;
    for (let j = i - 2 * side; j < i - side; j++) before += wt[j];
    for (let j = i + side; j < i + 2 * side; j++) after += wt[j];
    before /= side; after /= side;
    if (Math.abs(before) <= mv || Math.abs(after) <= mv || Math.sign(before) === Math.sign(after)) continue;
    revSeen++;
    const sg = Math.sign(after);
    let r = -1;
    for (let j = i; j < Math.min(n, i + rw); j++) if (Math.sign(wc[j]) === sg && Math.abs(wc[j]) > mv) { r = j; break; }
    if (r < 0) revMissed++; else lat.push((r - i) * dt * 1000);
    events.reversals.push({ t: S[i].t, latencyMs: r < 0 ? null : (r - i) * dt * 1000 });
    i += side; // one reversal per side window
  }

  // losses -> reacquisition, acquisitions -> stabilisation
  const lmin = Math.round(LOSS_MIN_ON / dt), sh = Math.round(STAB_HOLD / dt), sw = Math.round(STAB_WINDOW / dt);
  const reacq: number[] = [], stab: number[] = []; let losses = 0, onRun = 0;
  for (let i = 0; i < n; i++) {
    if (S[i].on) { onRun++; continue; }
    let j = i; while (j < n && !S[j].on) j++;
    if (onRun >= lmin && (j - i) * dt >= LOSS_MIN_OFF - 1e-9) {
      losses++;
      events.losses.push({ t: S[i].t, reacquireMs: j < n ? (j - i) * dt * 1000 : null });
      if (j < n) {
        reacq.push((j - i) * dt * 1000);
        let calm = 0;
        for (let q = j; q < Math.min(n, j + sw); q++) {
          if (S[q].on && Math.abs(wr[q]) < STAB_THRESH_DEG_S * DEG) { if (++calm >= sh) { stab.push((q - sh + 1 - j) * dt * 1000); break; } } else calm = 0;
        }
      }
    }
    onRun = 0;
  }

  // switch time (2v1): first kill -> first tick on the other enemy
  let switchMs: number | null = null;
  if (kills.length) {
    const k0 = kills[0], other = 1 - k0.i;
    const s = S.find(x => x.t >= k0.t && x.on && x.target === other);
    if (s) switchMs = (s.t - k0.t) * 1000;
  }

  // on-target by target angular speed
  const speedBins: SpeedBin[] = [];
  for (let b = 0; b < SPEED_BINS.length - 1; b++) {
    let tt = 0, oo = 0;
    for (let i = 0; i < n; i++) { const s = Math.abs(wt[i]) / DEG; if (s >= SPEED_BINS[b] && s < SPEED_BINS[b + 1]) { tt++; if (S[i].on) oo++; } }
    speedBins.push({ lo: SPEED_BINS[b], hi: SPEED_BINS[b + 1], seconds: tt * dt, on: tt ? (oo / tt) * 100 : null });
  }

  // left/right: positive yaw rate = target moving left on screen
  let lt = 0, lo = 0, rt = 0, ro = 0;
  for (let i = 0; i < n; i++) {
    if (wt[i] > mv) { lt++; if (S[i].on) lo++; } else if (wt[i] < -mv) { rt++; if (S[i].on) ro++; }
  }
  const leftOnPct = lt ? (lo / lt) * 100 : null, rightOnPct = rt ? (ro / rt) * 100 : null;

  // within-drill consistency and drift on 2 s windows
  const wn = Math.round(WINDOW_S / dt), wins: { t: number; on: number }[] = [];
  for (let a = 0; a + wn <= n; a += wn) { let o = 0; for (let i = a; i < a + wn; i++) if (S[i].on) o++; wins.push({ t: S[a].t + WINDOW_S / 2, on: (o / wn) * 100 }); }
  let windowSdPct: number | null = null, driftPctPerS: number | null = null;
  if (wins.length >= 2) {
    const m = mean(wins.map(w => w.on));
    windowSdPct = Math.sqrt(wins.reduce((s, w) => s + (w.on - m) ** 2, 0) / (wins.length - 1));
    const tm = mean(wins.map(w => w.t));
    let num = 0, den = 0; for (const w of wins) { num += (w.t - tm) * (w.on - m); den += (w.t - tm) ** 2; }
    driftPctPerS = den ? num / den : 0;
  }

  const metrics: M1Metrics = {
    seconds: T,
    onPct: n ? (on / n) * 100 : 0, headPct: n ? (head / n) * 100 : 0,
    errHDeg: n ? aeh / n / DEG : 0, errVDeg: n ? aev / n / DEG : 0,
    errHNorm: n ? neh / n : 0, errVNorm: n ? nev / n : 0,
    trailingPct: trail + lead ? (trail / (trail + lead)) * 100 : 0,
    leadingPct: trail + lead ? (lead / (trail + lead)) * 100 : 0,
    overshootPerS: T ? overs / T : 0, overshootMagNorm: overMag.length ? mean(overMag) : null,
    undershootPerS: T ? under / T : 0,
    jitterHDeg: jn ? Math.sqrt(jh / jn) / DEG : 0, jitterVDeg: jn ? Math.sqrt(jv / jn) / DEG : 0,
    correctionsPerS: T ? corr / T : 0, correctionAmpDeg: amps.length ? mean(amps) : null,
    handSpeedMean: n ? vsum / n : 0, handSpeedPeak: vpk, handAccelPeak: apk,
    reversalLatencyMs: median(lat), reversalsSeen: revSeen, reversalsMissed: revMissed,
    reacquireMs: median(reacq), losses,
    stabilizeMs: median(stab),
    switchMs,
    speedBins,
    leftOnPct, rightOnPct, asymmetryPct: leftOnPct != null && rightOnPct != null ? leftOnPct - rightOnPct : null,
    windowSdPct, driftPctPerS,
  };
  return { metrics, events, series: { wt, wc, eh, ev } };
}
