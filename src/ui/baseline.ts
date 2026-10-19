// Baseline screen (Milestone 3): battery runs, external benchmarks and the noise-floor table.
import { batterySessions, externalSeries, noiseFloor, MIN_DAYS, dayOf, type NoiseFloor } from "../analysis/baseline";
import { batteryFloors } from "../analysis/battery";
import { fmt } from "../core/math";
import { deleteExternal, listExternal, listSessions, saveExternal, type LabDB } from "../storage/db";
import type { ExternalKind, ExternalResult } from "../telemetry/schema";

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function floorRows(floors: NoiseFloor[]): string {
  return floors.map(f => `<tr><td>${esc(f.label)}</td><td>${f.days}</td><td>${fmt(f.mean, 1)}</td><td>${fmt(f.sd, 2)}</td><td>${f.sdCi ? `${fmt(f.sdCi[0], 2)}–${fmt(f.sdCi[1], 2)}` : "—"}</td><td>${f.ready ? fmt(f.sdc95, 2) : "—"}</td><td>${esc(f.unit)}</td></tr>`).join("");
}

export function setupBaseline(db: LabDB, runBattery: (seedSet: number) => void): { open(): Promise<void> } {
  async function render(): Promise<void> {
    const all = await listSessions(db);
    const bat = batterySessions(all);
    const days = new Set(bat.map(s => dayOf(s.startedAt))).size;
    $("#baseStatus").textContent = `${bat.length} batteries on ${days} separate day(s). ${days >= MIN_DAYS ? "Noise floor ready." : `Need ${MIN_DAYS - days} more day(s) for a noise floor.`}`;
    const ext = await listExternal(db);
    const floors = [...batteryFloors(bat), ...externalSeries(ext).map(noiseFloor)];
    $("#floorTable").innerHTML = floors.length
      ? `<table><thead><tr><th>Metric</th><th>Days</th><th>Mean</th><th>Day SD</th><th>SD 95% CI</th><th>SDC95</th><th>Unit</th></tr></thead><tbody>${floorRows(floors)}</tbody></table>`
      : `<p class="note">No baseline data yet.</p>`;
    $("#floorNote").textContent = floors.some(f => f.days === 3) ? "With only 3 days, an SD estimate is rough: its 95% interval runs from about half to six times the value shown. More days narrow it." : "";
    $("#extList").innerHTML = ext.length ? [...ext].reverse().map(r => `<li style="grid-template-columns:1fr auto"><span>${new Date(r.at).toLocaleDateString()} · ${esc(r.measure)}: <b>${fmt(r.value, 1)}</b> ${esc(r.unit)}${r.notes ? ` · ${esc(r.notes)}` : ""}</span><button class="btn ghost" data-del="${r.id}" type="button" style="padding:4px 10px">Remove</button></li>`).join("") : "";
    document.querySelectorAll<HTMLButtonElement>("[data-del]").forEach(b => (b.onclick = async () => { await deleteExternal(db, b.dataset.del!); render(); }));
    $("#extMeasures").innerHTML = [...new Set(ext.map(r => r.measure))].map(m => `<option value="${esc(m)}">`).join("");
    $<HTMLButtonElement>("#batteryBtn").onclick = () => runBattery(bat.length);
  }
  $("#extSave").addEventListener("click", async () => {
    const value = parseFloat($<HTMLInputElement>("#extValue").value), measure = $<HTMLInputElement>("#extMeasure").value.trim();
    if (!isFinite(value) || !measure) { $("#extNote").textContent = "Enter a measure and a number."; return; }
    const r: ExternalResult = {
      id: crypto.randomUUID(), at: new Date().toISOString(), kind: $<HTMLSelectElement>("#extKind").value as ExternalKind, measure, value,
      unit: $<HTMLInputElement>("#extUnit").value.trim(), higherIsBetter: $<HTMLInputElement>("#extHigher").checked, notes: $<HTMLInputElement>("#extNotes").value.trim(),
    };
    await saveExternal(db, r);
    $("#extNote").textContent = "Saved.";
    $<HTMLInputElement>("#extValue").value = "";
    render();
  });
  $("#baseBack").addEventListener("click", () => { $("#baseline").hidden = true; $("#setup").hidden = false; });
  return { open: async () => { $("#setup").hidden = true; $("#results").hidden = true; $("#baseline").hidden = false; scrollTo(0, 0); await render(); } };
}
