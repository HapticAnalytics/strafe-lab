// Milestone 7 Nemesis Engine: parameterised scenarios, one difficulty level per family, adapted by a staircase that
// keeps the player inside a target success band. Every segment's parameters are written to the event log, so a
// training segment replays exactly like any other drill.
import { clamp } from "../core/math";
import type { Mix, MoveProfile } from "./drills";

export type Family = "close" | "mid" | "vertical" | "switch" | "long";
export const FAMILIES: Family[] = ["close", "mid", "vertical", "switch", "long"];
export const FAMILY_NAMES: Record<Family, string> = { close: "Close strafes", mid: "Mid-range strafes", vertical: "Vertical movement", switch: "Two-target switching", long: "Long range" };

export interface NemesisParams {
  family: Family;
  /** difficulty level in [0, 1] that produced these parameters */
  level: number;
  dist: number;
  speedScale: number;
  accel: number;
  sub: [number, number];
  jitter: number;
  mix: Mix;
  bound: number;
  /** hitbox width scale */
  size: number;
  targets: 1 | 2;
  /** optional range change: distance = dist + amp * sin(2 pi t / period) (combat scenarios) */
  distOsc?: { amp: number; period: number };
  /** Milestone 9: movement condition (the player moves unless cond is "still") */
  movement?: import("./movement").MovementSpec;
}

interface Anchor { dist: number; speedScale: number; accel: number; sub: [number, number]; jitter: number; mix: Mix; bound: number; size: number }

// APPROX: easy/hard anchors chosen to span "comfortably trackable" to "harder than most real fights" for each family.
// Speeds are scales on the verified Apex movement speeds; nothing here is measured from Apex players.
export const ANCHORS: Record<Family, { easy: Anchor; hard: Anchor; targets: 1 | 2 }> = {
  close: {
    easy: { dist: 7, speedScale: 0.7, accel: 25, sub: [0.45, 0.8], jitter: 0.2, mix: { run: 0.6, adad: 0.4 }, bound: 2.5, size: 1.3 },
    hard: { dist: 3.5, speedScale: 1.1, accel: 60, sub: [0.12, 0.3], jitter: 1.2, mix: { adad: 0.5, crouch: 0.2, jump: 0.15, slide: 0.15 }, bound: 2.6, size: 0.9 },
    targets: 1,
  },
  mid: {
    easy: { dist: 14, speedScale: 0.7, accel: 25, sub: [0.6, 1.0], jitter: 0.2, mix: { run: 0.7, adad: 0.3 }, bound: 6, size: 1.3 },
    hard: { dist: 22, speedScale: 1.1, accel: 55, sub: [0.2, 0.45], jitter: 1.2, mix: { adad: 0.4, sprint: 0.25, crouch: 0.2, jump: 0.15 }, bound: 9, size: 0.9 },
    targets: 1,
  },
  vertical: {
    easy: { dist: 8, speedScale: 0.6, accel: 25, sub: [0.5, 0.9], jitter: 0.2, mix: { run: 0.5, jump: 0.3, crouch: 0.2 }, bound: 1.5, size: 1.3 },
    hard: { dist: 5, speedScale: 1.0, accel: 50, sub: [0.2, 0.4], jitter: 1.2, mix: { jump: 0.5, crouch: 0.4, slide: 0.1 }, bound: 1.5, size: 0.9 },
    targets: 1,
  },
  switch: {
    easy: { dist: 8, speedScale: 0.6, accel: 25, sub: [0.5, 0.9], jitter: 0.2, mix: { run: 0.6, adad: 0.4 }, bound: 2, size: 1.3 },
    hard: { dist: 10, speedScale: 1.05, accel: 55, sub: [0.18, 0.4], jitter: 1.2, mix: { adad: 0.5, crouch: 0.25, jump: 0.25 }, bound: 2.5, size: 0.9 },
    targets: 2,
  },
  long: {
    easy: { dist: 30, speedScale: 0.6, accel: 25, sub: [0.8, 1.4], jitter: 0.2, mix: { run: 0.8, adad: 0.2 }, bound: 6, size: 1.4 },
    hard: { dist: 50, speedScale: 1.0, accel: 45, sub: [0.3, 0.7], jitter: 1.0, mix: { run: 0.4, adad: 0.4, crouch: 0.2 }, bound: 9, size: 1.0 },
    targets: 1,
  },
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Parameters at a difficulty level (0 = easy anchor, 1 = hard anchor). Mix weights interpolate and renormalise. */
export function paramsFor(family: Family, level: number): NemesisParams {
  const L = clamp(level, 0, 1), { easy: e, hard: h, targets } = ANCHORS[family];
  const keys = [...new Set([...Object.keys(e.mix), ...Object.keys(h.mix)])] as (keyof Mix)[];
  const raw = keys.map(k => [k, lerp(e.mix[k] ?? 0, h.mix[k] ?? 0, L)] as const);
  const tot = raw.reduce((a, [, v]) => a + v, 0);
  const mix: Mix = {};
  for (const [k, v] of raw) if (v > 0) mix[k] = v / tot;
  return {
    family, level: L, dist: lerp(e.dist, h.dist, L), speedScale: lerp(e.speedScale, h.speedScale, L), accel: lerp(e.accel, h.accel, L),
    sub: [lerp(e.sub[0], h.sub[0], L), lerp(e.sub[1], h.sub[1], L)], jitter: lerp(e.jitter, h.jitter, L), mix, bound: lerp(e.bound, h.bound, L),
    size: lerp(e.size, h.size, L), targets,
  };
}

export const profileOf = (p: NemesisParams): MoveProfile => ({ mix: p.mix, sub: p.sub, bound: p.bound, speedScale: p.speedScale, accel: p.accel, jitter: p.jitter });

// HYPOTHESIS: a success band of 55-75% (time on target, or damage rate for switching) keeps practice challenging but
// achievable. Test: Milestone 6 experiment comparing bands, judged on the held-out battery.
export const BAND: [number, number] = [55, 75];
// HYPOTHESIS: level step 0.08 per segment (about 12 steps from easy to hard)
export const LEVEL_STEP = 0.08;
// HYPOTHESIS: new players start every family at level 0.3
export const START_LEVEL = 0.3;

/** Staircase: harder after a segment above the band, easier below it, unchanged inside. */
export function nextLevel(level: number, score: number): number {
  if (score > BAND[1]) return clamp(level + LEVEL_STEP, 0, 1);
  if (score < BAND[0]) return clamp(level - LEVEL_STEP, 0, 1);
  return level;
}

export type Levels = Record<Family, number>;
export const startLevels = (): Levels => Object.fromEntries(FAMILIES.map(f => [f, START_LEVEL])) as Levels;
