// Milestone 5 Aim Fingerprint. Findings are within-person: either a contrast that should be ~0 for a balanced
// player (left/right, trailing/leading, vertical/horizontal), or a metric that has moved past the player's own
// baseline. Nothing is compared with other players (no population data exists; ROADMAP says no percentiles).
// Rule (ROADMAP acceptance): a finding appears only when it exceeds the noise floor in at least two sessions.
import { mean } from "../core/math";
import type { SessionLog } from "../telemetry/schema";
import { dayOf, MIN_DAYS, noiseFloor, type NoiseFloor } from "./baseline";
import { batteryMetrics, type MetricPoint } from "./battery";
import { slope } from "./stats";

// HYPOTHESIS: "exceeds the noise floor in >= 2 sessions" (ROADMAP). Test: synthetic sessions in tests/fingerprint.test.ts.
export const MIN_SESSIONS_OVER = 2;
// HYPOTHESIS: confidence bands by the share of recent sessions over the floor (last 5)
export const RECENT_N = 5;
export const CONF_HIGH_SHARE = 0.8;
export const CONF_MED_SHARE = 0.5;

export interface Evidence { sessionId: string; at: string; value: number; over: boolean }

export interface Finding {
  key: string;
  kind: "contrast" | "regression";
  title: string;
  /** mean value across sessions over the floor, in the metric's unit */
  value: number; unit: string;
  /** |value| / SDC95 */
  severity: number;
  confidence: "high" | "medium" | "low";
  /** per-session slope of the value (unit per session); sign relative to "getting worse" */
  trend: "worse" | "better" | "flat";
  evidence: Evidence[];
  floor: NoiseFloor;
  explanations: string[];
  interventions: string[];
}

interface Library { title: (v: number) => string; explanations: (v: number) => string[]; interventions: (v: number) => string[] }

// Explanations and interventions are hypotheses about *why*, not measurements. The UI labels them that way.
const LIB: Record<string, Library> = {
  "contrast:asym": {
    title: v => `Stronger tracking ${v > 0 ? "leftward" : "rightward"}-moving targets`,
    explanations: v => [`Wrist/arm mechanics differ by direction: ${v > 0 ? "pulling the mouse left" : "pushing it right"} is easier for many right-handed players.`, "Mousepad or desk edge limits movement on one side.", "Grip pressure changes with direction."],
    interventions: v => [`Extra tracking reps on ${v > 0 ? "rightward" : "leftward"} strafes (mid-range drill), focusing on smooth follow-through.`, "Check pad position: centre the mouse where your arm rests."],
  },
  "contrast:trail": {
    title: v => (v > 0 ? "Reacting to strafes instead of matching them (trailing)" : "Over-leading strafes"),
    explanations: v => v > 0 ? ["Visual reaction delay: the crosshair follows where the target was.", "Sens too slow for the target speed (check sens-finder per-skill results)."] : ["Anticipating direction changes too early.", "Sens fast enough that small hand movements overshoot."],
    interventions: v => v > 0 ? ["Close reactive drill: aim to keep the crosshair on the target's leading edge.", "Watch the replay at 0.25× around flagged reversals."] : ["Mid-range drill at reduced intensity: match speed, don't predict.", "Replay overshoot flags to see when the lead starts."],
  },
  "contrast:vh": {
    title: v => (v > 0 ? "Vertical misses larger than horizontal" : "Horizontal misses larger than vertical"),
    explanations: v => v > 0 ? ["Crosshair height not following crouches and jumps.", "Holding a fixed height instead of tracking the chest."] : ["Strafe tracking is the main limiter (expected for most players)."],
    interventions: v => v > 0 ? ["Vertical drill: track through jumps and crouch spam.", "Practise resetting height after each crouch."] : ["Close and mid tracking drills."],
  },
};

const regressionLib: Library = {
  title: () => "",
  explanations: () => ["Fatigue, sleep or warm-up differences on the test days.", "A setup change (sens, DPI, mousepad, FPS).", "Genuine skill change."],
  interventions: () => ["Check the setup is unchanged, then re-test on a rested day before acting on it."],
};

const confOf = (ev: Evidence[]): Finding["confidence"] => {
  const recent = ev.slice(-RECENT_N), share = recent.filter(e => e.over).length / recent.length;
  return share >= CONF_HIGH_SHARE ? "high" : share >= CONF_MED_SHARE ? "medium" : "low";
};

/** Baseline = the battery sessions of the first MIN_DAYS distinct days; the floor is computed from those. */
export function baselineSessions(battery: SessionLog[]): SessionLog[] {
  const sorted = [...battery].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const days: string[] = [];
  const out: SessionLog[] = [];
  for (const s of sorted) {
    const d = dayOf(s.startedAt);
    if (!days.includes(d)) { if (days.length >= MIN_DAYS) break; days.push(d); }
    out.push(s);
  }
  return out;
}

/** metricsOf is injectable so the rule can be tested without replaying drills. */
export function fingerprint(battery: SessionLog[], metricsOf: (s: SessionLog) => MetricPoint[] = batteryMetrics): { findings: Finding[]; ready: boolean; baselineIds: string[] } {
  const sorted = [...battery].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const base = baselineSessions(sorted);
  const baseIds = base.map(s => s.id);
  const ready = new Set(base.map(s => dayOf(s.startedAt))).size >= MIN_DAYS;
  if (!ready) return { findings: [], ready, baselineIds: baseIds };
  const pointsOf = (s: SessionLog) => new Map(metricsOf(s).map(p => [p.key, p] as [string, MetricPoint]));
  const all = sorted.map(s => ({ s, pts: pointsOf(s) }));
  const keys = [...new Set(all.flatMap(x => [...x.pts.keys()]))];
  const findings: Finding[] = [];
  for (const key of keys) {
    const proto = all.find(x => x.pts.has(key))!.pts.get(key)!;
    const floor = noiseFloor({ key, label: proto.label, unit: proto.unit, higherIsBetter: proto.higherIsBetter, byDay: base.filter(s => pointsOf(s).has(key)).map(s => ({ day: dayOf(s.startedAt), value: pointsOf(s).get(key)!.value })) });
    if (!floor.ready || !floor.sdc95) continue;
    const series = all.filter(x => x.pts.has(key)).map(x => ({ s: x.s, v: x.pts.get(key)!.value }));
    if (key.startsWith("contrast:")) {
      // contrast: distance from 0 (perfect balance); the sign must agree with the overall mean
      const sign = Math.sign(mean(series.map(x => x.v)));
      const ev: Evidence[] = series.map(x => ({ sessionId: x.s.id, at: x.s.startedAt, value: x.v, over: Math.sign(x.v) === sign && Math.abs(x.v) > floor.sdc95! }));
      const over = ev.filter(e => e.over);
      if (over.length < MIN_SESSIONS_OVER) continue;
      const v = mean(over.map(e => e.value)), lib = LIB[key];
      const tr = slope(series.map((_, i) => i), series.map(x => Math.abs(x.v)));
      findings.push({
        key, kind: "contrast", title: lib.title(v), value: v, unit: proto.unit, severity: Math.abs(v) / floor.sdc95, confidence: confOf(ev),
        trend: Math.abs(tr) * series.length < floor.sdc95 ? "flat" : tr > 0 ? "worse" : "better",
        evidence: ev, floor, explanations: lib.explanations(v), interventions: lib.interventions(v),
      });
    } else {
      // regression: worse than the baseline mean by more than SDC95 (post-baseline sessions only)
      const post = series.filter(x => !baseIds.includes(x.s.id));
      const worse = (v: number) => (proto.higherIsBetter ? floor.mean - v : v - floor.mean);
      const ev: Evidence[] = post.map(x => ({ sessionId: x.s.id, at: x.s.startedAt, value: x.v, over: worse(x.v) > floor.sdc95! }));
      const over = ev.filter(e => e.over);
      if (over.length < MIN_SESSIONS_OVER) continue;
      const v = mean(over.map(e => e.value));
      const tr = slope(post.map((_, i) => i), post.map(x => worse(x.v)));
      findings.push({
        key, kind: "regression", title: `${proto.label} is worse than your baseline`, value: v, unit: proto.unit, severity: worse(v) / floor.sdc95,
        confidence: confOf(ev), trend: Math.abs(tr) * post.length < floor.sdc95 ? "flat" : tr > 0 ? "worse" : "better",
        evidence: ev, floor, explanations: regressionLib.explanations(v), interventions: regressionLib.interventions(v),
      });
    }
  }
  return { findings: findings.sort((a, b) => b.severity - a.severity), ready, baselineIds: baseIds };
}
