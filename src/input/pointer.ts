// Pointer lock + raw mouse deltas. No rendering imports. Still per-frame-aligned `mousemove` in M0;
// Milestone 1 switches to pointerrawupdate + getCoalescedEvents with timestamps.
import { clamp } from "../core/math";
import { DEG } from "../core/units";

export class MouseView {
  yaw = 0;
  pitch = 0;
  /** radians per count; set per block */
  k = 0;
  /** cumulative hypot of counts, used for hand travel */
  counts = 0;
  locked = false;
  rawInput = false;
  accepting = false;
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    document.addEventListener("mousemove", e => {
      if (!this.locked || !this.accepting) return;
      this.yaw -= e.movementX * this.k;
      this.pitch = clamp(this.pitch - e.movementY * this.k, -89 * DEG, 89 * DEG);
      this.counts += Math.hypot(e.movementX, e.movementY);
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.onLockChange?.(this.locked);
    });
  }

  async lock(): Promise<void> {
    try {
      await (this.canvas.requestPointerLock as (o?: object) => Promise<void> | void).call(this.canvas, { unadjustedMovement: true });
      this.rawInput = true;
    } catch {
      this.rawInput = false;
      try { const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined; await p; } catch { /* ignore */ }
    }
  }

  release(): void { if (document.pointerLockElement) document.exitPointerLock(); }
}
