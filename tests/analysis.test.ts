import { describe, expect, it } from "vitest";
import { analyzeBlock, analyzeTrack } from "../src/analysis/track";
import { confidence, fitCurve, quadFit, solve3 } from "../src/analysis/fit";
import { synthBlock, synthDrill } from "./helpers";

describe("analyzeTrack", () => {
  it("zero lag, zero offset -> always on target, no wobble, no misses", () => {
    const m = analyzeTrack(synthDrill("close", 144, 0).frames, 800);
    expect(m.on).toBeCloseTo(100, 6);
    expect(m.jitter).toBeCloseTo(0, 6);
    expect(m.vertMiss).toBe(0);
    expect(m.recover).toBe(0);
    expect(m.pitchErr).toBeCloseTo(0, 6);
  });
  it("a pure vertical offset is all off-target time and all of it counts as vertical miss", () => {
    const m = analyzeTrack(synthDrill("close", 144, 0, 0.2).frames, 800);
    expect(m.on).toBe(0);
    expect(m.vertMiss).toBeCloseTo(100, 6);
    expect(m.pitchErr).toBeCloseTo(-0.2 / (Math.PI / 180), 4);
  });
  it("lagging a strafing target drops time on target and reports trailing", () => {
    const fast = analyzeTrack(synthDrill("close", 144, 0.02).frames, 800);
    const slow = analyzeTrack(synthDrill("close", 144, 0.25).frames, 800);
    expect(slow.on).toBeLessThan(fast.on);
    expect(slow.behind).toBeGreaterThan(75);
    expect(slow.recover).toBeGreaterThan(0);
  });
  it("empty and single-frame logs do not throw", () => {
    expect(analyzeTrack([], 800).on).toBe(0);
    expect(analyzeTrack(synthDrill("pb", 144, 0).frames.slice(0, 1), 800).on).toBe(0);
  });
  it("hand travel converts counts to cm using DPI", () => {
    const fr = synthDrill("pb", 60, 0).frames;
    fr[0].c = 0;
    fr[fr.length - 1].c = 800; // 800 counts at 800 dpi = 1 inch
    expect(analyzeTrack(fr, 800).handTravel).toBeCloseTo(2.54, 6);
  });
});

describe("sampling-rate invariance of metrics (same sim, different sampling rate)", () => {
  it("time-weighted percentages agree within 1.5 points at 60/144/240 fps", () => {
    const base = analyzeBlock(synthBlock(0, 30, 240, 0.08), 800);
    for (const fps of [60, 144]) {
      const m = analyzeBlock(synthBlock(0, 30, fps, 0.08), 800);
      for (const k of ["pb", "close", "mid"] as const) expect(Math.abs(m[k].on - base[k].on)).toBeLessThan(1.5);
    }
  });
});

describe("golden: synthetic lag-0.08 player, 144 fps", () => {
  it("block metrics are locked", () => {
    const m = analyzeBlock(synthBlock(0, 30, 144, 0.08), 800);
    const r = (o: object) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? +v.toFixed(3) : v]));
    expect({ pb: r(m.pb), close: r(m.close), mid: r(m.mid), score: +m.score.toFixed(3) }).toMatchSnapshot();
  });
});

describe("curve fitting", () => {
  const parab = (peak: number) => [10, 14, 20, 28, 40, 56, 80].map(cm => ({ cm, score: 80 - 12 * (Math.log(cm) - Math.log(peak)) ** 2 }));
  it("solve3 solves a known system and rejects a singular one", () => {
    expect(solve3([[2, 0, 0], [0, 3, 0], [0, 0, 4]], [2, 6, 12])).toEqual([1, 2, 3]);
    expect(solve3([[1, 1, 1], [1, 1, 1], [0, 0, 1]], [1, 1, 1])).toBeNull();
  });
  it("recovers the exact peak of a noiseless parabola in ln(cm)", () => {
    const f = fitCurve(parab(31));
    expect(f.curved).toBe(true);
    expect(f.peakCm).toBeCloseTo(31, 4);
    expect(f.peakY).toBeCloseTo(80, 4);
    expect(f.rmse!).toBeLessThan(1e-6);
    expect(f.lo).toBeLessThan(31);
    expect(f.hi).toBeGreaterThan(31);
  });
  it("flags a peak at the edge of the tested range", () => {
    const f = fitCurve(parab(5));
    expect(f.edge).toBe(true);
    expect(confidence(f).level).toBe("low");
  });
  it("noiseless data -> high confidence", () => {
    expect(confidence(fitCurve(parab(31))).level).toBe("high");
  });
  it("quadFit returns null when x has no variation", () => {
    expect(quadFit([{ x: 1, y: 1, cm: 1 }, { x: 1, y: 2, cm: 1 }, { x: 1, y: 3, cm: 1 }])).toBeNull();
  });
});
