// Precomputed enemy trajectories: the whole drill's motion is generated up front from the seed, in lockstep for
// all enemies, then sampled at any time t. This makes target state a pure function of (t, seed) and removes the
// frame-batching dependence that stepping two movers separately (sharing one RNG) would have.
import { mulberry32 } from "../core/rng";
import { SIM_DT } from "./constants";
import type { MoveProfile } from "./drills";
import { createMover, step } from "./mover";

export interface Trajectory {
  dt: number;
  /** lateral offset (m), height of feet (m), height scale; index i = state after i steps */
  x: Float64Array; y: Float64Array; h: Float64Array;
}

export interface EnemyState { x: number; y: number; h: number }

export function buildTrajectories(specs: { profile: MoveProfile; x0: number }[], seed: number, dur: number): Trajectory[] {
  const rng = mulberry32(seed);
  const movers = specs.map(s => createMover(s.profile, rng, s.x0));
  // APPROX: one extra second of trajectory beyond the drill so sampling at t = dur (and slightly past) is defined
  const n = Math.ceil((dur + 1) / SIM_DT) + 1;
  const out = movers.map(() => ({ dt: SIM_DT, x: new Float64Array(n), y: new Float64Array(n), h: new Float64Array(n) }));
  for (let i = 0; i < n; i++) {
    movers.forEach((m, j) => { out[j].x[i] = m.x; out[j].y[i] = m.y; out[j].h[i] = m.h; });
    for (const m of movers) step(m, SIM_DT);
  }
  return out;
}

/** Position at time t: linear interpolation of x and y between steps; h (stance) is piecewise constant. */
export function sampleTrajectory(tr: Trajectory, t: number): EnemyState {
  const n = tr.x.length;
  const f = Math.max(0, t / tr.dt);
  const i = Math.min(n - 2, Math.floor(f + 1e-9)), a = Math.min(1, f - i);
  return {
    x: tr.x[i] + (tr.x[i + 1] - tr.x[i]) * a,
    y: tr.y[i] + (tr.y[i + 1] - tr.y[i]) * a,
    h: tr.h[i],
  };
}
