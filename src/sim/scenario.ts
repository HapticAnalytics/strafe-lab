// A drill as a pure, precomputed scenario: enemy lanes plus trajectories from (seed, dur).
import { DRILLS, DUO_ENEMIES, DUO_PROFILE, type DrillId } from "./drills";
import { angTo, enemyChest, type Vec3 } from "./geometry";
import { buildTrajectories, sampleTrajectory, type EnemyState, type Trajectory } from "./trajectory";
import { BODY_RADIUS, DPS_BODY, DPS_HEAD, EYE, HP } from "./constants";
import { BODY_HEIGHT, hitTest } from "./hit";

export interface Lane { theta: number; dist: number }

export interface Scenario {
  id: DrillId;
  seed: number;
  dur: number;
  lanes: Lane[];
  traj: Trajectory[];
  /** 2v1: enemies take R-99 damage while aimed at, die at 0 HP, and the drill ends when both are down */
  damage: { body: number; head: number; hp: number } | null;
}

export function buildScenario(id: DrillId, seed: number, dur: number): Scenario {
  if (id === "duo") {
    const traj = buildTrajectories(DUO_ENEMIES.map(e => ({ profile: DUO_PROFILE, x0: e.x0 })), seed, dur);
    return { id, seed, dur, lanes: DUO_ENEMIES.map(e => ({ theta: e.theta, dist: e.dist })), traj, damage: { body: DPS_BODY, head: DPS_HEAD, hp: HP } };
  }
  const d = DRILLS[id];
  const traj = buildTrajectories([{ profile: { mix: d.mix!, sub: d.sub!, bound: d.bound! }, x0: 0 }], seed, dur);
  return { id, seed, dur, lanes: [{ theta: 0, dist: d.dist! }], traj, damage: null };
}

export function enemyState(sc: Scenario, i: number, t: number): EnemyState { return sampleTrajectory(sc.traj[i], t); }

/** World position of the enemy's feet. */
export function feetPos(lane: Lane, s: EnemyState): Vec3 {
  const fx = -Math.sin(lane.theta), fz = -Math.cos(lane.theta), rx = Math.cos(lane.theta), rz = -Math.sin(lane.theta);
  return { x: fx * lane.dist + rx * s.x, y: s.y, z: fz * lane.dist + rz * s.x };
}

export interface TargetView {
  /** chest bearing (rad) */
  yaw: number; pitch: number;
  /** angular half-width (rad) of the body column and half-height of the body */
  hw: number; vh: number;
  feet: Vec3; h: number;
}

export function targetView(sc: Scenario, i: number, t: number): TargetView {
  const s = enemyState(sc, i, t), lane = sc.lanes[i];
  const c = enemyChest(s, lane.theta, lane.dist), a = angTo(c), feet = feetPos(lane, s);
  const dh = Math.hypot(c.x, c.z);
  const top = Math.atan2(feet.y + BODY_HEIGHT * s.h - EYE, dh), bottom = Math.atan2(feet.y - EYE, dh);
  return { yaw: a.yaw, pitch: a.pitch, hw: Math.asin(Math.min(1, BODY_RADIUS / dh)), vh: (top - bottom) / 2, feet, h: s.h };
}

export const hitAt = (tv: TargetView, yaw: number, pitch: number) => hitTest(yaw, pitch, tv.feet, tv.h).kind;
