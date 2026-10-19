// Milestone 9 analysis: movement vs mouse vs interaction effects on tracking, with bootstrap CIs.
import { mean } from "../core/math";
import { mulberry32 } from "../core/rng";
import { CELLS, promptAt, type MovementSpec } from "../sim/movement";
import { replay } from "../sim/evaluator";
import { buildScenario } from "../sim/scenario";
import { isEventLog, type EventDrillLog, type SessionLog } from "../telemetry/schema";
import { sd } from "./stats";

// APPROX: a sample counts as compliant when the player strafes the prompted way above 1 m/s (or stands below 1 m/s)
export const COMPLY_SPEED = 1;
// APPROX: samples within 250 ms after a prompt change are not judged (reaction + acceleration to 1 m/s takes ~0.2 s)
export const REACT_GRACE = 0.25;
// HYPOTHESIS: segments with < 60% compliance are excluded from the effect estimates (the condition wasn't performed)
export const MIN_COMPLIANCE = 60;
// APPROX: 2000 bootstrap resamples
const B = 2000;

export interface MoveSegment { spec: MovementSpec; onPct: number; compliancePct: number; sessionId: string }

export function scoreMovement(d: EventDrillLog, sessionId = ""): MoveSegment | null {
  const spec = d.params?.movement;
  if (!spec) return null;
  const sc = buildScenario(d.id, d.seed, d.dur, d.params);
  const ev = replay(sc, d.k, d.events, d.tEnd);
  const S = ev.samples;
  let ok = 0, judged = 0, prev: number | null = null, changedAt = -Infinity;
  for (const s of S) {
    const want = promptAt(sc, spec, s.t);
    if (want !== prev) { if (prev !== null) changedAt = s.t; prev = want; }
    if (s.t - changedAt < REACT_GRACE) continue;
    judged++;
    if (want === 0 ? Math.abs(s.pv) < COMPLY_SPEED : Math.sign(s.pv) === want && Math.abs(s.pv) >= COMPLY_SPEED) ok++;
  }
  return { spec, onPct: S.length ? (S.filter(s => s.on).length / S.length) * 100 : 0, compliancePct: judged ? (ok / judged) * 100 : 0, sessionId };
}

export function movementSegments(sessions: SessionLog[]): MoveSegment[] {
  const out: MoveSegment[] = [];
  for (const s of sessions) for (const b of s.blocks) for (const d of Object.values(b.drills)) {
    if (!d || !isEventLog(d) || !d.params?.movement) continue;
    const r = scoreMovement(d, s.id);
    if (r) out.push(r);
  }
  return out;
}

const key = (m: MovementSpec) => `${m.cond}:${m.targetMoving ? "moving" : "still"}`;

export interface Effect { label: string; estimate: number | null; ci: [number, number] | null; d: number | null; n: number }
export interface MovementReport { cells: { key: string; spec: MovementSpec; n: number; mean: number | null; excluded: number }[]; effects: Effect[] }

/**
 * Effects in time-on-target points (positive = higher on%). Factorial core:
 *   movement = mean(player moving) - mean(player still), averaged over target still/moving
 *   target   = mean(target moving) - mean(target still), averaged over player still/moving
 *   interaction = (moving player - still player | target moving) - (same | target still)
 * plus each movement style vs standing still, against a moving target, with Cohen's d.
 */
export function movementReport(segs: MoveSegment[], seed = 7): MovementReport {
  const groups = new Map<string, number[]>(), excluded = new Map<string, number>();
  for (const s of segs) {
    const k = key(s.spec);
    if (s.spec.cond !== "still" && s.compliancePct < MIN_COMPLIANCE) { excluded.set(k, (excluded.get(k) ?? 0) + 1); continue; }
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(s.onPct);
  }
  const g = (k: string) => groups.get(k) ?? [];
  const cells = CELLS.map(c => { const v = g(key(c)); return { key: key(c), spec: c, n: v.length, mean: v.length ? mean(v) : null, excluded: excluded.get(key(c)) ?? 0 }; });
  const r = mulberry32(seed);
  const resample = (v: number[]) => v.map(() => v[Math.floor(r() * v.length)]);
  const boot = (keys: string[], f: (m: number[]) => number): Effect["ci"] => {
    if (keys.some(k => g(k).length < 2)) return null;
    const vals: number[] = [];
    for (let i = 0; i < B; i++) vals.push(f(keys.map(k => mean(resample(g(k))))));
    vals.sort((a, b) => a - b);
    return [vals[Math.floor(B * 0.025)], vals[Math.floor(B * 0.975)]];
  };
  const est = (keys: string[], f: (m: number[]) => number) => (keys.every(k => g(k).length) ? f(keys.map(k => mean(g(k)))) : null);
  const cohen = (a: string, b: string): number | null => {
    const x = g(a), y = g(b);
    if (x.length < 2 || y.length < 2) return null;
    const sp = Math.sqrt(((x.length - 1) * sd(x) ** 2 + (y.length - 1) * sd(y) ** 2) / (x.length + y.length - 2));
    return sp ? (mean(x) - mean(y)) / sp : null;
  };
  const core = ["still:still", "still:moving", "indep:still", "indep:moving"];
  const fMove = (m: number[]) => (m[2] + m[3]) / 2 - (m[0] + m[1]) / 2;
  const fTarget = (m: number[]) => (m[1] + m[3]) / 2 - (m[0] + m[2]) / 2;
  const fInter = (m: number[]) => (m[3] - m[1]) - (m[2] - m[0]);
  const n = (keys: string[]) => keys.reduce((a, k) => a + g(k).length, 0);
  const effects: Effect[] = [
    { label: "Movement (main effect)", estimate: est(core, fMove), ci: boot(core, fMove), d: cohen("indep:moving", "still:moving"), n: n(core) },
    { label: "Target motion (main effect)", estimate: est(core, fTarget), ci: boot(core, fTarget), d: cohen("still:moving", "still:still"), n: n(core) },
    { label: "Movement × target motion (interaction)", estimate: est(core, fInter), ci: boot(core, fInter), d: null, n: n(core) },
  ];
  for (const c of ["mirror", "counter", "dirchange", "indep"] as const) {
    const ks = [`${c}:moving`, "still:moving"], f = (m: number[]) => m[0] - m[1];
    effects.push({ label: `${c === "indep" ? "Independent strafe" : c === "mirror" ? "Mirrored strafe" : c === "counter" ? "Counter-strafe" : "Direction changes"} vs standing (moving target)`, estimate: est(ks, f), ci: boot(ks, f), d: cohen(ks[0], ks[1]), n: n(ks) });
  }
  return { cells, effects };
}

export const movementSessions = (all: SessionLog[]) => all.filter(s => s.protocol === "movement" && s.status !== "in_progress");
