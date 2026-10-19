import { cmPer360, sensFromCm } from "../core/units";
import { isEventLog, type InputSample, type SessionLog } from "../telemetry/schema";
import { timingReport, type TimingReport } from "./calibration";
import type { M1Metrics } from "./metrics";
import { confidence, fitCurve, type Fit } from "./fit";
import { fatigue, habits, localInsights, type Habits, type Insight, type ScoredBlock } from "./insights";
import { analyzeBlock } from "./track";

export interface SessionResult {
  scored: ScoredBlock[];
  fit: Fit;
  per: Record<"pb" | "close" | "mid" | "duo", Fit>;
  habits: Habits;
  fatigue: number;
  conf: ReturnType<typeof confidence>;
  baseCm: number;
  recSens: number; recLoSens: number; recHiSens: number;
  insights: Insight[];
  /** Milestone 1 metrics per range, averaged over scored blocks (null for v1 sessions) */
  m1: Record<"pb" | "close" | "mid" | "duo", M1Summary> | null;
  /** input timing over all logged events (null for v1 sessions) */
  timing: TimingReport | null;
}

/** Numeric M1 fields averaged across blocks; null where no block had a value. */
export type M1Summary = { [K in keyof M1Metrics]: M1Metrics[K] extends number ? number : M1Metrics[K] extends number | null ? number | null : never };

const M1_KEYS: (keyof M1Summary)[] = ["onPct", "headPct", "errHDeg", "errVDeg", "errHNorm", "errVNorm", "trailingPct", "leadingPct", "overshootPerS", "overshootMagNorm", "undershootPerS", "jitterHDeg", "jitterVDeg", "correctionsPerS", "correctionAmpDeg", "handSpeedMean", "handSpeedPeak", "handAccelPeak", "reversalLatencyMs", "reversalsSeen", "reversalsMissed", "reacquireMs", "losses", "stabilizeMs", "switchMs", "leftOnPct", "rightOnPct", "asymmetryPct", "windowSdPct", "driftPctPerS", "seconds"];

export function summarizeM1(list: M1Metrics[]): M1Summary {
  const out = {} as Record<string, number | null>;
  for (const k of M1_KEYS) {
    const v = list.map(m => m[k] as number | null).filter((x): x is number => x != null);
    out[k] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }
  return out as unknown as M1Summary;
}

/** Everything the results screen shows, recomputed from the stored log only. Returns null if too few scored blocks. */
export function computeResult(s: SessionLog): SessionResult | null {
  const { dpi, sens } = s.settings;
  const scored: ScoredBlock[] = s.blocks.filter(b => !b.warm).map(b => ({ cm: b.cm360, round: b.round, data: analyzeBlock(b, dpi) }));
  if (scored.length < 3) return null;
  const fit = fitCurve(scored.map(b => ({ cm: b.cm, score: b.data.score })));
  fit.pts.forEach((p, i) => (p.r2 = scored[i].round === 2));
  const per = {
    pb: fitCurve(scored.map(b => ({ cm: b.cm, score: b.data.pb.on }))),
    close: fitCurve(scored.map(b => ({ cm: b.cm, score: b.data.close.on }))),
    mid: fitCurve(scored.map(b => ({ cm: b.cm, score: b.data.mid.on }))),
    duo: fitCurve(scored.map(b => ({ cm: b.cm, score: b.data.duo.score }))),
  };
  const h = habits(scored), fat = fatigue(scored, fit), baseCm = cmPer360(sens, dpi);
  return {
    scored, fit, per, habits: h, fatigue: fat, conf: confidence(fit), baseCm,
    recSens: sensFromCm(fit.peakCm, dpi), recLoSens: sensFromCm(fit.hi, dpi), recHiSens: sensFromCm(fit.lo, dpi),
    insights: localInsights(h, fit, per, fat, scored, baseCm),
    m1: scored[0].data.m1 ? {
      pb: summarizeM1(scored.map(b => b.data.m1!.pb)), close: summarizeM1(scored.map(b => b.data.m1!.close)),
      mid: summarizeM1(scored.map(b => b.data.m1!.mid)), duo: summarizeM1(scored.map(b => b.data.m1!.duo)),
    } : null,
    timing: sessionTiming(s),
  };
}

/** Block metrics of the warm-up are not scored but are shown in the table. */
export const allBlockMetrics = (s: SessionLog) => s.blocks.map(b => ({ block: b, data: analyzeBlock(b, s.settings.dpi) }));

/** Timing report over every logged event in the session (frame rate unknown offline). */
export function sessionTiming(s: SessionLog): TimingReport | null {
  if (s.sampling !== "event" || !s.capture) return null;
  const all: InputSample[] = [];
  for (const b of s.blocks) for (const d of Object.values(b.drills)) if (d && isEventLog(d)) all.push(...d.events);
  return timingReport(all, s.capture, null);
}
