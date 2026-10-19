// Pointer lock + event-level raw mouse capture. No rendering imports.
// Listens to exactly one event type (never two, which would double-count):
//   pointerrawupdate (secure context, Chromium/Firefox 148+) > pointermove > mousemove.
// Every intermediate event is recovered with getCoalescedEvents() when available and kept with its own timestamp.
import { applyDelta, type Aim } from "../core/crosshair";
import type { CaptureDiagnostics, InputSample, InputSource } from "../telemetry/schema";
import { CaptureBuffer, newDiagnostics, type RawParent, type RawPointer } from "./capture";

export function pickSource(): InputSource {
  if (typeof window === "undefined") return "synthetic";
  if (window.isSecureContext && "onpointerrawupdate" in window) return "pointerrawupdate";
  if ("PointerEvent" in window) return "pointermove";
  return "mousemove";
}

export class MouseInput {
  /** live crosshair for rendering; integrates samples the moment they arrive (same function as the replay) */
  readonly aim: Aim = { yaw: 0, pitch: 0 };
  /** radians per count; set per block */
  k = 0;
  locked = false;
  rawInput = false;
  accepting = false;
  onLockChange: ((locked: boolean) => void) | null = null;
  readonly source: InputSource;
  readonly diag: CaptureDiagnostics;
  private buf: CaptureBuffer;
  private pending: InputSample[] = [];

  constructor(private canvas: HTMLElement) {
    this.source = pickSource();
    const coalescedApi = typeof PointerEvent !== "undefined" && "getCoalescedEvents" in PointerEvent.prototype;
    this.diag = newDiagnostics(this.source, coalescedApi);
    this.buf = new CaptureBuffer(performance.now(), this.diag);
    const handler = (e: Event) => {
      if (!this.locked || !this.accepting) return;
      const m = e as MouseEvent;
      const pe = e as PointerEvent;
      let coalesced: RawPointer[] | null = null;
      if (typeof pe.getCoalescedEvents === "function") {
        coalesced = pe.getCoalescedEvents().map(c => ({ timeStamp: c.timeStamp, movementX: c.movementX, movementY: c.movementY }));
      }
      const p: RawParent = { timeStamp: m.timeStamp, movementX: m.movementX, movementY: m.movementY, coalesced };
      for (const s of this.buf.ingest(p)) { applyDelta(this.aim, s.dx, s.dy, this.k); this.pending.push(s); }
    };
    document.addEventListener(this.source === "synthetic" ? "mousemove" : this.source, handler);
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.onLockChange?.(this.locked);
    });
  }

  /** Start a fresh capture at t0 (ms, performance.now clock) with the crosshair reset to straight ahead. */
  begin(t0: number, k: number): void {
    this.buf.reset(t0);
    this.pending = [];
    this.aim.yaw = 0; this.aim.pitch = 0;
    this.k = k;
    this.accepting = true;
  }

  stop(): void { this.accepting = false; }

  /** Samples captured since the last drain, in timestamp order. */
  drain(): InputSample[] { const p = this.pending; this.pending = []; return p; }

  async lock(): Promise<void> {
    const el = this.canvas as HTMLElement & { requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | void };
    try {
      const p = el.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof (p as Promise<void>).then === "function") { await p; this.rawInput = true; }
      else this.rawInput = false; // non-promise implementations ignore the option; we cannot confirm raw input
    } catch {
      this.rawInput = false;
      try { await el.requestPointerLock(); } catch { /* user can click again */ }
    }
  }

  release(): void { if (document.pointerLockElement) document.exitPointerLock(); }
}
