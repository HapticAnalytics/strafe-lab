// Milestone 8 weapon profiles. Fire rate, damage, magazine and reload are sourced and dated (game stats change per
// patch). Recoil and spread are NOT published by Respawn: they are approximations, labelled APPROX, chosen so that
// each class feels different. Profiles are versioned: a stored combat log names its profile version, so a later
// patch never silently changes old results.

export type WeaponId = "r99" | "r301" | "eva8" | "wingman" | "g7";
export type WeaponClass = "SMG" | "AR" | "Shotgun" | "Pistol" | "Marksman";

export interface WeaponProfile {
  id: WeaponId; name: string; cls: WeaponClass;
  /** profile version stored with combat logs */
  version: string;
  damage: { body: number; head: number; legs: number };
  pellets: number;
  rpm: number;
  auto: boolean;
  /** magazine with no attachment, and full (empty-mag) reload time in seconds */
  mag: number;
  reloadS: number;
  /** projectile speed m/s, or null = treated as hitscan (APPROX where unknown) */
  projectileMs: number | null;
  /** APPROX: cone half-angle in degrees for hipfire and ADS (pellet pattern radius for shotguns) */
  spreadDeg: { hip: number; ads: number };
  /** APPROX: per-shot vertical kick (deg, up) and random horizontal kick (deg, +/-), max accumulated kick, and recovery rate (deg/s) while not firing */
  recoil: { up: number; side: number; max: number; recover: number };
  source: string;
}

// VERIFIED: values from the sources named in each profile's `source`; dates are when those sources were checked (2026-10-18)
export const WEAPONS: Record<WeaponId, WeaponProfile> = {
  r99: {
    id: "r99", name: "R-99", cls: "SMG", version: "s30-2026-08-03",
    damage: { body: 12, head: 15, legs: 10 }, pellets: 1, rpm: 1080, auto: true, mag: 18, reloadS: 2.5, projectileMs: 482,
    spreadDeg: { hip: 1.6, ads: 0.25 }, recoil: { up: 0.22, side: 0.18, max: 3.5, recover: 12 },
    source: "Body 12: EA Marked patch notes 2026-08-03. Head/legs, RPM, mag, reload, projectile speed: apexlegends.wiki.gg R-99 SMG (edited 2026-08-05).",
  },
  r301: {
    id: "r301", name: "R-301", cls: "AR", version: "s30-2026-08-03",
    damage: { body: 15, head: 20, legs: 11 }, pellets: 1, rpm: 810, auto: true, mag: 21, reloadS: 3.2, projectileMs: null,
    spreadDeg: { hip: 2.0, ads: 0.15 }, recoil: { up: 0.2, side: 0.12, max: 3.0, recover: 10 },
    source: "apexlegends.wiki.gg R-301 Carbine (edited 2026-08-29; body 15 since the 2026-01-06 patch). Not changed in the 2026-08-03 Marked patch.",
  },
  eva8: {
    id: "eva8", name: "EVA-8", cls: "Shotgun", version: "s30-2026-08-03",
    damage: { body: 7, head: 7, legs: 7 }, pellets: 8, rpm: 168, auto: true, mag: 8, reloadS: 3.0, projectileMs: null,
    spreadDeg: { hip: 3.2, ads: 2.4 }, recoil: { up: 0.6, side: 0.2, max: 3.0, recover: 8 },
    source: "apexlegends.wiki.gg EVA-8 Auto (edited 2026-08-05; 8 pellets x 7 since the 2025-06-30 patch). Not changed in the Marked patch.",
  },
  wingman: {
    id: "wingman", name: "Wingman", cls: "Pistol", version: "s30-2026-08-03",
    damage: { body: 50, head: 75, legs: 45 }, pellets: 1, rpm: 168, auto: false, mag: 5, reloadS: 2.1, projectileMs: null,
    spreadDeg: { hip: 1.4, ads: 0.1 }, recoil: { up: 1.6, side: 0.4, max: 4, recover: 9 },
    source: "apexlegends.wiki.gg Wingman (edited 2026-08-05). Tactical vs full reload not separated on the page; 2.1 s used for both.",
  },
  g7: {
    id: "g7", name: "G7 Scout", cls: "Marksman", version: "s30-2026-08-03",
    damage: { body: 33, head: 48, legs: 25 }, pellets: 1, rpm: 246, auto: false, mag: 10, reloadS: 3.0, projectileMs: null,
    spreadDeg: { hip: 2.4, ads: 0.05 }, recoil: { up: 0.9, side: 0.25, max: 3, recover: 9 },
    source: "Body 33 and base mag 10: EA Marked patch notes 2026-08-03. Head 48, reload: apexlegends.wiki.gg G7 Scout. RPM 246 is the wiki value; the Marked patch reduced fire rate without giving the new value, so RPM is APPROX.",
  },
};

// APPROX: legs = lower 40% of the body column (our hitbox has no separate leg region)
export const LEG_FRACTION = 0.4;
// VERIFIED: purple shield + health = 200 effective HP (same as the 2v1 drill)
export const TARGET_HP = 200;
