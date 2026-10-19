import { describe, expect, it } from "vitest";
import { abbaSchedule, armForToday, evaluateExperiment, sensLocked, type Experiment } from "../src/analysis/experiments";
import type { MetricPoint } from "../src/analysis/battery";
import type { NoiseFloor } from "../src/analysis/baseline";
import { requestPlan, cost, worstCase, MAX_TOKENS } from "../src/coach/client";
import type { CoachContext } from "../src/coach/facts";
import { fallbackPlan } from "../src/coach/fallback";
import type { Plan } from "../src/coach/schema";
import { checkText, validatePlan } from "../src/coach/validate";
import type { DashboardData } from "../src/analysis/dashboard";
import type { SessionLog } from "../src/telemetry/schema";

const ctx: CoachContext = {
  facts: [
    { id: "F1", label: "battery days", value: 3, unit: "days", sources: ["a"] },
    { id: "F2", label: "contrast:trail value", value: 12.04, unit: "pts", sources: ["a", "b"] },
    { id: "F3", label: "reversal", value: 184.6, unit: "ms", sources: ["b"] },
  ],
  text: "", metricKeys: ["skill:pb"], sensLocked: false,
};
const plan = (over: Partial<Plan> = {}): Plan => ({
  kind: "daily", headline: "Match strafes instead of chasing them", claims: [{ text: "You trail strafing targets by 12.0 pts [F2] on average." }],
  sessions: [{ title: "Close reactive", skill: "pb", minutes: 10, focus: "Keep the crosshair on the leading edge." }],
  experiment: null, sensRetest: false, ...over,
});

describe("Milestone 6 acceptance: the validator rejects uncited numbers", () => {
  it("accepts numbers that cite a matching fact (rounding allowed)", () => {
    expect(checkText("Reversal response is 185 ms [F3] and trailing 12 pts [F2].", ctx, "x")).toEqual([]);
    expect(validatePlan(plan(), ctx).ok).toBe(true);
  });
  it("rejects an uncited number", () => {
    const r = checkText("Your reversal response is 185 ms, which is slow.", ctx, "x");
    expect(r.map(i => i.problem)).toEqual(['uncited number "185"']);
  });
  it("rejects a number that does not match its cited fact", () => {
    expect(checkText("Trailing is 20 pts [F2].", ctx, "x")[0].problem).toMatch(/does not match/);
  });
  it("rejects citations of unknown facts", () => {
    expect(checkText("Jitter 0.4 deg [F99].", ctx, "x")[0].problem).toMatch(/unknown fact/);
  });
  it("a citation cannot be borrowed across sentences or other numbers", () => {
    expect(checkText("You improved 5 pts. Trailing 12 pts [F2].", ctx, "x").map(i => i.problem)).toEqual(['uncited number "5"']);
    expect(checkText("Between 5 and 12 pts [F2].", ctx, "x").map(i => i.problem)).toEqual(['uncited number "5"']);
  });
  it("drill and optic names, identifiers and citation tags are not claims", () => {
    expect(checkText("Do the 2v1 drill, then 180° turns; R-99 only; check m1 metrics on 3x optics.", ctx, "x")).toEqual([]);
  });
  it("invented numbers anywhere in the plan fail the whole plan", () => {
    const r = validatePlan(plan({ sessions: [{ title: "Do 50 reps", skill: "pb", minutes: 10, focus: "x" }] }), ctx);
    expect(r.ok).toBe(false);
  });
  it("rejects sens-change advice and sens re-tests while locked", () => {
    expect(validatePlan(plan({ headline: "Lower your sens a bit" }), ctx).ok).toBe(false);
    expect(validatePlan(plan({ sensRetest: true }), { ...ctx, sensLocked: true }).ok).toBe(false);
    expect(validatePlan(plan({ sensRetest: true }), ctx).ok).toBe(true);
  });
  it("experiments must pre-register a metric that has a noise floor", () => {
    const e = { name: "Variable vs blocked", hypothesis: "Variable practice retains better", armA: "blocked", armB: "variable", metricKey: "skill:mid", minEffectFloors: 1, daysPerArm: 4 };
    expect(validatePlan(plan({ experiment: e }), ctx).ok).toBe(false);
    expect(validatePlan(plan({ experiment: { ...e, metricKey: "skill:pb" } }), ctx).ok).toBe(true);
  });
  it("rejects malformed JSON shapes", () => {
    expect(validatePlan({ kind: "daily" }, ctx).ok).toBe(false);
  });
});

describe("app works with the coach disabled", () => {
  const d = { fingerprintReady: false, findings: [], counts: { batteryDays: 3 } } as unknown as DashboardData;
  it("the deterministic fallback plan always passes the same validator", () => {
    expect(validatePlan(fallbackPlan("daily", d, ctx), ctx).ok).toBe(true);
  });
  it("no API key -> fallback plan, no network", async () => {
    const r = await requestPlan("daily", ctx, fallbackPlan("daily", d, ctx), null, "2026-01-01", { fetch: () => { throw new Error("must not be called"); } });
    expect(r.source).toBe("fallback");
  });
});

describe("coach client (mocked API)", () => {
  const msg = (text: string) => ({ id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 500 } });
  function fakeFetch(bodies: object[]) {
    const calls: string[] = [];
    let i = 0;
    const f = (async (url: string | URL) => {
      calls.push(String(url));
      const body = String(url).includes("count_tokens") ? { input_tokens: 1000 } : bodies[i++];
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    return { f, calls };
  }
  const fb = plan({ headline: "fallback" });
  it("retries once with the validator's issues, then accepts a valid plan", async () => {
    const bad = plan({ claims: [{ text: "You trail by 30 pts." }] }), good = plan();
    const { f, calls } = fakeFetch([msg(JSON.stringify(bad)), msg(JSON.stringify(good))]);
    const r = await requestPlan("daily", ctx, fb, "test-key", "2026-01-01", { fetch: f });
    expect(r.source).toBe("ai");
    if (r.source === "ai") { expect(r.attempts).toBe(2); expect(r.usd).toBeCloseTo(2 * cost("claude-sonnet-5-5", 1000, 500), 12); }
    expect(calls.filter(c => !c.includes("count_tokens")).length).toBe(2);
  });
  it("two invalid plans -> fallback with the issues", async () => {
    const bad = plan({ claims: [{ text: "You trail by 30 pts." }] });
    const { f } = fakeFetch([msg(JSON.stringify(bad)), msg(JSON.stringify(bad))]);
    const r = await requestPlan("daily", ctx, fb, "test-key", "2026-01-01", { fetch: f });
    expect(r.source).toBe("fallback");
    if (r.source === "fallback") expect(r.issues?.[0].problem).toMatch(/uncited/);
  });
  it("worst-case cost uses the full output cap", () => {
    expect(worstCase("claude-opus-5-5", 10000)).toBeCloseTo((10000 * 4 + MAX_TOKENS * 20) / 1e6, 12);
  });
});

describe("experiments", () => {
  const floor: NoiseFloor = { key: "skill:pb", label: "pb", unit: "pts", higherIsBetter: true, days: 3, mean: 60, sd: 1, sdc95: 2.77, sdCi: [0.5, 6], ready: true };
  const mk = (id: string, day: number): SessionLog => ({ schema: 2, id, startedAt: new Date(2026, 1, day, 10).toISOString(), finishedAt: "x", status: "complete", settings: { dpi: 800, sens: 1.6, fovScale: 1.4675, display: { aspect: null, scaling: "stretched" } }, rawInput: true, sampling: "event", protocol: "battery", blocks: [] });
  const exp = (practice: { day: string; arm: 0 | 1 }[]): Experiment => ({ id: "e", name: "x", hypothesis: "h", arms: [{ name: "blocked", description: "" }, { name: "variable", description: "" }], metricKey: "skill:pb", minEffectFloors: 1, daysPerArm: 4, schedule: abbaSchedule(4), createdAt: "x", frozen: true, status: "active", practice, proposedBy: "user" });
  const day = (d: number) => `2026-02-${String(d).padStart(2, "0")}`;
  function run(values: number[]) {
    // practice on days 1..8 following the ABBA schedule; battery the morning after each
    const sched = abbaSchedule(4);
    const practice = sched.map((arm, i) => ({ day: day(1 + i), arm }));
    const sessions = values.map((_, i) => mk(`s${i}`, 2 + i));
    const val = new Map(sessions.map((s, i) => [s.id, values[i]]));
    const metricsOf = (s: SessionLog): MetricPoint[] => [{ key: "skill:pb", label: "pb", unit: "pts", higherIsBetter: true, value: val.get(s.id)! }];
    return evaluateExperiment(exp(practice), sessions, floor, metricsOf);
  }
  it("ABBA schedule", () => { expect(abbaSchedule(4)).toEqual([0, 1, 1, 0, 0, 1, 1, 0]); });
  it("a clear B advantage larger than the minimum effect is detected", () => {
    // arm order A B B A A B B A
    const r = run([60, 66, 67, 60, 61, 66, 67, 60]);
    expect(r.verdict).toBe("B better");
    expect(r.diffFloors!).toBeGreaterThan(1);
    expect(r.a.length).toBe(4); expect(r.b.length).toBe(4);
  });
  it("noise-level differences are 'no difference detected'", () => {
    expect(run([60, 61, 59, 61, 60, 60, 61, 59]).verdict).toBe("no difference detected");
  });
  it("too few measurements -> insufficient data", () => {
    expect(run([60, 66, 67]).verdict).toBe("insufficient data");
  });
  it("arm for today follows the schedule; sens is locked while active", () => {
    const e = exp([{ day: day(1), arm: 0 }]);
    expect(armForToday(e, day(1))).toBe(0);
    expect(armForToday(e, day(2))).toBe(1);
    expect(sensLocked([e])).toBe(true);
    expect(sensLocked([{ ...e, status: "complete" }])).toBe(false);
  });
});
