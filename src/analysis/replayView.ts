// Milestone 4 replay model: the stored event log re-run through the same evaluator as live play and analysis.
// Nothing here is recorded video; every frame of a replay is recomputed, so a replay IS the measurement.
import { replay, type DrillEvaluator, type Sample } from "../sim/evaluator";
import { buildScenario, targetView, type Scenario, type TargetView } from "../sim/scenario";
import type { EventDrillLog } from "../telemetry/schema";
import { analyzeM1, type FlaggedEvents, type M1Metrics, type M1Series } from "./metrics";

export interface ReplayData {
  log: EventDrillLog;
  sc: Scenario;
  ev: DrillEvaluator;
  samples: Sample[];
  /** null for spawn drills (they are scored per target, not by tracking metrics) */
  m1: { metrics: M1Metrics; events: FlaggedEvents; series: M1Series } | null;
  duration: number;
}

export function loadReplay(log: EventDrillLog, dpi: number): ReplayData {
  const sc = buildScenario(log.id, log.seed, log.dur, log.params);
  const ev = replay(sc, log.k, log.events, log.tEnd);
  const m1 = sc.spawn ? null : analyzeM1(ev.samples, dpi, ev.kills);
  return { log, sc, ev, samples: ev.samples, m1, duration: ev.samples.length ? ev.samples[ev.samples.length - 1].t : 0 };
}

export interface ReplayFrame {
  t: number;
  index: number;
  aim: { yaw: number; pitch: number };
  /** visible enemies at time t */
  targets: { i: number; tv: TargetView; on: boolean }[];
  on: 0 | 1 | 2;
}

/** State at replay time t (seconds), derived only from the replayed samples, kills and spawn records. */
export function frameAt(r: ReplayData, t: number): ReplayFrame {
  const n = r.samples.length;
  const index = Math.max(0, Math.min(n - 1, Math.round(t / 0.001)));
  const s = r.samples[index];
  const tt = s ? s.t : 0;
  const targets: ReplayFrame["targets"] = [];
  if (r.sc.spawn) {
    const sp = r.ev.spawns.find(x => x.at <= tt + 1e-9 && tt < (x.done ?? x.at + r.sc.spawn!.def.timeout) + 1e-9);
    if (sp) targets.push({ i: sp.i, tv: targetView(r.sc, sp.i, tt - sp.at), on: !!s?.on });
  } else {
    for (let i = 0; i < r.sc.lanes.length; i++) {
      const k = r.ev.kills.find(x => x.i === i);
      if (k && k.t <= tt) continue;
      targets.push({ i, tv: targetView(r.sc, i, tt), on: !!s?.on && s.target === i });
    }
  }
  return { t: tt, index, aim: s ? { yaw: s.yaw, pitch: s.pitch } : { yaw: 0, pitch: 0 }, targets, on: s ? s.on : 0 };
}

export interface Flag { t: number; kind: "reversal" | "loss" | "overshoot" | "kill" | "spawn-miss"; label: string }

/** All flagged events, sorted by time, for one-click navigation. */
export function flags(r: ReplayData): Flag[] {
  const out: Flag[] = [];
  if (r.m1) {
    for (const e of r.m1.events.reversals) out.push({ t: e.t, kind: "reversal", label: e.latencyMs == null ? "Reversal · no response" : `Reversal · ${Math.round(e.latencyMs)} ms response` });
    for (const e of r.m1.events.losses) out.push({ t: e.t, kind: "loss", label: e.reacquireMs == null ? "Lost target · not reacquired" : `Lost target · back in ${Math.round(e.reacquireMs)} ms` });
    for (const e of r.m1.events.overshoots) out.push({ t: e.t, kind: "overshoot", label: `Overshoot · ${e.magNorm.toFixed(1)}× half-width` });
  }
  for (const k of r.ev.kills) out.push({ t: k.t, kind: "kill", label: `Enemy ${k.i + 1} down` });
  for (const s of r.ev.spawns) if (s.done == null) out.push({ t: s.at, kind: "spawn-miss", label: `Target ${s.i + 1} timed out` });
  return out.sort((a, b) => a.t - b.t);
}
