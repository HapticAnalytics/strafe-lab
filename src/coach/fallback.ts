// Deterministic plan used when the AI coach is off, over budget, or fails validation twice. Same schema, same
// validator: the app works fully without the AI (ROADMAP rule 4).
import type { DashboardData } from "../analysis/dashboard";
import type { Plan } from "./schema";
import type { CoachContext } from "./facts";

const SKILL_FOR: Record<string, Plan["sessions"][number]["skill"]> = { "contrast:asym": "mid", "contrast:trail": "pb", "contrast:vh": "vert" };

export function fallbackPlan(kind: Plan["kind"], d: DashboardData, ctx: CoachContext): Plan {
  const claims: Plan["claims"] = [];
  const sessions: Plan["sessions"] = [];
  const factFor = (label: string) => ctx.facts.find(f => f.label === label);
  if (!d.fingerprintReady) {
    const days = factFor("battery days");
    claims.push({ text: days ? `Run the baseline battery on separate days first: ${days.value} days [${days.id}] logged so far.` : "Run the baseline battery on separate days first." });
    sessions.push({ title: "Baseline battery", skill: "pb", minutes: 3, focus: "Play it like a real fight; it measures your noise floor." });
  }
  for (const f of d.findings.slice(0, 2)) {
    const sev = factFor(`${f.key} severity`);
    claims.push({ text: sev ? `${f.title}: ${sev.value.toFixed(2)} x noise floor [${sev.id}].` : f.title });
    sessions.push({ title: f.title, skill: f.kind === "contrast" ? SKILL_FOR[f.key] ?? "mid" : "pb", minutes: 10, focus: f.interventions[0] });
  }
  if (!sessions.length || sessions.length < 2) sessions.push({ title: "Mixed tracking", skill: "mid", minutes: 10, focus: "Varied scenarios with fresh seeds; smooth, steady tracking." });
  return {
    kind,
    headline: d.findings.length ? `Focus on: ${d.findings[0].title}` : d.fingerprintReady ? "Nothing stands out above your noise floor; keep varied practice." : "Build your baseline first.",
    claims, sessions, experiment: null, sensRetest: false,
  };
}
