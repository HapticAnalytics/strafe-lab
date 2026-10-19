import { describe, expect, it } from "vitest";
import { baselineSessions, fingerprint } from "../src/analysis/fingerprint";
import type { MetricPoint } from "../src/analysis/battery";
import type { SessionLog } from "../src/telemetry/schema";

// Fake battery sessions: metric values are injected, so the rule is tested without replaying drills.
const mk = (id: string, day: number, hour = 10): SessionLog => ({
  schema: 2, id, startedAt: new Date(2026, 0, day, hour).toISOString(), finishedAt: "x", status: "complete",
  settings: { dpi: 800, sens: 1.6, fovScale: 1.4675, display: { aspect: null, scaling: "stretched" } },
  rawInput: true, sampling: "event", protocol: "battery", seedSet: 0, blocks: [],
});
function run(values: Record<string, number[]>, extraDays: number[]) {
  const sessions = [mk("b1", 1), mk("b2", 2), mk("b3", 3), ...extraDays.map((d, i) => mk(`p${i}`, d))];
  const idx = new Map(sessions.map((s, i) => [s.id, i]));
  const metricsOf = (s: SessionLog): MetricPoint[] => Object.entries(values).map(([key, v]) => ({
    key, label: key, unit: "pts", higherIsBetter: key === "skill:pb", value: v[idx.get(s.id)!],
  }));
  return { fp: fingerprint(sessions, metricsOf), sessions };
}

describe("Aim Fingerprint", () => {
  it("not ready (no findings) before 3 baseline days", () => {
    const sessions = [mk("a", 1), mk("b", 2)];
    expect(fingerprint(sessions, () => []).ready).toBe(false);
    expect(baselineSessions([mk("a", 1), mk("b", 1, 15), mk("c", 2), mk("d", 3), mk("e", 4)]).map(s => s.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("a consistent left/right asymmetry larger than the noise floor is a finding", () => {
    // baseline asym 10, 11, 9 (SD 1 -> SDC95 2.77); every session is over the floor
    const { fp } = run({ "contrast:asym": [10, 11, 9, 10, 12] }, [4, 5]);
    expect(fp.findings.length).toBe(1);
    const f = fp.findings[0];
    expect(f.title).toMatch(/leftward/);
    expect(f.severity).toBeGreaterThan(3);
    expect(f.evidence.filter(e => e.over).length).toBe(5);
    expect(f.confidence).toBe("high");
  });
  it("ACCEPTANCE: a contrast over the floor in only ONE session is not a finding", () => {
    // noisy baseline (SD ~5 -> SDC95 ~14); only one session exceeds 14
    const { fp } = run({ "contrast:asym": [0, 5, 10, 20, 3] }, [4, 5]);
    expect(fp.findings.filter(f => f.key === "contrast:asym").length).toBe(0);
  });
  it("ACCEPTANCE: exactly two sessions over the floor is enough", () => {
    const { fp } = run({ "contrast:asym": [0, 5, 10, 20, 21] }, [4, 5]);
    expect(fp.findings.filter(f => f.key === "contrast:asym").length).toBe(1);
  });
  it("regression: a metric worse than baseline by > SDC95 in 2 post-baseline sessions", () => {
    // baseline 60, 62, 61 (SD 1); later 55 and 54 are > 2.77 below the mean
    const { fp } = run({ "skill:pb": [60, 62, 61, 55, 54] }, [4, 5]);
    expect(fp.findings.map(f => f.kind)).toEqual(["regression"]);
    expect(fp.findings[0].evidence.map(e => e.sessionId)).toEqual(["p0", "p1"]);
    // one bad day is not enough
    expect(run({ "skill:pb": [60, 62, 61, 55, 61] }, [4, 5]).fp.findings.length).toBe(0);
  });
  it("every finding's evidence points at stored sessions", () => {
    const { fp, sessions } = run({ "contrast:trail": [12, 14, 13, 15, 16], "contrast:vh": [0.1, -0.1, 0, 0.05, 0] }, [4, 5]);
    const ids = new Set(sessions.map(s => s.id));
    for (const f of fp.findings) for (const e of f.evidence) expect(ids.has(e.sessionId)).toBe(true);
    expect(fp.findings.map(f => f.key)).toEqual(["contrast:trail"]);
  });
});
