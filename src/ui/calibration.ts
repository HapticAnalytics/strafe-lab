// Calibration screen. Captures raw counts with the same MouseInput/CaptureBuffer path as the drills; all
// numbers come from analysis/calibration.ts.
import { measuredDpi, netCounts, repeatStats, timingReport, turn360, CAL_TOLERANCE_PCT } from "../analysis/calibration";
import { fmt } from "../core/math";
import { MouseInput } from "../input/pointer";
import { listCalibrations, saveCalibration, type LabDB } from "../storage/db";
import type { CalibrationKind, CalibrationRecord, Settings } from "../telemetry/schema";

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
// APPROX: 5 s of circles gives thousands of intervals at 1000 Hz, enough for a stable median
const POLL_TEST_MS = 5000;

export function setupCalibration(db: LabDB, readSettings: () => Settings): { open(): void } {
  const pad = $("#calibPad");
  const input = new MouseInput(pad);
  let kind: CalibrationKind | null = null;
  let frameTimes: number[] = [];
  let raf = 0, stopTimer = 0;

  const show = (title: string, text: string) => { $("#padTitle").textContent = title; $("#padText").textContent = text; };

  function begin(k: CalibrationKind): void {
    kind = k;
    pad.hidden = false;
    $("#padEyebrow").textContent = { dpi: "Ruler DPI test", turn360: "Physical 360° test", polling: "Input timing test" }[k];
    show("Click here to lock the mouse", k === "polling" ? "Then move in steady circles. It stops by itself after 5 seconds." : "Then make the move and press Space or click to finish.");
    $("#padLive").textContent = "";
  }

  function live(): void {
    raf = requestAnimationFrame(t => { frameTimes.push(t); live(); });
    const n = netCounts(peek());
    $("#padLive").textContent = `${n} counts so far`;
  }
  let captured: ReturnType<MouseInput["drain"]> = [];
  const peek = () => { captured.push(...input.drain()); return captured; };

  pad.addEventListener("click", () => { if (kind && !input.locked) input.lock(); else if (kind && input.locked && kind !== "polling") finish(); });
  document.addEventListener("keydown", e => { if (e.code === "Space" && kind && input.locked && kind !== "polling") { e.preventDefault(); finish(); } });
  input.onLockChange = locked => {
    if (locked && kind) {
      captured = []; frameTimes = [];
      input.begin(performance.now(), 0);
      show(kind === "polling" ? "Move in circles…" : "Go", kind === "polling" ? "Keep moving." : "Press Space or click when you reach the mark.");
      live();
      if (kind === "polling") stopTimer = window.setTimeout(finish, POLL_TEST_MS);
    } else if (!locked && kind && input.accepting) cancel();
  };
  $("#padCancel").addEventListener("click", e => { e.stopPropagation(); cancel(); });

  function end(): void {
    cancelAnimationFrame(raf); clearTimeout(stopTimer);
    input.stop(); input.release();
    pad.hidden = true;
  }
  function cancel(): void { end(); kind = null; }

  async function finish(): Promise<void> {
    if (!kind) return;
    const k = kind; kind = null;
    const samples = peek();
    end();
    const s = readSettings();
    const counts = netCounts(samples);
    const rec: CalibrationRecord = { id: crypto.randomUUID(), at: new Date().toISOString(), kind: k, input: {}, result: {} };
    if (k === "dpi") {
      const cm = +$<HTMLInputElement>("#calCm").value || 10;
      const dpi = measuredDpi(counts, cm);
      rec.input = { cm, statedDpi: s.dpi }; rec.result = { counts, measuredDpi: dpi, errorPct: (dpi / s.dpi - 1) * 100 };
    } else if (k === "turn360") {
      const r = turn360(counts, s.sens);
      rec.input = { sens: s.sens, dpi: s.dpi }; rec.result = { counts, expectedCounts: r.expected, errorPct: r.errorPct, apexDegrees: r.apexDegrees };
    } else {
      const d = frameTimes.slice(1).map((t, i) => t - frameTimes[i]).sort((a, b) => a - b);
      const frameMs = d.length ? d[d.length >> 1] : null;
      const t = timingReport(samples, { ...input.diag }, frameMs);
      rec.input = { browserSource: t.source };
      rec.result = { pollingHz: t.pollingHz, medianIntervalMs: t.medianIntervalMs, frameMs: t.frameMs, frameAlignedPct: t.frameAlignedPct, coalescedApi: String(t.coalescedApi), coalescedMismatch: t.coalescedMismatch, nonMonotonic: t.nonMonotonic, rawInput: String(input.rawInput), secureContext: String(window.isSecureContext), verdict: t.verdict };
    }
    await saveCalibration(db, rec);
    await render();
  }

  async function render(): Promise<void> {
    const all = await listCalibrations(db);
    const of = (k: CalibrationKind) => all.filter(c => c.kind === k);
    const dpi = of("dpi"), t360 = of("turn360"), poll = of("polling");
    const ds = repeatStats(dpi.slice(-3).map(c => c.result.measuredDpi as number));
    $("#calDpiOut").innerHTML = ds ? `Last ${ds.n}: <b>${fmt(ds.mean, 0)}</b> DPI measured (${fmt(ds.min, 0)}–${fmt(ds.max, 0)}, ±${fmt(ds.spreadPct, 1)}%) vs ${dpi[dpi.length - 1].input.statedDpi} stated` : "";
    const ts = repeatStats(t360.slice(-3).map(c => c.result.errorPct as number));
    $("#cal360Out").innerHTML = ts ? `Last ${ts.n}: mean error <b>${fmt(ts.mean, 2)}%</b> (range ${fmt(ts.min, 2)} to ${fmt(ts.max, 2)}%). ${Math.abs(ts.mean) < CAL_TOLERANCE_PCT ? "Within 1%: input matches Apex." : "Outside 1%: check DPI, sens and Enhance pointer precision, then repeat."}` : "";
    const lp = poll[poll.length - 1];
    $("#calPollOut").innerHTML = lp ? `<b>${lp.result.pollingHz != null ? fmt(lp.result.pollingHz as number, 0) + " Hz" : "—"}</b> · source ${lp.input.browserSource} · frame-aligned ${fmt(lp.result.frameAlignedPct as number, 0)}% · raw input ${lp.result.rawInput}<br>${lp.result.verdict}` : "";
    $("#calList").innerHTML = all.length ? [...all].reverse().slice(0, 12).map(c => `<li style="grid-template-columns:1fr"><span>${new Date(c.at).toLocaleString()} · ${c.kind} · ${Object.entries(c.result).filter(([k]) => k !== "verdict").map(([k, v]) => `${k} ${typeof v === "number" ? fmt(v, 2) : v}`).join(" · ")}</span></li>`).join("") : `<li><span class="note">No calibrations yet.</span></li>`;
  }

  document.querySelectorAll<HTMLButtonElement>("[data-cal]").forEach(b => b.addEventListener("click", () => begin(b.dataset.cal as CalibrationKind)));
  $("#calBack").addEventListener("click", () => { $("#calib").hidden = true; $("#setup").hidden = false; });
  return { open: () => { $("#setup").hidden = true; $("#calib").hidden = false; scrollTo(0, 0); render(); } };
}
