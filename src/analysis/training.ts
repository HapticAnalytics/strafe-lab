// Milestone 7: training scores, adaptive levels reconstructed from logs, and the trained vs held-out report.
import { clamp, mean } from "../core/math";
import { FAMILIES, FAMILY_NAMES, nextLevel, startLevels, type Family, type Levels } from "../sim/nemesis";
import { replay } from "../sim/evaluator";
import { buildScenario } from "../sim/scenario";
import { isEventLog, type EventDrillLog, type SessionLog } from "../telemetry/schema";
import { changeInFloors } from "./baseline";
import type { TrendSeries } from "./dashboard";

export interface SegmentScore { family: Family; level: number; score: number; at: string; sessionId: string }

/** Success score of one Nemesis segment: time on target %, or damage rate % vs perfect body tracking (2 targets). */
export function scoreNemesis(d: EventDrillLog): number {
  const sc = buildScenario(d.id, d.seed, d.dur, d.params);
  const ev = replay(sc, d.k, d.events, d.tEnd);
  if (sc.damage) return clamp((ev.dealt / (sc.damage.body * ev.endT)) * 100, 0, 100);
  const n = ev.samples.length;
  return n ? (ev.samples.filter(s => s.on).length / n) * 100 : 0;
}

const cache = new WeakMap<EventDrillLog, number>();
const scoreOf = (d: EventDrillLog) => { let v = cache.get(d); if (v === undefined) { v = scoreNemesis(d); cache.set(d, v); } return v; };

/** All Nemesis segments of training sessions, in play order. */
export function segments(train: SessionLog[]): SegmentScore[] {
  const out: SegmentScore[] = [];
  for (const s of [...train].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    for (const b of s.blocks) for (const d of Object.values(b.drills)) {
      if (!d || !isEventLog(d) || d.id !== "nem" || !d.params) continue;
      out.push({ family: d.params.family, level: d.params.level, score: scoreOf(d), at: s.startedAt, sessionId: s.id });
    }
  }
  return out;
}

/** Levels to start the next session at: replay the staircase over every logged segment. Pure function of the logs. */
export function levelsFrom(train: SessionLog[]): Levels {
  const lv = startLevels();
  for (const g of segments(train)) lv[g.family] = nextLevel(g.level, g.score);
  return lv;
}

export interface TrainedRow { family: Family; label: string; sessions: number; firstLevel: number; lastLevel: number; change: number; sources: string[] }
export interface HeldOutRow { key: string; label: string; unit: string; baseline: number; latest: number; changeFloors: number | null; sources: string[] }

/**
 * ROADMAP Milestone 7 acceptance: improvement on held-out scenarios is reported separately from trained ones.
 * Trained = difficulty level reached in Nemesis training (first vs last session). Held-out = battery metrics (fixed
 * seeds never used in training) vs the baseline, in noise-floor units.
 */
export function trainedVsHeldOut(train: SessionLog[], batteryTrends: TrendSeries[], baselineIds: string[]): { trained: TrainedRow[]; heldOut: HeldOutRow[] } {
  const segs = segments(train);
  const trained: TrainedRow[] = [];
  for (const f of FAMILIES) {
    const bySession = new Map<string, number[]>();
    for (const g of segs.filter(x => x.family === f)) { if (!bySession.has(g.sessionId)) bySession.set(g.sessionId, []); bySession.get(g.sessionId)!.push(g.level); }
    const ids = [...bySession.keys()];
    if (!ids.length) continue;
    const first = mean(bySession.get(ids[0])!), last = mean(bySession.get(ids[ids.length - 1])!);
    trained.push({ family: f, label: FAMILY_NAMES[f], sessions: ids.length, firstLevel: first, lastLevel: last, change: last - first, sources: ids });
  }
  const base = new Set(baselineIds);
  const heldOut: HeldOutRow[] = [];
  for (const t of batteryTrends) {
    const post = t.points.filter(p => !base.has(p.sessionId));
    if (!t.floor.ready || !post.length) continue;
    const last = post[post.length - 1];
    heldOut.push({ key: t.key, label: t.label, unit: t.unit, baseline: t.floor.mean, latest: last.value, changeFloors: changeInFloors(t.floor, t.floor.mean, last.value), sources: [...baselineIds, last.sessionId] });
  }
  return { trained, heldOut };
}

export const trainSessions = (all: SessionLog[]) => all.filter(s => s.protocol === "train" && (s.status === "complete" || s.status === "abandoned"));
