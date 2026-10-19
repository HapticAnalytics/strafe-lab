import { DEG } from "../core/units";

export type DrillId = "pb" | "close" | "mid" | "duo" | "acc";
export type SegType = "adad" | "run" | "crouch" | "jump" | "sprint" | "slide";
export type Mix = Partial<Record<SegType, number>>;

export interface MoveProfile {
  mix: Mix;
  /** [min, max] seconds between strafe reversals */
  sub: [number, number];
  /** max lateral offset from centre, metres */
  bound: number;
}

export interface DrillDef extends Partial<MoveProfile> {
  name: string;
  hint: string;
  dur: number;
  seed: number;
  dist?: number;
}

// All drill parameters below: APPROX: hand-tuned in V2 to feel like Apex SMG fights, not measured from game data.
// seeds: V2 used one fixed seed per drill (known limitation; Milestone 2 adds multiple seeds).
export const DRILLS: Record<DrillId, DrillDef> = {
  pb:    { name: "Point-blank", hint: "Stay on them through ADAD, crouch spam and jumps.", dist: 4, bound: 2.6, dur: 10, seed: 101, mix: { adad: .45, crouch: .25, run: .15, jump: .15 }, sub: [.16, .38] },
  close: { name: "Close SMG duel", hint: "R-99 range. Track through strafes, crouches, jumps and slides.", dist: 8, bound: 4.5, dur: 12, seed: 202, mix: { adad: .35, run: .18, crouch: .17, jump: .15, slide: .15 }, sub: [.18, .45] },
  mid:   { name: "Mid-range", hint: "Smooth and steady. No wobble.", dist: 18, bound: 8, dur: 12, seed: 303, mix: { run: .32, adad: .25, sprint: .15, crouch: .15, jump: .13 }, sub: [.3, .7] },
  duo:   { name: "2v1 fight", hint: "You deal R-99 damage while on target. Kill one, switch, kill the other.", dur: 10, seed: 404 },
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
