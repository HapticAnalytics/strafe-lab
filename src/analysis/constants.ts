// Every constant in analysis/ carries a tag: VERIFIED (with source), APPROX (why), or HYPOTHESIS (how we'll test it).
// These are V2's values, ported unchanged in Milestone 0. Milestone 1 re-derives them with event-level data.

// APPROX: gaps longer than 50 ms between frames (tab stalls) are clamped so one hitch can't dominate time-weighted metrics
export const MAX_FRAME_GAP = 0.05;
// APPROX: a target counts as "moving" above 0.08 rad/s (~4.6 deg/s) angular speed
export const MOVING_THRESHOLD = 0.08;
// APPROX: "near the target" for jitter = within 3 deg of its centre
export const NEAR_DEG = 3;
// APPROX: a crosshair crossing over the target centre within 2.5 half-widths counts as one oscillation
export const OSC_HALFWIDTHS = 2.5;
// APPROX: after a reversal, look back 120 ms to see whether the player was on target, then watch up to 1.0 s;
// if still on at 300 ms they never lost it
export const RECOVER_LOOKBACK = 0.12;
export const RECOVER_WINDOW = 1.0;
export const RECOVER_GRACE = 0.3;
// APPROX: a reversal never recovered within the window is scored as 1000 ms
export const RECOVER_UNRECOVERED_MS = 1000;
// APPROX: jitter = deviation from a +/-40 ms moving average of the aim error (high-pass); V2 comment called this 80 ms
export const JITTER_HALF_WINDOW = 0.04;
// APPROX: hand peak speed measured over 60 ms windows (min 30 ms of data)
export const PEAK_WINDOW = 0.06;
export const PEAK_MIN_DT = 0.03;

// HYPOTHESIS: block score weights (point-blank .25, close .30, mid .20, 2v1 .25). Test via test-retest reliability (Milestone 3).
export const SCORE_WEIGHTS = { pb: 0.25, close: 0.30, mid: 0.20, duo: 0.25 } as const;

// HYPOTHESIS: peak confidence cut-offs (stability <=6% & rmse<4 = high; <=12% = medium). Test: simulated players with a known best sens (Milestone 2).
export const CONF_HIGH_SPREAD = 6;
export const CONF_HIGH_RMSE = 4;
export const CONF_MED_SPREAD = 12;
// HYPOTHESIS: "sweet spot" = range where the fitted curve is within 2 score points of its peak
export const SWEET_SPOT_DROP = 2;

// HYPOTHESIS: insight thresholds below (percent / ms / points). Tune against baseline noise floor (Milestone 3).
export const INSIGHT = {
  sensClosePct: 6,
  splitRatio: 1.35,
  leftRightGap: 6,
  behindHigh: 62,
  behindLow: 38,
  recoverMs: 200,
  vertMissPct: 30,
  wobbleRatio: 1.3,
  fatiguePerBlock: -1.2,
} as const;
