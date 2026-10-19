// Tracked metrics from one battery session (Milestone 3). Every value is recomputed from the event log.
import { mean } from "../core/math";
import type { SessionLog } from "../telemetry/schema";
import { dayOf, noiseFloor, type MetricSeries, type NoiseFloor } from "./baseline";
import type { M1Metrics } from "./metrics";
import { combinedScore, scoreSkill, SKILL_NAMES, SKILLS, type SkillId, type SkillResult } from "./skills";

export interface MetricPoint { key: string; label: string; unit: string; higherIsBetter: boolean; value: number }

const M1_TRACKED: [keyof M1Metrics, string, string, boolean][] = [
  ["errHNorm", "horizontal error", "× half-width", false],
  ["jitterHDeg", "jitter", "°", false],
  ["reversalLatencyMs", "reversal response", "ms", false],
  ["reacquireMs", "reacquire", "ms", false],
  ["overshootPerS", "overshoots", "/s", false],
  ["trailingPct", "trailing share", "%", false],
];
const TRACKING: SkillId[] = ["pb", "mid", "vert", "long"];

const cache = new WeakMap<SessionLog, MetricPoint[]>();

export function batteryMetrics(s: SessionLog): MetricPoint[] {
  const hit = cache.get(s);
  if (hit) return hit;
  const per = new Map<SkillId, SkillResult[]>();
  for (const b of s.blocks) for (const d of Object.values(b.drills)) {
    if (!d) continue;
    const r = scoreSkill(d, s.settings.dpi);
    if (!r) continue;
    if (!per.has(r.id)) per.set(r.id, []);
    per.get(r.id)!.push(r);
  }
  const out: MetricPoint[] = [];
  const scores: Partial<Record<SkillId, number>> = {};
  for (const id of SKILLS) {
    const list = per.get(id);
    if (!list?.length) continue;
    scores[id] = mean(list.map(r => r.score));
    out.push({ key: `skill:${id}`, label: `${SKILL_NAMES[id]} · score`, unit: "pts", higherIsBetter: true, value: scores[id]! });
    if (TRACKING.includes(id)) {
      for (const [k, label, unit, hib] of M1_TRACKED) {
        const v = list.map(r => r.m1?.[k] as number | null).filter((x): x is number => x != null && isFinite(x));
        if (v.length) out.push({ key: `m1:${id}:${k}`, label: `${SKILL_NAMES[id]} · ${label}`, unit, higherIsBetter: hib, value: mean(v) });
      }
    }
    if (id === "duo") {
      const sw = list.map(r => r.detail.switchMs).filter((x): x is number => x != null);
      if (sw.length) out.push({ key: "duo:switchMs", label: `${SKILL_NAMES.duo} · switch time`, unit: "ms", higherIsBetter: false, value: mean(sw) });
    }
    if (id === "turn" || id === "flick" || id === "click") {
      const t = list.map(r => r.detail.medianMs).filter((x): x is number => x != null);
      if (t.length) out.push({ key: `spawn:${id}:ms`, label: `${SKILL_NAMES[id]} · median time`, unit: "ms", higherIsBetter: false, value: mean(t) });
    }
  }
  // Within-person contrasts for the Aim Fingerprint (Milestone 5), averaged over horizontal tracking skills.
  // Each is 0 for a perfectly balanced player, so no population norm is needed.
  const horiz = (["pb", "mid", "long"] as SkillId[]).flatMap(id => per.get(id) ?? []).map(r => r.m1).filter((m): m is M1Metrics => !!m);
  const avg = (f: (m: M1Metrics) => number | null) => { const v = horiz.map(f).filter((x): x is number => x != null && isFinite(x)); return v.length ? mean(v) : null; };
  const asym = avg(m => m.asymmetryPct), trail = avg(m => (m.trailingPct + m.leadingPct > 0 ? m.trailingPct - 50 : null)), vh = avg(m => m.errVNorm - m.errHNorm);
  if (asym != null) out.push({ key: "contrast:asym", label: "Left − right time on target", unit: "pts", higherIsBetter: false, value: asym });
  if (trail != null) out.push({ key: "contrast:trail", label: "Trailing − 50% of misses", unit: "pts", higherIsBetter: false, value: trail });
  if (vh != null) out.push({ key: "contrast:vh", label: "Vertical − horizontal error", unit: "× size", higherIsBetter: false, value: vh });
  out.unshift({ key: "battery:combined", label: "Battery combined score", unit: "pts", higherIsBetter: true, value: combinedScore(scores) });
  cache.set(s, out);
  return out;
}

/** Series per metric across battery sessions (one point per session; noiseFloor averages within a day). */
export function batterySeries(sessions: SessionLog[]): MetricSeries[] {
  const g = new Map<string, MetricSeries>();
  for (const s of sessions) for (const p of batteryMetrics(s)) {
    if (!g.has(p.key)) g.set(p.key, { key: p.key, label: p.label, unit: p.unit, higherIsBetter: p.higherIsBetter, byDay: [] });
    g.get(p.key)!.byDay.push({ day: dayOf(s.startedAt), value: p.value });
  }
  return [...g.values()];
}

export const batteryFloors = (sessions: SessionLog[]): NoiseFloor[] => batterySeries(sessions).map(noiseFloor);
