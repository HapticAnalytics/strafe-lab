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

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const db = makeDb();

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

async function refreshHistory(): Promise<SessionLog[]> {
  const all = await listSessions(db);
  const done = all.filter(s => s.status === "complete");
  const last = done[done.length - 1];
  const r = last ? computeResult(last) : null;
  $("#prevNote").textContent = last && r ? `Last result: ${fmt(r.recSens, 2)} sens at ${last.settings.dpi} DPI (${fmt(r.fit.peakCm, 1)} cm/360)` : "";
  $("#histList").innerHTML = all.length
    ? [...all].reverse().map(s => {
        const res = s.status === "complete" ? computeResult(s) : null;
        const label = `${new Date(s.startedAt).toLocaleString()} · ${s.status.replace("_", " ")} · ${s.blocks.length} blocks`;
        return `<li style="grid-template-columns:1fr auto"><span>${label}${res ? ` · ${fmt(res.recSens, 2)} sens` : ""}</span>${res ? `<button class="btn ghost" data-open="${s.id}" type="button" style="padding:6px 12px">Open</button>` : ""}</li>`;
      }).join("")
    : `<li><span class="note">No sessions yet.</span></li>`;
  document.querySelectorAll<HTMLButtonElement>("[data-open]").forEach(b => (b.onclick = () => showResults(all.find(s => s.id === b.dataset.open)!, all)));
  return all;
}

function showResults(s: SessionLog, all: SessionLog[]): void {
  const r = computeResult(s);
  if (!r) return;
  const earlier = all.filter(x => x.status === "complete" && x.startedAt < s.startedAt);
  const prev = earlier.length ? earlier[earlier.length - 1] : null;
  const box = $("#results");
  box.innerHTML = resultsHTML(s, r, previousRec(prev));
  $("#setup").hidden = true; box.hidden = false; scrollTo(0, 0);
  $("#againBtn").onclick = () => { box.hidden = true; startTest(); };
  $("#setupBtn").onclick = () => { box.hidden = true; $("#setup").hidden = false; refreshHistory(); scrollTo(0, 0); };
  $("#copyBtn").onclick = () =>
    navigator.clipboard.writeText(copyText(s, r)).then(() => ($("#copyNote").textContent = "Copied."), () => ($("#copyNote").textContent = "Copy didn't work here. Select the text above instead."));
  setupCoach(s, r);
}

function startTest(): void {
  const settings = readSettings();
  saveSettings(db, settings).catch(() => {});
  if (!scene) {
    scene = new RangeScene($<HTMLCanvasElement>("#view"));
    runner = new Runner(scene, mouse, {
      persist: s => { saveSession(db, s).catch(err => console.error("save failed", err)); },
      finished: async s => { const all = await refreshHistory(); showResults(s, all); },
      quit: () => { refreshHistory(); },
    });
  }
  runner!.start(settings);
}
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
