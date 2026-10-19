# Strafe Lab — Architecture & Roadmap (v3 plan)

Status: V2 prototype works (single HTML file, three.js, blind tracking sens finder, AI coach via Claude artifact runtime).
Live build: https://hapticanalytics.github.io/strafe-lab/ (auto-deployed from `master` after typecheck, unit and e2e tests pass).

## Milestone status

### Runs needed from you (gaming PC)
1. **Calibration** (Milestone 1): open https://hapticanalytics.github.io/strafe-lab/ in Chrome or Edge, click *Open calibration*, and run each test 3 times: ruler DPI (10 cm), physical 360° (marks taken from the Apex Firing Range at your current sens), input timing (5 s of circles).
2. **ADS per optic** (Milestone 2b): in *Calibration → ADS per optic*, run the ADS 360° test once per optic you use (marks from the Firing Range while ADS with that optic). Enter your ADS multiplier and current scalars first.
3. **Baseline** (Milestone 3): on 3 separate days, *Open baseline → Run today's battery*, and do the Firing Range protocol shown there (plus your aim-trainer benchmark if you use one). Enter the results.
4. **Sens finder test-retest** (Milestone 2): run the sens finder in **Standard** mode on two different days.
5. After each batch: *Export JSON* and send me the file.

| Milestone | Status | Notes |
|---|---|---|
| 0 Foundation | Done | All acceptance checks pass (unit + Playwright e2e). Added `cl_fovScale` + aspect/scaling display. React deferred to Milestone 5 (dashboard). |
| 1 Input & telemetry | Built; 2 of 3 acceptance checks pass | Same synthetic trace gives identical logs and metrics at 60/144/240 fps (exact, not just within 0.5%): PASS. Golden files lock every M1 metric: PASS. 360° calibration error < 1%: **needs a run on the gaming PC** (see "Runs needed from you"). |
| 2 Sens Intelligence v3 | Built; simulation acceptance conditional | Simulated player recovered within ±8% in Standard: 95% of runs at block noise σ=2 points (PASS), 83% at σ=3, 66% at σ=5 (locked table in `tests/__snapshots__/sensfinder.test.ts.snap`). Your real σ comes from Milestone 3; if it is above ~2.5 points, Standard needs more or longer blocks. Two-day test-retest: **needs runs from you**. Durations re-set from measured reliability: pending Milestone 3 data. |
| 2b ADS | Built; acceptance PASS (math) | Per-optic conversion maths unit-tested: zoom factor from measured counts/360, 360° match, monitor-distance match (definition; 0% = tangent ratio). Apex zoom scaling is unverified publicly, so the tool measures it per optic (ADS 360° test). Optic FOVs for MDM and scalar index order are APPROX/HYPOTHESIS and labelled in the UI. **Needs runs from you** to produce your scalars. |
| 3 Baseline protocol | Built; acceptance needs your data | Fixed held-out battery (4 rotating seed sets, ~2.5 min), Firing Range / R5 / aim-trainer entry, noise floor per metric (day SD, chi-square CI, SDC95). "Baseline variance known for every tracked metric" needs **3 battery days from you**. Single subject: ICC is not computable, so we use day-to-day SD and SDC (RESEARCH.md §4). |
| 4 Replay | Done; both acceptance checks PASS | Replay re-runs the evaluator on the event log: metrics from a replay equal the stored analysis exactly (unit test). Flagged reversals, losses, overshoots, kills and timeouts jump the replay in one click (e2e). Slow motion 0.1–1×, crosshair and target trails, synced timelines. Metric change found via replay: losses now need ≥30 ms off target (edge flicker excluded); golden files updated on purpose. |
| 5 Fingerprint + dashboard | Done; both acceptance checks PASS (rules), real findings need baseline data | Findings are within-person contrasts (left/right, trailing/leading, vertical/horizontal) and regressions vs your own baseline, with severity in noise-floor units (÷ SDC95), confidence, trend, hypothesised explanations and interventions. Unit tests: a finding needs ≥2 sessions over the floor; one is not enough. Every dashboard number carries source ids, and a test checks they all exist in storage. Dashboard in React (sens history, fingerprint, skill trends with SDC band, records, export). |
| R Research | Done (living doc) | `RESEARCH.md`. Tag lint test enforces tags in `sim/` and `analysis/`. ADS scaling is community-only → APPROX until the user's per-optic calibration. |
Goal: a personal aim-development lab for Apex Legends MnK that measures correctly first, then coaches, then trains, and proves whether training transfers to real Apex.

Guiding rules for every milestone:
1. Measurement correctness before features. No metric ships without a test that proves it.
2. Deterministic code does the math. AI only interprets, plans and proposes experiments.
3. Every claim is labeled **Verified**, **Approximation**, or **Hypothesis**.
4. The app always works with the AI turned off.
5. A working build exists at the end of every milestone.

---

## 1. Decisions

### 1.1 Claude Code vs chat
**Build in Claude Code (desktop app, Code tab) on the gaming PC.** Use chat for planning, research and reviews.

Why:
- It works in a real project folder with git, runs the app and its tests, and keeps a `CLAUDE.md` with standing rules for every session.
- It runs on the same Windows machine, mouse and GPU the tool is measuring.
- The chat artifact sandbox can't host a multi-file app, a test suite, a database or a backend.

Migration:
1. Install the Claude desktop app on the PC (Code tab).
2. Create a `strafe-lab` folder with `strafe-lab-v2.html`, `ROADMAP.md` and `CLAUDE.md`.
3. Run `git init`.
4. Start Milestone 0. V2 stays as the reference implementation until v3 passes the same checks.

### 1.2 Models (pricing from platform.claude.com, Oct 2026)

**Available models**

| Model | API price in / out per M tokens | Use it for |
|---|---|---|
| Opus 5.5 | $4 / $20 | Default for building: architecture, complex code, statistics, debugging |
| Sonnet 5.5 | $2 / $10 | Fast routine edits and UI work; the default in-app coach model |
| Haiku 5.5 | from $0.10 / $0.50 | Cheap high-volume tasks: labeling sessions, short summaries |
| Fable 5.1 | $10 / $50 | Reserve for the hardest design reviews, e.g. the statistics of the sens finder, if Opus falls short |

**Building in Claude Code (subscription).**
- Cost is usage limits, not dollars.
- Opus 5.5 is the default.
- Switch to Sonnet 5.5 for quick UI tweaks.

**In-app coach (API, if productized).**

Estimated cost per report, assuming about 15K tokens in and 2K out:

| Model | Input cost | Output cost | Total per report |
|---|---|---|---|
| Sonnet 5.5 | $0.03 | $0.02 | about $0.05 |
| Opus 5.5 | $0.06 | $0.04 | about $0.10 |

- Use Sonnet 5.5 for daily reports.
- Use Opus 5.5 for weekly reviews and experiment design.

**Never use an LLM to compute metrics.**

### 1.3 Stack
**A TypeScript web app, structured so a desktop shell can be added later.**

**Core stack**
- **Build and language:** Vite + TypeScript.
- **Rendering:** three.js, WebGL.
- **Dashboard and analytics UI:** React.
- **Tests:** Vitest (unit), Playwright (end-to-end).
- **Storage:** IndexedDB via Dexie, local-first, with a versioned schema plus JSON/CSV export.

**Input**
- Pointer Lock with `unadjustedMovement: true` for raw deltas.
- `pointerrawupdate` + `getCoalescedEvents()` to read every intermediate mouse event with its timestamp instead of one merged event per frame.
- Chrome aligns `mousemove` to animation frames, which is why V2's per-frame sampling loses detail.

**Simulation decoupled from rendering (the key fix over V2)**
- Target position is a pure function of time and seed.
- Crosshair angle is integrated per input event.
- Metrics are computed from the event stream, not from rendered frames.
- Result: the same input gives the same metrics at 60, 144 or 240 Hz.

**Desktop shell later (Electron or Tauri)**
- Electron is Chromium, where `unadjustedMovement` is documented.
- Tauri uses WebView2 on Windows (also Chromium-based), but raw-input behavior there is **unverified**. Test before choosing.

**Native-engine fallback**
- Godot or Unity with the Windows Raw Input API.
- Only if browser input fails the Milestone 1 validation tests.
- Native means better input latency, but a slower dashboard and AI build. Not worth it unless measurement fails.

**AI**
- Personal use: user-supplied API key stored locally, or keep the Claude-artifact coach.
- Commercial: small backend proxy (auth, per-user rate limits, cost caps). Never ship an API key in the client.

### 1.4 Research status

**Verified** (source in brief / Milestone R):
- Yaw: 0.022°/count. Sens 1.636364 gives 10,000 counts per 360°.
- FOV: slider V gives a 4:3 horizontal FOV of 70·(1+(V−70)·0.01375).
- Movement:
  - Walk 5.07 m/s, sprint 7.59 m/s, crouch-walk 2.34 m/s.
  - −13% while holding a weapon.
- R-99: 11 / 17 damage, 1080 RPM.
- Raw input: `unadjustedMovement` is supported in Chromium. Firefox support was reported recently.
- Input timing: Chrome dispatches `mousemove` aligned to frames. `getCoalescedEvents()` recovers the intermediate events.
- `pointerrawupdate` delivers events as often as the browser produces them, but is not more precise per event. It is secure-context only. Per-browser support needs checking against the MDN compatibility table.

**Approximation:**
- Jump arc, slide decay and strafe acceleration.
- Hitbox dimensions (vary by legend).
- ADS movement speed.
- Recoil patterns.

**Hypothesis (needs our own data):**
- Familiarity bias size.
- How many blocks give a stable sens estimate.
- Whether trainer gains transfer to Apex.
- Score weights.
- Metric thresholds.
- Optimal practice dosage.

**Still to research (Milestone R):**
- ADS sensitivity scaling (`mouse_zoomed_sensitivity_scalar_*` per optic), monitor-distance-match conventions.
- Apex hitbox data.
- Motor learning literature: variable vs blocked practice, retention, transfer, feedback frequency, speed-accuracy tradeoff.
- Test-retest reliability methods.

---

## 2. Architecture

```
src/
  core/        units.ts (sens, cm/360, FOV math), rng.ts, time.ts      — pure, 100% unit-tested
  input/       pointer lock, raw event capture, calibration            — no rendering imports
  sim/         target motion (pure f(t, seed)), scenarios, hit geometry — pure, deterministic
  telemetry/   event log schema, recorder, integrity checks
  analysis/    metrics, curve fitting, bootstrap, fingerprint           — pure, unit-tested
  coach/       prompt builders, response validation, cost control       — optional at runtime
  storage/     Dexie schema + migrations, export/import, backup
  render/      three.js scene, HUD                                      — reads sim state, never writes it
  ui/          React: setup, results, replay, dashboard
tests/         unit, golden-file (recorded sessions → expected metrics), e2e
```

**Data flow:** input events → crosshair state → telemetry log. Sim state comes from (t, seed) → telemetry log. The analysis module reads only the log. That lets you re-run analysis on old sessions when a metric improves.

---

## 3. Roadmap

Order follows dependencies. Every module from the brief is included. Deferred modules have prerequisites listed.

### Milestone 0 — Foundation (Module 13 core)
- Repo, Vite + TS, folder structure above, CLAUDE.md rules.
- Port V2 math into `core/` with unit tests.
- Port the V2 drill into the new structure as-is.
- Versioned telemetry schema v1. Local storage, JSON export.
- Display settings that match the real Apex view: exact `cl_fovScale` (4:3 FOV = 70 × cl_fovScale, uncapped), game aspect incl. 4:3, and stretched vs black-bar scaling. Sens math unchanged.

**Acceptance:**
- Unit tests pass for all conversions, e.g. 800 DPI × 1.6 = 32.47 cm/360, and FOV 110 → 108.5° (4:3) → 123.3° (16:9).
- The V2 drill runs in the new app.
- cl_fovScale 1.9 -> 133° at 4:3 (no cap); 4:3 stretched and black-bar modes render the same angular geometry.
- A session survives a page reload.
- Export → import round-trips the data exactly.

### Milestone R — Research pass (runs alongside M0–M1, in chat)
Deliverable: `RESEARCH.md`. Every parameter used in sim/analysis gets a status tag and a source.

**Acceptance:**
- No untagged constants left in `sim/` or `analysis/`.

### Milestone 1 — Input correctness and telemetry (Module 2 + calibration)
**Event-driven capture**
- Raw deltas with event timestamps.
- Crosshair integrated per event; hit testing analytic per event, using target geometry at the event time.

**Calibration tests**
- 360° check: swipe until the crosshair returns to a marker; compare counts against expected.
- DPI sanity check: move a measured 10 cm with a ruler.
- Polling-rate estimate from event intervals.
- Dropped-event and timing diagnostics.

**Synthetic input harness**
- Scripted mouse traces drive the full pipeline without a human.

**Metrics, all time-weighted**
- Time on target; angular error (horizontal and vertical, normalized by target angular size).
- Overshoot and undershoot; trailing and leading.
- Jitter (defined in deg, high-pass); correction count and amplitude.
- Mouse velocity and acceleration.
- Reversal response latency; reacquisition time; stabilization time.
- Switch time; performance vs angular velocity bins.
- Left/right asymmetry; within-session consistency; drift over time.

**Acceptance:**
- The same synthetic trace yields identical metrics (within 0.5%) when run at 60, 144 and 240 fps.
- Calibration error is under 1% on the 360° test.
- Golden-file tests lock every metric.

### Milestone 2 — Sensitivity Intelligence v3 (Module 1, hipfire)
**Modes**
- Quick, Standard and Deep. Target durations are 3–4, 6–8 and 12–15 minutes.

**Design**
- Wide log sweep, then adaptive zoom.
- Repeated candidates; counterbalanced order (Latin-square style).
- Multiple seeds per scenario; acclimation per block.

**Skills covered**
- Close reactive tracking; mid sustained tracking; target switching.
- Vertical tracking; fast 180° turns; dynamic clicking; shotgun-style flick + correct.
- Long-range precision as a minor weight.

**Statistics**
- Per-skill fits.
- Bootstrap confidence interval on the peak.
- Explicit "no clear winner" output when the CI spans most of the range.
- Learning and fatigue terms estimated from repeated candidates.

**Outputs**
- Recommended range, a single setting only if justified, in-game values, per-skill breakdown.

**Acceptance:**
- In simulation, a synthetic player with a known best sens is recovered within ±8% in Standard mode in 90% of runs.
- Real test-retest across two days: peaks within the reported CI.
- Mode durations are re-set based on measured reliability, not assumed.

### Milestone 2b — ADS (Module 1, continued)
- Depends on Milestone R (ADS scaling research).
- ADS multiplier test per optic class.

**Acceptance:**
- Per-optic conversion math unit-tested against verified formulas.

### Milestone 3 — Baseline and validation protocol (Module 10, started early on purpose)
Before any training, capture:
- A Strafe Lab standard battery on 3 separate days.
- A Firing Range protocol: fixed dummy/strafe settings and a recorded video procedure.
- An optional R5 Reloaded protocol.
- An aim-trainer benchmark of the user's choice.

**Acceptance:**
- Baseline variance known for every tracked metric. This is the noise floor every later "improvement" must beat.

### Milestone 4 — Replay and visualization (Module 8)
- Replay from telemetry (deterministic sim + logged input).
- Slow motion; crosshair and target trails.
- Synchronized error, velocity and on-target timelines.
- Auto-flagged events: reversals, losses, overshoots.

**Acceptance:**
- A replay reproduces logged metrics exactly.
- Any flagged event is reachable in one click.

### Milestone 5 — Aim Fingerprint and dashboard v1 (Modules 3 + 11)
- Persistent profile across sessions.
- Each weakness shows: evidence, severity vs the user's own baseline (in noise-floor units), confidence, possible explanations, interventions and trend.
- No population percentiles until real benchmark data exists.
- Dashboard: sens history, fingerprint, category trends, records, export.

**Acceptance:**
- A finding appears only when it exceeds the baseline noise floor in at least two sessions.
- All dashboard numbers trace to stored sessions.

### Milestone 6 — Adaptive AI coach (Module 4) + experiment framework (Module 12)
**Coach**
- Input: deterministic metrics, fingerprint and session history only. Output: a JSON schema-validated plan.
- Daily plans, weekly reviews and longer-term plans.
- Retry/fallback logic, plus a hard cost cap per day.

**Experiment framework**
- Coach proposes A/B practice experiments (e.g. variable vs blocked practice), each with a pre-registered success metric.
- The deterministic layer evaluates them; the coach updates its recommendations.

**Rule**
- Limit sens changes to evaluation windows. No switching during training blocks.

**Acceptance:**
- Every coach claim cites a stored metric, checked by a validator that rejects uncited numbers.
- The app works fully with the coach disabled.

### Milestone 7 — Nemesis Engine (Module 5)
- Parameterized scenario generator: distance, angular velocity, acceleration, strafe timing, unpredictability, crouch/jump/slide, size, multiple targets.
- Difficulty adapts to a target success band.
- Fresh seeds each run (no memorizing).
- Held-out validation scenarios that are never trained.

**Acceptance:**
- Improvement on held-out scenarios is reported separately from trained ones.

### Milestone 8 — Combat simulation (Module 6)
- Pure mouse-control tests stay separate from weapon simulations.
- Weapon profiles: fire rate, damage, magazine and reload (verified).
- Recoil and spread (approximation, clearly labeled).
- Hipfire vs ADS.
- Scenarios: SMG, AR, shotgun, Wingman-style, marksman; multiple targets; distance changes.

**Acceptance:**
- Every weapon constant tagged and sourced.
- Mechanical scores are unaffected by weapon mode.

### Milestone 9 — Movement and aim coordination (Module 7)
- WASD player movement with Apex speeds.
- Conditions: stationary, mirrored strafe, counter-strafe, independent movement, direction changes.
- Factorial comparison to separate mouse vs movement vs interaction effects.

**Acceptance:**
- Reports the effect size of movement on tracking with a CI.

### Milestone 10 — Gameplay video review (Module 9) — research spike first
**Reliable from video**
- Crosshair placement relative to visible enemies (after detection), time on target, approximate switch timing.

**Not reliable from video**
- Exact input timing, mouse movement, sensitivity, recoil control vs. aim.

**Approach**
- Offline analysis of user-recorded clips. A local detection model is needed; an extra install will be required.

**Compliance**
- No live overlays, no game memory, no injected input.
- Logging input alongside Apex is **unverified** against Easy Anti-Cheat policy. Deferred until checked.

**Acceptance:**
- Accuracy of detection measured against hand-labeled frames before any metric is shown.

### Milestone 11 — Product (Module 14 + Module 13 remainder)
- Premium UI pass and onboarding.
- Crash recovery; backups; schema migrations.
- Accounts, a backend AI proxy with per-user cost limits, and distribution (web vs desktop shell).
- Naming and legal: avoid "Apex Legends" in the product name.

---

## 4. Testing strategy
- **Unit tests:** all math, metrics and statistics (pure functions).
- **Golden files:** recorded or synthetic telemetry → expected metrics. Any change in output must be deliberate.
- **Simulation tests:** synthetic players with known traits (lag, jitter, best sens) must be detected by the analysis.
- **Frame-rate invariance tests:** same input at 60/144/240 fps.
- **Calibration tests run by the user:** 360° and ruler tests on real hardware.
- **Test-retest studies on the user:** the real reliability check.
- **AI validator:** schema check, plus a citation check against stored metrics.

## 5. Challenges to the brief
- **Scope:** 14 modules is a large product. The order above front-loads what makes everything else trustworthy. Expect the early milestones to feel slow.
- **"Elite" is not something a tool can promise.** The tool can measure, target and verify practice. Milestone 3 and Module 10 are how we'll know if it's working.
- **Practice time vs build time:** building the lab can eat the hours meant for practice. Lock in a practice routine with V2 now, while v3 is built.
- **Fixed mode durations** in the brief are targets, not facts. Reliability data decides them.
