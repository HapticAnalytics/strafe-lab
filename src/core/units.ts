// Pure unit conversions for Apex sensitivity and FOV. No DOM, no rendering.

export const DEG = Math.PI / 180;

// VERIFIED: Apex/Source engine yaw, 0.022 deg per mouse count at sens 1.0 (sens 1.636364 = 10,000 counts per 360).
export const APEX_YAW = 0.022;
const CM_PER_INCH = 2.54; // VERIFIED: definition of the inch

/** Physical mouse travel for a full 360° turn, in cm. */
export const cmPer360 = (sens: number, dpi: number): number =>
  (360 / (APEX_YAW * sens * dpi)) * CM_PER_INCH;

/** Inverse of cmPer360: the Apex sens that gives `cm` per 360° at `dpi`. */
export const sensFromCm = (cm: number, dpi: number): number =>
  (360 * CM_PER_INCH) / (APEX_YAW * dpi * cm);

/** Radians of view rotation per mouse count at a given cm/360 and dpi. */
export const radPerCount = (cm: number, dpi: number): number =>
  (360 / ((cm / CM_PER_INCH) * dpi)) * DEG;

// VERIFIED: Apex FOV slider V -> cl_fovScale = 1 + (V - 70) * 0.01375 (slider 110 = 1.55).
export const fovScaleFromSlider = (slider: number): number => 1 + (slider - 70) * 0.01375;
export const sliderFromFovScale = (scale: number): number => (scale - 1) / 0.01375 + 70;

// VERIFIED: real 4:3 horizontal FOV = cl_fovScale x 70. Not capped at the slider maximum, so config values above 1.55 are valid.
export const hfov43FromScale = (scale: number): number => 70 * scale;
export const hfov43 = (slider: number): number => hfov43FromScale(fovScaleFromSlider(slider));

/** Vertical FOV (deg) implied by a 4:3 horizontal FOV (deg). */
export const vfovFrom43 = (h43: number): number =>
  (2 * Math.atan(Math.tan((h43 * DEG) / 2) * (3 / 4))) / DEG;

/** Horizontal FOV (deg) at an arbitrary aspect ratio, keeping the vertical FOV fixed (Hor+). */
export const hfovForAspect = (h43: number, aspect: number): number =>
  (2 * Math.atan(Math.tan((vfovFrom43(h43) * DEG) / 2) * aspect)) / DEG;

/** Mouse counts per full 360° turn. */
export const countsPer360 = (sens: number): number => 360 / (APEX_YAW * sens);
