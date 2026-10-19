import { EYE } from "./constants";
import type { Mover } from "./mover";

export interface Vec3 { x: number; y: number; z: number }

/**
 * World position of an enemy's chest centre. Camera sits at the origin looking down -z at yaw 0;
 * theta is the bearing of the enemy's lane, dist its distance along that lane, mover.x its lateral offset.
 */
export function enemyChest(m: Pick<Mover, "x" | "y" | "h">, theta: number, dist: number): Vec3 {
  const fx = -Math.sin(theta), fz = -Math.cos(theta);
  const rx = Math.cos(theta), rz = -Math.sin(theta);
  return { x: fx * dist + rx * m.x, y: m.y + 1.0 * m.h, z: fz * dist + rz * m.x };
}

/** Yaw/pitch (radians) pointing the crosshair at a world point. */
export const angTo = (p: Vec3): { yaw: number; pitch: number } => ({
  yaw: Math.atan2(-p.x, -p.z),
  pitch: Math.atan2(p.y - EYE, Math.hypot(p.x, p.z)),
});
