// Run controller: drives the block sequence. Captures raw input into the event log and runs the shared
// DrillEvaluator for live game state (HP, kills). Metrics are never computed here, only in analysis/ from the log.
import { analyzeBlock } from "../analysis/track";
import { fitCurve } from "../analysis/fit";
import { clamp } from "../core/math";
import { shuffle } from "../core/rng";
import { cmPer360, radPerCount } from "../core/units";
import type { MouseInput } from "../input/pointer";
import type { RangeScene } from "../render/scene";
import { DRILLS, SEQ, WARMUP_MAX_DUR, type DrillId } from "../sim/drills";
import { DrillEvaluator } from "../sim/evaluator";
import { R1_N, R2_MULTIPLIERS, sweep, zoomRound } from "../sim/plan";
import { buildScenario, hitAt, targetView, type Scenario } from "../sim/scenario";
import { BlockRecorder } from "../telemetry/recorder";
import { SCHEMA_VERSION, type Settings, type SessionLog } from "../telemetry/schema";

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;

// The live evaluator runs this far behind real time so frame-batched events (delivered up to one frame late)
// are applied before their tick is evaluated. Only affects when HP bars/kills appear, never stored metrics.
const LIVE_LAG = 0.05;

interface PlanBlock { cm: number; warm: boolean; round: 1 | 2 | null }
interface BlockState {
  warm: boolean; step: number; kind: DrillId | "gap" | null; t0: number; dur: number; gapUntil: number;
  rec: BlockRecorder; sc: Scenario | null; ev: DrillEvaluator | null;
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
  private bi = 0;
  private phase: "idle" | "ready" | "live" = "idle";
  private live = false;
  private B: BlockState | null = null;
  private readyAt = 0;
  private onEMA = 0;
  private totalPlanned = 0;
  private running = false;
  private k = 0;

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

  start(settings: Settings): void {
    const baseCm = cmPer360(settings.sens, settings.dpi);
    this.plan = [{ cm: baseCm, warm: true, round: null }, ...shuffle(sweep(baseCm)).map(cm => ({ cm, warm: false, round: 1 as const }))];
    this.totalPlanned = 1 + R1_N + R2_MULTIPLIERS.length;
    this.bi = 0;
    this.session = {
      schema: SCHEMA_VERSION, id: crypto.randomUUID(), startedAt: new Date().toISOString(), finishedAt: null,
      status: "in_progress", settings, rawInput: false, sampling: "event", capture: this.mouse.diag, blocks: [],
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
    $("#ovEyebrow").textContent = b.warm ? "Warm-up · not scored" : `Block ${n} of ${this.totalPlanned} · round ${b.round} · sensitivity hidden`;
    $("#ovTitle").textContent = b.warm ? "Get your hand moving" : b.round === 2 ? "Zooming in" : "Next block";
    $("#ovText").textContent = b.warm
      ? "One block at your current sens so your first scored block isn't cold. It runs the same drills as the real test."
      : b.round === 2 ? "Round two tests small steps around your best zone. These blocks decide your exact number."
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
    this.B = { warm: b.warm, step: -1, kind: null, t0: 0, dur: 0, gapUntil: 0, sc: null, ev: null, rec: new BlockRecorder(this.bi, b.warm, b.round, b.cm) };
    this.live = true; this.phase = "live";
    this.nextStep(performance.now());
  }

  private endDrill(now: number): void {
    const B = this.B!;
    if (!B.ev) return;
    B.rec.events(this.mouse.drain());
    B.rec.endDrill((now - B.t0) / 1000);
    this.mouse.stop();
    B.ev = null; B.sc = null;
  }

  private nextStep(now: number): void {
    const B = this.B!;
    if (B.kind && B.kind !== "gap") this.endDrill(now);
    B.step++;
    if (B.step >= SEQ.length * 2) return this.endBlock();
    const id = SEQ[Math.floor(B.step / 2)], isGap = B.step % 2 === 0, d = DRILLS[id];
    this.scene.hideEnemies(); $("#hpbars").hidden = true;
    const ban = $("#banner");
    $("#hudDrill").textContent = d.name; $("#hudHint").textContent = d.hint; $("#hudTimer").textContent = "";
    if (isGap) {
      B.kind = "gap"; B.gapUntil = now + (id === "acc" ? 700 : 1300);
      ban.hidden = false; ban.innerHTML = `${d.name}<small>${d.hint}</small>`;
      return;
    }
    ban.hidden = true;
    B.kind = id; B.t0 = now;
    B.dur = B.warm && id !== "acc" ? Math.min(d.dur, WARMUP_MAX_DUR) : d.dur;
    B.sc = buildScenario(id, d.seed, B.dur);
    B.ev = new DrillEvaluator(B.sc, this.k, false);
    B.rec.startDrill(id, d.seed, B.dur, this.k);
    this.mouse.begin(now, this.k);
    if (B.sc.damage) { $("#hpbars").hidden = false; $("#hp0").style.width = "100%"; $("#hp1").style.width = "100%"; }
  }

  private update(now: number): void {
    const B = this.B;
    if (!B) return;
    if (B.kind === "gap") { if (now >= B.gapUntil) this.nextStep(now); return; }
    const sc = B.sc!, ev = B.ev!, el = (now - B.t0) / 1000;
    const fresh = this.mouse.drain();
    B.rec.events(fresh);
    this.mouse.diag.late += ev.push(fresh);
    ev.advanceTo(el - LIVE_LAG);
    const { yaw, pitch } = this.mouse.aim;
    let on = 0;
    for (let i = 0; i < sc.lanes.length; i++) {
      if (!ev.alive(i)) { this.scene.hide(i); continue; }
      const tv = targetView(sc, i, el);
      this.scene.place(i, tv.feet, tv.h);
      const h = hitAt(tv, yaw, pitch);
      this.scene.highlight(i, !!h);
      if (h && !on) on = h;
    }
    if (sc.damage) [0, 1].forEach(i => ($("#hp" + i).style.width = `${clamp(ev.hp[i] / sc.damage!.hp, 0, 1) * 100}%`));
    this.updateOnBar(on);
    const left = sc.damage ? ev.hp.filter(h => h > 0).length : 0;
    $("#hudTimer").textContent = `${Math.max(0, B.dur - el).toFixed(1)} s${sc.damage ? ` · ${2 - left}/2 down` : ""}`;
    if (el >= B.dur || ev.done) this.nextStep(now);
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
    if (this.bi === this.plan.length && !this.plan.some(x => x.round === 2)) {
      const scored = this.session.blocks.filter(b => !b.warm).map(b => ({ cm: b.cm360, score: analyzeBlock(b, this.session.settings.dpi).score }));
      const f = fitCurve(scored);
      this.plan.push(...shuffle(zoomRound(f.peakCm).map(cm => ({ cm, warm: false, round: 2 as const }))));
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
