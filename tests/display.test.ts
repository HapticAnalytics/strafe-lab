import { describe, expect, it } from "vitest";
import { layoutFor } from "../src/core/display";

describe("display layout (1920x1080 monitor)", () => {
  it("native: full screen at monitor aspect", () => {
    const l = layoutFor({ aspect: null, scaling: "stretched" }, 1920, 1080);
    expect(l.viewport).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(l.cameraAspect).toBeCloseTo(16 / 9, 9);
  });
  it("4:3 stretched: fills the screen but the camera renders 4:3 (image is widened)", () => {
    const l = layoutFor({ aspect: 4 / 3, scaling: "stretched" }, 1920, 1080);
    expect(l.viewport).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(l.cameraAspect).toBeCloseTo(4 / 3, 9);
  });
  it("4:3 black bars: 1440x1080 centred, 240 px bars each side", () => {
    const l = layoutFor({ aspect: 4 / 3, scaling: "blackbars" }, 1920, 1080);
    expect(l.viewport.w).toBeCloseTo(1440, 6);
    expect(l.viewport.h).toBe(1080);
    expect(l.viewport.x).toBeCloseTo(240, 6);
    expect(l.cameraAspect).toBeCloseTo(4 / 3, 9);
  });
  it("wider game aspect than the monitor letterboxes top and bottom", () => {
    const l = layoutFor({ aspect: 16 / 9, scaling: "blackbars" }, 1440, 1080);
    expect(l.viewport.w).toBe(1440);
    expect(l.viewport.h).toBeCloseTo(810, 6);
    expect(l.viewport.y).toBeCloseTo(135, 6);
  });
});
