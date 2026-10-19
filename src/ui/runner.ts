// Run controller: drives the block sequence. Reads sim state for rendering; logs through BlockRecorder.
// Metrics are never computed here, only in analysis/ from the stored log.
import { analyzeBlock } from "../analysis/track";
import { fitCurve } from "../analysis/fit";
import { clamp, wrap } from "../core/math";
import { mulberry32, shuffle } from "../core/rng";
import { cmPer360, radPerCount } from "../core/units";
import type { MouseView } from "../input/pointer";
import type { RangeScene } from "../render/scene";
import { DPS_BODY, DPS_HEAD, HP } from "../sim/constants";
import { DRILLS, DUO_ENEMIES, DUO_PROFILE, SEQ, WARMUP_MAX_DUR, type DrillId } from "../sim/drills";
import { angTo } from "../sim/geometry";
import { advanceMover, createMover, type Mover } from "../sim/mover";
import { R1_N, R2_MULTIPLIERS, sweep, zoomRound } from "../sim/plan";
import { BlockRecorder } from "../telemetry/recorder";
import { SCHEMA_VERSION, type Settings, type SessionLog } from "../telemetry/schema";

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;

interface PlanBlock { cm: number; warm: boolean; round: 1 | 2 | null }
interface BlockState {
  warm: boolean; step: number; kind: DrillId | "gap" | null; t0: number; dur: number; gapUntil: number;
  rec: BlockRecorder; movers: Mover[]; hp: number[]; lastNow: number;
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
  private lastT = 0;
  private onEMA = 0;
  private totalPlanned = 0;
  private running = false;

  constructor(private scene: RangeScene, private mouse: MouseView, private hooks: RunnerHooks) {
    $("#ovGo").addEventListener("click", () => { if (!this.mouse.locked) this.mouse.lock(); else this.startBlock(); });
    $("#ovQuit").addEventListener("click", () => this.quit());
    document.addEventListener("keydown", e => { if (e.code === "Space" && this.phase === "ready" && this.mouse.locked) { e.preventDefault(); this.startBlock(); } });
    document.addEventListener("mousedown", e => { if (e.button === 0 && this.mouse.locked && this.phase === "ready") this.startBlock(); });
    this.mouse.onLockChange = locked => {
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
      status: "in_progress", settings, rawInput: false, sampling: "per-frame", blocks: [],
    };
    this.scene.setView(settings.fovScale, settings.display);
    $("#setup").hidden = true; $("#results").hidden = true; $("#range").hidden = false;
    this.scene.resize();
    try { $("#range").requestFullscreen?.().catch(() => {}); } catch { /* ignore */ }
    this.showReady();
    if (!this.running) { this.running = true; requestAnimationFrame(t => this.loop(t)); }
  }

  private showReady(): void {
    this.phase = "ready"; this.live = false; this.mouse.accepting = false;
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
    $("#ovMeta").textContent = !this.mouse.locked && this.bi === 0 ? "" : this.mouse.rawInput ? "Raw input: on" : "Raw input isn't available in this browser. Make sure Enhance pointer precision is off and Windows pointer speed is 6/11.";
    $("#ovGo").textContent = this.mouse.locked ? "Press Space or click to start" : "Click to lock mouse and start";
    $("#overlay").hidden = false;
    $("#hudDrill").textContent = b.warm ? "Warm-up" : "Ready";
    $("#hudBlock").textContent = `Block ${n} / ${this.totalPlanned}`;
    $("#hudHint").textContent = ""; $("#hudTimer").textContent = "";
  }

  private quit(): void {
    this.live = false; this.phase = "idle"; this.mouse.accepting = false;
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
    this.mouse.k = radPerCount(b.cm, this.session.settings.dpi);
    this.session.rawInput = this.mouse.rawInput;
    $("#overlay").hidden = true;
    this.B = {
      warm: b.warm, step: -1, kind: null, t0: 0, dur: 0, gapUntil: 0, movers: [], hp: [], lastNow: 0,
      rec: new BlockRecorder(this.bi, b.warm, b.round, b.cm),
    };
    this.live = true; this.phase = "live"; this.mouse.accepting = true;
    this.nextStep(performance.now());
  }

  private nextStep(now: number): void {
    const B = this.B!;
    if (B.kind && B.kind !== "gap") B.rec.endDrill();
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
    this.mouse.yaw = 0; this.mouse.pitch = 0;
    B.kind = id; B.t0 = now;
    B.dur = B.warm && id !== "acc" ? Math.min(d.dur, WARMUP_MAX_DUR) : d.dur;
    B.rec.startDrill(id, d.seed);
    if (id === "duo") {
      const rng = mulberry32(d.seed);
      B.movers = DUO_ENEMIES.map(e => createMover(DUO_PROFILE, rng, e.x0));
      B.hp = [HP, HP];
      $("#hpbars").hidden = false; $("#hp0").style.width = "100%"; $("#hp1").style.width = "100%";
    } else {
      B.movers = [createMover({ mix: d.mix!, sub: d.sub!, bound: d.bound! }, mulberry32(d.seed))];
    }
  }

  private update(now: number, dt: number): void {
    const B = this.B;
    if (!B) return;
    if (B.kind === "gap") { if (now >= B.gapUntil) this.nextStep(now); return; }
    const el = (now - B.t0) / 1000, id = B.kind as DrillId;
    if (id === "duo") return this.updateDuo(now, dt, el);
    const d = DRILLS[id], m = B.movers[0];
    advanceMover(m, el);
    const p = this.scene.place(0, m, 0, d.dist!);
    const hit = this.scene.aim(this.mouse.yaw, this.mouse.pitch, [0]);
    const on = hit ? (hit.head ? 2 : 1) : 0;
    this.scene.highlight(0, !!on);
    const a = angTo(p);
    B.rec.frame({ t: el, yaw: this.mouse.yaw, pitch: this.mouse.pitch, ty: a.yaw, tp: a.pitch, on, hw: Math.atan(0.3 / Math.hypot(p.x, p.z)), c: this.mouse.counts });
    this.updateOnBar(on);
    $("#hudTimer").textContent = `${Math.max(0, B.dur - el).toFixed(1)} s`;
    if (el >= B.dur) this.nextStep(now);
  }

  private updateDuo(now: number, dt: number, el: number): void {
    const B = this.B!, x = B.rec.extra!;
    const pos = DUO_ENEMIES.map((q, i) => {
      if (B.hp[i] <= 0) { this.scene.hide(i); return null; }
      advanceMover(B.movers[i], el);
      return this.scene.place(i, B.movers[i], q.theta, q.dist);
    });
    const alive = [0, 1].filter(i => B.hp[i] > 0);
    const hit = this.scene.aim(this.mouse.yaw, this.mouse.pitch, alive);
    let on: 0 | 1 | 2 = 0;
    if (hit) {
      const dmg = (hit.head ? DPS_HEAD : DPS_BODY) * dt;
      B.hp[hit.index] -= dmg; on = hit.head ? 2 : 1;
      if (hit.head) x.dmgHead += dmg; else x.dmgBody += dmg;
      if (B.hp[hit.index] <= 0) x.kills.push({ i: hit.index, t: el });
    }
    [0, 1].forEach(i => { this.scene.highlight(i, !!hit && hit.index === i); $("#hp" + i).style.width = `${clamp(B.hp[i] / HP, 0, 1) * 100}%`; });
    // frame logged against the nearest living enemy (the one you're fighting)
    type Tgt = { a: { yaw: number; pitch: number }; p: { x: number; z: number } };
    let best = 1e9;
    const found: Tgt[] = [];
    pos.forEach(p => { if (!p) return; const a = angTo(p), dd = Math.abs(wrap(a.yaw - this.mouse.yaw)); if (dd < best) { best = dd; found[0] = { a, p }; } });
    if (found[0]) {
      const t = found[0];
      B.rec.frame({ t: el, yaw: this.mouse.yaw, pitch: this.mouse.pitch, ty: t.a.yaw, tp: t.a.pitch, on, hw: Math.atan(0.3 / Math.hypot(t.p.x, t.p.z)), c: this.mouse.counts });
    }
    this.updateOnBar(on);
    const left = B.hp.filter(h => h > 0).length;
    $("#hudTimer").textContent = `${Math.max(0, B.dur - el).toFixed(1)} s · ${2 - left}/2 down`;
    if (!left || el >= B.dur) {
      x.elapsed = el; x.dealt = B.hp.reduce((s, h) => s + (HP - Math.max(0, h)), 0);
      this.nextStep(now);
    }
  }

  private updateOnBar(on: number): void {
    this.onEMA = this.onEMA * 0.94 + (on ? 0.06 : 0);
    $("#onfill").style.width = `${this.onEMA * 100}%`;
  }

  private loop(now: number): void {
    if ($("#range").hidden) { this.running = false; this.lastT = 0; return; }
    requestAnimationFrame(t => this.loop(t));
    const dt = this.lastT ? Math.min(0.05, (now - this.lastT) / 1000) : 0.016;
    this.lastT = now;
    if (this.live) this.update(now, dt);
    this.scene.render(this.mouse.yaw, this.mouse.pitch);
  }

  private endBlock(): void {
    this.live = false; this.mouse.accepting = false;
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

