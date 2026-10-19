// Milestone 9 player movement: WASD integrated from logged key events at fixed steps, with Apex walk speed.
// Pure function of (key events, view yaw over time); the evaluator advances it on its 1 kHz grid.
import { GROUND_ACCEL, WALK_GUN } from "./constants";

export type MoveKey = "w" | "a" | "s" | "d";
export const MOVE_KEYS: MoveKey[] = ["w", "a", "s", "d"];

// VERIFIED: max speed = Apex walk speed with a weapon out (5.07 m/s x 0.87, apexlegends.wiki.gg) - see constants.ts
export const PLAYER_MAX = WALK_GUN;
// APPROX: player ground acceleration and braking reuse the enemy value (45 m/s^2); Apex's real value is unmeasured
export const PLAYER_ACCEL = GROUND_ACCEL;

export interface PlayerState { x: number; z: number; vx: number; vz: number; keys: Record<MoveKey, boolean> }

export const newPlayer = (): PlayerState => ({ x: 0, z: 0, vx: 0, vz: 0, keys: { w: false, a: false, s: false, d: false } });

/** One step: wish direction from held keys, relative to the view yaw (yaw 0 looks down -z; +yaw turns left). */
export function stepPlayer(p: PlayerState, yaw: number, dt: number): void {
  const f = (p.keys.w ? 1 : 0) - (p.keys.s ? 1 : 0), r = (p.keys.d ? 1 : 0) - (p.keys.a ? 1 : 0);
  // forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw) in x/z
  let wx = f * -Math.sin(yaw) + r * Math.cos(yaw), wz = f * -Math.cos(yaw) + r * -Math.sin(yaw);
  const len = Math.hypot(wx, wz);
  if (len > 0) { wx /= len; wz /= len; }
  const tx = wx * PLAYER_MAX, tz = wz * PLAYER_MAX;
  const dvx = tx - p.vx, dvz = tz - p.vz, dv = Math.hypot(dvx, dvz), max = PLAYER_ACCEL * dt;
  if (dv <= max) { p.vx = tx; p.vz = tz; } else { p.vx += (dvx / dv) * max; p.vz += (dvz / dv) * max; }
  p.x += p.vx * dt; p.z += p.vz * dt;
}

/** Lateral velocity relative to the view (+ = moving right on screen). */
export const lateral = (p: PlayerState, yaw: number): number => p.vx * Math.cos(yaw) - p.vz * Math.sin(yaw);
