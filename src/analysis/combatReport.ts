// Milestone 8: combat outcome and mechanics of one combat segment, from the event log. Mechanics come from the same
// replay with no weapon involved; the weapon layer is computed separately on top.
import { simulateCombat, type CombatResult } from "../sim/combat";
import { replay } from "../sim/evaluator";
import { buildScenario } from "../sim/scenario";
import type { EventDrillLog } from "../telemetry/schema";
import { computeM1, type M1Metrics } from "./metrics";

export interface CombatReport { mechanics: M1Metrics; combat: CombatResult }

export function combatReport(d: EventDrillLog, dpi: number): CombatReport | null {
  if (!d.combat) return null;
  const sc = buildScenario(d.id, d.seed, d.dur, d.params);
  const ev = replay(sc, d.k, d.events, d.tEnd);
  return { mechanics: computeM1(ev.samples, dpi, ev.kills), combat: simulateCombat(sc, ev.samples, d.combat, d.seed) };
}
