// Milestone 3 standard battery: fixed, held-out scenarios at the player's own sens, so day-to-day differences
// reflect the player, not the test. Never used for training (training seeds are random 32-bit values).
import type { SkillId } from "../analysis/skills";
import type { Segment } from "./protocol";

const SKILL_ORDER: SkillId[] = ["pb", "mid", "duo", "vert", "turn", "click", "flick", "long"];

// HYPOTHESIS: 4 fixed seed sets, rotated by battery number, limit memorisation while keeping scenarios comparable.
// Different sets differ slightly in difficulty; that variation is included in (inflates) the noise floor.
export const SEED_SETS = 4;
// HYPOTHESIS: 2 rounds x 8 skills x 10 s (+5 s acclimation) is long enough for stable per-skill scores and short
// enough (~3.5 min) to run daily (6 s drills were too short, player feedback 2026-10-22). Test: the noise floor itself.
export const BATTERY_ROUNDS = 2;
export const BATTERY_SEG = 10;
export const BATTERY_ACC = 5;
// APPROX: base value for fixed battery seeds; far from anything a random 32-bit training seed would hit by chance
const BASE_SEED = 7_000_000;

/** One block per round (a block holds one segment per skill); each round starts with a short acclimation. */
export function batteryPlan(seedSet: number): { acc: Segment; segments: Segment[] }[] {
  const set = ((seedSet % SEED_SETS) + SEED_SETS) % SEED_SETS;
  const out: { acc: Segment; segments: Segment[] }[] = [];
  for (let r = 0; r < BATTERY_ROUNDS; r++) {
    // second round in reverse order so position effects average out per skill
    const order = r % 2 === 0 ? SKILL_ORDER : [...SKILL_ORDER].reverse();
    out.push({
      acc: { id: "acc", seed: BASE_SEED + set * 1000 + 900 + r, dur: r === 0 ? BATTERY_ACC : 2 },
      segments: order.map((id, j) => ({ id, seed: BASE_SEED + set * 1000 + r * 100 + j, dur: BATTERY_SEG })),
    });
  }
  return out;
}

/** Battery seeds, for checking that training never reuses them. */
export function isBatterySeed(seed: number): boolean { return seed >= BASE_SEED && seed < BASE_SEED + SEED_SETS * 1000; }
