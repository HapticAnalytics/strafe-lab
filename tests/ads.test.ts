import { describe, expect, it } from "vitest";
import { effectiveYaw, mdmRatio, OPTICS, SCALAR_INDEX, scalarFor, targetRatio, zoomFactor } from "../src/core/ads";
import { APEX_YAW, countsPer360 } from "../src/core/units";

describe("ADS conversion", () => {
  it("zoom factor is 1 when ADS turns exactly like hipfire", () => {
    const counts = countsPer360(1.6);
    expect(zoomFactor(effectiveYaw(counts), 1.6, 1, 1)).toBeCloseTo(1, 12);
  });
  it("zoom factor divides out the ADS multiplier and scalar", () => {
    // game applies z = 0.5: effective yaw = 0.022 * sens * mult * scalar * 0.5
    const eff = APEX_YAW * 1.6 * 1.2 * 0.9 * 0.5;
    expect(zoomFactor(eff, 1.6, 1.2, 0.9)).toBeCloseTo(0.5, 12);
  });
  it("360 match scalar makes the effective ADS yaw equal hipfire yaw", () => {
    const z = 0.37, mult = 1.0;
    const s = scalarFor(targetRatio({ kind: "360" }, 110, 40), mult, z);
    expect(APEX_YAW * 1.6 * mult * s * z).toBeCloseTo(APEX_YAW * 1.6, 12);
  });
  it("MDM 0% is the tangent ratio; known case 90° -> 45°", () => {
    expect(mdmRatio(90, 45, 0)).toBeCloseTo(Math.tan(22.5 * Math.PI / 180), 12);
    expect(mdmRatio(90, 45, 1e-7)).toBeCloseTo(mdmRatio(90, 45, 0), 6);
  });
  it("MDM 100% is the ratio of half-FOVs (same flick to the screen edge)", () => {
    expect(mdmRatio(100, 50, 1)).toBeCloseTo(25 / 50, 12);
  });
  it("MDM ratio is monotonic in p between 0% and 100% for zoomed optics", () => {
    const r = [0, 0.25, 0.5, 0.75, 1].map(p => mdmRatio(110, 40, p));
    for (let i = 1; i < r.length; i++) expect(r[i]).toBeGreaterThan(r[i - 1]);
  });
  it("every optic has a distinct scalar index", () => {
    expect(new Set(OPTICS.map(o => SCALAR_INDEX[o])).size).toBe(OPTICS.length);
  });
});
