// Scenery layout for the range. Pure, so a test can prove no prop ever sits between the player and a target.
import { mulberry32 } from "../core/rng";

export interface Prop { x: number; z: number; w: number; h: number; d: number; rot: number }

// Props stay outside this radius. The furthest target any drill uses is about 51 m away (long range at 50 m with
// up to 9 m of strafe), checked by tests/props.test.ts; 75 m leaves margin for prop size.
export const PROP_MIN_RADIUS = 75;
export const PROP_RING = 40;

export function propLayout(): Prop[] {
  const r = mulberry32(99), out: Prop[] = [];
  for (let i = 0; i < 38; i++) {
    const a = r() * Math.PI * 2, dist = PROP_MIN_RADIUS + r() * PROP_RING, w = 3 + r() * 9, h = 2 + r() * 10;
    out.push({ x: Math.sin(a) * dist, z: Math.cos(a) * dist, w, h, d: 3 + r() * 7, rot: r() * 3 });
  }
  return out;
}
