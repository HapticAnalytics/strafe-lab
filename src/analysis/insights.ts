import { fmt, mean } from "../core/math";
import { INSIGHT } from "./constants";
import type { Fit } from "./fit";
import type { BlockMetrics } from "./track";

export interface ScoredBlock { cm: number; round: 1 | 2 | null; data: BlockMetrics }
export type Habits = Record<"behind" | "vertMiss" | "left" | "right" | "recover" | "jitter" | "oscPerSec" | "pitchErr" | "head", number>;
export type Insight = ["fix" | "watch" | "solid", string];

const RANGES = ["pb", "close", "mid"] as const;

export function habits(scored: ScoredBlock[]): Habits {
  const avg = (k: keyof Habits) => mean(scored.flatMap(b => RANGES.map(i => b.data[i][k])));
  return { behind: avg("behind"), vertMiss: avg("vertMiss"), left: avg("left"), right: avg("right"), recover: avg("recover"), jitter: avg("jitter"), oscPerSec: avg("oscPerSec"), pitchErr: avg("pitchErr"), head: avg("head") };
}

/** Slope of fit residuals vs play order, in score points per block. */
export function fatigue(scored: ScoredBlock[], fit: Fit): number {
  if (!fit.f) return 0;
  const r = scored.map(b => ({ o: b.data.order, e: b.data.score - fit.f!(Math.log(b.cm)) }));
  const om = mean(r.map(x => x.o)), em = mean(r.map(x => x.e));
  let num = 0, den = 0;
  for (const x of r) { num += (x.o - om) * (x.e - em); den += (x.o - om) ** 2; }
  return den ? num / den : 0;
}

export function localInsights(h: Habits, fit: Fit, per: Record<string, Fit>, fat: number, scored: ScoredBlock[], baseCm: number): Insight[] {
  const out: Insight[] = [], diff = (fit.peakCm / baseCm - 1) * 100;
  if (Math.abs(diff) < INSIGHT.sensClosePct) out.push(["solid", `Your current sens is already within ${Math.abs(diff).toFixed(0)}% of your best. Keep it and put your time into the habits below.`]);
  else out.push(["fix", `You tracked best ${Math.abs(diff).toFixed(0)}% ${diff > 0 ? "slower" : "faster"} than your current sens (${fmt(fit.peakCm, 1)} vs ${fmt(baseCm, 1)} cm/360).`]);
  const pbC = per.pb?.peakCm, midC = per.mid?.peakCm;
  if (pbC && midC && midC / pbC > INSIGHT.splitRatio) out.push(["watch", `Point-blank wants a faster sens (${fmt(pbC, 0)} cm/360) than mid-range (${fmt(midC, 0)} cm/360). Your recommended sens is the compromise, weighted toward close range.`]);
  const lr = h.left - h.right;
  if (Math.abs(lr) >= INSIGHT.leftRightGap) out.push(["fix", `You're stronger tracking ${lr > 0 ? "leftward" : "rightward"} strafes: ${fmt(Math.max(h.left, h.right), 0)}% on target vs ${fmt(Math.min(h.left, h.right), 0)}% the other way.`]);
  else out.push(["solid", `Left and right tracking are balanced (${fmt(h.left, 0)}% vs ${fmt(h.right, 0)}%).`]);
  if (h.behind > INSIGHT.behindHigh) out.push(["fix", `When you lose a strafing enemy, ${fmt(h.behind, 0)}% of that time you're trailing behind them. You're reacting to their strafe instead of matching it.`]);
  else if (h.behind < INSIGHT.behindLow) out.push(["watch", `When you lose the enemy you're usually ahead of them (${fmt(100 - h.behind, 0)}%). You over-lead and get caught by their next direction change.`]);
  if (h.recover > INSIGHT.recoverMs) out.push(["fix", `After an enemy changes direction it takes you ${fmt(h.recover, 0)} ms on average to get back on them. That gap is where ADAD spam wins fights.`]);
  if (h.vertMiss > INSIGHT.vertMissPct) out.push(["fix", `${fmt(h.vertMiss, 0)}% of your off-target time is vertical: lined up left-right but above or below them, mostly on crouch spam and jumps.`]);
  const fast = scored.filter(b => b.cm < fit.peakCm * 0.8), slow = scored.filter(b => b.cm > fit.peakCm * 1.25);
  const jit = (arr: ScoredBlock[]) => mean(arr.map(b => mean(RANGES.map(i => b.data[i].jitter))));
  if (fast.length && slow.length && jit(fast) > jit(slow) * INSIGHT.wobbleRatio) out.push(["watch", `Your aim wobbles more at fast sens (${fmt(jit(fast), 2)}° vs ${fmt(jit(slow), 2)}° at slow). That's the cost of wrist aiming at high sens.`]);
  if (fat < INSIGHT.fatiguePerBlock) out.push(["watch", `Scores dropped about ${fmt(-fat, 1)} points per block as the test went on. Fatigue shows up early for you.`]);
  return out;
}
