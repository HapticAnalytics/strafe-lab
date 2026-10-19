// Milestone 6: the coach's only input. Every number it may cite is a Fact with an id, built deterministically from
// stored data. The validator (validate.ts) rejects any number in coach text that does not cite one of these.
import type { DashboardData } from "../analysis/dashboard";
import type { ExperimentResult } from "../analysis/experiments";
import { fmt } from "../core/math";

export interface Fact { id: string; label: string; value: number; unit: string; sources: string[] }

export interface CoachContext {
  facts: Fact[];
  /** plain-text summary for the prompt; every number in it is followed by its [F#] */
  text: string;
  /** keys of metrics an experiment may pre-register (battery metrics with a noise floor) */
  metricKeys: string[];
  /** sens changes are only allowed in an evaluation window (no active experiment or training block) */
  sensLocked: boolean;
}

export function buildContext(d: DashboardData, experiments: ExperimentResult[], sensLocked: boolean): CoachContext {
  const facts: Fact[] = [];
  const add = (label: string, value: number, unit: string, sources: string[]) => {
    const id = `F${facts.length + 1}`;
    facts.push({ id, label, value, unit, sources });
    return `${fmt(value, Math.abs(value) < 10 ? 2 : 1)} ${unit} [${id}]`;
  };
  const lines: string[] = [];
  lines.push(`Data available: ${add("sens tests", d.counts.sensTests, "tests", [])}, ${add("baseline batteries", d.counts.batteries, "sessions", d.baselineIds)}, ${add("battery days", d.counts.batteryDays, "days", d.baselineIds)}.`);
  const lastSens = d.sens[d.sens.length - 1];
  if (lastSens) lines.push(`Latest sens test (${lastSens.label}): best ${add("latest best cm/360", lastSens.peakCm.value, "cm/360", lastSens.peakCm.sources)}${lastSens.ciLo != null ? `, 95% interval ${add("interval low", lastSens.ciLo, "cm/360", [lastSens.sessionId])} to ${add("interval high", lastSens.ciHi!, "cm/360", [lastSens.sessionId])}` : ""}${lastSens.noClearWinner ? ", no clear winner" : ""}.`);
  if (!d.fingerprintReady) lines.push("Noise floor not ready yet (needs 3 battery days), so no findings exist.");
  for (const f of d.findings) {
    const ids = f.evidence.filter(e => e.over).map(e => e.sessionId);
    lines.push(`Finding "${f.title}" (${f.kind}, confidence ${f.confidence}, trend ${f.trend}): value ${add(`${f.key} value`, f.value, f.unit, ids)}, severity ${add(`${f.key} severity`, f.severity, "x noise floor", ids)}, over the floor in ${add(`${f.key} sessions over`, ids.length, "sessions", ids)}.`);
  }
  for (const t of d.trends) {
    const last = t.points[t.points.length - 1];
    if (!last) continue;
    lines.push(`${t.label}: latest ${add(`${t.key} latest`, last.value, t.unit, [last.sessionId])}${t.floor.ready && t.floor.sdc95 ? `, baseline mean ${add(`${t.key} baseline mean`, t.floor.mean, t.unit, d.baselineIds)}, SDC95 ${add(`${t.key} SDC95`, t.floor.sdc95, t.unit, d.baselineIds)}` : ""}.`);
  }
  for (const e of experiments) {
    lines.push(`Experiment "${e.exp.name}" (${e.exp.status}, metric ${e.exp.metricKey}): verdict ${e.verdict}${e.diffFloors != null ? `, difference ${add(`${e.exp.id} diff`, e.diffFloors, "x noise floor", e.sessionIds)}` : ""}, ${add(`${e.exp.id} n`, e.n, "measurements", e.sessionIds)}.`);
  }
  return { facts, text: lines.join("\n"), metricKeys: d.trends.filter(t => t.floor.ready).map(t => t.key), sensLocked };
}
