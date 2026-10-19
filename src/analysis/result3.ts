// Sensitivity Intelligence v3 result, recomputed from the stored event log only.
import { sensFromCm, cmPer360 } from "../core/units";
import type { BlockLog, SessionLog } from "../telemetry/schema";
import { estimate, type SensEstimate } from "./sensfit";
import { combinedScore, scoreSkill, SKILLS, type SkillId, type SkillResult } from "./skills";

export interface V3Block {
  index: number; cm: number; phase: "warm" | "sweep" | "zoom"; order: number;
  skills: Partial<Record<SkillId, SkillResult>>;
  combined: number;
}

export interface V3Result {
  blocks: V3Block[];
  scored: V3Block[];
  overall: SensEstimate | null;
  perSkill: Partial<Record<SkillId, SensEstimate | null>>;
  baseCm: number;
  /** in-game values for the recommendation (sens at the user's DPI); lo/hi from the CI */
  rec: { sens: number; sensLo: number; sensHi: number; slider: number } | null;
}

const blockCache = new WeakMap<BlockLog, V3Block>();

export function v3Block(b: BlockLog, dpi: number, order: number): V3Block {
  const hit = blockCache.get(b);
  if (hit) return hit;
  const skills: Partial<Record<SkillId, SkillResult>> = {};
  for (const d of Object.values(b.drills)) {
    if (!d) continue;
    const r = scoreSkill(d, dpi);
    if (r) skills[r.id] = r;
  }
  const scores = Object.fromEntries(Object.entries(skills).map(([k, v]) => [k, v!.score])) as Partial<Record<SkillId, number>>;
  const out: V3Block = { index: b.index, cm: b.cm360, phase: b.warm ? "warm" : b.round === 2 ? "zoom" : "sweep", order, skills, combined: combinedScore(scores) };
  blockCache.set(b, out);
  return out;
}

/** Phase-1 peak used to centre the zoom (no bootstrap needed, only the point estimate). */
export function sweepPeak(s: SessionLog): number | null {
  const scored = s.blocks.filter(b => !b.warm).map((b, i) => v3Block(b, s.settings.dpi, i));
  const e = estimate(scored.map(b => ({ cm: b.cm, order: b.order, y: b.combined })), 1, 50);
  return e ? e.peakCm : null;
}

export function computeV3(s: SessionLog): V3Result {
  const { dpi, sens } = s.settings;
  let order = 0;
  const blocks = s.blocks.map(b => v3Block(b, dpi, b.warm ? -1 : order++));
  const scored = blocks.filter(b => b.phase !== "warm");
  const overall = scored.length >= 3 ? estimate(scored.map(b => ({ cm: b.cm, order: b.order, y: b.combined }))) : null;
  const perSkill: V3Result["perSkill"] = {};
  for (const id of SKILLS) {
    const obs = scored.filter(b => b.skills[id]).map(b => ({ cm: b.cm, order: b.order, y: b.skills[id]!.score }));
    if (obs.length >= 3) perSkill[id] = estimate(obs, 99, 400);
  }
  const rec = overall ? { sens: sensFromCm(overall.peakCm, dpi), sensLo: sensFromCm(overall.ciHi, dpi), sensHi: sensFromCm(overall.ciLo, dpi), slider: Math.round(sensFromCm(overall.peakCm, dpi) * 10) / 10 } : null;
  return { blocks, scored, overall, perSkill, baseCm: cmPer360(sens, dpi), rec };
}
