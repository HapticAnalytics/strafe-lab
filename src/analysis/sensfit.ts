// Sensitivity Intelligence v3 statistics: score ~ quadratic in ln(cm/360) + play-order terms (learning/fatigue),
// bootstrap CI on the peak, explicit "no clear winner". Deterministic (seeded bootstrap).
import { mean } from "../core/math";
import { mulberry32 } from "../core/rng";

export interface Obs { cm: number; order: number; y: number }

// HYPOTHESIS: order terms need enough blocks to be estimable: linear from 7 blocks, quadratic from 16.
// In simulation a quadratic order term at 10-13 blocks cost more precision than the bias it removed, so no current
// mode uses it; it stays available for longer protocols.
export const ORDER_LIN_MIN = 7;
export const ORDER_QUAD_MIN = 16;
// APPROX: 1000 bootstrap resamples (Monte-Carlo error of a 95% percentile CI is small at this B)
export const BOOT_B = 1000;
// HYPOTHESIS: "no clear winner" when the 95% CI covers > 60% of the tested log range, or < 60% of resamples have an
// interior peak. Test: simulated flat-curve players must trigger it; peaked ones must not (tests/sensfinder.test.ts).
export const NCW_RANGE_FRAC = 0.6;
export const NCW_INTERIOR_MIN = 0.6;
// HYPOTHESIS: a single setting is reported only when the CI is within about ±8% (hi/lo <= 1.17), matching the
// ROADMAP recovery target.
export const SINGLE_RATIO = 1.17;

/** Solve A x = b (Gaussian elimination with partial pivoting). Returns null if singular. */
export function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    if (Math.abs(M[p][i]) < 1e-10) return null;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < n; r++) if (r !== i) { const k = M[r][i] / M[i][i]; for (let c = i; c <= n; c++) M[r][c] -= k * M[i][c]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

export interface ModelFit {
  beta: number[]; xm: number; om: number; orderTerms: 0 | 1 | 2;
  f: (x: number, order?: number) => number;
  rmse: number;
}

export function fitModel(obs: Obs[], orderTerms?: 0 | 1 | 2): ModelFit | null {
  const n = obs.length;
  const ot = orderTerms ?? (n >= ORDER_QUAD_MIN ? 2 : n >= ORDER_LIN_MIN ? 1 : 0);
  const xm = mean(obs.map(o => Math.log(o.cm))), om = mean(obs.map(o => o.order));
  const row = (x: number, o: number) => { const r = [1, x - xm, (x - xm) ** 2]; if (ot >= 1) r.push(o - om); if (ot >= 2) r.push((o - om) ** 2); return r; };
  const p = 3 + ot;
  if (n < p) return null;
  const A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0);
  for (const o of obs) { const r = row(Math.log(o.cm), o.order); for (let i = 0; i < p; i++) { b[i] += r[i] * o.y; for (let j = 0; j < p; j++) A[i][j] += r[i] * r[j]; } }
  const beta = solve(A, b);
  if (!beta) return null;
  const f = (x: number, order = om) => row(x, order).reduce((s, v, i) => s + v * beta[i], 0);
  const rmse = Math.sqrt(mean(obs.map(o => (o.y - f(Math.log(o.cm), o.order)) ** 2)));
  return { beta, xm, om, orderTerms: ot as 0 | 1 | 2, f, rmse };
}

/** Peak in ln(cm) within [xmin, xmax]; interior only if the curve bends down and the vertex is inside. */
export function peakX(m: ModelFit, xmin: number, xmax: number): { x: number; interior: boolean } {
  const a = m.beta[2], b = m.beta[1];
  if (a < 0) {
    const v = m.xm - b / (2 * a);
    if (v >= xmin && v <= xmax) return { x: v, interior: true };
    return { x: v < xmin ? xmin : xmax, interior: false };
  }
  return { x: m.f(xmin) >= m.f(xmax) ? xmin : xmax, interior: false };
}

export interface SensEstimate {
  n: number;
  peakCm: number; ciLo: number; ciHi: number;
  /** fraction of bootstrap resamples with an interior peak */
  interiorFrac: number;
  edge: "fast" | "slow" | null;
  noClearWinner: boolean;
  /** true when the CI is narrow enough to justify recommending one value */
  single: boolean;
  /** score points per block at the first and last block (from the order terms); null if not estimated */
  learnStart: number | null; learnEnd: number | null;
  rmse: number;
  testedLo: number; testedHi: number;
  fit: ModelFit;
}

const pct = (sorted: number[], q: number) => {
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

export function estimate(obs: Obs[], seed = 12345, B = BOOT_B): SensEstimate | null {
  const fit = fitModel(obs);
  if (!fit) return null;
  const xs = obs.map(o => Math.log(o.cm)), xmin = Math.min(...xs), xmax = Math.max(...xs);
  const pk = peakX(fit, xmin, xmax);
  const rng = mulberry32(seed), peaks: number[] = [];
  let interior = 0;
  for (let b = 0; b < B; b++) {
    const s = obs.map(() => obs[Math.floor(rng() * obs.length)]);
    // a resample needs >= 3 distinct sens values to define a curve
    if (new Set(s.map(o => o.cm)).size < 3) continue;
    const m = fitModel(s, fit.orderTerms) ?? fitModel(s, 0);
    if (!m) continue;
    const p = peakX(m, xmin, xmax);
    peaks.push(p.x); if (p.interior) interior++;
  }
  peaks.sort((a, b) => a - b);
  const lo = peaks.length ? pct(peaks, 0.025) : xmin, hi = peaks.length ? pct(peaks, 0.975) : xmax;
  const interiorFrac = peaks.length ? interior / peaks.length : 0;
  const noClearWinner = !pk.interior || hi - lo > NCW_RANGE_FRAC * (xmax - xmin) || interiorFrac < NCW_INTERIOR_MIN;
  let learnStart: number | null = null, learnEnd: number | null = null;
  if (fit.orderTerms >= 1) {
    const o0 = Math.min(...obs.map(o => o.order)), o1 = Math.max(...obs.map(o => o.order));
    const d = (o: number) => fit.beta[3] + (fit.orderTerms === 2 ? 2 * fit.beta[4] * (o - fit.om) : 0);
    learnStart = d(o0); learnEnd = d(o1);
  }
  return {
    n: obs.length, peakCm: Math.exp(pk.x), ciLo: Math.exp(lo), ciHi: Math.exp(hi), interiorFrac,
    edge: pk.interior ? null : pk.x <= xmin ? "fast" : "slow",
    noClearWinner, single: !noClearWinner && Math.exp(hi - lo) <= SINGLE_RATIO,
    learnStart, learnEnd, rmse: fit.rmse, testedLo: Math.exp(xmin), testedHi: Math.exp(xmax), fit,
  };
}
