import { describe, expect, it } from "vitest";
import { APEX_YAW, hfov43FromScale, fovScaleFromSlider, sliderFromFovScale, cmPer360, countsPer360, hfov43, hfovForAspect, radPerCount, sensFromCm, vfovFrom43, DEG } from "../src/core/units";

describe("units", () => {
  it("800 DPI x 1.6 sens = 32.47 cm/360", () => {
    expect(cmPer360(1.6, 800)).toBeCloseTo(32.47, 2);
  });
  it("sens 1.636364 gives 10,000 counts per 360", () => {
    expect(countsPer360(1.636364)).toBeCloseTo(10000, 0);
    expect(APEX_YAW).toBe(0.022);
  });
  it("FOV slider 110 -> 108.5 deg at 4:3 -> 123.3 deg at 16:9", () => {
    expect(hfov43(110)).toBeCloseTo(108.5, 6);
    expect(hfovForAspect(hfov43(110), 16 / 9)).toBeCloseTo(123.3, 1);
  });
  it("FOV slider 70 is the 70 deg baseline and 4:3 is the identity aspect", () => {
    expect(hfov43(70)).toBe(70);
    expect(hfovForAspect(hfov43(104), 4 / 3)).toBeCloseTo(hfov43(104), 9);
    expect(vfovFrom43(90)).toBeCloseTo(73.74, 2);
  });
  it("sensFromCm inverts cmPer360", () => {
    for (const [s, d] of [[1.6, 800], [0.8, 1600], [3.2, 400]]) expect(sensFromCm(cmPer360(s, d), d)).toBeCloseTo(s, 10);
  });
  it("radPerCount x counts-per-360 = a full turn", () => {
    const cm = cmPer360(1.6, 800);
    const counts = (cm / 2.54) * 800;
    expect(radPerCount(cm, 800) * counts).toBeCloseTo(360 * DEG, 9);
    expect(radPerCount(cm, 800)).toBeCloseTo(APEX_YAW * 1.6 * DEG, 12);
  });
});

describe("cl_fovScale", () => {
  it("4:3 FOV = 70 x cl_fovScale and is not capped at the slider max", () => {
    expect(hfov43FromScale(1.55)).toBeCloseTo(108.5, 9);
    expect(hfov43FromScale(1.9)).toBeCloseTo(133, 9);
    expect(hfov43FromScale(2.5)).toBeCloseTo(175, 9);
  });
  it("slider and cl_fovScale convert both ways", () => {
    expect(fovScaleFromSlider(110)).toBeCloseTo(1.55, 9);
    expect(fovScaleFromSlider(70)).toBe(1);
    expect(sliderFromFovScale(fovScaleFromSlider(104))).toBeCloseTo(104, 9);
    expect(hfov43(104)).toBeCloseTo(hfov43FromScale(fovScaleFromSlider(104)), 12);
  });
  it("sens math does not depend on FOV", () => {
    expect(cmPer360(1.6, 800)).toBeCloseTo(32.47, 2);
  });
});
