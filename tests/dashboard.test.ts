import { describe, expect, it } from "vitest";
import { buildDashboard, citedIds } from "../src/analysis/dashboard";
import type { ExternalResult } from "../src/telemetry/schema";
import { synthSession, synthSessionV2, synthSessionV3 } from "./helpers";

describe("Milestone 5 acceptance: all dashboard numbers trace to stored records", () => {
  it("every cited id exists in the store", () => {
    const v1 = synthSession("c1"); v1.blocks = [...v1.blocks, { ...v1.blocks[0], index: 2, cm360: 45 }];
    const sessions = [v1, synthSessionV2("c2"), synthSessionV3("v3a")];
    const ext: ExternalResult[] = [
      { id: "e1", at: new Date(2026, 0, 1).toISOString(), kind: "firing-range", measure: "R-99 60 s strafe damage", value: 3000, unit: "dmg", higherIsBetter: true, notes: "" },
      { id: "e2", at: new Date(2026, 0, 2).toISOString(), kind: "firing-range", measure: "R-99 60 s strafe damage", value: 3200, unit: "dmg", higherIsBetter: true, notes: "" },
    ];
    const d = buildDashboard(sessions, ext);
    const stored = new Set([...sessions.map(s => s.id), ...ext.map(e => e.id)]);
    for (const id of citedIds(d)) expect(stored.has(id)).toBe(true);
    expect(d.sens.map(p => p.sessionId).sort()).toEqual(["c1", "c2", "v3a"]);
    expect(d.records.find(r => r.key.startsWith("ext:"))!.best).toEqual({ value: 3200, sources: ["e2"] });
    expect(d.fingerprintReady).toBe(false);
  }, 120_000);
});
