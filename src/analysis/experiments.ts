// Milestone 6 experiment framework. Practice experiments are pre-registered (arms, outcome metric, minimum effect,
// sample size) before any data, then evaluated deterministically. The coach may propose; only this code decides.
import { mean } from "../core/math";
import { mulberry32 } from "../core/rng";
import type { SessionLog } from "../telemetry/schema";
import { dayOf, type NoiseFloor } from "./baseline";
import { batteryMetrics } from "./battery";

export interface Experiment {
  id: string;
  name: string;
  hypothesis: string;
  arms: [{ name: string; description: string }, { name: string; description: string }];
  /** battery metric key that decides the experiment (must have a noise floor at registration) */
  metricKey: string;
  /** smallest difference that counts, in noise-floor units (SDC95) */
  minEffectFloors: number;
  /** practice days per arm */
  daysPerArm: number;
  /** ABBA... arm order per practice day, fixed at registration */
  schedule: (0 | 1)[];
  createdAt: string;
  /** pre-registration is frozen: these fields may not change once data exists */
  frozen: true;
  status: "active" | "complete" | "abandoned";
  /** practice days logged: day -> arm actually practised */
  practice: { day: string; arm: 0 | 1 }[];
  proposedBy: "coach" | "user";
}

// HYPOTHESIS: a counterbalanced ABBA-style schedule (A B B A A B ...) cancels linear learning trends between arms
export function abbaSchedule(daysPerArm: number): (0 | 1)[] {
  const out: (0 | 1)[] = [];
  const pat: (0 | 1)[] = [0, 1, 1, 0];
  for (let i = 0; out.length < daysPerArm * 2; i++) out.push(pat[i % 4]);
  return out;
}

export type Verdict = "insufficient data" | "A better" | "B better" | "no difference detected";

export interface ExperimentResult {
  exp: Experiment;
  /** outcome values per arm (battery the day after practising that arm) */
  a: number[]; b: number[];
  n: number;
  /** (B - A) in noise-floor units, sign so positive = B better */
  diffFloors: number | null;
  ci: [number, number] | null;
  verdict: Verdict;
  sessionIds: string[];
}

// APPROX: 2000 bootstrap resamples for the difference CI
const B = 2000;

/**
 * Outcome for a practice day = the first battery on the following calendar day (retention, not same-day
 * performance). Each battery is attributed to at most one practice day.
 */
export function evaluateExperiment(exp: Experiment, battery: SessionLog[], floor: NoiseFloor | undefined, metricsOf = batteryMetrics): ExperimentResult {
  const sorted = [...battery].sort((x, y) => x.startedAt.localeCompare(y.startedAt));
  const a: number[] = [], b: number[] = [], ids: string[] = [];
  const used = new Set<string>();
  for (const p of exp.practice) {
    const next = sorted.find(s => dayOf(s.startedAt) > p.day && !used.has(s.id));
    if (!next) continue;
    const m = metricsOf(next).find(x => x.key === exp.metricKey);
    if (!m) continue;
    used.add(next.id); ids.push(next.id);
    (p.arm === 0 ? a : b).push(m.value);
  }
  const n = a.length + b.length;
  const res: ExperimentResult = { exp, a, b, n, diffFloors: null, ci: null, verdict: "insufficient data", sessionIds: ids };
  if (!floor?.sdc95 || a.length < exp.daysPerArm || b.length < exp.daysPerArm) return res;
  const sign = floor.higherIsBetter ? 1 : -1;
  const diff = (sign * (mean(b) - mean(a))) / floor.sdc95;
  const r = mulberry32(42), boots: number[] = [];
  for (let i = 0; i < B; i++) {
    const ra = a.map(() => a[Math.floor(r() * a.length)]), rb = b.map(() => b[Math.floor(r() * b.length)]);
    boots.push((sign * (mean(rb) - mean(ra))) / floor.sdc95);
  }
  boots.sort((x, y) => x - y);
  const ci: [number, number] = [boots[Math.floor(B * 0.025)], boots[Math.floor(B * 0.975)]];
  res.diffFloors = diff; res.ci = ci;
  if (ci[0] > 0 && diff >= exp.minEffectFloors) res.verdict = "B better";
  else if (ci[1] < 0 && -diff >= exp.minEffectFloors) res.verdict = "A better";
  else res.verdict = "no difference detected";
  return res;
}

/** Which arm to practise today (null when the schedule is done or the experiment is not active). */
export function armForToday(exp: Experiment, today: string): 0 | 1 | null {
  if (exp.status !== "active") return null;
  const logged = exp.practice.find(p => p.day === today);
  if (logged) return logged.arm;
  return exp.schedule[exp.practice.length] ?? null;
}

/** Sens is locked while any experiment is active (ROADMAP: no sens switching during training blocks). */
export const sensLocked = (exps: Experiment[]) => exps.some(e => e.status === "active");
