import Dexie, { type Table } from "dexie";
import { EXPORT_FORMAT, EXPORT_VERSION, sessionProblem, type CalibrationRecord, type ExportFile, type ExternalResult, type Settings, type SessionLog } from "../telemetry/schema";

interface MetaRow { key: string; value: unknown }

/** Local-first store. DB version here is the IndexedDB layout version, separate from the telemetry schema. */
export class LabDB extends Dexie {
  sessions!: Table<SessionLog, string>;
  meta!: Table<MetaRow, string>;
  calibrations!: Table<CalibrationRecord, string>;
  external!: Table<ExternalResult, string>;

  constructor(name = "strafe-lab") {
    super(name);
    this.version(1).stores({ sessions: "id, startedAt, status", meta: "key" });
    // v2: calibration records (Milestone 1). Additive, so no data migration needed.
    this.version(2).stores({ sessions: "id, startedAt, status", meta: "key", calibrations: "id, at, kind" });
    // v3: external results (Milestone 3). Additive.
    this.version(3).stores({ sessions: "id, startedAt, status", meta: "key", calibrations: "id, at, kind", external: "id, at, kind" });
  }
}

export const makeDb = (name?: string): LabDB => new LabDB(name);

export async function saveSession(db: LabDB, s: SessionLog): Promise<void> {
  await db.sessions.put(s);
}

export async function listSessions(db: LabDB): Promise<SessionLog[]> {
  return db.sessions.orderBy("startedAt").toArray();
}

export async function getSettings(db: LabDB): Promise<Settings | null> {
  return ((await db.meta.get("settings"))?.value as Settings | undefined) ?? null;
}

export async function saveSettings(db: LabDB, s: Settings): Promise<void> {
  await db.meta.put({ key: "settings", value: s });
}

export async function saveCalibration(db: LabDB, c: CalibrationRecord): Promise<void> {
  await db.calibrations.put(c);
}

export async function listCalibrations(db: LabDB): Promise<CalibrationRecord[]> {
  return db.calibrations.orderBy("at").toArray();
}

export async function saveExternal(db: LabDB, r: ExternalResult): Promise<void> { await db.external.put(r); }
export async function listExternal(db: LabDB): Promise<ExternalResult[]> { return db.external.orderBy("at").toArray(); }
export async function deleteExternal(db: LabDB, id: string): Promise<void> { await db.external.delete(id); }

export async function exportAll(db: LabDB, now = new Date()): Promise<ExportFile> {
  return { format: EXPORT_FORMAT, schema: EXPORT_VERSION, exportedAt: now.toISOString(), sessions: await listSessions(db), calibrations: await listCalibrations(db), external: await listExternal(db) };
}

/** Parse and validate an export file (export versions 1 and 2). Throws with a readable message; writes nothing. */
export function parseExport(text: string): ExportFile {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("File is not valid JSON."); }
  const f = raw as Partial<ExportFile>;
  if (!f || f.format !== EXPORT_FORMAT) throw new Error("Not a Strafe Lab export file.");
  if (f.schema !== 1 && f.schema !== 2) throw new Error(`Export schema ${String(f.schema)} is not supported (expected 1 or ${EXPORT_VERSION}).`);
  if (!Array.isArray(f.sessions)) throw new Error("Export has no sessions list.");
  f.sessions.forEach((s, i) => { const p = sessionProblem(s); if (p) throw new Error(`Session ${i + 1}: ${p}.`); });
  if (f.calibrations !== undefined && !Array.isArray(f.calibrations)) throw new Error("Calibrations is not a list.");
  if (f.external !== undefined && (!Array.isArray(f.external) || f.external.some(e => typeof e?.value !== "number" || typeof e?.measure !== "string"))) throw new Error("External results are malformed.");
  return f as ExportFile;
}

/** Upsert by id. All-or-nothing: validation happens before any write. Returns the number of sessions imported. */
export async function importAll(db: LabDB, text: string): Promise<number> {
  const f = parseExport(text);
  await db.transaction("rw", db.sessions, db.calibrations, db.external, async () => {
    await db.sessions.bulkPut(f.sessions);
    if (f.calibrations?.length) await db.calibrations.bulkPut(f.calibrations);
    if (f.external?.length) await db.external.bulkPut(f.external);
  });
  return f.sessions.length;
}
