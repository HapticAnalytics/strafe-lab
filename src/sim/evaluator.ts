// The single source of truth for "what happened" in a drill: integrates raw input events and evaluates the
// scenario on a fixed time grid. Live play and offline analysis run this same code, so live HP bars / kills /
// spawns and stored metrics cannot disagree, and nothing depends on the render frame rate.
import { applyDelta, type Aim } from "../core/crosshair";
import { wrap } from "../core/math";
import type { InputSample } from "../telemetry/schema";
import { hitAt, targetView, type Scenario } from "./scenario";
import { lateral, newPlayer, stepPlayer, type PlayerState } from "./player";

// APPROX: 1 kHz evaluation grid. Crosshair state is exact at each tick (all events with t <= tick applied); hit
// and damage resolution is 1 ms, finer than any render frame and than 1000 Hz mouse polling.
export const GRID_DT = 0.001;

/** One grid tick. ty/tp/hw/vh are for the target the player is engaging (nearest living enemy by yaw). */
export interface Sample {
  t: number; yaw: number; pitch: number;
  ty: number; tp: number; hw: number; vh: number;
  /** 0 miss, 1 body, 2 head (any living / active enemy) */
  on: 0 | 1 | 2;
  /** index of the engaged enemy */
  target: number;
  /** cumulative |delta| in counts (hand travel) */
  c: number;
  /** trigger (left button) held at this tick, and presses that happened during it */
  trig: 0 | 1;
  press: number;
  /** player position (m) and lateral velocity relative to the view (m/s, + = right); 0 when the player can't move */
  px: number; pz: number; pv: number;
}

export interface Kill { i: number; t: number }

/** Spawn drills: one record per target that appeared. */
export interface SpawnResult {
  i: number;
  /** when it appeared (s) */
  at: number;
  /** when it was completed (s), null if it timed out or the drill ended first */
  done: number | null;
  /** clicks that were not on the target while it was active */
  misses: number;
  /** angular distance from the crosshair to the target when it appeared (deg) */
  startOffDeg: number;
}

export class DrillEvaluator {
  readonly aim: Aim = { yaw: 0, pitch: 0 };
  readonly samples: Sample[] = [];
  readonly kills: Kill[] = [];
  readonly spawns: SpawnResult[] = [];
  hp: number[];
  dmgBody = 0;
  dmgHead = 0;
  counts = 0;
  clicks = 0;
  trig: 0 | 1 = 0;
  readonly player: PlayerState = newPlayer();
  private pressesNow = 0;
  /** next grid tick index to evaluate */
  private tick = 0;
  private events: InputSample[] = [];
  private ei = 0;
  /** spawn state: current target, when it (will) appear, when the current hold started */
  private si = 0;
  private sAt = 0;
  private holdFrom: number | null = null;
  done = false;
  endT: number;

  constructor(readonly sc: Scenario, readonly k: number, private keepSamples = true, tEnd = Infinity) {
    this.hp = sc.lanes.map(() => sc.damage?.hp ?? Infinity);
    this.endT = Math.min(sc.dur, tEnd);
    if (sc.spawn) this.sAt = sc.spawn.def.delay;
  }

  /** Time of the next tick to be evaluated; events earlier than this arriving now are "late". */
  get evaluatedTo(): number { return this.tick * GRID_DT; }

  push(ev: InputSample[]): number {
    let late = 0;
    for (const e of ev) { if (e.t < this.evaluatedTo - GRID_DT) late++; this.events.push(e); }
    return late;
  }

  alive(i: number): boolean {
    if (this.sc.spawn) return i === this.si && this.tick * GRID_DT >= this.sAt;
    return this.hp[i] > 0;
  }

  /** Spawn drills: the index and local time of the target visible at time t, if any. */
  activeSpawn(t: number): { i: number; local: number } | null {
    if (!this.sc.spawn || t < this.sAt) return null;
    return { i: this.si, local: t - this.sAt };
  }

  private spawnTick(t: number, clicksNow: number[]): void {
    const sp = this.sc.spawn!;
    if (t < this.sAt) {
      // between targets: keep the 1 kHz sample grid uniform (aim only; nothing to hit)
      if (this.keepSamples) { const tv = targetView(this.sc, this.si, 0); this.samples.push({ t, yaw: this.aim.yaw, pitch: this.aim.pitch, ty: tv.yaw, tp: tv.pitch, hw: tv.hw, vh: tv.vh, on: 0, target: -1, c: this.counts, trig: this.trig, press: this.pressesNow, ...this.pos() }); }
      return;
    }
    const i = this.si, local = t - this.sAt;
    let rec = this.spawns[this.spawns.length - 1];
    if (!rec || rec.i !== i) {
      const tv0 = targetView(this.sc, i, 0);
      const off = Math.hypot(wrap(tv0.yaw - this.aim.yaw), tv0.pitch - this.aim.pitch) / (Math.PI / 180);
      rec = { i, at: this.sAt, done: null, misses: 0, startOffDeg: off };
      this.spawns.push(rec);
    }
    const tv = targetView(this.sc, i, local);
    const on = hitAt(tv, this.aim.yaw, this.aim.pitch);
    let complete = false;
    if (sp.def.complete === "hold") {
      if (on) { if (this.holdFrom == null) this.holdFrom = t; if (t - this.holdFrom >= sp.def.holdMs / 1000 - 1e-9) complete = true; }
      else this.holdFrom = null;
    } else {
      for (const hitKind of clicksNow) { if (hitKind) { complete = true; break; } rec.misses++; }
    }
    if (this.keepSamples) this.samples.push({ t, yaw: this.aim.yaw, pitch: this.aim.pitch, ty: tv.yaw, tp: tv.pitch, hw: tv.hw, vh: tv.vh, on, target: i, c: this.counts, trig: this.trig, press: this.pressesNow, ...this.pos() });
    if (complete) rec.done = t;
    if (complete || local >= sp.def.timeout - 1e-9) {
      this.si = Math.min(sp.targets.length - 1, this.si + 1);
      this.sAt = t + sp.def.delay;
      this.holdFrom = null;
    }
  }

  /** Evaluate all grid ticks with t <= tMax (and <= the drill end). */
  advanceTo(tMax: number): void {
    const sc = this.sc;
    while (!this.done) {
      const t = this.tick * GRID_DT;
      if (t > tMax + 1e-12) break;
      if (t > this.endT + 1e-12) { this.done = true; break; }
      // spawn drills: for each click, whether it was on the active target at that moment
      const clicksNow: number[] = [];
      while (this.ei < this.events.length && this.events[this.ei].t <= t + 1e-12) {
        const e = this.events[this.ei++];
        if (e.key) { this.player.keys[e.key] = !e.up; continue; }
        if (e.b === -1) { this.trig = 0; continue; }
        if (e.b) {
          this.clicks++; this.trig = 1; this.pressesNow++;
          const a = this.activeSpawn(t);
          if (a) clicksNow.push(hitAt(targetView(sc, a.i, a.local), this.aim.yaw, this.aim.pitch));
          continue;
        }
        applyDelta(this.aim, e.dx, e.dy, this.k);
        this.counts += Math.hypot(e.dx, e.dy);
      }
      if (sc.playerMoves) stepPlayer(this.player, this.aim.yaw, GRID_DT);
      if (sc.spawn) { this.spawnTick(t, clicksNow); this.pressesNow = 0; this.tick++; continue; }
      const { yaw, pitch } = this.aim;
      let on: 0 | 1 | 2 = 0, hitI = -1, best = Infinity, target = -1;
      let tv0 = null as ReturnType<typeof targetView> | null;
      for (let i = 0; i < sc.lanes.length; i++) {
        if (!this.alive(i)) continue;
        const tv = targetView(sc, i, t, sc.playerMoves ? this.eye() : undefined);
        const kind = hitAt(tv, yaw, pitch);
        if (kind && !on) { on = kind; hitI = i; }
        const dd = Math.abs(wrap(tv.yaw - yaw));
        if (dd < best) { best = dd; target = i; tv0 = tv; }
      }
      if (tv0 && this.keepSamples) {
        this.samples.push({ t, yaw, pitch, ty: tv0.yaw, tp: tv0.pitch, hw: tv0.hw, vh: tv0.vh, on, target, c: this.counts, trig: this.trig, press: this.pressesNow, ...this.pos() });
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
      this.pressesNow = 0;
      this.tick++;
    }
  }

  get dealt(): number { return this.dmgBody + this.dmgHead; }

  /** Player eye position for target views (origin when the player can't move). */
  eye(): { x: number; z: number } { return { x: this.player.x, z: this.player.z }; }
  private pos(): { px: number; pz: number; pv: number } {
    return { px: this.player.x, pz: this.player.z, pv: this.sc.playerMoves ? lateral(this.player, this.aim.yaw) : 0 };
  }
}

/** Offline replay of a whole drill log. */
export function replay(sc: Scenario, k: number, events: InputSample[], tEnd: number): DrillEvaluator {
  const ev = new DrillEvaluator(sc, k, true, tEnd);
  ev.push(events);
  ev.advanceTo(Infinity);
  return ev;
}
