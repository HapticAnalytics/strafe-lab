// A drill as a pure, precomputed scenario: enemy lanes plus trajectories from (seed, dur).
import { mulberry32 } from "../core/rng";
import { DEG } from "../core/units";
import { DRILLS, DUO_ENEMIES, DUO_PROFILE, type DrillId, type SpawnDef } from "./drills";
import { angTo, enemyChest, type Vec3 } from "./geometry";
import { buildTrajectories, sampleTrajectory, type EnemyState, type Trajectory } from "./trajectory";
import { BODY_RADIUS, DPS_BODY, DPS_HEAD, EYE, HP } from "./constants";
import { BODY_HEIGHT, hitTest } from "./hit";
import { profileOf, type NemesisParams } from "./nemesis";


/** size: hitbox width scale (Nemesis); 1 = the standard hitbox */
export interface Lane { theta: number; dist: number; size?: number; distOsc?: { amp: number; period: number } }

/** Lane distance at time t (constant unless the lane closes/opens range). */
export const laneDist = (lane: Lane, t: number): number => (lane.distOsc ? lane.dist + lane.distOsc.amp * Math.sin((2 * Math.PI * t) / lane.distOsc.period) : lane.dist);

export interface SpawnTarget extends Lane { traj: Trajectory | null }

export interface Scenario {
  id: DrillId;
  seed: number;
  dur: number;
  lanes: Lane[];
  traj: Trajectory[];
  /** 2v1: enemies take R-99 damage while aimed at, die at 0 HP, and the drill ends when both are down */
  damage: { body: number; head: number; hp: number } | null;
  /** spawn drills: one target at a time from a pre-generated list */
  spawn: { def: SpawnDef; targets: SpawnTarget[] } | null;
  /** Milestone 9: the player moves with WASD (key events integrate the eye position) */
  playerMoves?: boolean;
  movement?: import("./movement").MovementSpec;
}

const STILL: EnemyState = { x: 0, y: 0, h: 1 };

export function buildScenario(id: DrillId, seed: number, dur: number, params?: NemesisParams): Scenario {
  const d = DRILLS[id];
  if (id === "nem") {
    if (!params) throw new Error("Nemesis scenario needs params");
    const prof = profileOf(params);
    if (params.targets === 2) {
      // APPROX: two lanes either side of centre, the second a little further away (like the 2v1 drill)
      const lanes = [{ theta: 22 * DEG, dist: params.dist * 0.85, size: params.size }, { theta: -28 * DEG, dist: params.dist * 1.15, size: params.size }];
      const traj = buildTrajectories([{ profile: prof, x0: -1 }, { profile: prof, x0: 1 }], seed, dur);
      return { id, seed, dur, lanes, traj, damage: { body: DPS_BODY, head: DPS_HEAD, hp: HP }, spawn: null };
    }
    const traj = buildTrajectories([{ profile: prof, x0: 0 }], seed, dur);
    return {
      id, seed, dur, lanes: [{ theta: 0, dist: params.dist, size: params.size, ...(params.distOsc ? { distOsc: params.distOsc } : {}) }], traj, damage: null, spawn: null,
      ...(params.movement ? { movement: params.movement } : {}),
      ...(params.movement && params.movement.cond !== "still" ? { playerMoves: true } : {}),
    };
  }
  if (id === "duo") {
    const traj = buildTrajectories(DUO_ENEMIES.map(e => ({ profile: DUO_PROFILE, x0: e.x0 })), seed, dur);
    return { id, seed, dur, lanes: DUO_ENEMIES.map(e => ({ theta: e.theta, dist: e.dist })), traj, damage: { body: DPS_BODY, head: DPS_HEAD, hp: HP }, spawn: null };
  }
  if (d.spawn) {
    const sp = d.spawn, rng = mulberry32(seed);
    // enough targets for the whole drill even if every one is completed instantly
    const n = Math.ceil(dur / sp.delay) + 1;
    const targets: SpawnTarget[] = [];
    let theta = 0;
    for (let i = 0; i < n; i++) {
      const off = (sp.minDeg + rng() * (sp.maxDeg - sp.minDeg)) * DEG * (rng() < 0.5 ? -1 : 1);
      theta += off;
      const dist = sp.dist[0] + rng() * (sp.dist[1] - sp.dist[0]);
      const traj = sp.move ? buildTrajectories([{ profile: sp.move, x0: 0 }], (seed * 7919 + i * 104729) | 0, sp.timeout + 0.5)[0] : null;
      targets.push({ theta, dist, traj });
    }
    return { id, seed, dur, lanes: targets, traj: [], damage: null, spawn: { def: sp, targets } };
  }
  const traj = buildTrajectories([{ profile: { mix: d.mix!, sub: d.sub!, bound: d.bound! }, x0: 0 }], seed, dur);
  return { id, seed, dur, lanes: [{ theta: 0, dist: d.dist! }], traj, damage: null, spawn: null };
}

/** For lane drills t is drill time; for spawn targets t is time since that target appeared. */
export function enemyState(sc: Scenario, i: number, t: number): EnemyState {
  if (sc.spawn) { const tr = sc.spawn.targets[i].traj; return tr ? sampleTrajectory(tr, t) : STILL; }
  return sampleTrajectory(sc.traj[i], t);
}

/** World position of the enemy's feet (dist: the lane distance at that moment). */
export function feetPos(lane: Lane, s: EnemyState, dist = lane.dist): Vec3 {
  const fx = -Math.sin(lane.theta), fz = -Math.cos(lane.theta), rx = Math.cos(lane.theta), rz = -Math.sin(lane.theta);
  return { x: fx * dist + rx * s.x, y: s.y, z: fz * dist + rz * s.x };
}

export interface TargetView {
  /** chest bearing (rad) */
  yaw: number; pitch: number;
  /** angular half-width (rad) of the body column and half-height of the body */
  hw: number; vh: number;
  feet: Vec3; h: number; size: number;
}

/** eye: the player's position (Milestone 9 movement); targets are returned relative to it. */
export function targetView(sc: Scenario, i: number, t: number, eye?: { x: number; z: number }): TargetView {
  const s = enemyState(sc, i, t), lane = sc.lanes[i];
  const dist = laneDist(lane, t);
  const cw = enemyChest(s, lane.theta, dist), fw = feetPos(lane, s, dist);
  const ex = eye?.x ?? 0, ez = eye?.z ?? 0;
  const c = { x: cw.x - ex, y: cw.y, z: cw.z - ez }, feet = { x: fw.x - ex, y: fw.y, z: fw.z - ez }, a = angTo(c);
  const dh = Math.hypot(c.x, c.z);
  const top = Math.atan2(feet.y + BODY_HEIGHT * s.h - EYE, dh), bottom = Math.atan2(feet.y - EYE, dh);
  const size = lane.size ?? 1;
  return { yaw: a.yaw, pitch: a.pitch, hw: Math.asin(Math.min(1, (BODY_RADIUS * size) / dh)), vh: (top - bottom) / 2, feet, h: s.h, size };
}

export const hitAt = (tv: TargetView, yaw: number, pitch: number) => hitTest(yaw, pitch, tv.feet, tv.h, tv.size).kind;
