import { clamp } from "../core/math";
import type { Fit } from "../analysis/fit";

export function chartSVG(fit: Pick<Fit, "pts" | "f" | "peakCm" | "lo" | "hi" | "curved">, currentCm: number | null, opts: { peakLabel?: string } = {}): string {
  const { pts, f, peakCm, lo, hi, curved } = fit;
  const W = 640, H = 290, m = { l: 46, r: 18, t: 18, b: 44 };
  const cms = pts.map(p => p.cm).concat(currentCm ? [currentCm] : []);
  const x0 = Math.log(Math.min(...cms) * 0.92), x1 = Math.log(Math.max(...cms) * 1.08);
  const ys = pts.map(p => p.y);
  let y0 = Math.floor((Math.min(...ys) - 6) / 10) * 10, y1 = Math.ceil((Math.max(...ys) + 6) / 10) * 10;
  y0 = Math.max(0, y0); y1 = Math.min(100, Math.max(y1, y0 + 20));
  const X = (cm: number) => m.l + ((Math.log(cm) - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v: number) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tracking score by sensitivity">`;
  for (let v = y0; v <= y1; v += 10) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v}</text>`;
  const span = Math.exp(x1) - Math.exp(x0), step = span > 60 ? 10 : 5;
  for (let c = Math.ceil(Math.exp(x0) / step) * step; c <= Math.exp(x1); c += step) s += `<line x1="${X(c)}" x2="${X(c)}" y1="${H - m.b}" y2="${H - m.b + 5}" stroke="var(--muted)"/><text x="${X(c)}" y="${H - m.b + 18}" text-anchor="middle" font-size="11" fill="var(--muted)">${c}</text>`;
  s += `<text x="${(W + m.l) / 2}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--muted)">cm/360 · left = faster, right = slower</text>`;
  if (curved) s += `<rect x="${X(lo)}" y="${m.t}" width="${Math.max(2, X(hi) - X(lo))}" height="${H - m.t - m.b}" fill="var(--signal)" opacity=".10"/>`;
  if (f) {
    let d = "";
    const a = Math.log(Math.min(...pts.map(p => p.cm))), b = Math.log(Math.max(...pts.map(p => p.cm)));
    for (let i = 0; i <= 80; i++) { const x = a + ((b - a) * i) / 80, v = clamp(f(x), y0, y1); d += (i ? "L" : "M") + X(Math.exp(x)).toFixed(1) + " " + Y(v).toFixed(1); }
    s += `<path d="${d}" fill="none" stroke="var(--data)" stroke-width="2.5"/>`;
  }
  if (currentCm) s += `<line x1="${X(currentCm)}" x2="${X(currentCm)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--muted)" stroke-dasharray="4 4"/><text x="${X(currentCm) + 5}" y="${m.t + 12}" font-size="11" fill="var(--muted)">current</text>`;
  for (const p of pts) s += `<circle cx="${X(p.cm)}" cy="${Y(p.y)}" r="5" fill="var(--panel)" stroke="${p.r2 ? "var(--signal)" : "var(--ink)"}" stroke-width="2"/>`;
  s += `<line x1="${X(peakCm)}" x2="${X(peakCm)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--signal)" stroke-width="2"/><text x="${X(peakCm) > W - 110 ? X(peakCm) - 6 : X(peakCm) + 6}" text-anchor="${X(peakCm) > W - 110 ? "end" : "start"}" y="${H - m.b - 8}" font-size="12" fill="var(--signal)">${opts.peakLabel || "best"}</text>`;
  return s + "</svg>";
}
