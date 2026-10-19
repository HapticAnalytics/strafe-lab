import type { V3Result } from "../analysis/result3";
import { SKILL_NAMES, SKILLS, SKILL_WEIGHTS } from "../analysis/skills";
import { fmt } from "../core/math";
import { sensFromCm } from "../core/units";
import { MODES } from "../sim/protocol";
import type { SessionLog } from "../telemetry/schema";
import { chartSVG } from "./chart";

export function resultsV3HTML(s: SessionLog, r: V3Result): string {
  const { dpi, sens } = s.settings, e = r.overall, mode = MODES[s.mode ?? "standard"];
  const header = `<header class="brand"><h1>Strafe<span>/</span>Lab</h1><span class="eyebrow">Sens finder v3 · ${mode.label} · ${new Date(s.startedAt).toLocaleDateString()}</span></header>`;
  if (!e || !r.rec) return `${header}<p class="warnbox">Not enough scored blocks to fit a curve (${r.scored.length}). Run the test to the end.</p>${backRow()}`;
  const rec = r.rec;
  let hero: string, verdict: string;
  if (e.noClearWinner) {
    hero = `<div><span class="eyebrow">Result</span><div class="bignum" style="font-size:48px">No clear winner</div></div>`;
    verdict = `Your scores didn't separate the sensitivities you tried (${fmt(sensFromCm(e.testedHi, dpi), 2)}–${fmt(sensFromCm(e.testedLo, dpi), 2)} sens). The 95% interval for your best sens spans most of that range, so any setting there is defensible. Keep your current sens (${fmt(sens, 2)}) and re-test on another day, or run Deep mode.`;
  } else if (e.single) {
    hero = `<div><span class="eyebrow">Recommended Apex sens at ${dpi} DPI</span><div class="bignum">${fmt(rec.sens, 2)}<small>${fmt(e.peakCm, 1)} cm/360</small></div></div>`;
    verdict = `The 95% interval is narrow (${fmt(rec.sensLo, 2)}–${fmt(rec.sensHi, 2)}), so one setting is justified. In-game slider: ${fmt(rec.slider, 1)}; for the exact value set mouse_sensitivity in settings.cfg.`;
  } else {
    hero = `<div><span class="eyebrow">Recommended range at ${dpi} DPI</span><div class="bignum" style="font-size:56px">${fmt(rec.sensLo, 2)}–${fmt(rec.sensHi, 2)}</div></div>`;
    verdict = `Best estimate ${fmt(rec.sens, 2)} (${fmt(e.peakCm, 1)} cm/360), but the 95% interval is too wide to pick one value. Any sens in the range is as good as the data can tell. Re-test on another day; if both runs overlap, pick from the overlap.`;
  }
  const edge = e.edge ? `<p class="warnbox">Your best score was at the ${e.edge} edge of what was tested. Set your sens near this result and run again; the sweep re-centres on your current sens.</p>` : "";
  const learn = e.learnStart != null ? `Play-order effect: ${fmt(e.learnStart, 1)} points per block at the start, ${fmt(e.learnEnd, 1)} at the end (positive = still improving, negative = tiring). The fit separates this from sensitivity because the order was counterbalanced.` : "";
  const ids = SKILLS.filter(id => r.perSkill[id] !== undefined);
  const skillRows = ids.map(id => {
    const p = r.perSkill[id];
    if (!p) return `<tr><td>${SKILL_NAMES[id]}</td><td colspan="4">not enough data</td></tr>`;
    const rng = p.noClearWinner ? "no clear winner" : `${fmt(sensFromCm(p.ciHi, dpi), 2)}–${fmt(sensFromCm(p.ciLo, dpi), 2)}`;
    return `<tr><td>${SKILL_NAMES[id]}</td><td>${fmt(sensFromCm(p.peakCm, dpi), 2)}</td><td>${fmt(p.peakCm, 1)}</td><td>${rng}${p.edge ? ` (at ${p.edge} edge)` : ""}</td><td>${fmt(SKILL_WEIGHTS[id] * 100, 0)}%</td></tr>`;
  }).join("");
  const xs = r.scored.map(b => Math.log(b.cm));
  const chart = chartSVG({
    pts: r.scored.map(b => ({ x: Math.log(b.cm), y: b.combined, cm: b.cm, r2: b.phase === "zoom" })),
    f: x => e.fit.f(x), peakCm: e.peakCm, lo: e.ciLo, hi: e.ciHi, curved: !e.noClearWinner,
  }, r.baseCm, { peakLabel: e.noClearWinner ? "best guess" : "best" });
  void xs;
  const blockRows = r.blocks.map(b => `<tr><td>${b.phase === "warm" ? "Warm-up" : `Block ${b.index + 1} · ${b.phase}`}</td><td>${fmt(sensFromCm(b.cm, dpi), 2)}</td><td>${fmt(b.cm, 1)}</td><td>${b.phase === "warm" ? "—" : fmt(b.combined, 1)}</td>${ids.map(id => `<td>${b.skills[id] ? fmt(b.skills[id]!.score, 0) : "—"}</td>`).join("")}</tr>`).join("");
  return `${header}
    <section class="hero">${hero}
      <div class="facts">
        <div class="fact"><span class="v">${fmt(sens, 2)}</span><span class="k">Your current</span></div>
        <div class="fact"><span class="v">${fmt(rec.sensLo, 2)}–${fmt(rec.sensHi, 2)}</span><span class="k">95% interval</span></div>
        <div class="fact"><span class="v">${Math.round(rec.sens * dpi)}</span><span class="k">eDPI (best estimate)</span></div>
        <div class="fact"><span class="v">${r.scored.length}</span><span class="k">Blind blocks</span></div>
      </div>
    </section>
    <p class="note">${verdict} ${learn} This tunes hipfire only.</p>
    ${edge}
    <section class="panel"><div class="row" style="justify-content:space-between"><h2 style="font-size:18px">Combined score by sensitivity</h2><span class="tag">orange = zoom blocks · band = 95% interval</span></div><div class="chartbox">${chart}</div>
      <p class="note">Interval from ${e.n} blocks by bootstrap (1000 resamples of blocks). ${fmt(e.interiorFrac * 100, 0)}% of resamples found a peak inside the tested range. Fit noise ${fmt(e.rmse, 1)} points per block.</p></section>
    <section class="panel"><h2 style="font-size:18px">Best sens by skill</h2><div class="tablebox"><table><thead><tr><th>Skill</th><th>Best sens</th><th>cm/360</th><th>95% interval (sens)</th><th>Weight</th></tr></thead><tbody>${skillRows}</tbody></table></div>
      <p class="note">Each skill is fitted on its own. Weights are a hypothesis (close SMG fights first, long range minor) and will be revised from your test-retest and transfer data.</p></section>
    <section class="panel"><h2 style="font-size:18px">Every block</h2><div class="tablebox"><table><thead><tr><th>Block</th><th>Sens</th><th>cm/360</th><th>Combined</th>${ids.map(id => `<th>${id}</th>`).join("")}</tr></thead><tbody>${blockRows}</tbody></table></div></section>
    ${backRow()}`;
}

const backRow = () => `<div class="row"><button class="btn" id="againBtn" type="button">Run the test again</button><button class="btn ghost" id="setupBtn" type="button">Back to setup</button><span class="note" id="copyNote"></span></div>`;
