// Deterministic checks on a coach plan (ROADMAP Milestone 6 acceptance: every claim cites a stored metric; uncited
// numbers are rejected). Numbers in free text must each be followed by a [F#] citation whose fact value matches.
import { PlanSchema, type Plan } from "./schema";
import type { CoachContext } from "./facts";

// APPROX: plan parameter limits (practice minutes per item, experiment size and effect) to keep plans sane
export const LIMITS = { minutesMax: 60, totalMinutesMax: 120, daysPerArmMin: 2, daysPerArmMax: 10, minEffectMin: 0.5, minEffectMax: 3 } as const;

/** Tokens that contain digits but are not numeric claims: citation tags, drill/optic names, identifiers like m1 or R5. */
const NON_CLAIM = /\[F\d+\]|\b(?:2v1|180°?|R-99|1x|2x|3x|4x|6x|8x|10x)\b|\b[A-Za-z]+\d+[A-Za-z\d]*\b/g;
const NUMBER = /-?\d+(?:\.\d+)?/g;
/** A citation must follow its number within 40 characters, before any other digit or sentence end. */
const CITE_AFTER = /^[^\d!?;\n]{0,40}?\[(F\d+)\]/;

export interface Issue { where: string; problem: string }

function decimals(s: string): number { const i = s.indexOf("."); return i < 0 ? 0 : s.length - i - 1; }

export function checkText(text: string, ctx: CoachContext, where: string): Issue[] {
  const issues: Issue[] = [];
  const facts = new Map(ctx.facts.map(f => [f.id, f]));
  // mask non-claims (citation tags keep their brackets so the lookahead still finds them, digits become #)
  const masked = text.replace(NON_CLAIM, m => (m.startsWith("[F") ? `[F${"#".repeat(m.length - 3)}]` : " ".repeat(m.length)));
  let m: RegExpExecArray | null;
  NUMBER.lastIndex = 0;
  while ((m = NUMBER.exec(masked))) {
    // look ahead in the original text; a full stop followed by space/end ends the sentence
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 60).replace(/\.(?=\s|$)/g, "!");
    const c = CITE_AFTER.exec(after);
    if (!c) { issues.push({ where, problem: `uncited number "${m[0]}"` }); continue; }
    const f = facts.get(c[1]);
    if (!f) { issues.push({ where, problem: `cites unknown fact [${c[1]}]` }); continue; }
    const v = parseFloat(m[0]);
    // the quoted number may be rounded: allow half a unit of its last decimal, plus 1% relative
    const tol = 0.5 * 10 ** -decimals(m[0]) + Math.abs(f.value) * 0.01;
    if (Math.abs(v - f.value) > tol) issues.push({ where, problem: `"${m[0]}" does not match [${c[1]}] (${f.value})` });
  }
  return issues;
}

/** Sens changes are never the coach's call; this catches wording that tells the player to change sens. */
const SENS_CHANGE = /\b(change|raise|lower|increase|decrease|switch|bump|drop)\b[^.]{0,30}\b(sens|sensitivity|dpi)\b/i;

export function validatePlan(raw: unknown, ctx: CoachContext): { ok: true; plan: Plan } | { ok: false; issues: Issue[] } {
  const parsed = PlanSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map(i => ({ where: i.path.join("."), problem: i.message })) };
  const p = parsed.data, issues: Issue[] = [];
  issues.push(...checkText(p.headline, ctx, "headline"));
  p.claims.forEach((c, i) => issues.push(...checkText(c.text, ctx, `claims[${i}]`)));
  p.sessions.forEach((s, i) => {
    issues.push(...checkText(s.title, ctx, `sessions[${i}].title`), ...checkText(s.focus, ctx, `sessions[${i}].focus`));
    if (s.minutes < 1 || s.minutes > LIMITS.minutesMax) issues.push({ where: `sessions[${i}].minutes`, problem: `minutes must be 1-${LIMITS.minutesMax}` });
  });
  if (p.sessions.reduce((a, s) => a + s.minutes, 0) > LIMITS.totalMinutesMax) issues.push({ where: "sessions", problem: `total practice over ${LIMITS.totalMinutesMax} min` });
  const prose: [string, string][] = [["headline", p.headline], ...p.claims.map((c, i): [string, string] => [`claims[${i}]`, c.text]), ...p.sessions.map((s, i): [string, string] => [`sessions[${i}].focus`, s.focus])];
  for (const [w, t] of prose) if (SENS_CHANGE.test(t)) issues.push({ where: w, problem: "coach may not tell the player to change sens (use sensRetest)" });
  if (p.sensRetest && ctx.sensLocked) issues.push({ where: "sensRetest", problem: "sens is locked during an active experiment" });
  if (p.experiment) {
    const e = p.experiment;
    if (!ctx.metricKeys.includes(e.metricKey)) issues.push({ where: "experiment.metricKey", problem: `metric "${e.metricKey}" has no noise floor (allowed: ${ctx.metricKeys.join(", ") || "none yet"})` });
    if (e.daysPerArm < LIMITS.daysPerArmMin || e.daysPerArm > LIMITS.daysPerArmMax) issues.push({ where: "experiment.daysPerArm", problem: `must be ${LIMITS.daysPerArmMin}-${LIMITS.daysPerArmMax}` });
    if (e.minEffectFloors < LIMITS.minEffectMin || e.minEffectFloors > LIMITS.minEffectMax) issues.push({ where: "experiment.minEffectFloors", problem: `must be ${LIMITS.minEffectMin}-${LIMITS.minEffectMax}` });
    issues.push(...checkText(e.hypothesis, ctx, "experiment.hypothesis"), ...checkText(e.armA, ctx, "experiment.armA"), ...checkText(e.armB, ctx, "experiment.armB"));
  }
  return issues.length ? { ok: false, issues } : { ok: true, plan: p };
}
