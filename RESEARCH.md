# Strafe Lab — Research notes (Milestone R)

Every number the app uses is one of:

- **VERIFIED**: from a primary or authoritative source, linked below.
- **APPROX**: a reasonable engineering choice or community estimate. Says why.
- **HYPOTHESIS**: a guess we intend to test. Says how.

The rule is enforced by `tests/tags.test.ts`: any module-level numeric constant in `src/sim/` or `src/analysis/` without a tag in its comment fails the build.

If evidence is missing, this file says so. It never fills the gap with a made-up number.

---

## 1. Apex Legends facts

| Parameter | Value | Status | Source / note |
|---|---|---|---|
| Yaw per count at sens 1.0 | 0.022° | VERIFIED | Project brief (Source-engine convention; sens 1.636364 = 10,000 counts/360). Re-checked by the user's 360° calibration (Milestone 1). |
| FOV | 4:3 hFOV = 70 × `cl_fovScale`; slider V → scale 1 + (V−70)·0.01375 | VERIFIED | Project brief; `cl_fovScale` lives in `profile.cfg` ([mouse-sensitivity.com thread](https://www.mouse-sensitivity.com/forums/topic/7549-apex-scalars-settingscfg/), community). Not capped at slider max 110 (=1.55). |
| Hor+ FOV at other aspects | vertical FOV fixed from the 4:3 value | APPROX | Standard Source-engine behaviour; not independently confirmed for Apex. Test: user screenshots at 16:9 vs 4:3 (Milestone 1 calibration). |
| Walk / sprint / crouch-walk | 5.07 / 7.59 / 2.34 m/s | VERIFIED | apexlegends.wiki.gg (project brief) |
| Weapon slowdown | −13 % | VERIFIED | apexlegends.wiki.gg (project brief) |
| R-99 | 11 body / 17 head, 1080 RPM | VERIFIED | Liquipedia (project brief) |
| Purple shield + health | 200 HP | VERIFIED | Game rule: 100 health + 100 purple shield |
| Jump arc, slide decay, strafe acceleration | V2 hand-tuned values | APPROX | No public measurement found. Test: frame-step video of Firing Range dummies (Milestone 9). |
| Hitbox dimensions | cylinder r 0.3 m, ~1.8 m tall, head sphere r 0.17 m | APPROX | Respawn publishes no hitbox data. Community measurements are relative areas only (e.g. Wraith ~33 vs Gibraltar ~79 "sq cm" in screen space, [Dot Esports](https://dotesports.com/apex-legends/news/apex-legends-has-some-drastically-different-hitbox-sizes), [ProGameGuides](https://progameguides.com/apex-legends/all-apex-legends-character-hitbox-sizes/)), dated and patch-dependent. |
| ADS sensitivity scaling | default scales with optic zoom; per-optic `mouse_zoomed_sensitivity_scalar_0..N` exist in `settings.cfg` with `mouse_use_per_scope_sensitivity_scalars "1"` | APPROX | Community only. Reported optic FOV scale factors disagree: [edpi-calculator](https://edpi-calculator.org/tools/apex-ads-sensitivity) lists 1x 1.00, 2x 0.90, 3x 0.75, 4x 0.55, 6x 0.40, 8x 0.30, 10x 0.20; a [Steam thread](https://steamcommunity.com/app/1172470/discussions/0/3129415222161819298) gives different values; one 2019 thread claims 0 % monitor-distance (tan ratio) scaling. **Not verified.** Milestone 2b ships these as APPROX and asks the user for a Firing Range counts-per-360 measurement per optic, which turns them into VERIFIED for this user's game version. |
| Recoil patterns, ADS move speed | — | APPROX / not used | Not modelled until Milestone 8. Clearly labelled there. |

## 2. Browser input

| Fact | Status | Source |
|---|---|---|
| `requestPointerLock({ unadjustedMovement: true })` disables OS acceleration. Chromium-only as of the source date. Rejects with `NotSupportedError` where unsupported. The promise return isn't standard everywhere. | VERIFIED | [web.dev](https://web.dev/articles/disable-mouse-acceleration), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestPointerLock) |
| `pointerrawupdate`: Chrome 77+, Edge 79+, Firefox 148+ (partial 140–147), no Safari. Secure context only. Firefox 148+ sets movementX/Y on it. | VERIFIED | [MDN](https://developer.mozilla.org/docs/Web/API/Element/pointerrawupdate_event), [caniuse](https://caniuse.com/mdn-api_element_pointerrawupdate_event) |
| `getCoalescedEvents()` returns the PointerEvents merged into one `pointermove`/`pointerrawupdate`. Secure context. | VERIFIED | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents) |
| Coalesced events carry their own `timeStamp` and `movementX/Y` under pointer lock | **Unverified** | MDN does not say. Milestone 1 checks this at runtime with an **integrity check**: the sum of coalesced deltas must equal the sum of parent deltas, or capture falls back to parent events and the session is flagged. |
| Chrome aligns `mousemove` to animation frames | VERIFIED | Project brief, Milestone R list |
| Tauri/WebView2 raw-input behaviour | **Unverified** | Deferred to Milestone 11. Test before choosing a shell. |

## 3. Motor learning (used by the coach and experiment framework)

| Finding | Status | Source |
|---|---|---|
| Contextual interference: random practice gives worse practice-phase performance but better retention and transfer than blocked practice (lab tasks) | VERIFIED (as a finding in the literature) | Shea & Morgan 1979, *J. Exp. Psychol.: Human Learning and Memory* ([PDF](https://www.gwern.net/doc/psychology/spaced-repetition/1979-shea.pdf)). Reviews call it robust: Lee & Magill 1983, Goode & Magill 1986. |
| The effect does not always replicate in applied sport settings | VERIFIED (mixed evidence) | e.g. field hockey null result cited in [Brunel review](https://bura.brunel.ac.uk/bitstream/2438/13898/4/FullText.pdf) |
| CI benefits transfer to **mouse aiming in Apex** | HYPOTHESIS | No direct evidence. Milestone 6 runs it as a pre-registered within-user experiment (variable vs blocked) with held-out scenarios. |
| Feedback frequency, speed–accuracy trade-off, practice dosage | Not yet researched with sources | Labelled HYPOTHESIS wherever used. No thresholds are taken from them. |

## 4. Reliability methods (Milestone 3)

| Method | Status | Source |
|---|---|---|
| Test-retest reliability via ICC. Report the form (we use ICC(2,1): two-way random, absolute agreement, single measurement) and a 95 % CI. Bands: <0.5 poor, 0.5–0.75 moderate, 0.75–0.9 good, >0.9 excellent, judged on the CI. | VERIFIED | Koo & Li 2016, *J. Chiropr. Med.* 15(2):155–163 ([PMC4913118](https://pmc.ncbi.nlm.nih.gov/articles/PMC4913118/)) |
| Standard error of measurement SEM = SD·√(1−ICC); smallest detectable change SDC95 = 1.96·√2·SEM | VERIFIED (standard psychometrics) | Classical test theory. Used as the "noise floor" that any improvement must beat. |
| Koo & Li recommend ≥30 heterogeneous subjects | VERIFIED | Same source. **Single-user caveat:** we have one subject, so between-subject ICC is undefined. We use within-subject day-to-day SD and SDC instead and say so in the UI. |

## 5. Constants by module

The constant-by-constant list lives in the code next to each value (`src/sim/constants.ts`, `src/sim/drills.ts`, `src/sim/plan.ts`, `src/analysis/constants.ts`, and later modules). Each carries its tag and reason. `tests/tags.test.ts` keeps it complete.

## 6. Open questions → experiments

1. **ADS scaling for this user's game version.** In the Firing Range, count mouse counts per 360° hipfire and with each optic. Strafe Lab's calibration screen tells you how (Milestone 2b).
2. **Coalesced-event timestamps.** Run the Milestone 1 input diagnostics on the gaming PC. Report the polling-rate estimate and the integrity check.
3. **Familiarity bias.** Repeated candidate sens values within Milestone 2 sessions. The current-sens advantage is estimated, not assumed.
4. **How many blocks give a stable sens estimate.** Simulated players (Milestone 2), then real test-retest across two days.
5. **Transfer to Apex.** Milestone 3 baseline (Firing Range protocol) before training, then the same protocol after.
