// Milestone 2 skill scores (0-100 per drill segment), computed from the replayed event log.
import { clamp, mean } from "../core/math";
import type { DrillId } from "../sim/drills";
import { replay, type SpawnResult } from "../sim/evaluator";
import { buildScenario } from "../sim/scenario";
import { isEventLog, type DrillLog } from "../telemetry/schema";
import { computeM1, type M1Metrics } from "./metrics";

export type SkillId = "pb" | "mid" | "duo" | "vert" | "turn" | "click" | "flick" | "long";
export const SKILLS: SkillId[] = ["pb", "mid", "duo", "vert", "turn", "click", "flick", "long"];
export const SKILL_NAMES: Record<SkillId, string> = {
  pb: "Close reactive tracking", mid: "Mid sustained tracking", duo: "Target switching (2v1)", vert: "Vertical tracking",
  turn: "Fast 180° turns", click: "Dynamic clicking", flick: "Shotgun flick + correct", long: "Long-range precision",
};

// HYPOTHESIS: skill weights for the combined score. Long range is a minor weight per ROADMAP; the rest favour close
// SMG fights. Test: Milestone 3 test-retest + Milestone 6 transfer experiments.
export const SKILL_WEIGHTS: Record<SkillId, number> = { pb: 0.18, mid: 0.14, duo: 0.16, vert: 0.12, turn: 0.10, click: 0.10, flick: 0.14, long: 0.06 };

// HYPOTHESIS: spawn-drill score per target = 100 * exp(-time_to_complete / tau). tau chosen so a "good" completion
// (~tau) scores ~37 and an instant one 100. Test: compare sensitivity of these scores across sens in Milestone 3.
export const SPAWN_TAU: Record<"turn" | "flick" | "click", number> = { turn: 0.7, flick: 0.4, click: 0.6 };
// HYPOTHESIS: each missed click costs 25% of that target's score
export const MISS_PENALTY = 0.25;

export interface SkillResult {
  id: SkillId;
  score: number;
  /** tracking skills: M1 metrics; spawn skills: per-target results */
  m1: M1Metrics | null;
  spawns: SpawnResult[] | null;
  /** extra per-skill numbers for the report */
  detail: Record<string, number | null>;
}

/** Score one logged skill segment. Returns null for v1 logs or unknown drills. */
export function scoreSkill(d: DrillLog, dpi: number): SkillResult | null {
  if (!isEventLog(d)) return null;
  const id = d.id as SkillId;
  if (!SKILLS.includes(id)) return null;
  const sc = buildScenario(d.id, d.seed, d.dur);
  const ev = replay(sc, d.k, d.events, d.tEnd);
  if (sc.spawn) {
    const tau = SPAWN_TAU[id as "turn" | "flick" | "click"];
    // only targets that appeared at least `timeout` before the end can be fully judged; a target cut off by the end
    // of the drill is excluded unless it was completed
    const judged = ev.spawns.filter(s => s.done != null || s.at + sc.spawn!.def.timeout <= ev.endT + 1e-9);
    const per = judged.map(s => (s.done == null ? 0 : 100 * Math.exp(-(s.done - s.at) / tau)) * Math.max(0, 1 - MISS_PENALTY * s.misses));
    const times = judged.filter(s => s.done != null).map(s => (s.done! - s.at) * 1000);
    return {
      id, score: per.length ? mean(per) : 0, m1: null, spawns: ev.spawns,
      detail: { targets: judged.length, completed: times.length, medianMs: times.length ? [...times].sort((a, b) => a - b)[times.length >> 1] : null, misses: judged.reduce((a, s) => a + s.misses, 0) },
    };
  }
  const m1 = computeM1(ev.samples, dpi, ev.kills);
  if (sc.damage) {
    // damage rate vs perfect body-only tracking over the time the drill ran; 100 = never off target
    const score = clamp((ev.dealt / (sc.damage.body * ev.endT)) * 100, 0, 100);
    return { id, score, m1, spawns: null, detail: { dealt: ev.dealt, killTime: ev.kills.length === 2 ? ev.kills[1].t : null, switchMs: m1.switchMs } };
  }
  return { id, score: m1.onPct, m1, spawns: null, detail: { onPct: m1.onPct } };
}

export function combinedScore(scores: Partial<Record<SkillId, number>>): number {
  let s = 0, w = 0;
  for (const id of SKILLS) { const v = scores[id]; if (v == null) continue; s += SKILL_WEIGHTS[id] * v; w += SKILL_WEIGHTS[id]; }
  return w ? s / w : 0;
}

export const skillOf = (id: DrillId): SkillId | null => (SKILLS as string[]).includes(id) ? (id as SkillId) : null;
