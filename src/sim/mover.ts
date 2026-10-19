import type { Rng } from "../core/rng";
import {
  AIR_ACCEL, CROUCH_GUN, CROUCH_HEIGHT_SCALE, GRAVITY, GROUND_ACCEL, JUMP_VY, SIM_DT,
  SLIDE_DECAY, SLIDE_DURATION, SLIDE_HOLD, SPRINT, WALK_GUN,
} from "./constants";
import type { MoveProfile, SegType } from "./drills";

interface Segment { type: SegType; speed: number; sub: number; t: number }

/** Enemy motion state. Advance only through advanceMover so it stays a function of (time, seed). */
export interface Mover {
  profile: MoveProfile;
  rng: Rng;
  x: number; y: number; vx: number; vy: number; h: number;
  dir: number;
  air: boolean;
  seg: Segment;
  subT: number;
  crouched: boolean;
  crouchT: number;
  slideT: number;
  steps: number;
}

export function createMover(profile: MoveProfile, rng: Rng, x0 = 0): Mover {
  const m = {
    profile, rng, x: x0, y: 0, vx: 0, vy: 0, h: 1, dir: rng() < 0.5 ? -1 : 1, air: false,
    seg: { type: "run", speed: WALK_GUN, sub: 99, t: 1 }, subT: 0, crouched: false, crouchT: 0.2, slideT: 0, steps: 0,
  } as Mover;
  pickSeg(m);
  return m;
}

function pickSeg(s: Mover): void {
  const R = s.rng, mix = s.profile.mix;
  let r = R(), type: SegType = "run";
  for (const k of Object.keys(mix) as SegType[]) {
    if (r < mix[k]!) { type = k; break; }
    r -= mix[k]!;
  }
  const [lo, hi] = s.profile.sub;
  const sub = () => lo + R() * (hi - lo);
  const g: Segment = { type, speed: WALK_GUN, sub: 99, t: 1 };
  // APPROX: segment durations (s) are V2 hand-tuned
  if (type === "adad") { g.t = 1.0 + R() * 1.0; g.sub = sub(); }
  if (type === "run") { g.t = 0.5 + R() * 0.8; }
  if (type === "crouch") { g.t = 1 + R() * 0.8; g.sub = sub() * 1.4; }
  if (type === "jump") { g.t = 2; }
  if (type === "sprint") { g.t = 0.6 + R() * 0.5; g.speed = SPRINT; }
  if (type === "slide") { g.t = SLIDE_DURATION; g.speed = SPRINT; s.slideT = 0; }
  s.seg = g; s.subT = g.sub; s.crouched = false; s.crouchT = 0.2;
  if (R() < 0.5) s.dir *= -1;
  if (type === "jump") { s.vy = JUMP_VY; s.air = true; }
}

/** One fixed simulation step. Exported for lockstep multi-enemy trajectories. */
export function step(s: Mover, dt: number): void {
  if (s.seg.t <= 0 && !s.air) pickSeg(s);
  const g = s.seg;
  g.t -= dt;
  if (g.type === "adad" || g.type === "crouch") {
    s.subT -= dt;
    if (s.subT <= 0) { s.dir *= -1; s.subT = g.sub * (0.7 + s.rng() * 0.6); }
  }
  if (g.type === "crouch") {
    s.crouchT -= dt;
    // APPROX: crouch-spam toggle interval 0.16-0.26 s (V2)
    if (s.crouchT <= 0) { s.crouched = !s.crouched; s.crouchT = 0.16 + s.rng() * 0.1; }
  }
  const B = s.profile.bound;
  if (s.x > B && s.dir > 0) s.dir = -1;
  if (s.x < -B && s.dir < 0) s.dir = 1;
  let want = s.dir * (g.type === "crouch" && s.crouched ? CROUCH_GUN : g.speed);
  if (g.type === "slide") {
    s.slideT += dt;
    want = s.dir * (s.slideT < SLIDE_HOLD ? SPRINT : Math.max(WALK_GUN, SPRINT - (s.slideT - SLIDE_HOLD) * SLIDE_DECAY));
  }
  const acc = s.air ? AIR_ACCEL : GROUND_ACCEL, dv = want - s.vx;
  s.vx += Math.sign(dv) * Math.min(Math.abs(dv), acc * dt);
  s.x += s.vx * dt;
  if (s.air) {
    s.vy -= GRAVITY * dt; s.y += s.vy * dt;
    if (s.y <= 0) { s.y = 0; s.vy = 0; s.air = false; g.t = 0; }
  }
  s.h = (g.type === "crouch" && s.crouched) || g.type === "slide" ? CROUCH_HEIGHT_SCALE : 1;
}

/** Advance to simulation time `t` seconds in fixed SIM_DT steps. Same (seed, t) -> same state at any frame rate. */
export function advanceMover(m: Mover, t: number): void {
  const target = Math.floor(t / SIM_DT + 1e-9);
  while (m.steps < target) { step(m, SIM_DT); m.steps++; }
}
