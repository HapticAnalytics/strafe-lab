// Small, dependency-free statistics helpers (VERIFIED: standard definitions; algorithms from Numerical Recipes).
import { mean } from "../core/math";

/** Sample standard deviation (n - 1). */
export function sd(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** ln Gamma(x) (Lanczos approximation, g = 7, n = 9; accurate to ~1e-15 for x > 0). */
export function lnGamma(x: number): number {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularised lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  const gln = lnGamma(a);
  if (x < a + 1) {
    let sum = 1 / a, del = sum, ap = a;
    for (let n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-15) break; }
    return sum * Math.exp(-x + a * Math.log(x) - gln);
  }
  // continued fraction for Q, P = 1 - Q
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - gln) * h;
}

export const chi2Cdf = (x: number, df: number): number => gammaP(df / 2, x / 2);

/** Inverse chi-square CDF by bisection. */
export function chi2Inv(p: number, df: number): number {
  let lo = 0, hi = Math.max(10, df * 10);
  while (chi2Cdf(hi, df) < p) hi *= 2;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (chi2Cdf(m, df) < p) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/** 95% CI multipliers for an SD estimated with df degrees of freedom: [lo, hi] x sample SD. */
export function sdCiFactors(df: number): [number, number] {
  return [Math.sqrt(df / chi2Inv(0.975, df)), Math.sqrt(df / chi2Inv(0.025, df))];
}

/** Ordinary least-squares slope of y on x. */
export function slope(x: number[], y: number[]): number {
  const mx = mean(x), my = mean(y);
  let n = 0, d = 0;
  for (let i = 0; i < x.length; i++) { n += (x[i] - mx) * (y[i] - my); d += (x[i] - mx) ** 2; }
  return d ? n / d : 0;
}
