export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export const mean = (a: number[]): number => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/** Wrap an angle in radians to [-π, π). */
export const wrap = (a: number): number => {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
};

export const fmt = (v: number | null | undefined, d = 1): string =>
  v == null || !isFinite(v) ? "—" : (+v).toFixed(d);
