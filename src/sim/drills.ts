import { DEG } from "../core/units";

/** V2 drills (pb, close, mid, duo, acc) plus the Milestone 2 skill drills. */
export type DrillId = "pb" | "close" | "mid" | "duo" | "acc" | "vert" | "long" | "turn" | "flick" | "click" | "nem";
export type SegType = "adad" | "run" | "crouch" | "jump" | "sprint" | "slide";
export type Mix = Partial<Record<SegType, number>>;

export interface MoveProfile {
  mix: Mix;
  /** [min, max] seconds between strafe reversals */
  sub: [number, number];
  /** max lateral offset from centre, metres */
  bound: number;
  /** Nemesis (Milestone 7) overrides; absent = the V2 values. speedScale multiplies all Apex speeds. */
  speedScale?: number;
  /** ground acceleration, m/s^2 */
  accel?: number;
  /** reversal-timing randomness: each reversal interval is sub x (1 - j/2 + U[0,1) x j) */
  jitter?: number;
}

/**
 * Spawn drills: one target at a time. "hold" completes after staying on it for holdMs; "click" completes on a
 * left click while on it (other clicks count as misses). Each next target appears "delay" s after the last
 * one completes or times out, at a bearing offset of +/-[minDeg, maxDeg] from the previous target.
 */
export interface SpawnDef {
  complete: "hold" | "click";
  holdMs: number;
  timeout: number;
  delay: number;
  minDeg: number; maxDeg: number;
  dist: [number, number];
  /** movement while active (null = stationary) */
  move: MoveProfile | null;
}

export interface DrillDef extends Partial<MoveProfile> {
  name: string;
  hint: string;
  dur: number;
  seed: number;
  dist?: number;
  spawn?: SpawnDef;
}

// All drill parameters below: APPROX: hand-tuned in V2 to feel like Apex SMG fights, not measured from game data.
// seeds: V2 used one fixed seed per drill (known limitation; Milestone 2 adds multiple seeds).
export const DRILLS: Record<DrillId, DrillDef> = {
  pb:    { name: "Point-blank", hint: "Stay on them through ADAD, crouch spam and jumps.", dist: 4, bound: 2.6, dur: 10, seed: 101, mix: { adad: .45, crouch: .25, run: .15, jump: .15 }, sub: [.16, .38] },
  close: { name: "Close SMG duel", hint: "R-99 range. Track through strafes, crouches, jumps and slides.", dist: 8, bound: 4.5, dur: 12, seed: 202, mix: { adad: .35, run: .18, crouch: .17, jump: .15, slide: .15 }, sub: [.18, .45] },
  mid:   { name: "Mid-range", hint: "Smooth and steady. No wobble.", dist: 18, bound: 8, dur: 12, seed: 303, mix: { run: .32, adad: .25, sprint: .15, crouch: .15, jump: .13 }, sub: [.3, .7] },
  duo:   { name: "2v1 fight", hint: "You deal R-99 damage while on target. Kill one, switch, kill the other.", dur: 10, seed: 404 },
  // Milestone 2 skills. APPROX: all values hand-picked to isolate one skill each; not measured from Apex.
  vert:  { name: "Vertical", hint: "Jumps and crouch spam. Stay on them up and down.", dist: 6, bound: 1.2, dur: 10, seed: 606, mix: { jump: .5, crouch: .35, adad: .15 }, sub: [.3, .6] },
  long:  { name: "Long range", hint: "Small, slow and far. Precision, no wobble.", dist: 40, bound: 6, dur: 10, seed: 707, mix: { run: .6, adad: .25, crouch: .15 }, sub: [.6, 1.2] },
  turn:  { name: "180 turns", hint: "Someone behind you. Turn, get on them, hold.", dur: 10, seed: 808, spawn: { complete: "hold", holdMs: 250, timeout: 2.5, delay: 0.45, minDeg: 140, maxDeg: 180, dist: [6, 12], move: null } },
  flick: { name: "Shotgun flick", hint: "Close target pops up. Flick, correct, hold.", dur: 10, seed: 909, spawn: { complete: "hold", holdMs: 150, timeout: 1.5, delay: 0.4, minDeg: 20, maxDeg: 90, dist: [3, 6], move: { mix: { adad: .7, run: .3 }, sub: [.2, .4], bound: 1.5 } } },
  click: { name: "Dynamic clicking", hint: "Moving targets. Click once when you are on them. Misses count.", dur: 10, seed: 1010, spawn: { complete: "click", holdMs: 0, timeout: 2.0, delay: 0.4, minDeg: 10, maxDeg: 45, dist: [10, 20], move: { mix: { adad: .5, run: .5 }, sub: [.3, .6], bound: 3 } } },
  // Milestone 7: parameters come from sim/nemesis.ts per segment (stored in the log); this entry is only for naming.
  nem:   { name: "Nemesis", hint: "Adaptive training scenario. It gets harder when you do well.", dur: 20, seed: 0 },
  acc:   { name: "Adjusting", hint: "Not scored. Get used to this sensitivity.", dist: 8, bound: 4.5, dur: 4, seed: 505, mix: { adad: .4, run: .3, crouch: .15, jump: .15 }, sub: [.2, .5] },
};

export const SEQ: DrillId[] = ["acc", "pb", "close", "mid", "duo"];

// APPROX: 2v1 layout (angle from forward, distance m) and movement profile; V2 values
export const DUO_ENEMIES = [
  { theta: 22 * DEG, dist: 7, x0: -1 },
  { theta: -30 * DEG, dist: 10, x0: 1 },
];
export const DUO_PROFILE: MoveProfile = { mix: { adad: .4, run: .25, crouch: .2, jump: .15 }, sub: [.2, .45], bound: 2.5 };
// APPROX: warm-up drills are capped at 7 s so the unscored block stays short
export const WARMUP_MAX_DUR = 7;
