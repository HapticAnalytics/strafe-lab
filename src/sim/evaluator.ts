// The single source of truth for "what happened" in a drill: integrates raw input events and evaluates the
// scenario on a fixed time grid. Live play and offline analysis run this same code, so live HP bars / kills and
// stored metrics cannot disagree, and nothing depends on the render frame rate.
import { applyDelta, type Aim } from "../core/crosshair";
import { wrap } from "../core/math";
import type { InputSample } from "../telemetry/schema";
import { hitAt, targetView, type Scenario } from "./scenario";

// APPROX: 1 kHz evaluation grid. Crosshair state is exact at each tick (all events with t <= tick applied); hit
// and damage resolution is 1 ms, finer than any render frame and than 1000 Hz mouse polling.
export const GRID_DT = 0.001;

/** One grid tick. ty/tp/hw/vh are for the target the player is engaging (nearest living enemy by yaw). */
export interface Sample {
  t: number; yaw: number; pitch: number;
  ty: number; tp: number; hw: number; vh: number;
  /** 0 miss, 1 body, 2 head (any living enemy) */
  on: 0 | 1 | 2;
  /** index of the engaged enemy */
  target: number;
  /** cumulative |delta| in counts (hand travel) */
  c: number;
}

export interface Kill { i: number; t: number }

export class DrillEvaluator {
  readonly aim: Aim = { yaw: 0, pitch: 0 };
  readonly samples: Sample[] = [];
  readonly kills: Kill[] = [];
  hp: number[];
  dmgBody = 0;
  dmgHead = 0;
  counts = 0;
  /** next grid tick index to evaluate */
  private tick = 0;
  private events: InputSample[] = [];
  private ei = 0;
  done = false;
  endT: number;

  constructor(readonly sc: Scenario, readonly k: number, private keepSamples = true, tEnd = Infinity) {
    this.hp = sc.lanes.map(() => sc.damage?.hp ?? Infinity);
    this.endT = Math.min(sc.dur, tEnd);
  }

  /** Time of the next tick to be evaluated; events earlier than this arriving now are "late". */
  get evaluatedTo(): number { return this.tick * GRID_DT; }

  push(ev: InputSample[]): number {
    let late = 0;
    for (const e of ev) { if (e.t < this.evaluatedTo - GRID_DT) late++; this.events.push(e); }
    return late;
  }

  alive(i: number): boolean { return this.hp[i] > 0; }

  /** Evaluate all grid ticks with t <= tMax (and <= the drill end). */
  advanceTo(tMax: number): void {
    const sc = this.sc;
    while (!this.done) {
      const t = this.tick * GRID_DT;
      if (t > tMax + 1e-12) break;
      if (t > this.endT + 1e-12) { this.done = true; break; }
      while (this.ei < this.events.length && this.events[this.ei].t <= t + 1e-12) {
        const e = this.events[this.ei++];
        applyDelta(this.aim, e.dx, e.dy, this.k);
        this.counts += Math.hypot(e.dx, e.dy);
      }
      const { yaw, pitch } = this.aim;
      let on: 0 | 1 | 2 = 0, hitI = -1, best = Infinity, target = -1;
      let tv0 = null as ReturnType<typeof targetView> | null;
      for (let i = 0; i < sc.lanes.length; i++) {
        if (!this.alive(i)) continue;
        const tv = targetView(sc, i, t);
        const kind = hitAt(tv, yaw, pitch);
        if (kind && !on) { on = kind; hitI = i; }
        const dd = Math.abs(wrap(tv.yaw - yaw));
        if (dd < best) { best = dd; target = i; tv0 = tv; }
      }
      if (tv0 && this.keepSamples) {
        this.samples.push({ t, yaw, pitch, ty: tv0.yaw, tp: tv0.pitch, hw: tv0.hw, vh: tv0.vh, on, target, c: this.counts });
      }
      // damage is applied over [t, t + GRID_DT)
      if (sc.damage && on && hitI >= 0) {
        const dmg = (on === 2 ? sc.damage.head : sc.damage.body) * GRID_DT;
        const applied = Math.min(dmg, this.hp[hitI]);
        this.hp[hitI] -= dmg;
        if (on === 2) this.dmgHead += applied; else this.dmgBody += applied;
        if (this.hp[hitI] <= 0) {
          this.kills.push({ i: hitI, t: t + GRID_DT });
          if (this.hp.every(h => h <= 0)) { this.endT = Math.min(this.endT, t + GRID_DT); }
        }
      }
      this.tick++;
    }
  }

  get dealt(): number { return this.dmgBody + this.dmgHead; }
}

/** Offline replay of a whole drill log. */
export function replay(sc: Scenario, k: number, events: InputSample[], tEnd: number): DrillEvaluator {
  const ev = new DrillEvaluator(sc, k, true, tEnd);
  ev.push(events);
  ev.advanceTo(Infinity);
  return ev;
}
