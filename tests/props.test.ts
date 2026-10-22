import { expect, it } from "vitest";
import { propLayout, PROP_MIN_RADIUS } from "../src/render/props";
import { DRILLS } from "../src/sim/drills";
import { ANCHORS } from "../src/sim/nemesis";
import { combatParams, COMBAT_SCENARIOS, type CombatScenarioId } from "../src/sim/combat";

it("no scenery prop can sit between the player and any target", () => {
  // furthest any target gets: lane distance (+ range oscillation) plus maximum lateral strafe
  const reach: number[] = [];
  for (const d of Object.values(DRILLS)) {
    if (d.dist) reach.push(Math.hypot(d.dist, d.bound ?? 0));
    if (d.spawn) reach.push(Math.hypot(d.spawn.dist[1], d.spawn.move?.bound ?? 0));
  }
  for (const a of Object.values(ANCHORS)) for (const p of [a.easy, a.hard]) reach.push(Math.hypot(p.dist * 1.15, p.bound));
  for (const id of Object.keys(COMBAT_SCENARIOS) as CombatScenarioId[]) {
    const p = combatParams(id);
    reach.push(Math.hypot(p.dist + (p.distOsc?.amp ?? 0), p.bound));
  }
  const maxReach = Math.max(...reach);
  expect(maxReach).toBeLessThan(60);
  for (const pr of propLayout()) {
    // nearest point of the (rotated) box to the player is at least centre distance minus half its diagonal
    const near = Math.hypot(pr.x, pr.z) - Math.hypot(pr.w, pr.d) / 2;
    expect(near).toBeGreaterThan(maxReach + 2);
  }
  expect(PROP_MIN_RADIUS).toBeGreaterThan(maxReach);
});
