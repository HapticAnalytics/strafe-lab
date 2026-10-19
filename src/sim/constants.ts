// Every constant in sim/ carries a tag: VERIFIED (with source), APPROX (why), or HYPOTHESIS (how we'll test it).

// VERIFIED: apexlegends.wiki.gg movement speeds (m/s)
export const WALK = 5.07;
export const CROUCH_WALK = 2.34;
export const SPRINT = 7.59;
// VERIFIED: apexlegends.wiki.gg, -13% movement speed while holding a weapon
export const WEAPON_SLOWDOWN = 0.87;
export const WALK_GUN = WALK * WEAPON_SLOWDOWN; // 4.41 m/s
export const CROUCH_GUN = CROUCH_WALK * WEAPON_SLOWDOWN; // 2.04 m/s

// VERIFIED (frozen ruleset): liquipedia R-99 as of the project brief, 1080 RPM, 11 body / 17 head -> 198 / 306 DPS.
// The Aug 3 2026 "Marked" patch (Season 30) set R-99 body damage to 12. The 2v1 drill keeps 11/17 on purpose so
// every stored session replays identically; weapon simulations use the dated profiles in sim/weapons.ts.
export const DPS_BODY = 198;
export const DPS_HEAD = 306;
// VERIFIED: purple shield (100) + base health (100) = 200 effective HP
export const HP = 200;

// APPROX: camera eye height; real value varies by legend and stance
export const EYE = 1.6;
// APPROX: hitbox as cylinder r=0.3 m / head sphere r=0.17 m; real hitboxes vary by legend
export const BODY_RADIUS = 0.3;
// APPROX: standing body height scale 1.0, crouched/sliding 0.62; real crouch hitbox differs per legend
export const CROUCH_HEIGHT_SCALE = 0.62;

// APPROX: V2 hand-tuned ground acceleration (m/s^2); Apex strafe acceleration not measured
export const GROUND_ACCEL = 45;
// APPROX: V2 hand-tuned air acceleration (m/s^2)
export const AIR_ACCEL = 6;
// APPROX: V2 hand-tuned jump launch speed (m/s) and gravity (m/s^2), not Apex's real arc
export const JUMP_VY = 4.2;
export const GRAVITY = 12;
// APPROX: V2 hand-tuned slide: full sprint speed for 0.6 s then decays at 7 m/s^2 down to walk speed
export const SLIDE_HOLD = 0.6;
export const SLIDE_DECAY = 7;
export const SLIDE_DURATION = 1.1;

// APPROX: fixed simulation step. Movement is a function of (time, seed) evaluated on this grid, so any
// frame rate sees identical target positions. 240 Hz bounds position error at < 4 ms of motion.
export const SIM_DT = 1 / 240;
