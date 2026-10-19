// Replay viewer (Milestone 4). Reads replay state from analysis/replayView.ts; draws only.
import { flags, frameAt, loadReplay, type Flag, type ReplayData } from "../analysis/replayView";
import { fmt } from "../core/math";
import { DEG } from "../core/units";
import { RangeScene } from "../render/scene";
import { DRILLS } from "../sim/drills";
import { EYE } from "../sim/constants";
import { aimDir } from "../sim/hit";
import { isEventLog, type SessionLog } from "../telemetry/schema";

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const TRAIL_S = 0.5;

export function setupReplay(onBack: () => void): { open(s: SessionLog): void } {
  const stage = $("#rpStage");
  let scene: RangeScene | null = null;
  let session: SessionLog | null = null;
  let r: ReplayData | null = null;
  let fl: Flag[] = [];
  let t = 0, playing = false, last = 0, raf = 0;

  const ensureScene = () => {
    if (!scene) scene = new RangeScene($<HTMLCanvasElement>("#rpView"), () => ({ w: stage.clientWidth, h: stage.clientHeight }));
    if (session) scene.setView(session.settings.fovScale, { aspect: null, scaling: "stretched" });
    return scene;
  };

  function fillBlocks(): void {
    const sel = $<HTMLSelectElement>("#rpBlock");
    sel.innerHTML = "";
    session!.blocks.forEach((b, i) => sel.add(new Option(`${b.warm ? "Warm-up" : `Block ${i + 1}`} · ${fmt(b.cm360, 1)} cm/360`, String(i))));
    fillDrills();
  }
  function fillDrills(): void {
    const b = session!.blocks[+$<HTMLSelectElement>("#rpBlock").value];
    const sel = $<HTMLSelectElement>("#rpDrill");
    sel.innerHTML = "";
    for (const [id, d] of Object.entries(b.drills)) if (d && isEventLog(d)) sel.add(new Option(DRILLS[d.id].name, id));
    load();
  }
  function load(): void {
    const b = session!.blocks[+$<HTMLSelectElement>("#rpBlock").value];
    const d = b.drills[$<HTMLSelectElement>("#rpDrill").value as keyof typeof b.drills];
    if (!d || !isEventLog(d)) { r = null; return; }
    r = loadReplay(d, session!.settings.dpi);
    fl = flags(r);
    $("#rpFlags").innerHTML = fl.length ? fl.map((f, i) => `<li style="grid-template-columns:70px 1fr"><span class="calc">${fmt(f.t, 2)} s</span><button class="flag" data-flag="${i}" type="button">${f.label}</button></li>`).join("") : `<li><span class="note">Nothing flagged in this drill.</span></li>`;
    document.querySelectorAll<HTMLButtonElement>("[data-flag]").forEach(b => (b.onclick = () => seek(Math.max(0, fl[+b.dataset.flag!].t - 0.3))));
    seek(0);
  }

  function seek(nt: number): void { t = Math.max(0, Math.min(r?.duration ?? 0, nt)); draw(); }

  function draw(): void {
    const sc = ensureScene();
    sc.resize();
    if (!r) return;
    const f = frameAt(r, t);
    sc.hideEnemies();
    f.targets.forEach((x, j) => { const slot = Math.min(1, j); sc.place(slot, x.tv.feet, x.tv.h); sc.highlight(slot, x.on); });
    sc.render(f.aim.yaw, f.aim.pitch);
    // trails: crosshair direction and target chests over the last TRAIL_S seconds, projected into today's view
    const tc = $<HTMLCanvasElement>("#rpTrails"), ctx = tc.getContext("2d")!;
    tc.width = stage.clientWidth; tc.height = stage.clientHeight;
    ctx.clearRect(0, 0, tc.width, tc.height);
    const from = Math.max(0, f.index - Math.round(TRAIL_S / 0.001));
    const pathOf = (pt: (i: number) => { x: number; y: number; z: number } | null, color: string) => {
      ctx.beginPath(); let started = false;
      for (let i = from; i <= f.index; i += 5) {
        const w = pt(i); if (!w) continue;
        const p = sc.project(w, f.aim.yaw, f.aim.pitch); if (!p) continue;
        if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    };
    pathOf(i => { const s = r!.samples[i], d = aimDir(s.yaw, s.pitch); return { x: d.x * 10, y: EYE + d.y * 10, z: d.z * 10 }; }, "rgba(255,255,255,.8)");
    pathOf(i => {
      const s = r!.samples[i];
      if (s.target < 0) return null;
      const d = aimDir(s.ty, s.tp);
      return { x: d.x * 10, y: EYE + d.y * 10, z: d.z * 10 };
    }, "rgba(255,122,61,.9)");
    $("#rpTime").textContent = `${fmt(t, 2)} s / ${fmt(r.duration, 2)} s`;
    $<HTMLInputElement>("#rpScrub").value = String(r.duration ? Math.round((t / r.duration) * 1000) : 0);
    drawTimeline(f.index);
  }

  function drawTimeline(cur: number): void {
    const c = $<HTMLCanvasElement>("#rpTimeline"), ctx = c.getContext("2d")!;
    c.width = c.clientWidth; const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    if (!r) return;
    const S = r.samples, n = S.length, col = getComputedStyle(document.documentElement);
    const ink = col.getPropertyValue("--muted").trim() || "#8e98a6", sig = col.getPropertyValue("--signal").trim() || "#ff7a3d", dat = col.getPropertyValue("--data").trim() || "#62c6d4";
    const X = (i: number) => (i / Math.max(1, n - 1)) * W;
    const rows = [{ y0: 4, h: 70 }, { y0: 84, h: 70 }, { y0: 164, h: 18 }];
    ctx.strokeStyle = ink; ctx.globalAlpha = 0.4; for (const rw of rows.slice(0, 2)) { ctx.beginPath(); ctx.moveTo(0, rw.y0 + rw.h / 2); ctx.lineTo(W, rw.y0 + rw.h / 2); ctx.stroke(); } ctx.globalAlpha = 1;
    const step = Math.max(1, Math.floor(n / W));
    // error in half-widths, clipped to +/-4
    ctx.beginPath();
    for (let i = 0; i < n; i += step) { const e = Math.max(-4, Math.min(4, (r.m1 ? r.m1.series.eh[i] : 0) / S[i].hw)); const y = rows[0].y0 + rows[0].h / 2 - (e / 4) * (rows[0].h / 2); i ? ctx.lineTo(X(i), y) : ctx.moveTo(X(i), y); }
    ctx.strokeStyle = sig; ctx.stroke();
    if (r.m1) {
      const vmax = 200 * DEG;
      for (const [arr, color] of [[r.m1.series.wt, ink], [r.m1.series.wc, dat]] as const) {
        ctx.beginPath();
        for (let i = 0; i < n; i += step) { const v = Math.max(-vmax, Math.min(vmax, arr[i])); const y = rows[1].y0 + rows[1].h / 2 - (v / vmax) * (rows[1].h / 2); i ? ctx.lineTo(X(i), y) : ctx.moveTo(X(i), y); }
        ctx.strokeStyle = color; ctx.stroke();
      }
    }
    ctx.fillStyle = sig;
    for (let i = 0; i < n; i += step) if (S[i].on) ctx.fillRect(X(i), rows[2].y0, Math.max(1, W / n * step), rows[2].h);
    for (const f of fl) { ctx.fillStyle = f.kind === "loss" ? "#ff5d5d" : f.kind === "overshoot" ? "#f2c14e" : ink; ctx.fillRect(X(f.t / 0.001) - 1, 0, 2, 6); }
    ctx.fillStyle = "#fff"; ctx.fillRect(X(cur) - 1, 0, 2, H);
  }

  function tick(now: number): void {
    if (!playing || !r) return;
    const dt = last ? (now - last) / 1000 : 0; last = now;
    seek(t + dt * +$<HTMLSelectElement>("#rpSpeed").value);
    if (t >= r.duration) { playing = false; $("#rpPlay").textContent = "Play"; return; }
    raf = requestAnimationFrame(tick);
  }

  $("#rpPlay").addEventListener("click", () => {
    playing = !playing; $("#rpPlay").textContent = playing ? "Pause" : "Play";
    if (playing) { if (r && t >= r.duration) t = 0; last = 0; raf = requestAnimationFrame(tick); } else cancelAnimationFrame(raf);
  });
  $<HTMLInputElement>("#rpScrub").addEventListener("input", e => seek(((+(e.target as HTMLInputElement).value) / 1000) * (r?.duration ?? 0)));
  $("#rpTimeline").addEventListener("click", e => { const c = e.currentTarget as HTMLCanvasElement; seek((e.offsetX / c.clientWidth) * (r?.duration ?? 0)); });
  $("#rpBlock").addEventListener("change", fillDrills);
  $("#rpDrill").addEventListener("change", load);
  $("#rpBack").addEventListener("click", () => { playing = false; cancelAnimationFrame(raf); $("#replay").hidden = true; onBack(); });
  addEventListener("resize", () => { if (!$("#replay").hidden) draw(); });

  return {
    open(s: SessionLog) {
      session = s;
      document.querySelectorAll<HTMLElement>(".wrap").forEach(w => (w.hidden = true));
      $("#replay").hidden = false; scrollTo(0, 0);
      ensureScene();
      fillBlocks();
    },
  };
}
