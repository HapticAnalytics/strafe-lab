// How the game image maps onto the monitor. Pure geometry; affects only what is drawn, never sens math or metrics
// (all metrics are angular and computed from the log).

export type Scaling = "stretched" | "blackbars";

export interface Display {
  /** Game render aspect (width / height). null = native, i.e. the monitor's own aspect. */
  aspect: number | null;
  /** When the game aspect differs from the monitor: stretch the image to fill, or letterbox with black bars. */
  scaling: Scaling;
}

export const DEFAULT_DISPLAY: Display = { aspect: null, scaling: "stretched" };

export const ASPECT_PRESETS: { label: string; aspect: number | null }[] = [
  { label: "Native (monitor)", aspect: null },
  { label: "4:3 (1920x1440, 1600x1200, 1440x1080, 1280x960, 1024x768)", aspect: 4 / 3 },
  { label: "5:4 (1280x1024)", aspect: 5 / 4 },
  { label: "16:10 (1920x1200)", aspect: 16 / 10 },
  { label: "16:9 (1920x1080)", aspect: 16 / 9 },
];

export interface Layout {
  /** pixel rectangle of the 3D view inside the screen */
  viewport: { x: number; y: number; w: number; h: number };
  /** aspect used for the camera projection (what the game would render at) */
  cameraAspect: number;
}

export function layoutFor(d: Display, screenW: number, screenH: number): Layout {
  const native = screenW / screenH;
  if (d.aspect == null) return { viewport: { x: 0, y: 0, w: screenW, h: screenH }, cameraAspect: native };
  if (d.scaling === "stretched") return { viewport: { x: 0, y: 0, w: screenW, h: screenH }, cameraAspect: d.aspect };
  // black bars: largest rectangle of the game aspect that fits, centred
  const w = d.aspect < native ? screenH * d.aspect : screenW;
  const h = d.aspect < native ? screenH : screenW / d.aspect;
  return { viewport: { x: (screenW - w) / 2, y: (screenH - h) / 2, w, h }, cameraAspect: d.aspect };
}
