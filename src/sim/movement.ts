// Milestone 9 movement + aim conditions. The player is prompted (A/D) by a schedule that is a pure function of the
// seed (independent, direction changes) or of the target's motion (mirrored, counter-strafe). Compliance is measured.
import { mulberry32 } from "../core/rng";
import { paramsFor, type NemesisParams } from "./nemesis";
import type { Scenario } from "./scenario";

export type MoveCond = "still" | "indep" | "mirror" | "counter" | "dirchange";
export interface MovementSpec { cond: MoveCond; targetMoving: boolean }
export const COND_NAMES: Record<MoveCond, string> = { still: "Standing still", indep: "Independent strafe", mirror: "Mirrored strafe", counter: "Counter-strafe", dirchange: "Direction changes" };

/** 2 x 2 factorial core (player still/indep x target still/moving) plus three moving-target movement styles. */
export const CELLS: MovementSpec[] = [
  { cond: "still", targetMoving: false }, { cond: "still", targetMoving: true },
  { cond: "indep", targetMoving: false }, { cond: "indep", targetMoving: true },
  { cond: "mirror", targetMoving: true }, { cond: "counter", targetMoving: true }, { cond: "dirchange", targetMoving: true },
];

// HYPOTHESIS: 2 repetitions x 7 cells x 12 s (~4 min with gaps) per movement session
export const MOVE_REPS = 2;
export const MOVE_SEG_S = 12;
// APPROX: prompt switch intervals (s) for independent strafing and frequent direction changes
export const INDEP_INTERVAL: [number, number] = [0.6, 1.4];
export const DIRCHANGE_INTERVAL: [number, number] = [0.25, 0.5];
// APPROX: the target lane for movement drills: close-mid strafing at 10 m (level 0.3), or a stationary target
export const MOVE_DIST = 10;
export const MOVE_LEVEL = 0.3;

export function movementParams(spec: MovementSpec): NemesisParams {
  const p = paramsFor("mid", MOVE_LEVEL);
  const base: NemesisParams = { ...p, dist: MOVE_DIST, movement: spec };
  // a stationary target: zero speed (the mover still runs, so the scenario stays a pure function of the seed)
  return spec.targetMoving ? base : { ...base, speedScale: 0 };
}

/** Prompt switch times for seeded schedules, starting "right" or "left" at random. */
function schedule(seed: number, dur: number, iv: [number, number]): { t: number; dir: 1 | -1 }[] {
  const r = mulberry32((seed ^ 0x51ed270b) >>> 0);
  const out: { t: number; dir: 1 | -1 }[] = [];
  let dir: 1 | -1 = r() < 0.5 ? 1 : -1;
  for (let t = 0; t < dur; t += iv[0] + r() * (iv[1] - iv[0])) { out.push({ t, dir }); dir = -dir as 1 | -1; }
  return out;
}

const schedCache = new WeakMap<Scenario, { t: number; dir: 1 | -1 }[]>();

/**
 * Which way the player should be strafing at time t: +1 right, -1 left, 0 stand still.
 * Mirrored/counter follow the target's lateral velocity (lane x, + = right on screen at bearing 0).
 */
export function promptAt(sc: Scenario, spec: MovementSpec, t: number): -1 | 0 | 1 {
  if (spec.cond === "still") return 0;
  if (spec.cond === "indep" || spec.cond === "dirchange") {
    let s = schedCache.get(sc);
    if (!s) { s = schedule(sc.seed, sc.dur + 1, spec.cond === "indep" ? INDEP_INTERVAL : DIRCHANGE_INTERVAL); schedCache.set(sc, s); }
    let dir: 1 | -1 = s[0].dir;
    for (const p of s) { if (p.t > t) break; dir = p.dir; }
    return dir;
  }
  const tr = sc.traj[0], i = Math.min(tr.x.length - 2, Math.max(0, Math.floor(t / tr.dt)));
  const v = tr.x[i + 1] - tr.x[i];
  const sgn = v > 0 ? 1 : v < 0 ? -1 : 0;
  return (spec.cond === "mirror" ? sgn : -sgn) as -1 | 0 | 1;
}
