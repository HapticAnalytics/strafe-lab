// Milestone 5 dashboard data. Pure function of stored sessions + external results. Every number carries the ids of
// the stored records it came from, so the UI can show its source and a test can check none are invented.
import { sensFromCm } from "../core/units";
import type { ExternalResult, SessionLog } from "../telemetry/schema";
import { batterySessions, dayOf, externalSeries, noiseFloor, type NoiseFloor } from "./baseline";
import { batteryMetrics, batterySeries } from "./battery";
import { fingerprint, type Finding } from "./fingerprint";
import { computeResult } from "./result";
import { computeV3 } from "./result3";
import { trainedVsHeldOut, trainSessions, type HeldOutRow, type TrainedRow } from "./training";

export interface Sourced { value: number; sources: string[] }

export interface SensPoint {
  at: string; sessionId: string; protocol: "v3" | "classic"; label: string;
  peakCm: Sourced; sens: Sourced; ciLo: number | null; ciHi: number | null; noClearWinner: boolean;
}
export interface TrendSeries { key: string; label: string; unit: string; higherIsBetter: boolean; points: { at: string; sessionId: string; value: number }[]; floor: NoiseFloor }
export interface RecordRow { key: string; label: string; unit: string; best: Sourced; at: string }

export interface DashboardData {
  sens: SensPoint[];
  trends: TrendSeries[];
  external: TrendSeries[];
  records: RecordRow[];
  findings: Finding[];
  fingerprintReady: boolean;
  baselineIds: string[];
  counts: { sensTests: number; batteries: number; batteryDays: number; external: number; trainings: number };
  /** Milestone 7: trained (Nemesis levels) and held-out (battery) progress, kept separate */
  training: { trained: TrainedRow[]; heldOut: HeldOutRow[] };
}

export function buildDashboard(all: SessionLog[], ext: ExternalResult[]): DashboardData {
  const done = all.filter(s => s.status === "complete").sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const sens: SensPoint[] = [];
  for (const s of done) {
    if (s.protocol === "v3") {
      const r = computeV3(s);
      if (!r.overall) continue;
      sens.push({ at: s.startedAt, sessionId: s.id, protocol: "v3", label: s.mode ?? "standard", peakCm: { value: r.overall.peakCm, sources: [s.id] }, sens: { value: sensFromCm(r.overall.peakCm, s.settings.dpi), sources: [s.id] }, ciLo: r.overall.ciLo, ciHi: r.overall.ciHi, noClearWinner: r.overall.noClearWinner });
    } else if (!s.protocol) {
      const r = computeResult(s);
      if (!r) continue;
      sens.push({ at: s.startedAt, sessionId: s.id, protocol: "classic", label: "classic", peakCm: { value: r.fit.peakCm, sources: [s.id] }, sens: { value: r.recSens, sources: [s.id] }, ciLo: null, ciHi: null, noClearWinner: false });
    }
  }
  const bat = batterySessions(done);
  const series = batterySeries(bat);
  const fp = fingerprint(bat);
  const baseSet = new Set(fp.baselineIds);
  const trends: TrendSeries[] = series.filter(x => x.key.startsWith("skill:") || x.key === "battery:combined").map(x => ({
    key: x.key, label: x.label, unit: x.unit, higherIsBetter: x.higherIsBetter,
    points: bat.map(s => ({ s, p: batteryMetrics(s).find(p => p.key === x.key) })).filter(q => q.p).map(q => ({ at: q.s.startedAt, sessionId: q.s.id, value: q.p!.value })),
    // the floor comes from the baseline days only
    floor: noiseFloor({ ...x, byDay: bat.filter(s => baseSet.has(s.id)).map(s => ({ s, p: batteryMetrics(s).find(p => p.key === x.key) })).filter(q => q.p).map(q => ({ day: dayOf(q.s.startedAt), value: q.p!.value })) }),
  }));
  const external: TrendSeries[] = externalSeries(ext).map(x => {
    const rows = ext.filter(r => `ext:${r.kind}:${r.measure}:${r.unit}` === x.key);
    return { key: x.key, label: x.label, unit: x.unit, higherIsBetter: x.higherIsBetter, points: rows.map(r => ({ at: r.at, sessionId: r.id, value: r.value })), floor: noiseFloor(x) };
  });
  const records: RecordRow[] = [...trends, ...external].filter(t => t.points.length).map(t => {
    const best = t.points.reduce((a, p) => ((t.higherIsBetter ? p.value > a.value : p.value < a.value) ? p : a), t.points[0]);
    return { key: t.key, label: t.label, unit: t.unit, best: { value: best.value, sources: [best.sessionId] }, at: best.at };
  });
  const train = trainSessions(all);
  return {
    sens, trends, external, records, findings: fp.findings, fingerprintReady: fp.ready, baselineIds: fp.baselineIds,
    counts: { sensTests: sens.length, batteries: bat.length, batteryDays: new Set(bat.map(s => dayOf(s.startedAt))).size, external: ext.length, trainings: train.length },
    training: trainedVsHeldOut(train, trends, fp.baselineIds),
  };
}

/** Every stored-record id the dashboard cites (sessions and external results). */
export function citedIds(d: DashboardData): Set<string> {
  const ids = new Set<string>();
  for (const p of d.sens) { p.peakCm.sources.forEach(i => ids.add(i)); p.sens.sources.forEach(i => ids.add(i)); ids.add(p.sessionId); }
  for (const t of [...d.trends, ...d.external]) for (const p of t.points) ids.add(p.sessionId);
  for (const r of d.records) r.best.sources.forEach(i => ids.add(i));
  for (const f of d.findings) for (const e of f.evidence) ids.add(e.sessionId);
  d.baselineIds.forEach(i => ids.add(i));
  for (const r of [...d.training.trained, ...d.training.heldOut]) r.sources.forEach(i => ids.add(i));
  return ids;
}
