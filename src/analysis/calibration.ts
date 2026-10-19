// Calibration maths. Pure functions of the captured counts / intervals and the user's stated setup.
import { mean } from "../core/math";
import { APEX_YAW, countsPer360 } from "../core/units";
import { estimatePollingHz, frameAlignedFraction } from "../input/capture";
import type { CaptureDiagnostics, InputSample } from "../telemetry/schema";

const CM_PER_INCH = 2.54; // VERIFIED: definition of the inch

// HYPOTHESIS: 1% is the acceptance bar for the 360° test (ROADMAP Milestone 1); the user's own repeat spread tells us
// whether swipe precision, not input, dominates the error.
export const CAL_TOLERANCE_PCT = 1;

/** Net horizontal counts of one swipe (signed sum, so small back-and-forth wobble cancels). */
export const netCounts = (s: InputSample[]): number => Math.abs(s.reduce((a, e) => a + e.dx, 0));

/** DPI measured by moving a known distance along a ruler. */
export function measuredDpi(counts: number, cm: number): number { return counts / (cm / CM_PER_INCH); }

/** Physical 360° check: counts for a swipe that does exactly one 360° turn in Apex at `sens`. */
export function turn360(counts: number, sens: number): { expected: number; errorPct: number; apexDegrees: number } {
  const expected = countsPer360(sens);
  return { expected, errorPct: (counts / expected - 1) * 100, apexDegrees: counts * APEX_YAW * sens };
}

export interface RepeatStats { n: number; mean: number; min: number; max: number; spreadPct: number }
export function repeatStats(xs: number[]): RepeatStats | null {
  if (!xs.length) return null;
  const m = mean(xs), lo = Math.min(...xs), hi = Math.max(...xs);
  return { n: xs.length, mean: m, min: lo, max: hi, spreadPct: m ? ((hi - lo) / 2 / m) * 100 : 0 };
}

export interface TimingReport {
  source: string; coalescedApi: boolean; samples: number;
  pollingHz: number | null; medianIntervalMs: number | null;
  frameMs: number | null; frameAlignedPct: number | null;
  coalescedMismatch: number; nonMonotonic: number; duplicateTs: number; late: number;
  /** plain-language verdict */
  verdict: string;
}

export function timingReport(samples: InputSample[], diag: CaptureDiagnostics, frameMs: number | null): TimingReport {
  const p = estimatePollingHz(samples);
  const fa = frameMs ? frameAlignedFraction(samples, frameMs) * 100 : null;
  let verdict: string;
  if (p.hz == null) verdict = "Not enough continuous movement to measure. Move the mouse in steady circles for the whole test.";
  // APPROX: >70% of intervals at whole frames, with a "polling rate" at or below ~1.2x the frame rate => frame-aligned
  else if (fa != null && fa > 70 && frameMs && p.hz < 1.2 * (1000 / frameMs)) verdict = "Events look frame-aligned: the browser is merging mouse polls into one event per frame. Metrics stay correct in total counts but lose sub-frame timing. Use Chrome or Edge over HTTPS (or localhost) for pointerrawupdate.";
  else verdict = `Events arrive at about ${Math.round(p.hz)} Hz, faster than your ${frameMs ? Math.round(1000 / frameMs) : "?"} fps frame rate, so timing is captured per mouse poll.`;
  if (diag.coalescedMismatch) verdict += ` ${diag.coalescedMismatch} coalesced lists did not add up and the parent event was used instead.`;
  if (diag.nonMonotonic) verdict += ` ${diag.nonMonotonic} timestamps went backwards and were clamped.`;
  return {
    source: diag.source, coalescedApi: diag.coalescedApi, samples: samples.length,
    pollingHz: p.hz, medianIntervalMs: p.medianMs, frameMs, frameAlignedPct: fa,
    coalescedMismatch: diag.coalescedMismatch, nonMonotonic: diag.nonMonotonic, duplicateTs: diag.duplicateTs, late: diag.late,
    verdict,
  };
}
