import { describe, expect, it } from "vitest";
import { estimate, fitModel, solve } from "../src/analysis/sensfit";
import { mulberry32, type Rng } from "../src/core/rng";
import { estimatedMinutes, MODES, planSweep, planZoom, seedFor, sweepCandidates, williamsRow, type Mode } from "../src/sim/protocol";

const gauss = (r: Rng) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

/**
 * Synthetic player with a KNOWN best sens: block score = top - A (ln cm - ln best)^2 + learning - fatigue + noise.
 * A = 30 means a sens 2x off the best costs ~14 points. sigma is block-to-block noise in score points.
 * These magnitudes are HYPOTHESES until Milestone 3 measures the real noise floor.
 */
interface Player { best: number; A: number; sigma: number; learn: number; fatigue: number }
function simulate(mode: Mode, baseCm: number, p: Player, seed: number, B = 1000) {
  const r = mulberry32(seed), sessionSeed = seed * 2654435761 >>> 0;
  const score = (cm: number, order: number) => 70 - p.A * (Math.log(cm) - Math.log(p.best)) ** 2 + p.learn * (1 - Math.exp(-order / 2)) - p.fatigue * order + p.sigma * gauss(r);
  const sweep = planSweep(baseCm, mode, sessionSeed);
  const obs = sweep.map((b, i) => ({ cm: b.cm, order: i, y: score(b.cm, i) }));
  const e1 = estimate(obs, 1, 300)!;
  const zoom = planZoom(e1.peakCm, mode, sessionSeed, obs.length);
  zoom.forEach((b, j) => obs.push({ cm: b.cm, order: obs.length, y: score(b.cm, obs.length) }));
  return estimate(obs, 7, B)!;
}

describe("protocol", () => {
  it("Williams row visits every candidate once", () => {
    for (const n of [5, 6, 7]) expect([...williamsRow(n, 2)].sort()).toEqual([...Array(n).keys()]);
    expect(williamsRow(6, 0)).toEqual([0, 1, 5, 2, 4, 3]);
  });
  it("sweep is log-spaced over a factor of 2 either side and clamped to sane cm/360", () => {
    const c = sweepCandidates(32, 5);
    expect(c[0]).toBeCloseTo(16, 9); expect(c[4]).toBeCloseTo(64, 9); expect(c[2]).toBeCloseTo(32, 9);
    expect(sweepCandidates(6, 5)[0]).toBeCloseTo(8, 9);
  });
  it("plans are deterministic per session seed and seeds differ per block and skill", () => {
    expect(planSweep(32, "standard", 9)).toEqual(planSweep(32, "standard", 9));
    const p = planSweep(32, "standard", 9);
    const seeds = p.flatMap(b => b.segments.map(s => s.seed));
    expect(new Set(seeds).size).toBe(seeds.length);
    expect(seedFor(1, 2, 3)).not.toBe(seedFor(1, 3, 2));
  });
  it("zoom repeats candidates in ABBA order", () => {
    const z = planZoom(30, "standard", 5, 6).map(b => b.cm);
    expect(z.length).toBe(4);
    expect(z[0]).toBe(z[3]); expect(z[1]).toBe(z[2]);
  });
  it("mode durations match the revised targets (10 s drills; Deep 12 s)", () => {
    expect(estimatedMinutes("quick")).toBeGreaterThanOrEqual(6); expect(estimatedMinutes("quick")).toBeLessThanOrEqual(7);
    expect(estimatedMinutes("standard")).toBeGreaterThanOrEqual(14); expect(estimatedMinutes("standard")).toBeLessThanOrEqual(16);
    expect(estimatedMinutes("deep")).toBeGreaterThanOrEqual(22); expect(estimatedMinutes("deep")).toBeLessThanOrEqual(25);
  });
});

describe("statistics", () => {
  it("solve handles a 4x4 system", () => {
    expect(solve([[2, 0, 0, 0], [0, 1, 0, 0], [0, 0, 4, 0], [1, 0, 0, 1]], [2, 3, 8, 5])!.map(v => +v.toFixed(9))).toEqual([1, 3, 2, 4]);
  });
  it("recovers an exact parabola and an exact learning slope with no noise", () => {
    const obs = Array.from({ length: 12 }, (_, i) => { const cm = [16, 22, 30, 40, 52, 64][i % 6]; return { cm, order: i, y: 60 - 20 * (Math.log(cm) - Math.log(33)) ** 2 + 0.8 * i }; });
    const m = fitModel(obs, 1)!;
    expect(m.beta[3]).toBeCloseTo(0.8, 6);
    const e = estimate(obs)!;
    expect(e.peakCm).toBeCloseTo(33, 4);
    expect(e.single).toBe(true);
    expect(e.learnStart!).toBeCloseTo(0.8, 6);
  });
  it("a flat player (no sens preference) gets 'no clear winner'", () => {
    let ncw = 0;
    for (let s = 1; s <= 60; s++) if (simulate("standard", 32, { best: 32, A: 0, sigma: 3, learn: 0, fatigue: 0 }, s).noClearWinner) ncw++;
    expect(ncw / 60).toBeGreaterThan(0.8);
  }, 60_000);
});

/**
 * ROADMAP Milestone 2 acceptance: "a synthetic player with a known best sens is recovered within ±8% in Standard
 * mode in 90% of runs". The result depends on block-to-block noise, which is unknown until Milestone 3. We assert
 * the criterion where it holds (sigma <= 2 points) and lock the full table so ROADMAP can state it honestly.
 */
describe("Milestone 2 acceptance (simulation)", () => {
  const RUNS = 300;
  const table = (mode: Mode) => [1.5, 2, 3, 5].map(sg => `sigma ${sg}: ${(rate(mode, sg) * 100).toFixed(0)}%`).join(", ");
  function rate(mode: Mode, sigma: number) {
    let ok = 0;
    for (let s = 1; s <= RUNS; s++) {
      const r = mulberry32(s * 31);
      const base = 20 + r() * 40;                       // current sens 20-60 cm/360
      const best = base * Math.exp((r() * 2 - 1) * Math.log(1.6)); // true best within 1.6x of current
      const e = simulate(mode, base, { best, A: 30, sigma, learn: 3, fatigue: 0.2 }, s, 20); // peak estimate does not depend on B
      if (Math.abs(e.peakCm / best - 1) <= 0.08) ok++;
    }
    return ok / RUNS;
  }
  it("Standard mode: >= 90% of runs within ±8% when block noise sigma <= 2 points", () => {
    expect(rate("standard", 2)).toBeGreaterThanOrEqual(0.9);
  }, 60_000);
  it("recovery rates by mode and noise are locked (any change must be deliberate)", () => {
    expect({ quick: table("quick"), standard: table("standard"), deep: table("deep") }).toMatchSnapshot();
  }, 300_000);
});
