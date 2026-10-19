// Crosshair integration. The live app and offline replay both use exactly this function, so they cannot disagree.
import { clamp } from "./math";
import { DEG } from "./units";

export interface Aim { yaw: number; pitch: number }

// VERIFIED: Source-engine style pitch clamp at ±89°, as used by V2
export const PITCH_LIMIT = 89 * DEG;

/** Apply one raw mouse delta (counts) at k radians per count. Mouse right (dx > 0) turns right (yaw decreases). */
export function applyDelta(a: Aim, dx: number, dy: number, k: number): void {
  a.yaw -= dx * k;
  a.pitch = clamp(a.pitch - dy * k, -PITCH_LIMIT, PITCH_LIMIT);
}
