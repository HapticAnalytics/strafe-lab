// Milestone 5 dashboard (React). Renders analysis/dashboard.ts data only; every number shows its source on hover.
import { createRoot, type Root } from "react-dom/client";
import type { DashboardData, SensPoint, TrendSeries } from "../analysis/dashboard";
import type { Finding } from "../analysis/fingerprint";
import { fmt } from "../core/math";

const day = (iso: string) => new Date(iso).toLocaleDateString();
const src = (ids: string[], at?: string) => `Source: ${at ? day(at) + " · " : ""}${ids.join(", ")}`;

function Panel(p: { title: string; tag?: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="row" style={{ justifyContent: "space-between" }}><h2 style={{ fontSize: 18 }}>{p.title}</h2>{p.tag && <span className="tag">{p.tag}</span>}</div>
      {p.children}
    </section>
  );
}

/** Single-series line over sessions with an optional band (CI or noise floor). Hover each point for value + source. */
function LineChart(p: { points: { x: number; y: number; title: string; lo?: number | null; hi?: number | null }[]; band?: { lo: number; hi: number } | null; unit: string; invert?: boolean; h?: number; w?: number }) {
  const W = p.w ?? 640, H = p.h ?? 200, m = { l: 60, r: 14, t: 12, b: 26 };
  const ys = p.points.flatMap(q => [q.y, q.lo ?? q.y, q.hi ?? q.y]).concat(p.band ? [p.band.lo, p.band.hi] : []);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  // a flat series still gets a readable scale: +/-5% of its value (at least +/-1)
  if (y1 - y0 < 1e-9) { const d = Math.max(1, Math.abs(y0) * 0.05); y0 -= d; y1 += d; }
  const pad = (y1 - y0) * 0.1; y0 -= pad; y1 += pad;
  const n = p.points.length;
  const X = (i: number) => m.l + (n > 1 ? (i / (n - 1)) * (W - m.l - m.r) : (W - m.l - m.r) / 2);
  const Y = (v: number) => { const f = (v - y0) / (y1 - y0); return m.t + (p.invert ? f : 1 - f) * (H - m.t - m.b); };
  const ticks = [0, 0.5, 1].map(f => y0 + f * (y1 - y0));
  return (
    <div className="chartbox">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="trend chart">
        {ticks.map((v, i) => <g key={i}><line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} stroke="var(--line)" /><text x={m.l - 6} y={Y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{fmt(v, y1 - y0 < 0.5 ? 2 : y1 - y0 < 5 ? 1 : 0)}</text></g>)}
        {p.band && <rect x={m.l} width={W - m.l - m.r} y={Math.min(Y(p.band.lo), Y(p.band.hi))} height={Math.abs(Y(p.band.hi) - Y(p.band.lo))} fill="var(--data)" opacity={0.1} />}
        {p.points.map((q, i) => q.lo != null && q.hi != null ? <line key={"ci" + i} x1={X(i)} x2={X(i)} y1={Y(q.lo)} y2={Y(q.hi)} stroke="var(--data)" strokeWidth={2} opacity={0.45} /> : null)}
        {n > 1 && <path d={p.points.map((q, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(q.y).toFixed(1)}`).join("")} fill="none" stroke="var(--data)" strokeWidth={2} />}
        {p.points.map((q, i) => <g key={i}><circle cx={X(i)} cy={Y(q.y)} r={4.5} fill="var(--panel)" stroke="var(--data)" strokeWidth={2} /><circle cx={X(i)} cy={Y(q.y)} r={12} fill="transparent"><title>{q.title}</title></circle></g>)}
        <text x={W - m.r} y={H - 6} textAnchor="end" fontSize="11" fill="var(--muted)">sessions in order · {p.unit}</text>
      </svg>
    </div>
  );
}

function SensHistory({ sens, dpi }: { sens: SensPoint[]; dpi: number }) {
  if (!sens.length) return <p className="note">No completed sens tests yet.</p>;
  return (
    <>
      <LineChart unit="cm/360 (bars = 95% interval)" points={sens.map(s => ({ x: 0, y: s.peakCm.value, lo: s.ciLo, hi: s.ciHi, title: `${fmt(s.peakCm.value, 1)} cm/360 (${fmt(s.sens.value, 2)} sens) · ${s.label}${s.noClearWinner ? " · no clear winner" : ""} · ${src(s.peakCm.sources, s.at)}` }))} />
      <div className="tablebox"><table><thead><tr><th>Date</th><th>Test</th><th>Best cm/360</th><th>Sens</th><th>95% interval</th><th>Verdict</th></tr></thead><tbody>
        {[...sens].reverse().map(s => <tr key={s.sessionId} title={src(s.peakCm.sources, s.at)}><td>{day(s.at)}</td><td>{s.label}</td><td>{fmt(s.peakCm.value, 1)}</td><td>{fmt(s.sens.value, 2)}</td><td>{s.ciLo != null ? `${fmt(s.ciLo, 1)}–${fmt(s.ciHi, 1)} cm` : "—"}</td><td>{s.protocol === "classic" ? "classic (no interval)" : s.noClearWinner ? "no clear winner" : "estimate"}</td></tr>)}
      </tbody></table></div>
      <p className="note">Sens values use each test's own DPI (current DPI {dpi}).</p>
    </>
  );
}

function FindingCard({ f }: { f: Finding }) {
  const over = f.evidence.filter(e => e.over);
  return (
    <div className="focus" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="eyebrow">{f.kind === "contrast" ? "Pattern" : "Regression"} · severity {fmt(f.severity, 1)}× noise floor · confidence {f.confidence} · trend {f.trend}</span>
      <b>{f.title}</b>
      <span className="note" title={src(over.map(e => e.sessionId))}>Evidence: {fmt(f.value, 2)} {f.unit} on average in {over.length} of {f.evidence.length} sessions over the noise floor (SDC95 {fmt(f.floor.sdc95, 2)} {f.unit}, from {f.floor.days} baseline days).</span>
      <span className="note">Possible explanations (hypotheses): {f.explanations.join(" · ")}</span>
      <span className="note">Things to try: {f.interventions.join(" · ")}</span>
    </div>
  );
}

function Trend({ t }: { t: TrendSeries }) {
  const f = t.floor;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span className="eyebrow">{t.label}</span>
      <LineChart h={170} w={420} unit={t.unit} band={f.ready && f.sdc95 ? { lo: f.mean - f.sdc95, hi: f.mean + f.sdc95 } : null}
        points={t.points.map(p => ({ x: 0, y: p.value, title: `${fmt(p.value, 1)} ${t.unit} · ${src([p.sessionId], p.at)}` }))} />
    </div>
  );
}

function Dashboard({ d, dpi, onExport }: { d: DashboardData; dpi: number; onExport: () => void }) {
  const skill = d.trends.filter(t => t.key.startsWith("skill:") || t.key === "battery:combined");
  return (
    <>
      <div className="facts">
        <div className="fact"><span className="v">{d.counts.sensTests}</span><span className="k">Sens tests</span></div>
        <div className="fact"><span className="v">{d.counts.batteries}</span><span className="k">Batteries</span></div>
        <div className="fact"><span className="v">{d.counts.batteryDays}</span><span className="k">Battery days</span></div>
        <div className="fact"><span className="v">{d.counts.external}</span><span className="k">External results</span></div>
      </div>
      <Panel title="Aim Fingerprint" tag="vs your own baseline · no population norms">
        {!d.fingerprintReady ? <p className="note">The fingerprint needs a noise floor first: run the baseline battery on 3 separate days ({d.counts.batteryDays} so far).</p>
          : d.findings.length ? d.findings.map(f => <FindingCard key={f.key} f={f} />)
          : <p className="note">No finding exceeds your noise floor in two or more sessions. That means nothing stands out yet, not that nothing could be improved.</p>}
      </Panel>
      <Panel title="Sensitivity history"><SensHistory sens={d.sens} dpi={dpi} /></Panel>
      <Panel title="Skill trends" tag="battery scores · band = baseline mean ± SDC95">
        {skill.length ? <div className="grid2">{skill.map(t => <Trend key={t.key} t={t} />)}</div> : <p className="note">No battery sessions yet.</p>}
        <p className="note">A point outside the band is a change larger than your day-to-day noise. Inside the band, it may just be noise.</p>
      </Panel>
      {d.external.length > 0 && <Panel title="External benchmarks"><div className="grid2">{d.external.map(t => <Trend key={t.key} t={t} />)}</div></Panel>}
      <Panel title="Records">
        {d.records.length ? <div className="tablebox"><table><thead><tr><th>Metric</th><th>Best</th><th>Unit</th><th>Date</th></tr></thead><tbody>
          {d.records.map(r => <tr key={r.key} title={src(r.best.sources, r.at)}><td>{r.label}</td><td>{fmt(r.best.value, 1)}</td><td>{r.unit}</td><td>{day(r.at)}</td></tr>)}
        </tbody></table></div> : <p className="note">No records yet.</p>}
      </Panel>
      <div className="row"><button className="btn ghost" type="button" onClick={onExport}>Export JSON</button></div>
    </>
  );
}

let root: Root | null = null;
export function renderDashboard(el: HTMLElement, d: DashboardData, dpi: number, onExport: () => void): void {
  if (!root) root = createRoot(el);
  root.render(<Dashboard d={d} dpi={dpi} onExport={onExport} />);
}
