import "./ui/style.css";
import { computeResult } from "./analysis/result";
import { setupCoach } from "./coach/coach";
import { clamp, fmt } from "./core/math";
import { ASPECT_PRESETS, type Scaling } from "./core/display";
import { cmPer360, hfov43FromScale, hfovForAspect, sliderFromFovScale } from "./core/units";
import { MouseInput } from "./input/pointer";
import { RangeScene } from "./render/scene";
import { exportAll, getSettings, importAll, listSessions, makeDb, saveSession, saveSettings } from "./storage/db";
import type { Settings, SessionLog } from "./telemetry/schema";
import { chartSVG } from "./ui/chart";
import { fitCurve } from "./analysis/fit";
import { copyText, previousRec, resultsHTML } from "./ui/results";
import { Runner } from "./ui/runner";
import { setupCalibration } from "./ui/calibration";
import { setupBaseline } from "./ui/baseline";
import { setupReplay } from "./ui/replay";
import { batteryMetrics } from "./analysis/battery";
import { computeV3, type V3Result } from "./analysis/result3";
import { resultsV3HTML } from "./ui/results3";
import { estimatedMinutes, MODES, type Mode } from "./sim/protocol";

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const db = makeDb();

(Object.keys(MODES) as Mode[]).forEach(m => $<HTMLSelectElement>("#mode").add(new Option(`${MODES[m].label} · about ${Math.round(estimatedMinutes(m))} min`, m)));
$<HTMLSelectElement>("#mode").value = "standard";
ASPECT_PRESETS.forEach((p, i) => $<HTMLSelectElement>("#aspect").add(new Option(p.label, String(i))));
function readSettings(): Settings {
  return {
    dpi: clamp(+$<HTMLInputElement>("#dpi").value || 800, 100, 32000),
    sens: clamp(+$<HTMLInputElement>("#sens").value || 1.6, 0.05, 20),
    // cl_fovScale is deliberately not capped at the slider max (1.55); 0.5-4 only guards against typos
    fovScale: clamp(+$<HTMLInputElement>("#fov").value || 1.4675, 0.5, 4),
    display: { aspect: ASPECT_PRESETS[+$<HTMLSelectElement>("#aspect").value]?.aspect ?? null, scaling: $<HTMLSelectElement>("#scaling").value as Scaling },
  };
}
function updateCalc(): void {
  const s = readSettings();
  const h43 = hfov43FromScale(s.fovScale), asp = s.display.aspect ?? ((innerWidth / innerHeight) || 16 / 9);
  $("#calc").innerHTML = `Current: <b>${fmt(cmPer360(s.sens, s.dpi), 1)}</b> cm/360 · <b>${Math.round(s.sens * s.dpi)}</b> eDPI · ${fmt(h43, 1)}° FOV at 4:3 (slider ${fmt(sliderFromFovScale(s.fovScale), 0)}) · ${fmt(hfovForAspect(h43, asp), 1)}° at your game aspect`;
}
["dpi", "sens", "fov", "aspect", "scaling"].forEach(id => $(`#${id}`).addEventListener("input", updateCalc));

// Example chart (static illustrative data, labelled "Example report" in the UI)
(() => {
  const ex: [number, number][] = [[16, 52.4], [21.5, 60.8], [29, 66.2], [39, 67.9], [52, 61.5], [70, 50.3], [30.5, 67.1], [33.7, 68.6], [37.2, 68.2], [41.2, 66.4]];
  $("#exChart").innerHTML = chartSVG(fitCurve(ex.map(([cm, score]) => ({ cm, score }))), 27, { peakLabel: "example best" });
})();

const finePointer = matchMedia("(pointer: fine)").matches && "requestPointerLock" in Element.prototype;
if (!finePointer) { $("#noMouse").hidden = false; $<HTMLButtonElement>("#startBtn").disabled = true; }

const mouse = new MouseInput($<HTMLCanvasElement>("#view"));
let scene: RangeScene | null = null;
let runner: Runner | null = null;

// Results are pure functions of the stored log; memoise per session id + block count so the list stays fast.
const v3Memo = new Map<string, V3Result>();
function v3Of(s: SessionLog): V3Result {
  const key = `${s.id}:${s.blocks.length}`;
  let r = v3Memo.get(key);
  if (!r) { r = computeV3(s); v3Memo.set(key, r); }
  return r;
}
/** One-line summary for the history list: [label, recommended sens or null] */
function summary(s: SessionLog): string | null {
  if (s.status !== "complete") return null;
  if (s.protocol === "battery") return `battery combined ${fmt(batteryMetrics(s)[0]?.value, 1)}`;
  if (s.protocol === "v3") {
    const r = v3Of(s);
    if (!r.overall || !r.rec) return null;
    return r.overall.noClearWinner ? "no clear winner" : r.overall.single ? `${fmt(r.rec.sens, 2)} sens` : `${fmt(r.rec.sensLo, 2)}–${fmt(r.rec.sensHi, 2)} sens`;
  }
  const r = computeResult(s);
  return r ? `${fmt(r.recSens, 2)} sens (classic)` : null;
}

async function refreshHistory(): Promise<SessionLog[]> {
  const all = await listSessions(db);
  const done = all.filter(s => s.status === "complete");
  const last = done[done.length - 1];
  const ls = last ? summary(last) : null;
  $("#prevNote").textContent = last && ls ? `Last result: ${ls} at ${last.settings.dpi} DPI` : "";
  $("#histList").innerHTML = all.length
    ? [...all].reverse().map(s => {
        const res = summary(s);
        const label = `${new Date(s.startedAt).toLocaleString()} · ${s.protocol === "v3" ? MODES[s.mode ?? "standard"].label : s.protocol === "battery" ? "Baseline battery" : "classic"} · ${s.status.replace("_", " ")} · ${s.blocks.length} blocks`;
        const rp = s.sampling === "event" && s.blocks.length ? `<button class="btn ghost" data-replay="${s.id}" type="button" style="padding:6px 12px">Replay</button>` : "";
        return `<li style="grid-template-columns:1fr auto"><span>${label}${res ? ` · ${res}` : ""}</span><span class="row" style="gap:6px">${res ? `<button class="btn ghost" data-open="${s.id}" type="button" style="padding:6px 12px">Open</button>` : ""}${rp}</span></li>`;
      }).join("")
    : `<li><span class="note">No sessions yet.</span></li>`;
  document.querySelectorAll<HTMLButtonElement>("[data-open]").forEach(b => (b.onclick = () => showResults(all.find(s => s.id === b.dataset.open)!, all)));
  document.querySelectorAll<HTMLButtonElement>("[data-replay]").forEach(b => (b.onclick = () => replayView.open(all.find(s => s.id === b.dataset.replay)!)));
  return all;
}

function showResults(s: SessionLog, all: SessionLog[]): void {
  const box = $("#results");
  if (s.protocol === "battery") { baseline.open(); return; }
  if (s.protocol === "v3") {
    box.innerHTML = resultsV3HTML(s, v3Of(s));
    $("#setup").hidden = true; box.hidden = false; scrollTo(0, 0);
    $("#againBtn").onclick = () => { box.hidden = true; startTest(); };
    $("#setupBtn").onclick = () => { box.hidden = true; $("#setup").hidden = false; refreshHistory(); scrollTo(0, 0); };
    return;
  }
  const r = computeResult(s);
  if (!r) return;
  const earlier = all.filter(x => x.status === "complete" && x.startedAt < s.startedAt);
  const prev = earlier.length ? earlier[earlier.length - 1] : null;
  box.innerHTML = resultsHTML(s, r, previousRec(prev));
  $("#setup").hidden = true; box.hidden = false; scrollTo(0, 0);
  $("#againBtn").onclick = () => { box.hidden = true; startTest(); };
  $("#setupBtn").onclick = () => { box.hidden = true; $("#setup").hidden = false; refreshHistory(); scrollTo(0, 0); };
  $("#copyBtn").onclick = () =>
    navigator.clipboard.writeText(copyText(s, r)).then(() => ($("#copyNote").textContent = "Copied."), () => ($("#copyNote").textContent = "Copy didn't work here. Select the text above instead."));
  setupCoach(s, r);
}

function ensureRunner(): Runner {
  if (!scene) {
    scene = new RangeScene($<HTMLCanvasElement>("#view"));
    runner = new Runner(scene, mouse, {
      persist: s => { saveSession(db, s).catch(err => console.error("save failed", err)); },
      finished: async s => {
        const all = await refreshHistory();
        if (s.protocol === "battery") await baseline.open(); else showResults(s, all);
      },
      quit: () => { refreshHistory(); },
    });
  }
  return runner!;
}

function startTest(): void {
  const settings = readSettings();
  saveSettings(db, settings).catch(() => {});
  ensureRunner().start(settings, ($<HTMLSelectElement>("#mode").value as Mode) || "standard");
}

const replayView = setupReplay(() => { $("#setup").hidden = false; refreshHistory(); });
const baseline = setupBaseline(db, seedSet => {
  const settings = readSettings();
  saveSettings(db, settings).catch(() => {});
  ensureRunner().startBattery(settings, seedSet);
});
$("#baseOpen").addEventListener("click", () => baseline.open());
$("#startBtn").addEventListener("click", startTest);
const calibration = setupCalibration(db, readSettings);
$("#calOpen").addEventListener("click", () => calibration.open());

$("#exportBtn").addEventListener("click", async () => {
  const data = await exportAll(db);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  a.download = `strafe-lab-${data.exportedAt.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  $("#histNote").textContent = `Exported ${data.sessions.length} session(s).`;
});
$("#importBtn").addEventListener("click", () => $<HTMLInputElement>("#importFile").click());
$<HTMLInputElement>("#importFile").addEventListener("change", async e => {
  const input = e.target as HTMLInputElement, file = input.files?.[0];
  if (!file) return;
  try {
    const n = await importAll(db, await file.text());
    $("#histNote").textContent = `Imported ${n} session(s).`;
    await refreshHistory();
  } catch (err) { $("#histNote").textContent = (err as Error).message; }
  input.value = "";
});

(async () => {
  try {
    const saved = await getSettings(db);
    if (saved) { $<HTMLInputElement>("#dpi").value = String(saved.dpi); $<HTMLInputElement>("#sens").value = String(saved.sens); $<HTMLInputElement>("#fov").value = String(saved.fovScale);
      $<HTMLSelectElement>("#aspect").value = String(Math.max(0, ASPECT_PRESETS.findIndex(p => p.aspect === saved.display?.aspect)));
      $<HTMLSelectElement>("#scaling").value = saved.display?.scaling ?? "stretched"; }
  } catch { /* storage unavailable: app still works, nothing persists */ }
  updateCalc();
  try { await refreshHistory(); } catch { $("#histNote").textContent = "Saved sessions are unavailable in this browser."; }
})();
