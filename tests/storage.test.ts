import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { exportAll, getSettings, importAll, listSessions, makeDb, parseExport, saveSession, saveSettings } from "../src/storage/db";
import { sessionProblem, type FrameDrillLog } from "../src/telemetry/schema";
import { synthSession } from "./helpers";

let n = 0;
let name = "";
beforeEach(() => { name = `test-db-${n++}`; });

describe("storage", () => {
  it("a saved session survives a 'reload' (close and reopen the database)", async () => {
    const s = synthSession();
    const a = makeDb(name);
    await saveSession(a, s);
    await saveSettings(a, s.settings);
    a.close();
    const b = makeDb(name);
    expect(await listSessions(b)).toEqual([s]);
    expect(await getSettings(b)).toEqual(s.settings);
  });

  it("export -> wipe -> import round-trips the data exactly", async () => {
    const db = makeDb(name);
    const a = synthSession("a"), b = { ...synthSession("b"), startedAt: "2026-02-01T00:00:00.000Z", status: "abandoned" as const, finishedAt: null };
    await saveSession(db, a);
    await saveSession(db, b);
    const before = await listSessions(db);
    const text = JSON.stringify(await exportAll(db));
    await db.sessions.clear();
    expect(await listSessions(db)).toEqual([]);
    expect(await importAll(db, text)).toBe(2);
    expect(await listSessions(db)).toEqual(before);
    // and the second export is byte-identical apart from the timestamp
    const again = await exportAll(db, new Date(JSON.parse(text).exportedAt));
    expect(JSON.stringify(again)).toBe(text);
  });

  it("importing twice does not duplicate sessions", async () => {
    const db = makeDb(name);
    await saveSession(db, synthSession());
    const text = JSON.stringify(await exportAll(db));
    await importAll(db, text);
    await importAll(db, text);
    expect((await listSessions(db)).length).toBe(1);
  });

  it("rejects bad files without writing anything", async () => {
    const db = makeDb(name);
    const good = synthSession("good");
    const bad = { ...synthSession("bad"), blocks: [{ cm360: "x", drills: {} }] };
    const file = JSON.stringify({ format: "strafe-lab-export", schema: 1, exportedAt: "x", sessions: [good, bad] });
    await expect(importAll(db, file)).rejects.toThrow(/Session 2/);
    expect(await listSessions(db)).toEqual([]);
    expect(() => parseExport("not json")).toThrow(/valid JSON/);
    expect(() => parseExport(JSON.stringify({ format: "other" }))).toThrow(/Not a Strafe Lab/);
    expect(() => parseExport(JSON.stringify({ format: "strafe-lab-export", schema: 99, sessions: [] }))).toThrow(/schema 99/);
  });

  it("sessionProblem accepts a valid session and rejects broken frames", () => {
    expect(sessionProblem(synthSession())).toBeNull();
    const s = synthSession();
    ((s.blocks[0].drills.pb as FrameDrillLog).frames[0] as unknown as { t: string }).t = "0";
    expect(sessionProblem(s)).toBe("bad frame");
  });
});
