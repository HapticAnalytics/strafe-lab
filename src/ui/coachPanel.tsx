// Milestone 6 coach + experiments UI. The AI is optional; with no key the rule-based plan is shown.
import { useState } from "react";
import type { DashboardData } from "../analysis/dashboard";
import { abbaSchedule, armForToday, type Experiment, type ExperimentResult } from "../analysis/experiments";
import { dayOf } from "../analysis/baseline";
import { coachStore, requestPlan, type CoachOutcome } from "../coach/client";
import type { CoachContext } from "../coach/facts";
import { fallbackPlan } from "../coach/fallback";
import type { Plan } from "../coach/schema";
import { SKILL_NAMES, type SkillId } from "../analysis/skills";
import { fmt } from "../core/math";

/** Render text with [F#] citations as hoverable references to the stored facts. */
function Cited({ text, ctx }: { text: string; ctx: CoachContext }) {
  const parts = text.split(/(\[F\d+\])/g);
  return <>{parts.map((p, i) => {
    const m = /^\[(F\d+)\]$/.exec(p);
    if (!m) return <span key={i}>{p}</span>;
    const f = ctx.facts.find(x => x.id === m[1]);
    return <abbr key={i} title={f ? `${f.label}: ${f.value} ${f.unit} · sources ${f.sources.join(", ") || "counts"}` : "unknown"} style={{ color: "var(--data)", textDecoration: "none", fontSize: 12 }}>{p}</abbr>;
  })}</>;
}

function PlanView({ out, ctx, onRegister }: { out: CoachOutcome; ctx: CoachContext; onRegister: (e: NonNullable<Plan["experiment"]>) => void }) {
  const p = out.plan;
  return (
    <div className="coach">
      <span className="eyebrow">{out.source === "ai" ? `AI plan · ${out.model} · $${out.usd.toFixed(4)} · ${out.attempts} attempt(s) · validated` : `Rule-based plan · ${out.reason}`}</span>
      <p style={{ fontSize: 18, fontFamily: "var(--f-display)" }}><Cited text={p.headline} ctx={ctx} /></p>
      {p.claims.map((c, i) => <div className="item" key={i}><span><Cited text={c.text} ctx={ctx} /></span></div>)}
      <h3>Practice</h3>
      {p.sessions.map((s, i) => <div className="item" key={i}><b><Cited text={s.title} ctx={ctx} /> · {SKILL_NAMES[s.skill as SkillId]} · {s.minutes} min</b><span><Cited text={s.focus} ctx={ctx} /></span></div>)}
      {p.sensRetest && <div className="focus"><span className="eyebrow">Sens</span>A sens re-test is worth doing (no changes during training blocks).</div>}
      {p.experiment && (
        <div className="focus" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="eyebrow">Proposed experiment</span>
          <b>{p.experiment.name}</b>
          <span><Cited text={p.experiment.hypothesis} ctx={ctx} /></span>
          <span className="note">A: {p.experiment.armA} · B: {p.experiment.armB} · outcome {p.experiment.metricKey} · minimum effect {p.experiment.minEffectFloors}× noise floor · {p.experiment.daysPerArm} days per arm</span>
          <div className="row"><button className="btn" type="button" onClick={() => onRegister(p.experiment!)}>Pre-register and start</button></div>
        </div>
      )}
      {out.source === "fallback" && out.issues?.length ? <p className="note">Rejected AI output: {out.issues.slice(0, 4).map(i => `${i.where}: ${i.problem}`).join("; ")}</p> : null}
    </div>
  );
}

export interface CoachProps {
  d: DashboardData;
  ctx: CoachContext;
  experiments: ExperimentResult[];
  saveExperiment: (e: Experiment) => Promise<void>;
  refresh: () => void;
}

export function CoachPanel({ d, ctx, experiments, saveExperiment, refresh }: CoachProps) {
  const today = dayOf(new Date().toISOString());
  const [out, setOut] = useState<CoachOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasKey, setHasKey] = useState(!!coachStore.getKey());
  const [keyInput, setKeyInput] = useState("");
  const [cap, setCap] = useState(coachStore.getCap());
  const [form, setForm] = useState({ name: "", a: "", b: "", metric: ctx.metricKeys[0] ?? "", eff: 1, days: 4 });

  const ask = async (kind: Plan["kind"]) => {
    setBusy(true);
    setOut(await requestPlan(kind, ctx, fallbackPlan(kind, d, ctx), coachStore.getKey(), today));
    setBusy(false);
  };
  const register = async (e: { name: string; hypothesis: string; armA: string; armB: string; metricKey: string; minEffectFloors: number; daysPerArm: number }, by: Experiment["proposedBy"]) => {
    if (experiments.some(x => x.exp.status === "active")) { alert("Finish or abandon the active experiment first."); return; }
    const exp: Experiment = {
      id: crypto.randomUUID(), name: e.name, hypothesis: e.hypothesis, arms: [{ name: "A", description: e.armA }, { name: "B", description: e.armB }],
      metricKey: e.metricKey, minEffectFloors: e.minEffectFloors, daysPerArm: e.daysPerArm, schedule: abbaSchedule(e.daysPerArm),
      createdAt: new Date().toISOString(), frozen: true, status: "active", practice: [], proposedBy: by,
    };
    await saveExperiment(exp);
    refresh();
  };
  const logPractice = async (r: ExperimentResult, arm: 0 | 1) => {
    const e = r.exp;
    if (e.practice.some(p => p.day === today)) return;
    const next = { ...e, practice: [...e.practice, { day: today, arm }] };
    if (next.practice.length >= next.schedule.length) next.status = "complete";
    await saveExperiment(next);
    refresh();
  };

  const spent = coachStore.ledger(today).usd;
  return (
    <>
      <section className="panel coach">
        <div className="row" style={{ justifyContent: "space-between" }}><h2 style={{ fontSize: 18 }}>Coach</h2><span className="tag">{hasKey ? "AI on · numbers validated" : "AI off · rule-based"}</span></div>
        <p className="note">The coach only sees the numbers listed in this dashboard. Every number it writes must cite one of them, or the plan is rejected and the rule-based plan is shown instead.</p>
        <div className="row">
          <button className="btn" type="button" disabled={busy} onClick={() => ask("daily")}>Daily plan</button>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => ask("weekly")}>Weekly review</button>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => ask("long")}>Long-term plan</button>
          {busy && <span className="thinking">Working…</span>}
        </div>
        {out && <PlanView out={out} ctx={ctx} onRegister={e => register(e, "coach")} />}
        <details>
          <summary className="note" style={{ cursor: "pointer" }}>AI settings (your own Anthropic API key)</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            <p className="note">Optional. Your key is stored only in this browser (localStorage), is sent only to api.anthropic.com, and is never included in exports. Daily plans use Claude Sonnet 5.5; weekly and long-term use Claude Opus 5.5. Spend today: ${spent.toFixed(3)} of ${cap.toFixed(2)} cap.</p>
            <div className="fields">
              <label>API key<input type="password" autoComplete="off" value={keyInput} placeholder={hasKey ? "saved" : "sk-ant-..."} onChange={e => setKeyInput(e.target.value)} style={{ fontSize: 14 }} /></label>
              <label>Daily cap (USD)<input type="number" min={0} step={0.05} value={cap} onChange={e => { const v = Math.max(0, +e.target.value || 0); setCap(v); coachStore.setCap(v); }} /></label>
            </div>
            <div className="row">
              <button className="btn ghost" type="button" disabled={!keyInput} onClick={() => { coachStore.setKey(keyInput.trim()); setKeyInput(""); setHasKey(true); }}>Save key</button>
              <button className="btn ghost" type="button" disabled={!hasKey} onClick={() => { coachStore.setKey(null); setHasKey(false); }}>Remove key</button>
            </div>
          </div>
        </details>
      </section>

      <section className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}><h2 style={{ fontSize: 18 }}>Experiments</h2><span className="tag">pre-registered · judged by code, not the coach</span></div>
        <p className="note">An experiment fixes its two practice arms, outcome metric, minimum effect and schedule before any data. Practise the scheduled arm each day, then run the baseline battery the next day; that battery is the outcome. Sens is locked while an experiment is active.</p>
        {experiments.length ? experiments.map(r => {
          const arm = armForToday(r.exp, today);
          const done = r.exp.practice.some(p => p.day === today);
          return (
            <div key={r.exp.id} className="focus" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="eyebrow">{r.exp.status} · {r.exp.practice.length}/{r.exp.schedule.length} practice days · proposed by {r.exp.proposedBy}</span>
              <b>{r.exp.name}</b>
              <span className="note">A: {r.exp.arms[0].description} · B: {r.exp.arms[1].description} · outcome {r.exp.metricKey} · minimum effect {r.exp.minEffectFloors}× noise floor</span>
              <span>Verdict: <b>{r.verdict}</b>{r.diffFloors != null ? ` · B − A = ${fmt(r.diffFloors, 2)}× noise floor (95% CI ${fmt(r.ci![0], 2)} to ${fmt(r.ci![1], 2)})` : ""} · {r.a.length} A and {r.b.length} B outcomes</span>
              {arm != null && <div className="row"><span className="note">{done ? `Logged today: arm ${arm === 0 ? "A" : "B"}.` : `Today: practise arm ${arm === 0 ? "A" : "B"}.`}</span>{!done && <button className="btn ghost" type="button" onClick={() => logPractice(r, arm)}>I practised arm {arm === 0 ? "A" : "B"} today</button>}
                <button className="btn ghost" type="button" onClick={async () => { await saveExperiment({ ...r.exp, status: "abandoned" }); refresh(); }}>Abandon</button></div>}
            </div>
          );
        }) : <p className="note">No experiments yet.</p>}
        <details>
          <summary className="note" style={{ cursor: "pointer" }}>Set up an experiment yourself</summary>
          {ctx.metricKeys.length === 0 ? <p className="note">Outcome metrics need a noise floor first (3 battery days).</p> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
              <label>Name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={{ fontSize: 14 }} /></label>
              <div className="fields">
                <label>Arm A<input value={form.a} onChange={e => setForm({ ...form, a: e.target.value })} style={{ fontSize: 14 }} /></label>
                <label>Arm B<input value={form.b} onChange={e => setForm({ ...form, b: e.target.value })} style={{ fontSize: 14 }} /></label>
                <label>Outcome<select value={form.metric} onChange={e => setForm({ ...form, metric: e.target.value })}>{ctx.metricKeys.map(k => <option key={k} value={k}>{k}</option>)}</select></label>
              </div>
              <div className="fields">
                <label>Min effect (× floor)<input type="number" min={0.5} max={3} step={0.25} value={form.eff} onChange={e => setForm({ ...form, eff: +e.target.value })} /></label>
                <label>Days per arm<input type="number" min={2} max={10} value={form.days} onChange={e => setForm({ ...form, days: Math.round(+e.target.value) })} /></label>
              </div>
              <div className="row"><button className="btn" type="button" disabled={!form.name || !form.a || !form.b} onClick={() => register({ name: form.name, hypothesis: "", armA: form.a, armB: form.b, metricKey: form.metric, minEffectFloors: form.eff, daysPerArm: form.days }, "user")}>Pre-register and start</button></div>
            </div>
          )}
        </details>
      </section>
    </>
  );
}
