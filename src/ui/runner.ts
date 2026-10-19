// Run controller for the Sensitivity Intelligence v3 test. Captures raw input into the event log and runs the
// shared DrillEvaluator for live game state (HP, kills, spawns). Metrics are never computed here, only in
// analysis/ from the log.
import { sweepPeak } from "../analysis/result3";
import { clamp } from "../core/math";
import { cmPer360, radPerCount } from "../core/units";
import type { MouseInput } from "../input/pointer";
import type { RangeScene } from "../render/scene";
import { DRILLS } from "../sim/drills";
import { DrillEvaluator } from "../sim/evaluator";
import { MODES, planSweep, planZoom, seedFor, type Mode, type PlannedBlock, type Segment } from "../sim/protocol";
import { buildScenario, hitAt, targetView, type Scenario } from "../sim/scenario";
import { BlockRecorder } from "../telemetry/recorder";
import { SCHEMA_VERSION, type Settings, type SessionLog } from "../telemetry/schema";

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;

// The live evaluator runs this far behind real time so frame-batched events (delivered up to one frame late)
// are applied before their tick is evaluated. Only affects when HP bars/kills/spawns update, never stored metrics.
const LIVE_LAG = 0.05;
// warm-up segments are capped so the unscored block stays short
const WARM_SEG_MAX = 4;

interface PlanBlock extends PlannedBlock { warm: boolean }
interface BlockState {
  steps: Segment[]; step: number; inGap: boolean; t0: number; gapUntil: number;
  rec: BlockRecorder; seg: Segment | null; sc: Scenario | null; ev: DrillEvaluator | null;
}

export interface RunnerHooks {
  /** Persist the session (called after every completed block and at the end). */
  persist(s: SessionLog): void;
  finished(s: SessionLog): void;
  quit(): void;
}

export class Runner {
  private session!: SessionLog;
  private plan: PlanBlock[] = [];
  private mode: Mode = "standard";
  private bi = 0;
  private phase: "idle" | "ready" | "live" = "idle";
  private live = false;
  private B: BlockState | null = null;
  private readyAt = 0;
  private onEMA = 0;
  private totalPlanned = 0;
  private running = false;
  private k = 0;
  private zoomPlanned = false;

  constructor(private scene: RangeScene, private mouse: MouseInput, private hooks: RunnerHooks) {
    $("#ovGo").addEventListener("click", () => { if (!this.mouse.locked) this.mouse.lock(); else this.startBlock(); });
    $("#ovQuit").addEventListener("click", () => this.quit());
    document.addEventListener("keydown", e => { if (e.code === "Space" && this.phase === "ready" && this.mouse.locked) { e.preventDefault(); this.startBlock(); } });
    document.addEventListener("mousedown", e => { if (e.button === 0 && this.mouse.locked && this.phase === "ready") this.startBlock(); });
    this.mouse.onLockChange = (locked: boolean) => {
      if (locked && this.phase === "ready") { $("#ovGo").textContent = "Press Space or click to start"; this.startBlock(); }
      if (!locked && this.live) this.pause();
    };
  }

  start(settings: Settings, mode: Mode): void {
    const baseCm = cmPer360(settings.sens, settings.dpi);
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const m = MODES[mode];
    this.mode = mode;
    const warm: PlanBlock = {
      cm: baseCm, phase: "sweep", warm: true,
      acc: { id: "acc", seed: seedFor(seed, 999, 99), dur: m.accDur },
      segments: m.skills.map((id, j) => ({ id, seed: seedFor(seed, 999, j), dur: Math.min(m.segDur, WARM_SEG_MAX) })),
    };
    this.plan = [warm, ...planSweep(baseCm, mode, seed).map(b => ({ ...b, warm: false }))];
    this.totalPlanned = 1 + m.sweepN + m.zoom.length * m.zoomReps;
    this.zoomPlanned = false;
    this.bi = 0;
    this.session = {
      schema: SCHEMA_VERSION, id: crypto.randomUUID(), startedAt: new Date().toISOString(), finishedAt: null,
      status: "in_progress", settings, rawInput: false, sampling: "event", capture: this.mouse.diag,
      protocol: "v3", mode, sessionSeed: seed, blocks: [],
    };
    this.scene.setView(settings.fovScale, settings.display);
    $("#setup").hidden = true; $("#results").hidden = true; $("#range").hidden = false;
    this.scene.resize();
    try { $("#range").requestFullscreen?.().catch(() => {}); } catch { /* ignore */ }
    this.showReady();
    if (!this.running) { this.running = true; requestAnimationFrame(t => this.loop(t)); }
  }

  private showReady(): void {
    this.phase = "ready"; this.live = false; this.mouse.stop();
    const b = this.plan[this.bi];
    this.scene.hideEnemies(); $("#hpbars").hidden = true; $("#banner").hidden = true;
    const n = this.bi + 1;
    $("#ovEyebrow").textContent = b.warm ? "Warm-up · not scored" : `Block ${n} of ${this.totalPlanned} · ${b.phase === "zoom" ? "zoom" : "sweep"} · sensitivity hidden`;
    $("#ovTitle").textContent = b.warm ? "Get your hand moving" : b.phase === "zoom" ? "Zooming in" : "Next block";
    $("#ovText").textContent = b.warm
      ? "One short block at your current sens so your first scored block isn't cold. Same skills as the real test."
      : b.phase === "zoom" ? "These blocks test small steps around your best zone, some of them twice, to pin down your number."
      : "New hidden sensitivity. Some will feel very fast or very slow on purpose. Play every one like a real fight.";
    $("#ovProg").style.width = `${(this.bi / this.totalPlanned) * 100}%`;
    this.readyAt = performance.now();
    const src = `Input: ${this.mouse.source}${this.mouse.diag.coalescedApi ? " + coalesced events" : ""}.`;
    $("#ovMeta").textContent = !this.mouse.locked && this.bi === 0 ? "" : this.mouse.rawInput ? `Raw input: on. ${src}` : `Raw input isn't confirmed in this browser. Make sure Enhance pointer precision is off and Windows pointer speed is 6/11. ${src}`;
    $("#ovGo").textContent = this.mouse.locked ? "Press Space or click to start" : "Click to lock mouse and start";
    $("#overlay").hidden = false;
    $("#hudDrill").textContent = b.warm ? "Warm-up" : "Ready";
    $("#hudBlock").textContent = `Block ${n} / ${this.totalPlanned}`;
    $("#hudHint").textContent = ""; $("#hudTimer").textContent = "";
  }

  private quit(): void {
    this.live = false; this.phase = "idle"; this.mouse.stop();
    this.mouse.release();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (this.session && this.session.blocks.length) { this.session.status = "abandoned"; this.hooks.persist(this.session); }
    $("#range").hidden = true; $("#setup").hidden = false;
    this.hooks.quit();
  }

  private pause(): void {
    this.live = false; this.B = null;
    this.showReady();
    $("#ovEyebrow").textContent = "Paused";
    $("#ovTitle").textContent = "Block paused";
    $("#ovText").textContent = "This block restarts from the beginning when you resume, so a pause never counts against a sensitivity.";
  }

  private startBlock(): void {
    if (this.phase !== "ready" || performance.now() - this.readyAt < 600) return;
    const b = this.plan[this.bi];
    this.k = radPerCount(b.cm, this.session.settings.dpi);
    this.session.rawInput = this.mouse.rawInput;
    $("#overlay").hidden = true;
    const round = b.warm ? null : b.phase === "zoom" ? 2 : 1;
    this.B = { steps: [b.acc, ...b.segments], step: -1, inGap: false, t0: 0, gapUntil: 0, seg: null, sc: null, ev: null, rec: new BlockRecorder(this.bi, b.warm, round, b.cm) };
    this.live = true; this.phase = "live";
    this.nextStep(performance.now());
  }

  private endSegment(now: number): void {
    const B = this.B!;
    if (!B.ev) return;
    B.rec.events(this.mouse.drain());
    B.rec.endDrill((now - B.t0) / 1000);
    this.mouse.stop();
    B.ev = null; B.sc = null; B.seg = null;
  }

  /** Steps alternate: gap banner, segment, gap banner, segment, ... */
  private nextStep(now: number): void {
    const B = this.B!;
    this.endSegment(now);
    this.scene.hideEnemies(); $("#hpbars").hidden = true;
    const ban = $("#banner");
    if (!B.inGap) {
      B.step++;
      if (B.step >= B.steps.length) return this.endBlock();
      const d = DRILLS[B.steps[B.step].id];
      B.inGap = true; B.gapUntil = now + (B.step === 0 ? 700 : 900);
      $("#hudDrill").textContent = d.name; $("#hudHint").textContent = d.hint; $("#hudTimer").textContent = "";
      ban.hidden = false; ban.innerHTML = `${d.name}<small>${d.hint}</small>`;
      return;
    }
    B.inGap = false;
    ban.hidden = true;
    const seg = B.steps[B.step];
    B.seg = seg; B.t0 = now;
    B.sc = buildScenario(seg.id, seg.seed, seg.dur);
    B.ev = new DrillEvaluator(B.sc, this.k, false);
    B.rec.startDrill(seg.id, seg.seed, seg.dur, this.k);
    this.mouse.begin(now, this.k);
    if (B.sc.damage) { $("#hpbars").hidden = false; $("#hp0").style.width = "100%"; $("#hp1").style.width = "100%"; }
  }

  private update(now: number): void {
    const B = this.B;
    if (!B) return;
    if (B.inGap || !B.sc) { if (now >= B.gapUntil) this.nextStep(now); return; }
    const sc = B.sc, ev = B.ev!, el = (now - B.t0) / 1000;
    const fresh = this.mouse.drain();
    B.rec.events(fresh);
    this.mouse.diag.late += ev.push(fresh);
    ev.advanceTo(el - LIVE_LAG);
    const { yaw, pitch } = this.mouse.aim;
    let on = 0;
    if (sc.spawn) {
      this.scene.hide(1);
      const a = ev.activeSpawn(el);
      if (a) {
        const tv = targetView(sc, a.i, a.local);
        this.scene.place(0, tv.feet, tv.h);
        on = hitAt(tv, yaw, pitch);
        this.scene.highlight(0, !!on);
      } else this.scene.hide(0);
    } else {
      for (let i = 0; i < sc.lanes.length; i++) {
        if (!ev.alive(i)) { this.scene.hide(i); continue; }
        const tv = targetView(sc, i, el);
        this.scene.place(i, tv.feet, tv.h);
        const h = hitAt(tv, yaw, pitch);
        this.scene.highlight(i, !!h);
        if (h && !on) on = h;
      }
      if (sc.lanes.length < 2) this.scene.hide(1);
    }
    if (sc.damage) [0, 1].forEach(i => ($("#hp" + i).style.width = `${clamp(ev.hp[i] / sc.damage!.hp, 0, 1) * 100}%`));
    this.updateOnBar(on);
    const left = sc.damage ? ev.hp.filter(h => h > 0).length : 0;
    const done = sc.spawn ? ` · ${ev.spawns.filter(s => s.done != null).length} hit` : "";
    $("#hudTimer").textContent = `${Math.max(0, B.seg!.dur - el).toFixed(1)} s${sc.damage ? ` · ${2 - left}/2 down` : ""}${done}`;
    if (el >= B.seg!.dur || ev.done) this.nextStep(now);
  }

  private updateOnBar(on: number): void {
    this.onEMA = this.onEMA * 0.94 + (on ? 0.06 : 0);
    $("#onfill").style.width = `${this.onEMA * 100}%`;
  }

  private loop(now: number): void {
    if ($("#range").hidden) { this.running = false; return; }
    requestAnimationFrame(t => this.loop(t));
    if (this.live) this.update(now);
    this.scene.render(this.mouse.aim.yaw, this.mouse.aim.pitch);
  }

  private endBlock(): void {
    this.live = false; this.mouse.stop();
    const B = this.B!;
    this.session.blocks.push(B.rec.log);
    this.B = null; this.bi++;
    if (this.bi === this.plan.length && !this.zoomPlanned) {
      this.zoomPlanned = true;
      const peak = sweepPeak(this.session) ?? cmPer360(this.session.settings.sens, this.session.settings.dpi);
      const scoredSoFar = this.session.blocks.filter(b => !b.warm).length;
      this.plan.push(...planZoom(peak, this.mode, this.session.sessionSeed!, scoredSoFar).map(b => ({ ...b, warm: false })));
    }
    if (this.bi >= this.plan.length) return this.finish();
    this.hooks.persist(this.session);
    this.showReady();
  }

  private finish(): void {
    this.phase = "idle";
    this.session.status = "complete"; this.session.finishedAt = new Date().toISOString();
    this.hooks.persist(this.session);
    this.mouse.release();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    $("#range").hidden = true;
    this.hooks.finished(this.session);
  }
}
