// Milestone 8 combat layer. It consumes the evaluator's 1 kHz samples (crosshair, trigger) and fires simulated
// shots with the weapon's fire rate, magazine, reload, damage, and APPROX recoil/spread. It never feeds back into the
// crosshair or the scenario: mouse-control metrics are computed from the same samples with no weapon involved, so
// they cannot depend on the weapon or hip/ADS mode (ROADMAP acceptance).
import { mulberry32, type Rng } from "../core/rng";
import { DEG } from "../core/units";
import { EYE } from "./constants";
import type { Sample } from "./evaluator";
import { aimDir, BODY_HEIGHT, hitTest } from "./hit";
import { paramsFor, type Family, type NemesisParams } from "./nemesis";
import { targetView, type Scenario } from "./scenario";
import { LEG_FRACTION, TARGET_HP, WEAPONS, type WeaponId } from "./weapons";

export type FireMode = "hip" | "ads";

export interface CombatSpec { scenario: CombatScenarioId; weapon: WeaponId; version: string; mode: FireMode }

export type CombatScenarioId = "smg" | "ar" | "shotgun" | "wingman" | "marksman" | "multi" | "range";
interface ScenarioDef { name: string; weapon: WeaponId; family: Family; level: number; dist?: number; distOsc?: { amp: number; period: number } }

// APPROX: scenario layouts (family, difficulty, distance) chosen to match each weapon class's usual fight range
export const COMBAT_SCENARIOS: Record<CombatScenarioId, ScenarioDef> = {
  smg: { name: "SMG close duel", weapon: "r99", family: "close", level: 0.4, dist: 8 },
  ar: { name: "AR mid-range", weapon: "r301", family: "mid", level: 0.4, dist: 20 },
  shotgun: { name: "Shotgun point-blank", weapon: "eva8", family: "close", level: 0.3, dist: 5 },
  wingman: { name: "Wingman duel", weapon: "wingman", family: "mid", level: 0.3, dist: 15 },
  marksman: { name: "Marksman long range", weapon: "g7", family: "long", level: 0.3, dist: 35 },
  multi: { name: "Two targets (R-99)", weapon: "r99", family: "switch", level: 0.4 },
  range: { name: "Closing and opening range (R-301)", weapon: "r301", family: "mid", level: 0.3, dist: 16, distOsc: { amp: 8, period: 6 } },
};

/** Movement parameters for a combat scenario (stored in the log like any Nemesis segment). */
export function combatParams(id: CombatScenarioId): NemesisParams {
  const d = COMBAT_SCENARIOS[id], p = paramsFor(d.family, d.level);
  return { ...p, ...(d.dist ? { dist: d.dist } : {}), ...(d.distOsc ? { distOsc: d.distOsc } : {}) };
}

export interface Shot { t: number; hit: 0 | 1 | 2 | 3; target: number; damage: number }
export interface CombatResult {
  weapon: WeaponId; mode: FireMode;
  shots: number; pellets: number; hits: number; headHits: number; legHits: number;
  accuracyPct: number; headshotPct: number;
  damage: number; kills: number; meanTtkS: number | null;
  /** damage dealt / maximum possible body damage for the shots fired */
  efficiencyPct: number;
  reloads: number;
  log: Shot[];
}

/** Uniform random direction inside a cone of half-angle `deg`, as a yaw/pitch offset. */
function coneOffset(r: Rng, deg: number): [number, number] {
  const a = r() * 2 * Math.PI, rad = Math.sqrt(r()) * deg * DEG;
  return [Math.cos(a) * rad, Math.sin(a) * rad];
}

export class CombatSim {
  private w; private r: Rng;
  private next = 0; private mag: number; private reloadUntil = -1;
  private kickX = 0; private kickY = 0; private lastShot = -Infinity;
  private hp: number[]; private lifeStart: (number | null)[];
  private lastT = 0;
  readonly log: Shot[] = [];
  kills = 0; reloads = 0; private ttk: number[] = []; private shots = 0;

  constructor(private sc: Scenario, private spec: CombatSpec, seed: number) {
    this.w = WEAPONS[spec.weapon];
    this.r = mulberry32((seed ^ 0x2545f491) >>> 0);
    this.mag = this.w.mag;
    this.hp = sc.lanes.map(() => TARGET_HP);
    this.lifeStart = sc.lanes.map(() => null);
  }

  get ammo(): number { return this.mag; }
  get reloading(): boolean { return this.reloadUntil > this.lastT; }

  push(samples: Sample[]): void { for (const s of samples) this.tick(s); }

  private tick(s: Sample): void {
    const w = this.w, dt = s.t - this.lastT;
    this.lastT = s.t;
    if (this.reloadUntil >= 0 && s.t >= this.reloadUntil) { this.mag = w.mag; this.reloadUntil = -1; }
    // recoil recovers while not firing
    if (s.t - this.lastShot > (60 / w.rpm) * 1.5 && dt > 0) {
      const k = Math.hypot(this.kickX, this.kickY), rec = w.recoil.recover * DEG * dt;
      if (k <= rec) { this.kickX = 0; this.kickY = 0; } else { this.kickX *= 1 - rec / k; this.kickY *= 1 - rec / k; }
    }
    const want = w.auto ? s.trig === 1 : s.press > 0;
    if (!want || s.t < this.next || this.reloadUntil >= 0) return;
    if (this.mag <= 0) { this.reloadUntil = s.t + w.reloadS; this.reloads++; return; }
    this.fire(s);
    this.mag--; this.shots++; this.lastShot = s.t; this.next = s.t + 60 / w.rpm;
    if (this.mag === 0) { this.reloadUntil = s.t + w.reloadS; this.reloads++; }
  }

  private fire(s: Sample): void {
    const w = this.w, spread = this.spec.mode === "ads" ? w.spreadDeg.ads : w.spreadDeg.hip;
    for (let p = 0; p < w.pellets; p++) {
      const [ox, oy] = coneOffset(this.r, spread);
      const yaw = s.yaw + this.kickX + ox, pitch = s.pitch + this.kickY + oy;
      let best: Shot = { t: s.t, hit: 0, target: -1, damage: 0 }, bestDist = Infinity;
      for (let i = 0; i < this.sc.lanes.length; i++) {
        // APPROX: straight-line projectile without drop; arrival time = distance / speed (hitscan if unknown)
        const tv0 = targetView(this.sc, i, s.t);
        const travel = w.projectileMs ? Math.hypot(tv0.feet.x, tv0.feet.z) / w.projectileMs : 0;
        const tv = travel ? targetView(this.sc, i, s.t + travel) : tv0;
        const h = hitTest(yaw, pitch, tv.feet, tv.h, tv.size);
        if (!h.kind || h.dist >= bestDist) continue;
        bestDist = h.dist;
        const y = EYE + aimDir(yaw, pitch).y * h.dist;
        const leg = h.kind === 1 && y < tv.feet.y + LEG_FRACTION * BODY_HEIGHT * tv.h;
        const kind = h.kind === 2 ? 2 : leg ? 3 : 1;
        best = { t: s.t, hit: kind as 1 | 2 | 3, target: i, damage: kind === 2 ? w.damage.head : kind === 3 ? w.damage.legs : w.damage.body };
      }
      this.log.push(best);
      if (best.target >= 0) {
        const i = best.target;
        if (this.lifeStart[i] == null) this.lifeStart[i] = s.t;
        this.hp[i] -= best.damage;
        if (this.hp[i] <= 0) { this.kills++; this.ttk.push(s.t - this.lifeStart[i]!); this.hp[i] = TARGET_HP; this.lifeStart[i] = null; }
      }
    }
    // APPROX: recoil kick accumulates per shot up to a cap (upwards + random sideways)
    this.kickY = Math.min(this.kickY + w.recoil.up * DEG, w.recoil.max * DEG);
    this.kickX += (this.r() * 2 - 1) * w.recoil.side * DEG;
  }

  result(): CombatResult {
    const w = this.w, n = this.log.length, hits = this.log.filter(s => s.hit), dmg = hits.reduce((a, s) => a + s.damage, 0);
    return {
      weapon: w.id, mode: this.spec.mode, shots: this.shots, pellets: n, hits: hits.length,
      headHits: hits.filter(s => s.hit === 2).length, legHits: hits.filter(s => s.hit === 3).length,
      accuracyPct: n ? (hits.length / n) * 100 : 0, headshotPct: hits.length ? (hits.filter(s => s.hit === 2).length / hits.length) * 100 : 0,
      damage: dmg, kills: this.kills, meanTtkS: this.ttk.length ? this.ttk.reduce((a, b) => a + b, 0) / this.ttk.length : null,
      efficiencyPct: n ? (dmg / (n * w.damage.body)) * 100 : 0, reloads: this.reloads, log: this.log,
    };
  }
}

export function simulateCombat(sc: Scenario, samples: Sample[], spec: CombatSpec, seed: number): CombatResult {
  const c = new CombatSim(sc, spec, seed);
  c.push(samples);
  return c.result();
}
