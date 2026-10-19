// Pure ingest of browser pointer events into timestamped raw samples. No DOM access here, so the synthetic
// harness can drive exactly the same code path as the real browser.
import type { CaptureDiagnostics, InputSample, InputSource } from "../telemetry/schema";

/** The fields we read from a PointerEvent / MouseEvent. timeStamp is ms on the performance.now() clock. */
export interface RawPointer { timeStamp: number; movementX: number; movementY: number }
export interface RawParent extends RawPointer { coalesced: RawPointer[] | null }

export const newDiagnostics = (source: InputSource, coalescedApi: boolean): CaptureDiagnostics => ({
  source, coalescedApi, parents: 0, samples: 0, coalescedMismatch: 0, nonMonotonic: 0, duplicateTs: 0, late: 0,
});

/**
 * Accumulates samples relative to a drill start time t0 (ms). Coalesced events are used when their deltas sum to
 * the parent's; otherwise the parent alone is logged and the mismatch is counted, so counts are never lost or
 * double-counted. Timestamps are forced non-decreasing (and counted when that was needed).
 */
export class CaptureBuffer {
  samples: InputSample[] = [];
  private lastTs = -Infinity;

  constructor(public t0: number, public diag: CaptureDiagnostics) {}

  reset(t0: number): void { this.t0 = t0; this.samples = []; this.lastTs = -Infinity; }

  ingest(p: RawParent): InputSample[] {
    this.diag.parents++;
    let list: RawPointer[] = [p];
    if (p.coalesced && p.coalesced.length) {
      let sx = 0, sy = 0;
      for (const c of p.coalesced) { sx += c.movementX; sy += c.movementY; }
      if (sx === p.movementX && sy === p.movementY) list = p.coalesced;
      else this.diag.coalescedMismatch++;
    }
    const added: InputSample[] = [];
    for (const e of list) {
      if (!e.movementX && !e.movementY) continue;
      let ts = e.timeStamp;
      if (ts < this.lastTs) { this.diag.nonMonotonic++; ts = this.lastTs; }
      else if (ts === this.lastTs) this.diag.duplicateTs++;
      this.lastTs = ts;
      if (ts < this.t0) continue; // movement before the drill started is not part of it
      const s = { t: (ts - this.t0) / 1000, dx: e.movementX, dy: e.movementY };
      this.samples.push(s); added.push(s);
      this.diag.samples++;
    }
    return added;
  }
}

/** Log a left-button press (b = 1) or release (b = -1) on the same clock; dx = dy = 0. */
export function ingestClick(buf: CaptureBuffer, timeStamp: number, b: 1 | -1 = 1): InputSample | null {
  if (timeStamp < buf.t0) return null;
  const s: InputSample = { t: (timeStamp - buf.t0) / 1000, dx: 0, dy: 0, b };
  buf.samples.push(s);
  return s;
}

/** Polling-rate estimate (Hz) from intervals between consecutive moving samples, or null if too few. */
export function estimatePollingHz(samples: InputSample[]): { hz: number | null; medianMs: number | null; n: number } {
  const iv: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const d = (samples[i].t - samples[i - 1].t) * 1000;
    // APPROX: only intervals under 50 ms count as continuous movement; longer gaps are pauses, not polling
    if (samples[i].b || samples[i - 1].b) continue;
    if (d > 0 && d < 50) iv.push(d);
  }
  // APPROX: need at least 50 intervals for a stable median
  if (iv.length < 50) return { hz: null, medianMs: null, n: iv.length };
  iv.sort((a, b) => a - b);
  const med = iv[Math.floor(iv.length / 2)];
  return { hz: 1000 / med, medianMs: med, n: iv.length };
}

/**
 * Heuristic: if most intervals are near a multiple of the frame interval, events are probably frame-aligned
 * (Chrome mousemove behaviour) rather than per-poll.
 */
export function frameAlignedFraction(samples: InputSample[], frameMs: number): number {
  let near = 0, n = 0;
  for (let i = 1; i < samples.length; i++) {
    const d = (samples[i].t - samples[i - 1].t) * 1000;
    if (d <= 0 || d >= 50) continue;
    n++;
    const r = d / frameMs, off = Math.abs(r - Math.round(r));
    // APPROX: within 10% of a whole number of frames counts as aligned
    if (Math.round(r) >= 1 && off < 0.1) near++;
  }
  return n ? near / n : 0;
}
