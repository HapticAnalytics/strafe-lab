import { clamp } from "../core/math";

// HYPOTHESIS: 6 wide-sweep blocks then 4 zoom blocks give a usable peak estimate; test via test-retest (Milestone 2)
export const R1_N = 6;
// HYPOTHESIS: zoom multipliers around the round-1 peak; test via simulated players with known best sens (Milestone 2)
export const R2_MULTIPLIERS = [0.86, 0.95, 1.05, 1.16];

// APPROX: sweep bounds (cm/360) are V2 hand-tuned: low end 0.6x current capped to 8-40 cm, high end 2x current floored at 55, max 90
/** Wide, log-spaced sweep from fast wrist-aim to slow arm-aim, always covering the player's current sens. */
export function sweep(baseCm: number): number[] {
  const lo = clamp(Math.min(baseCm * 0.6, 22), 8, 40);
  const hi = clamp(Math.max(baseCm * 2.0, 55), lo * 2.2, 90);
  return Array.from({ length: R1_N }, (_, i) => Math.exp(Math.log(lo) + ((Math.log(hi) - Math.log(lo)) * i) / (R1_N - 1)));
}

export const zoomRound = (peakCm: number): number[] => R2_MULTIPLIERS.map(m => peakCm * m);
