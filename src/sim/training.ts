// Milestone 7 training sessions: Nemesis segments in variable (interleaved) or blocked order, fresh seeds every
// segment, never a battery seed (the battery is the held-out validation set).
import { shuffle, type Rng } from "../core/rng";
import { isBatterySeed } from "./battery";
import { FAMILIES, type Family } from "./nemesis";

export type TrainMode = "variable" | "blocked";

// HYPOTHESIS: 3 blocks x 5 segments x 20 s (~6 min with gaps) per training session; each family 3 times
export const TRAIN_BLOCKS = 3;
export const SEG_PER_BLOCK = 5;
export const TRAIN_SEG_S = 20;
export const TRAIN_ACC_S = 4;

/**
 * variable = every block has one segment of each family in random order (high contextual interference);
 * blocked = each block repeats families back to back (low contextual interference).
 */
export function trainingOrder(mode: TrainMode, rng: Rng): Family[][] {
  const reps = (TRAIN_BLOCKS * SEG_PER_BLOCK) / FAMILIES.length;
  if (mode === "variable") return Array.from({ length: TRAIN_BLOCKS }, () => shuffle([...FAMILIES], rng));
  const seq = shuffle([...FAMILIES], rng).flatMap(f => Array.from({ length: reps }, () => f));
  return Array.from({ length: TRAIN_BLOCKS }, (_, b) => seq.slice(b * SEG_PER_BLOCK, (b + 1) * SEG_PER_BLOCK));
}

/** A fresh training seed that can never collide with the held-out battery seeds. */
export function trainingSeed(random: () => number): number {
  for (;;) { const s = random() >>> 0; if (!isBatterySeed(s)) return s; }
}
