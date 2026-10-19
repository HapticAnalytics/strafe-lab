import { describe, expect, it } from "vitest";
import { measuredDpi, netCounts, repeatStats, timingReport, turn360 } from "../src/analysis/calibration";
import { newDiagnostics } from "../src/input/capture";

describe("calibration maths", () => {
  it("10 cm at 800 DPI = 3149.6 counts", () => {
    expect(measuredDpi(3149.606, 10)).toBeCloseTo(800, 2);
  });
  it("net counts cancel back-and-forth wobble", () => {
    expect(netCounts([{ t: 0, dx: 100, dy: 0 }, { t: 0.01, dx: -10, dy: 3 }, { t: 0.02, dx: 50, dy: 0 }])).toBe(140);
  });
  it("360 check: sens 1.636364 expects 10,000 counts; 10,050 is +0.5%", () => {
    const r = turn360(10050, 1.636364);
    expect(r.expected).toBeCloseTo(10000, 0);
    expect(r.errorPct).toBeCloseTo(0.5, 2);
    expect(r.apexDegrees).toBeCloseTo(361.8, 1);
  });
  it("repeat spread", () => {
    expect(repeatStats([99, 101])).toEqual({ n: 2, mean: 100, min: 99, max: 101, spreadPct: 1 });
    expect(repeatStats([])).toBeNull();
  });
  it("timing verdicts: per-poll vs frame-aligned vs not enough data", () => {
    const d = newDiagnostics("pointerrawupdate", true);
    const poll = Array.from({ length: 2000 }, (_, i) => ({ t: i / 1000, dx: 1, dy: 0 }));
    expect(timingReport(poll, d, 1000 / 144).verdict).toMatch(/1000 Hz/);
    const fr = Array.from({ length: 300 }, (_, i) => ({ t: i / 60, dx: 5, dy: 0 }));
    expect(timingReport(fr, d, 1000 / 60).verdict).toMatch(/frame-aligned/);
    expect(timingReport(poll.slice(0, 5), d, 1000 / 60).verdict).toMatch(/Not enough/);
  });
});
