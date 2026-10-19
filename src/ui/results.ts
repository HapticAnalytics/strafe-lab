import { allBlockMetrics, computeResult, type SessionResult } from "../analysis/result";
import { fmt, mean } from "../core/math";
import { sensFromCm } from "../core/units";
import type { SessionLog } from "../telemetry/schema";
import { chartSVG } from "./chart";

const RNAMES = { pb: "Point-blank", close: "Close duel", mid: "Mid-range", duo: "2v1 fight" } as const;
type RangeId = keyof typeof RNAMES;

/** Previous completed session's recommended cm/360, recomputed from its stored log. */
export function previousRec(prev: SessionLog | null): number | null {
  const r = prev ? computeResult(prev) : null;
  return r ? r.fit.peakCm : null;
}

export function resultsHTML(s: SessionLog, r: SessionResult, prevCm: number | null): string {
  const { dpi, sens } = s.settings, { fit, per, scored, conf, baseCm } = r;
  const rec = r.recSens;
  const rows = allBlockMetrics(s);
  const bestB = scored.reduce((a, b) => (b.data.score > a.data.score ? b : a), scored[0]);
  const bestIndex = s.blocks.findIndex(b => !b.warm && b.cm360 === bestB.cm);
  let consistency: string;
  if (prevCm) {
    const d = (fit.peakCm / prevCm - 1) * 100;
    consistency = Math.abs(d) <= 8
      ? `Matches your last session within ${Math.abs(d).toFixed(0)}%, so this is a reliable number.`
      : `Your last session landed ${Math.abs(d).toFixed(0)}% ${d > 0 ? "faster" : "slower"} (${fmt(prevCm, 1)} cm/360). Run it once more on a fresh day and use the average.`;
  } else consistency = "Run it again on a different day. If both land within about 8%, that's your sens.";
  const edgeNote = fit.edge ? `<p class="warnbox">Your best score was at the ${fit.peakCm > baseCm ? "slow" : "fast"} edge of what was tested. Set your sens to this result and run the test again; the sweep will re-center around it.</p>` : "";
  const rg = (id: RangeId) => {
    const p = per[id];
    const val = (b: typeof scored[number]) => (id === "duo" ? b.data.duo.score : b.data[id].on);
    const b = scored.reduce((a, x) => (val(x) > val(a) ? x : a), scored[0]);
    const v = id === "duo" ? (b.data.duo.killTime != null ? fmt(b.data.duo.killTime, 2) + " s" : Math.round(b.data.duo.dealt) + " dmg") : fmt(b.data[id].on, 0) + "%";
    return `<div class="rg"><span class="n">${RNAMES[id]}</span><span class="v">${fmt(sensFromCm(p.peakCm, dpi), 2)}</span><span class="s">best sens · ${fmt(p.peakCm, 0)} cm/360</span><span class="s">top block: ${v}${id === "duo" ? " to kill both" : " on target"}</span></div>`;
  };
  const tr = rows.map(({ block: b, data: d }, i) => {
    const best = i === bestIndex ? "best" : "";
    return `<tr class="${best}"><td>${b.warm ? "Warm-up" : `Block ${i + 1} · R${b.round}`}</td><td>${fmt(sensFromCm(b.cm360, dpi), 2)}</td><td>${fmt(b.cm360, 1)}</td><td>${b.warm ? "—" : fmt(d.score, 1)}</td><td>${fmt(d.pb.on, 0)}%</td><td>${fmt(d.close.on, 0)}%</td><td>${fmt(d.mid.on, 0)}%</td><td>${d.duo.killTime != null ? fmt(d.duo.killTime, 2) + " s" : Math.round(d.duo.dealt) + " dmg"}</td><td>${fmt(d.close.recover, 0)}</td><td>${fmt(mean([d.pb.jitter, d.close.jitter, d.mid.jitter]), 2)}</td><td>${fmt(Math.max(d.pb.handPeak, d.close.handPeak), 0)}</td></tr>`;
  }).join("");
  return `
    <header class="brand"><h1>Strafe<span>/</span>Lab</h1><span class="eyebrow">Your result · ${new Date(s.startedAt).toLocaleDateString()}</span></header>
    <section class="hero">
      <div><span class="eyebrow">Recommended Apex sens at ${dpi} DPI</span><div class="bignum">${fmt(rec, 2)}<small>${fmt(fit.peakCm, 1)} cm/360</small></div></div>
      <div class="facts">
        <div class="fact"><span class="v">${fmt(sens, 2)}</span><span class="k">Your current</span></div>
        <div class="fact"><span class="v">${fit.curved ? fmt(r.recLoSens, 2) + "–" + fmt(r.recHiSens, 2) : "—"}</span><span class="k">Sweet spot</span></div>
        <div class="fact"><span class="v">${Math.round(rec * dpi)}</span><span class="k">eDPI</span></div>
        <div class="fact"><span class="v conf-${conf.level}">${conf.level}</span><span class="k">Confidence</span></div>
      </div>
    </section>
    <p class="note">Confidence is ${conf.level} because ${conf.why}. ${consistency} The in-game slider takes one decimal (${fmt(rec, 1)}); for the exact value, set mouse_sensitivity in Apex's settings.cfg. This tunes hipfire. Keep your ADS multipliers as they are for now.</p>
    ${edgeNote}
    <section class="panel"><div class="row" style="justify-content:space-between"><h2 style="font-size:18px">Tracking score by sensitivity</h2><span class="tag">${scored.length} blind blocks · orange = zoom round</span></div><div class="chartbox">${chartSVG(fit, baseCm)}</div></section>
    <section class="panel"><h2 style="font-size:18px">Best sens by range</h2><div class="ranges">${(["pb", "close", "mid", "duo"] as RangeId[]).map(rg).join("")}</div><p class="note">Each range fitted on its own. When these split apart, your overall sens is the weighted compromise: close range and the 2v1 count for 80% of the score because that's where SMG fights are decided.</p></section>
    <section class="panel"><h2 style="font-size:18px">What your mouse data shows</h2><ul class="insights">${r.insights.map(([k, t]) => `<li><span class="pill ${k}">${k === "fix" ? "Fix" : k === "watch" ? "Watch" : "Solid"}</span><span>${t}</span></li>`).join("")}</ul></section>
    ${m1Section(r)}
    <section class="panel coach" id="coach"><div class="row" style="justify-content:space-between"><h2 style="font-size:18px">AI tracking coach</h2><span class="tag">Claude</span></div>
      <p class="note" id="coachNote">Claude reads every metric from every block, range by range, and explains how your tracking changes from fast to slow sens, what's costing you SMG fights, and what to drill.</p>
      <div class="row"><button class="btn" id="coachBtn" type="button" hidden>Get tracking coaching</button><button class="btn ghost" id="coachStop" type="button" hidden>Stop</button></div>
      <div id="coachOut"></div></section>
    <section class="panel"><h2 style="font-size:18px">Every block</h2><div class="tablebox"><table><thead><tr><th>Block</th><th>Sens</th><th>cm/360</th><th>Score</th><th>Point-blank</th><th>Close</th><th>Mid</th><th>2v1</th><th>Recover ms</th><th>Wobble °</th><th>Hand cm/s</th></tr></thead><tbody>${tr}</tbody></table></div>
      <p class="note">Blocks in the order you played them. Range columns are time on target. Recover is time to get back on an enemy after they change direction (close duel). Wobble is high-frequency shake near the target. Hand cm/s is your fastest hand movement.</p></section>
    <div class="row"><button class="btn" id="againBtn" type="button">Run the test again</button><button class="btn ghost" id="copyBtn" type="button">Copy report</button><button class="btn ghost" id="setupBtn" type="button">Back to setup</button><span class="note" id="copyNote"></span></div>`;
}

export function copyText(s: SessionLog, r: SessionResult): string {
  return `Strafe Lab: ${fmt(r.recSens, 2)} sens at ${s.settings.dpi} DPI (${fmt(r.fit.peakCm, 1)} cm/360), confidence ${r.conf.level}. Current: ${fmt(s.settings.sens, 2)}.\n` + r.insights.map(i => "- " + i[1]).join("\n");
}

/** JSON handed to the optional AI coach. Every number comes from deterministic analysis of the stored log. */
export function coachReport(s: SessionLog, r: SessionResult): object {
  const { dpi, sens, fovScale, display } = s.settings, { fit, conf } = r;
  const r1 = (o: object) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? +v.toFixed(2) : v]));
  return {
    setup: { dpi, clFovScale: fovScale, gameAspect: display.aspect, displayScaling: display.scaling, currentSens: sens, currentCm360: +r.baseCm.toFixed(1), rawInput: s.rawInput },
    result: {
      recommendedSens: +r.recSens.toFixed(2), recommendedCm360: +fit.peakCm.toFixed(1),
      sweetSpotSens: fit.curved ? [+r.recLoSens.toFixed(2), +r.recHiSens.toFixed(2)] : null,
      confidence: conf.level, peakStabilityPlusMinusPct: fit.spread != null ? +fit.spread.toFixed(1) : null,
      fitRmsePoints: fit.rmse != null ? +fit.rmse.toFixed(1) : null, peakAtEdgeOfTestedRange: fit.edge,
      bestCm360ByRange: Object.fromEntries(Object.entries(r.per).map(([k, p]) => [k, { cm360: +p.peakCm.toFixed(1), sens: +sensFromCm(p.peakCm, dpi).toFixed(2), atEdge: p.edge }])),
      fatiguePointsPerBlock: +r.fatigue.toFixed(2),
    },
    habitsAveraged: r1(r.habits),
    blocks: r.scored.map(b => ({
      playedOrder: b.data.order + 1, round: b.round, sens: +sensFromCm(b.cm, dpi).toFixed(2), cm360: +b.cm.toFixed(1), score: +b.data.score.toFixed(1),
      pointBlank: r1(b.data.pb), closeDuel: r1(b.data.close), midRange: r1(b.data.mid), twoVsOne: r1(b.data.duo),
    })),
  };
}

const M1_ROWS: [keyof NonNullable<SessionResult["m1"]>["pb"], string, number, string][] = [
  ["onPct", "Time on target", 0, "%"], ["headPct", "Head time", 0, "%"],
  ["errHNorm", "Horizontal error", 2, "× half-width"], ["errVNorm", "Vertical error", 2, "× half-height"],
  ["trailingPct", "Trailing (when off)", 0, "%"], ["leadingPct", "Leading (when off)", 0, "%"],
  ["overshootPerS", "Overshoots", 2, "/s"], ["undershootPerS", "Undershoots", 2, "/s"],
  ["jitterHDeg", "Jitter, horizontal", 3, "°"], ["jitterVDeg", "Jitter, vertical", 3, "°"],
  ["correctionsPerS", "Corrections", 2, "/s"], ["correctionAmpDeg", "Correction size", 2, "°"],
  ["reversalLatencyMs", "Reversal response", 0, "ms"], ["reacquireMs", "Reacquire after loss", 0, "ms"],
  ["stabilizeMs", "Stabilise after acquiring", 0, "ms"], ["switchMs", "Switch time (2v1)", 0, "ms"],
  ["asymmetryPct", "Left − right on target", 1, "pts"], ["windowSdPct", "Consistency (SD of 2 s windows)", 1, "pts"],
  ["driftPctPerS", "Drift within drill", 2, "pts/s"], ["handSpeedPeak", "Peak hand speed", 0, "cm/s"],
];

function m1Section(r: SessionResult): string {
  if (!r.m1) return `<section class="panel"><h2 style="font-size:18px">Tracking detail</h2><p class="note">This session was recorded with the Milestone 0 per-frame logger, so event-level metrics are not available. New sessions record every mouse event.</p></section>`;
  const ids = ["pb", "close", "mid", "duo"] as const;
  const rows = M1_ROWS.map(([k, label, d, unit]) => `<tr><td>${label}</td>${ids.map(id => `<td>${fmt(r.m1![id][k] as number | null, d)}</td>`).join("")}<td>${unit}</td></tr>`).join("");
  const t = r.timing;
  return `<section class="panel"><h2 style="font-size:18px">Tracking detail</h2>
    <div class="tablebox"><table><thead><tr><th>Metric (mean of scored blocks)</th><th>Point-blank</th><th>Close</th><th>Mid</th><th>2v1</th><th>Unit</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">Every value is recomputed from the logged mouse events on a 1 ms grid. Thresholds behind these metrics are approximations (see RESEARCH.md). Compare them with your own baseline, not with other players.</p>
    ${t ? `<p class="note">Input: ${t.source}${t.coalescedApi ? " + coalesced events" : ""} · ${t.samples} events · polling ≈ ${t.pollingHz ? fmt(t.pollingHz, 0) + " Hz" : "—"} · coalesced mismatches ${t.coalescedMismatch} · backwards timestamps ${t.nonMonotonic} · late events ${t.late}</p>` : ""}
  </section>`;
}
