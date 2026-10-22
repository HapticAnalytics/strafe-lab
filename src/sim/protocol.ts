// Sensitivity Intelligence v3 test protocol: modes, block plans, counterbalanced order and seeds.
// Pure functions of (current sens, mode, session seed, phase-1 result).
import { clamp } from "../core/math";
import { mulberry32, shuffle, type Rng } from "../core/rng";
import type { SkillId } from "../analysis/skills";
import type { DrillId } from "./drills";

export type Mode = "quick" | "standard" | "deep";

export interface ModeDef {
  label: string;
  skills: SkillId[];
  /** seconds per scored skill segment, and for the unscored acclimation segment at the start of every block */
  segDur: number;
  accDur: number;
  /** wide sweep: number of log-spaced candidates */
  sweepN: number;
  /** zoom: multipliers around the phase-1 peak, each repeated zoomReps times in ABBA order */
  zoom: number[];
  zoomReps: number;
}

const ALL: SkillId[] = ["pb", "mid", "duo", "vert", "turn", "click", "flick", "long"];

// HYPOTHESIS: drills are 10 s (Deep 12 s) after player feedback (2026-10-22) that 4-6 s drills were too short to play
// properly. Sessions: Quick ~6.5, Standard ~15, Deep ~24 min (the original 3-4 / 6-8 / 12-15 min targets were dropped).
// Block counts are unchanged; recovery accuracy is checked by simulation (tests/sensfinder.test.ts) and then by real
// test-retest, and ROADMAP says the durations are re-set from measured reliability.
export const MODES: Record<Mode, ModeDef> = {
// Zoom width 0.8/1.25 beat 0.9/1.1 in simulation (80% vs 63% within ±8% at sigma 3; see tests/sensfinder.test.ts).
  quick: { label: "Quick", skills: ["pb", "mid", "duo", "flick"], segDur: 10, accDur: 4, sweepN: 5, zoom: [0.8, 1, 1.25], zoomReps: 1 },
  standard: { label: "Standard", skills: ALL, segDur: 10, accDur: 4, sweepN: 6, zoom: [0.8, 1.25], zoomReps: 2 },
  deep: { label: "Deep", skills: ALL, segDur: 12, accDur: 5, sweepN: 7, zoom: [0.8, 1, 1.25], zoomReps: 2 },
};

// HYPOTHESIS: the best sens lies within a factor of 2 either side of the current sens. If the peak lands at the
// edge, the result says so and asks for a re-run centred on it.
export const SWEEP_FACTOR = 2;
// APPROX: practical cm/360 limits (8 cm is extremely fast; 100 cm needs a very large pad)
export const CM_MIN = 8;
export const CM_MAX = 100;
// APPROX: gap between segments (banner), seconds; used for duration estimates only
export const GAP_S = 0.8;

/** family: Nemesis segments only; their parameters are generated from the current level when the segment starts */
export interface Segment { id: DrillId; seed: number; dur: number; family?: import("./nemesis").Family; combat?: import("./combat").CombatSpec }
export interface PlannedBlock { cm: number; phase: "sweep" | "zoom"; acc: Segment; segments: Segment[] }

/** Deterministic 32-bit seed for (session, block, slot). */
export function seedFor(sessionSeed: number, block: number, slot: number): number {
  let h = (sessionSeed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (block + 1) * 0x85ebca6b, 0xc2b2ae35) >>> 0;
  h = Math.imul(h ^ (slot + 1) * 0x27d4eb2f, 0x165667b1) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/** First row of a Williams design for n treatments: 0, 1, n-1, 2, n-2, ... (balances first-order carryover). */
export function williamsRow(n: number, shift: number): number[] {
  const base: number[] = [];
  for (let i = 0, lo = 1, hi = n - 1; i < n; i++) {
    if (i === 0) base.push(0);
    else if (i % 2 === 1) base.push(lo++);
    else base.push(hi--);
  }
  return base.map(v => (v + shift) % n);
}

export function sweepCandidates(baseCm: number, n: number): number[] {
  const lo = clamp(baseCm / SWEEP_FACTOR, CM_MIN, CM_MAX), hi = clamp(baseCm * SWEEP_FACTOR, lo * 1.5, CM_MAX);
  return Array.from({ length: n }, (_, i) => Math.exp(Math.log(lo) + ((Math.log(hi) - Math.log(lo)) * i) / (n - 1)));
}

function block(sessionSeed: number, index: number, cm: number, phase: PlannedBlock["phase"], m: ModeDef, rng: Rng): PlannedBlock {
  // skill order is shuffled per block so no skill is always first (fresh) or last (tired)
  const skills = shuffle([...m.skills], rng);
  return {
    cm, phase,
    acc: { id: "acc", seed: seedFor(sessionSeed, index, 99), dur: m.accDur },
    segments: skills.map((id, j) => ({ id, seed: seedFor(sessionSeed, index, j), dur: m.segDur })),
  };
}

/** Phase 1: wide log sweep in a Williams-design order chosen by the session seed. */
export function planSweep(baseCm: number, mode: Mode, sessionSeed: number): PlannedBlock[] {
  const m = MODES[mode], rng = mulberry32(sessionSeed);
  const c = sweepCandidates(baseCm, m.sweepN);
  const order = williamsRow(m.sweepN, Math.floor(rng() * m.sweepN));
  if (rng() < 0.5) order.reverse();
  return order.map((ci, i) => block(sessionSeed, i, c[ci], "sweep", m, rng));
}

/** Phase 2: zoom around the phase-1 peak, each candidate repeated in ABBA order (cancels linear drift). */
export function planZoom(peakCm: number, mode: Mode, sessionSeed: number, startIndex: number): PlannedBlock[] {
  const m = MODES[mode], rng = mulberry32((sessionSeed ^ 0x5bd1e995) >>> 0);
  const c = m.zoom.map(z => clamp(peakCm * z, CM_MIN, CM_MAX));
  const a = shuffle(c.map((_, i) => i), rng);
  const order: number[] = [];
  for (let r = 0; r < m.zoomReps; r++) order.push(...(r % 2 === 0 ? a : [...a].reverse()));
  return order.map((ci, i) => block(sessionSeed, startIndex + i, c[ci], "zoom", m, rng));
}

export function estimatedMinutes(mode: Mode): number {
  const m = MODES[mode];
  const blocks = m.sweepN + m.zoom.length * m.zoomReps;
  const perBlock = m.accDur + m.skills.length * m.segDur + (m.skills.length + 1) * GAP_S;
  return (blocks * perBlock) / 60;
}
