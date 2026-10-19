# Strafe Lab — standing rules for Claude Code

Read ROADMAP.md before any work. Work one milestone at a time and keep the app runnable at the end of every session.

## Non-negotiables
- Measurement correctness before features. Never ship a metric without a unit or golden-file test.
- Simulation is a pure function of (time, seed). Rendering reads sim state and never changes it.
- Metrics are computed from the timestamped input event log, never from rendered frames. They must give the same result at 60/144/240 fps.
- Every constant in `sim/` and `analysis/` carries a comment tag: `// VERIFIED: <source>`, `// APPROX: <why>`, or `// HYPOTHESIS: <how we'll test it>`.
- Deterministic code computes all numbers. The AI coach only interprets and plans, and every number it cites must exist in stored data.
- The app must work with the AI turned off. Never put an API key in client code.
- Don't invent statistics, benchmarks or research findings. If evidence is missing, say so and propose an experiment.
- No features that touch the live game: no overlays, memory reading, or input injection.

## Reference implementation
`strafe-lab-v2.html` is the working V2 prototype. Verified constants:
- Yaw 0.022°/count.
- FOV: the real config value is `cl_fovScale`; 4:3 horizontal FOV = 70 × cl_fovScale and is NOT capped at the slider max of 110. Slider V is just cl_fovScale = 1+(V−70)·0.01375.
- Display: the drills must match the player’s real view, so settings carry cl_fovScale, game aspect (native, 4:3, 5:4, 16:10, 16:9) and scaling (stretched to fill the monitor, or black bars). Display never changes sens math or any metric (all angular).
- Movement: walk 5.07, sprint 7.59, crouch-walk 2.34 m/s; −13% holding a weapon.
- R-99: 11/17 damage, 1080 RPM.

Known V2 limitations to fix in v3: per-frame sampling and hit tests, single seed per drill, no uncertainty interval, hipfire only.

## Workflow
- Small commits with clear messages. Run tests before every commit.
- When a decision affects measurement or architecture, explain it to the user in plain language before implementing.
