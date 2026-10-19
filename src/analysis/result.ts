import { cmPer360, sensFromCm } from "../core/units";
import type { SessionLog } from "../telemetry/schema";
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
  };
}

/** Block metrics of the warm-up are not scored but are shown in the table. */
export const allBlockMetrics = (s: SessionLog) => s.blocks.map(b => ({ block: b, data: analyzeBlock(b, s.settings.dpi) }));
