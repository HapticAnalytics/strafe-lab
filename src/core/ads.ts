// ADS (aim-down-sights) sensitivity conversion. Apex's internal zoom scaling per optic is NOT verified (see
// RESEARCH.md §1), so this module works from the user's own per-optic 360° measurements: the measured effective
// degrees-per-count tells us the game's zoom factor for that optic directly.
import { APEX_YAW, DEG } from "./units";

export type Optic = "1x" | "2x" | "3x" | "4x" | "6x" | "8x" | "10x";
export const OPTICS: Optic[] = ["1x", "2x", "3x", "4x", "6x", "8x", "10x"];

// APPROX: community-reported optic FOV scale factors (edpi-calculator.org, 2026); sources disagree. Used only for
// the monitor-distance-match method, and only until the user's own measurement replaces the zoom factor.
export const OPTIC_FOV_SCALE_APPROX: Record<Optic, number> = { "1x": 1.0, "2x": 0.9, "3x": 0.75, "4x": 0.55, "6x": 0.4, "8x": 0.3, "10x": 0.2 };
// HYPOTHESIS: settings.cfg scalar index order matches the optic list (scalar_0 = 1x ... scalar_6 = 10x). Community
// configs show 7-8 scalars; verify by changing one value at a time in the Firing Range.
export const SCALAR_INDEX: Record<Optic, number> = { "1x": 0, "2x": 1, "3x": 2, "4x": 3, "6x": 4, "8x": 5, "10x": 6 };

/** Effective degrees per count from a measured counts-per-360. */
export const effectiveYaw = (countsPer360: number): number => 360 / countsPer360;

/**
 * The game's zoom factor for an optic: effective yaw / (0.022 * sens * ADS multiplier * per-optic scalar).
 * 1 means ADS turns exactly like hipfire per count.
 */
export const zoomFactor = (effYaw: number, sens: number, adsMult: number, scalar: number): number =>
  effYaw / (APEX_YAW * sens * adsMult * scalar);

/**
 * Monitor distance match ratio: zoomed/hipfire sens ratio that makes a flick to a point at fraction p of the
 * half-screen width take the same mouse distance. p = 0 is the limit tan(fz/2)/tan(fh/2) ("0%", focal length).
 * FOVs are horizontal, in degrees, at the same aspect. Pure geometry (VERIFIED by definition).
 */
export function mdmRatio(fovHipDeg: number, fovZoomDeg: number, p: number): number {
  const th = Math.tan((fovHipDeg * DEG) / 2), tz = Math.tan((fovZoomDeg * DEG) / 2);
  if (p <= 1e-9) return tz / th;
  return Math.atan(p * tz) / Math.atan(p * th);
}

/** Per-optic scalar that gives target effective sens ratio `ratio` (ADS sens / hipfire sens) given zoom factor z. */
export const scalarFor = (ratio: number, adsMult: number, z: number): number => ratio / (adsMult * z);

export type MatchMethod = { kind: "360" } | { kind: "mdm"; p: number };

/** Target ADS/hip sens ratio for a method. 360 match = same cm/360 as hipfire. */
export function targetRatio(m: MatchMethod, fovHipDeg: number, fovZoomDeg: number): number {
  return m.kind === "360" ? 1 : mdmRatio(fovHipDeg, fovZoomDeg, m.p);
}
