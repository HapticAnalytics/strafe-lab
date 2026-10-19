// Optional AI coach over the Claude API, using the player's own API key (entered by them, kept only in this
// browser's localStorage, never in code, never exported). Hard daily cost cap, one corrective retry, then the
// deterministic fallback plan. Every plan, AI or not, passes the same validator.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { PlanSchema, type Plan } from "./schema";
import type { CoachContext } from "./facts";
import { validatePlan, type Issue } from "./validate";

export type CoachModel = "claude-sonnet-5-5" | "claude-opus-5-5";
// VERIFIED: Anthropic API pricing per million tokens (input, output), platform.claude.com, Oct 2026 (ROADMAP §1.2)
export const PRICE: Record<CoachModel, { in: number; out: number }> = {
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-opus-5-5": { in: 4, out: 20 },
};
// ROADMAP §1.2: Sonnet for daily plans, Opus for weekly reviews and long-term plans
export const MODEL_FOR: Record<Plan["kind"], CoachModel> = { daily: "claude-sonnet-5-5", weekly: "claude-opus-5-5", long: "claude-opus-5-5" };
// APPROX: output cap per request; plans are short JSON
export const MAX_TOKENS = 4000;
// HYPOTHESIS: default hard cap of $0.50/day (~5-10 reports); the user can change it
export const DEFAULT_DAILY_CAP_USD = 0.5;

export interface SpendLedger { day: string; usd: number }

const KEY_STORE = "strafelab.coach.apiKey";
const LEDGER_STORE = "strafelab.coach.ledger";
const CAP_STORE = "strafelab.coach.capUsd";

export const coachStore = {
  getKey(): string | null { try { return localStorage.getItem(KEY_STORE); } catch { return null; } },
  setKey(k: string | null): void { try { k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE); } catch { /* storage blocked */ } },
  getCap(): number { try { const v = parseFloat(localStorage.getItem(CAP_STORE) ?? ""); return isFinite(v) && v >= 0 ? v : DEFAULT_DAILY_CAP_USD; } catch { return DEFAULT_DAILY_CAP_USD; } },
  setCap(v: number): void { try { localStorage.setItem(CAP_STORE, String(v)); } catch { /* ignore */ } },
  ledger(today: string): SpendLedger {
    try { const l = JSON.parse(localStorage.getItem(LEDGER_STORE) ?? "null") as SpendLedger | null; return l && l.day === today ? l : { day: today, usd: 0 }; } catch { return { day: today, usd: 0 }; }
  },
  addSpend(today: string, usd: number): void { const l = this.ledger(today); l.usd += usd; try { localStorage.setItem(LEDGER_STORE, JSON.stringify(l)); } catch { /* ignore */ } },
};

export const cost = (m: CoachModel, inTok: number, outTok: number): number => (inTok * PRICE[m].in + outTok * PRICE[m].out) / 1e6;

/** Worst-case cost of a request: counted input tokens plus the full output cap. */
export const worstCase = (m: CoachModel, inTok: number): number => cost(m, inTok, MAX_TOKENS);

export function systemPrompt(): string {
  return `You are the training coach inside Strafe Lab, a personal aim-development lab for Apex Legends on mouse and keyboard.
You interpret numbers; you never compute new ones. The only numbers you may use are the facts provided, each tagged like [F3].
Rules:
- Every number you write in headline, claims, session titles, focus text or experiment text must be immediately followed by its fact tag, e.g. "trailing 12.0 pts [F4]". Copy the value as given (rounding is fine). If a fact you need is missing, say what data is missing instead of guessing.
- Never invent statistics, benchmarks, research findings or comparisons with other players.
- Never tell the player to change sensitivity or DPI. If a sens test is worth repeating, set sensRetest to true (only allowed when sens is not locked).
- Practice items use the lab's skills: pb (close reactive), mid (mid sustained), duo (2v1 switching), vert (vertical), turn (180 turns), click (dynamic clicking), flick (shotgun flick), long (long range). Keep total practice reasonable.
- You may propose one A/B practice experiment (two arms, an outcome metricKey chosen from the allowed list, a minimum effect in noise-floor units, days per arm). The app pre-registers and evaluates it; you do not judge it.
- Explanations of why something happens are hypotheses; say so.`;
}

export function userPrompt(kind: Plan["kind"], ctx: CoachContext): string {
  return `Write a ${kind} plan.
Sens locked: ${ctx.sensLocked ? "yes (an experiment is active)" : "no"}.
Allowed experiment metricKey values: ${ctx.metricKeys.length ? ctx.metricKeys.join(", ") : "none yet (do not propose an experiment)"}.

FACTS
${ctx.text}`;
}

export type CoachOutcome =
  | { source: "ai"; plan: Plan; model: CoachModel; usd: number; attempts: number }
  | { source: "fallback"; plan: Plan; reason: string; issues?: Issue[] };

/**
 * Ask Claude for a plan. Returns the validated AI plan, or the fallback plan with the reason. Never throws for
 * API problems; the caller always gets a usable plan.
 */
export async function requestPlan(kind: Plan["kind"], ctx: CoachContext, fallback: Plan, apiKey: string | null, today: string, opts: { fetch?: typeof fetch } = {}): Promise<CoachOutcome> {
  if (!apiKey) return { source: "fallback", plan: fallback, reason: "AI coach is off (no API key set)." };
  const model = MODEL_FOR[kind];
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: userPrompt(kind, ctx) }];
  let lastIssues: Issue[] | undefined;
  let spent = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const counted = await client.beta.messages.countTokens({ model, system: systemPrompt(), messages });
      const cap = coachStore.getCap(), used = coachStore.ledger(today).usd;
      if (used + worstCase(model, counted.input_tokens) > cap) {
        return { source: "fallback", plan: fallback, reason: `Daily AI budget reached ($${used.toFixed(3)} of $${cap.toFixed(2)} used; this request could cost up to $${worstCase(model, counted.input_tokens).toFixed(3)}).` };
      }
      const res = await client.beta.messages.parse({
        model, max_tokens: MAX_TOKENS, system: systemPrompt(), messages,
        output_config: { effort: kind === "daily" ? "medium" : "high", format: betaZodOutputFormat(PlanSchema) },
        // refusal fallback: on a policy decline the API re-runs the request on a suitable model (server-side)
        betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      });
      const usd = cost(model, res.usage.input_tokens, res.usage.output_tokens);
      spent += usd;
      coachStore.addSpend(today, usd);
      if (res.stop_reason === "refusal") return { source: "fallback", plan: fallback, reason: "The model declined this request." };
      if (res.stop_reason === "max_tokens") { lastIssues = [{ where: "response", problem: "truncated" }]; continue; }
      const v = validatePlan(res.parsed_output, ctx);
      if (v.ok) return { source: "ai", plan: v.plan, model, usd: spent, attempts: attempt };
      lastIssues = v.issues;
      // one corrective retry with the exact problems (append-only conversation)
      messages.push({ role: "assistant", content: JSON.stringify(res.parsed_output) });
      messages.push({ role: "user", content: `That plan failed validation:\n${v.issues.map(i => `- ${i.where}: ${i.problem}`).join("\n")}\nReturn a corrected plan. Cite every number with its fact tag, or remove it.` });
    } catch (e) {
      const msg = e instanceof Anthropic.AuthenticationError ? "API key was rejected." : e instanceof Anthropic.RateLimitError ? "Rate limited; try later." : e instanceof Anthropic.APIError ? `API error ${e.status}.` : "Could not reach the API.";
      return { source: "fallback", plan: fallback, reason: msg };
    }
  }
  return { source: "fallback", plan: fallback, reason: "The AI plan failed validation twice.", issues: lastIssues };
}
