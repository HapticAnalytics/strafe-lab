import { describe, expect, it } from "vitest";
import { combatReport } from "../src/analysis/combatReport";
import { radPerCount } from "../src/core/units";
import { synthPlayerEvents } from "../src/input/synthetic";
import { combatParams, COMBAT_SCENARIOS, simulateCombat, type CombatScenarioId, type CombatSpec } from "../src/sim/combat";
import { replay } from "../src/sim/evaluator";
import { buildScenario, laneDist } from "../src/sim/scenario";
import { WEAPONS, type WeaponId } from "../src/sim/weapons";
import type { EventDrillLog, InputSample } from "../src/telemetry/schema";

const K = radPerCount(32, 800);
/** Synthetic player tracking the target, holding the trigger (auto) or tapping it (semi) for the whole drill. */
function log(sid: CombatScenarioId, weapon: WeaponId, mode: "hip" | "ads", lag = 0.04, dur = 10): EventDrillLog {
  const p = combatParams(sid), sc = buildScenario("nem", 77, dur, p);
  const aim = synthPlayerEvents(sc, K, { lag, gain: 0.6, seed: 2 }, 1000);
  const trig: InputSample[] = [];
  if (WEAPONS[weapon].auto) trig.push({ t: 0.5, dx: 0, dy: 0, b: 1 }, { t: dur - 0.1, dx: 0, dy: 0, b: -1 });
  else for (let t = 0.5; t < dur; t += 0.4) trig.push({ t, dx: 0, dy: 0, b: 1 }, { t: t + 0.05, dx: 0, dy: 0, b: -1 });
  const events = [...aim, ...trig].sort((a, b) => a.t - b.t);
  const combat: CombatSpec = { scenario: sid, weapon, version: WEAPONS[weapon].version, mode };
  return { id: "nem", seed: 77, dur, tEnd: dur, k: K, events, params: p, combat };
}

describe("Milestone 8 acceptance: mechanical scores are unaffected by weapon and mode", () => {
  it("same input -> identical mouse-control metrics for every weapon and hip/ADS; combat results differ", () => {
    const base = log("smg", "r99", "hip");
    const reports = (["r99", "r301", "eva8", "wingman", "g7"] as WeaponId[]).flatMap(w => (["hip", "ads"] as const).map(m =>
      combatReport({ ...base, combat: { scenario: "smg", weapon: w, version: WEAPONS[w].version, mode: m } }, 800)!));
    for (const r of reports) expect(r.mechanics).toEqual(reports[0].mechanics);
    expect(new Set(reports.map(r => r.combat.damage)).size).toBeGreaterThan(5);
  });
});

describe("weapon layer", () => {
  it("auto weapon fires at its RPM and reloads at magazine empty", () => {
    const r = combatReport(log("smg", "r99", "ads", 0.04, 10), 800)!.combat;
    const w = WEAPONS.r99;
    // fire for 9.4 s with reloads of 2.5 s every 18 rounds at 18 rounds/s
    const cycle = w.mag / (w.rpm / 60) + w.reloadS;
    expect(r.shots).toBeGreaterThan(Math.floor(9.4 / cycle) * w.mag);
    expect(r.shots).toBeLessThanOrEqual(Math.ceil(9.4 / cycle) * w.mag + w.mag);
    expect(r.reloads).toBeGreaterThan(1);
  });
  it("ADS is more accurate than hipfire for the same input (smaller spread)", () => {
    const hip = combatReport(log("ar", "r301", "hip"), 800)!.combat, ads = combatReport(log("ar", "r301", "ads"), 800)!.combat;
    expect(ads.accuracyPct).toBeGreaterThan(hip.accuracyPct);
  });
  it("shotguns fire 8 pellets per shot; semi-auto weapons need one press per shot", () => {
    const s = combatReport(log("shotgun", "eva8", "hip"), 800)!.combat;
    expect(s.pellets).toBe(s.shots * 8);
    const wm = combatReport(log("wingman", "wingman", "ads"), 800)!.combat;
    const presses = log("wingman", "wingman", "ads").events.filter(e => e.b === 1).length;
    expect(wm.shots).toBeLessThanOrEqual(presses);
  });
  it("damage uses head/body/leg values; kills reset HP", () => {
    const r = combatReport(log("smg", "r99", "ads", 0, 10), 800)!.combat;
    for (const s of r.log.filter(x => x.hit)) expect([12, 15, 10]).toContain(s.damage);
    expect(r.kills).toBeGreaterThan(0);
    expect(r.meanTtkS!).toBeGreaterThan(0);
  });
  it("deterministic for the same log (seeded spread and recoil)", () => {
    const l = log("marksman", "g7", "hip");
    expect(combatReport(l, 800)).toEqual(combatReport(l, 800));
  });
  it("distance-changing scenario actually changes range", () => {
    const sc = buildScenario("nem", 1, 10, combatParams("range"));
    expect(laneDist(sc.lanes[0], 1.5)).toBeGreaterThan(laneDist(sc.lanes[0], 4.5) + 10);
  });
  it("every scenario names a weapon with a sourced profile", () => {
    for (const s of Object.values(COMBAT_SCENARIOS)) { expect(WEAPONS[s.weapon]).toBeDefined(); expect(WEAPONS[s.weapon].source.length).toBeGreaterThan(20); }
  });
  it("no trigger -> no shots", () => {
    const sc = buildScenario("nem", 1, 5, combatParams("ar"));
    const ev = replay(sc, K, [], 5);
    expect(simulateCombat(sc, ev.samples, { scenario: "ar", weapon: "r301", version: "x", mode: "hip" }, 1).shots).toBe(0);
  });
});
