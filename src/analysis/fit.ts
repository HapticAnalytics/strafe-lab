import { mean } from "../core/math";
import { CONF_HIGH_RMSE, CONF_HIGH_SPREAD, CONF_MED_SPREAD, SWEET_SPOT_DROP } from "./constants";

export interface Pt { x: number; y: number; cm: number; r2?: boolean }
interface Quad { c: number[]; xm: number; f: (x: number) => number }
interface Peak { x: number; curved: boolean; q: Quad | null; edge: boolean; xmin: number; xmax: number }

export interface Fit {
  pts: Pt[]; f: ((x: number) => number) | null; peakCm: number; peakY: number; lo: number; hi: number;
  edge: boolean; curved: boolean; spread: number | null; rmse: number | null;
}

export function solve3(A: number[][], b: number[]): number[] | null {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    if (Math.abs(M[p][i]) < 1e-9) return null;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < 3; r++) if (r !== i) { const k = M[r][i] / M[i][i]; for (let c = i; c < 4; c++) M[r][c] -= k * M[i][c]; }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

/** Least squares y = a(x-xm)^2 + b(x-xm) + c, with x = ln(cm/360). */
export function quadFit(pts: Pt[]): Quad | null {
  const xm = mean(pts.map(p => p.x));
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], V = [0, 0, 0];
  for (const p of pts) {
    const x = p.x - xm, r = [x * x, x, 1];
    for (let i = 0; i < 3; i++) { V[i] += r[i] * p.y; for (let j = 0; j < 3; j++) S[i][j] += r[i] * r[j]; }
  }
  const c = solve3(S, V);
  if (!c) return null;
  return { c, xm, f: x => c[0] * (x - xm) ** 2 + c[1] * (x - xm) + c[2] };
}

export function peakOf(pts: Pt[]): Peak {
  const xs = pts.map(p => p.x), xmin = Math.min(...xs), xmax = Math.max(...xs);
  let best = pts[0];
  for (const p of pts) if (p.y > best.y) best = p;
  const q = pts.length >= 3 ? quadFit(pts) : null;
  if (q && q.c[0] < 0) {
    const v = q.xm - q.c[1] / (2 * q.c[0]);
    if (v >= xmin && v <= xmax) return { x: v, curved: true, q, edge: false, xmin, xmax };
    return { x: v < xmin ? xmin : xmax, curved: false, q, edge: true, xmin, xmax };
  }
  return { x: best.x, curved: false, q, edge: best.x === xmin || best.x === xmax, xmin, xmax };
}

export function fitCurve(blocks: { cm: number; score: number }[]): Fit {
  const pts: Pt[] = blocks.map(b => ({ x: Math.log(b.cm), y: b.score, cm: b.cm }));
  const pk = peakOf(pts), f = pk.q ? pk.q.f : null;
  const peakY = pk.curved && f ? f(pk.x) : Math.max(...pts.map(p => p.y));
  let lo = pk.x, hi = pk.x;
  if (pk.curved && f) {
    for (let i = 0; i <= 300; i++) {
      const x = pk.xmin + ((pk.xmax - pk.xmin) * i) / 300;
      if (f(x) >= peakY - SWEET_SPOT_DROP) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    }
  }
  // stability: refit leaving each block out; spread of the peak = how dialed-in the answer is
  const loo: number[] = [];
  if (pts.length >= 5) for (let i = 0; i < pts.length; i++) loo.push(Math.exp(peakOf(pts.filter((_, j) => j !== i)).x));
  const spread = loo.length ? ((Math.max(...loo) - Math.min(...loo)) / 2 / Math.exp(pk.x)) * 100 : null;
  const rmse = f ? Math.sqrt(mean(pts.map(p => (p.y - f(p.x)) ** 2))) : null;
  return { pts, f, peakCm: Math.exp(pk.x), peakY, lo: Math.exp(lo), hi: Math.exp(hi), edge: pk.edge, curved: pk.curved, spread, rmse };
}

export function confidence(fit: Fit): { level: "high" | "medium" | "low"; why: string } {
  if (fit.edge || !fit.curved) return { level: "low", why: "your best score sat at the edge of the tested range" };
  if (fit.spread != null && fit.spread <= CONF_HIGH_SPREAD && fit.rmse! < CONF_HIGH_RMSE)
    return { level: "high", why: `the peak moves less than ±${Math.max(1, Math.round(fit.spread))}% when any single block is removed` };
  if (fit.spread != null && fit.spread <= CONF_MED_SPREAD)
    return { level: "medium", why: `the peak moves about ±${Math.round(fit.spread)}% when any single block is removed` };
  return { level: "low", why: "your scores were noisy from block to block" };
}
