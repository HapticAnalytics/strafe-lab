// Milestone 3: baseline variance and noise floor. Single-user design: we cannot compute a between-subject ICC (one
// subject), so reliability is expressed as day-to-day SD of each metric and the smallest detectable change
// SDC95 = 1.96 * sqrt(2) * SD (VERIFIED: classical test theory; see RESEARCH.md §4). Any later "improvement" must
// exceed SDC95 to count.
import { mean } from "../core/math";
import type { ExternalResult, SessionLog } from "../telemetry/schema";
import { sd, sdCiFactors } from "./stats";

// VERIFIED: 1.96 = two-sided 95% normal quantile; sqrt(2) because a change compares two noisy measurements
export const SDC_FACTOR = 1.96 * Math.SQRT2;
// HYPOTHESIS: 3 separate days is the minimum for a usable noise floor (ROADMAP); more days narrow the SD's CI
export const MIN_DAYS = 3;

export interface MetricSeries { key: string; label: string; unit: string; higherIsBetter: boolean; byDay: { day: string; value: number }[] }

export interface NoiseFloor {
  key: string; label: string; unit: string; higherIsBetter: boolean;
  days: number; mean: number; sd: number | null; sdc95: number | null;
  /** 95% CI of the SD (chi-square), null below 2 days */
  sdCi: [number, number] | null;
  ready: boolean;
}

/** Calendar day (local) of an ISO timestamp. */
export const dayOf = (iso: string): string => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** Several measurements on one day are averaged first, so "days" are the unit of replication. */
export function noiseFloor(s: MetricSeries): NoiseFloor {
  const days = new Map<string, number[]>();
  for (const p of s.byDay) { if (!isFinite(p.value)) continue; if (!days.has(p.day)) days.set(p.day, []); days.get(p.day)!.push(p.value); }
  const vals = [...days.values()].map(v => mean(v));
  const n = vals.length;
  const sdv = n >= 2 ? sd(vals) : null;
  let ci: [number, number] | null = null;
  if (sdv != null) { const [a, b] = sdCiFactors(n - 1); ci = [sdv * a, sdv * b]; }
  return {
    key: s.key, label: s.label, unit: s.unit, higherIsBetter: s.higherIsBetter,
    days: n, mean: n ? mean(vals) : NaN, sd: sdv, sdc95: sdv != null ? SDC_FACTOR * sdv : null, sdCi: ci, ready: n >= MIN_DAYS,
  };
}

/** Change between two values in noise-floor units (positive = better). null if no floor yet. */
export function changeInFloors(f: NoiseFloor, before: number, after: number): number | null {
  if (!f.sdc95) return null;
  const d = (after - before) / f.sdc95;
  return f.higherIsBetter ? d : -d;
}

/** Series from external (manually entered) results, grouped by protocol + measure name. */
export function externalSeries(list: ExternalResult[]): MetricSeries[] {
  const g = new Map<string, MetricSeries>();
  for (const r of list) {
    const key = `ext:${r.kind}:${r.measure}:${r.unit}`;
    if (!g.has(key)) g.set(key, { key, label: `${r.kind === "firing-range" ? "Firing Range" : r.kind === "r5" ? "R5 Reloaded" : "Aim trainer"} · ${r.measure}`, unit: r.unit, higherIsBetter: r.higherIsBetter, byDay: [] });
    g.get(key)!.byDay.push({ day: dayOf(r.at), value: r.value });
  }
  return [...g.values()];
}

export const batterySessions = (all: SessionLog[]) => all.filter(s => s.protocol === "battery" && s.status === "complete");
