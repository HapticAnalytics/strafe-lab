// Analytic hit tests: ray from the eye along the crosshair vs. the enemy body cylinder and head sphere.
// Pure geometry, evaluated at the exact analysis time. Replaces V2's per-frame three.js raycast.
import { BODY_RADIUS, EYE } from "./constants";
import type { Vec3 } from "./geometry";

// APPROX: body column height 1.45 m (scaled by stance h), head sphere r 0.17 m centred 0.16 m above the column
// top. Matches the V2 meshes; real Apex hitboxes are per-legend and unpublished (see RESEARCH.md).
export const BODY_HEIGHT = 1.45;
export const HEAD_RADIUS = 0.17;
export const HEAD_OFFSET = 0.16;

/** Unit view direction for yaw/pitch, matching three.js camera rotation order YXZ looking down -z. */
export function aimDir(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/** Nearest ray parameter t >= 0 hitting a vertical cylinder (incl. caps), or Infinity. */
function rayCylinder(o: Vec3, d: Vec3, cx: number, cz: number, y0: number, y1: number, r: number): number {
  let best = Infinity;
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z, b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - r * r;
  if (a > 1e-12) {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      for (const t of [(-b - s) / (2 * a), (-b + s) / (2 * a)]) {
        if (t < 0) continue;
        const y = o.y + t * d.y;
        if (y >= y0 && y <= y1 && t < best) best = t;
      }
    }
  }
  if (Math.abs(d.y) > 1e-12) {
    for (const yc of [y0, y1]) {
      const t = (yc - o.y) / d.y;
      if (t < 0) continue;
      const px = ox + t * d.x, pz = oz + t * d.z;
      if (px * px + pz * pz <= r * r && t < best) best = t;
    }
  }
  return best;
}

function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number): number {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return Infinity;
  const s = Math.sqrt(disc);
  const t0 = -b - s, t1 = -b + s;
  return t0 >= 0 ? t0 : t1 >= 0 ? t1 : Infinity;
}

export interface Hit { kind: 0 | 1 | 2; dist: number }

/** feet: world position of the enemy's feet (lane position, y = jump height). h: stance scale. 1 = body, 2 = head. */
export function hitTest(yaw: number, pitch: number, feet: Vec3, h: number, size = 1): Hit {
  const o = { x: 0, y: EYE, z: 0 }, d = aimDir(yaw, pitch);
  const top = feet.y + BODY_HEIGHT * h;
  const tb = rayCylinder(o, d, feet.x, feet.z, feet.y, top, BODY_RADIUS * size);
  const th = raySphere(o, d, { x: feet.x, y: top + HEAD_OFFSET, z: feet.z }, HEAD_RADIUS * size);
  if (th === Infinity && tb === Infinity) return { kind: 0, dist: Infinity };
  return th <= tb ? { kind: 2, dist: th } : { kind: 1, dist: tb };
}
