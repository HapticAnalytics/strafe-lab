import Dexie, { type Table } from "dexie";
import { EXPORT_FORMAT, SCHEMA_VERSION, sessionProblem, type ExportFile, type Settings, type SessionLog } from "../telemetry/schema";

interface MetaRow { key: string; value: unknown }

/** Local-first store. DB version here is the IndexedDB layout version, separate from the telemetry SCHEMA_VERSION. */
export class LabDB extends Dexie {
  sessions!: Table<SessionLog, string>;
  meta!: Table<MetaRow, string>;

  constructor(name = "strafe-lab") {
    super(name);
    this.version(1).stores({ sessions: "id, startedAt, status", meta: "key" });
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

export async function exportAll(db: LabDB, now = new Date()): Promise<ExportFile> {
  return { format: EXPORT_FORMAT, schema: SCHEMA_VERSION, exportedAt: now.toISOString(), sessions: await listSessions(db) };
}

/** Parse and validate an export file. Throws with a readable message on any problem; writes nothing. */
export function parseExport(text: string): ExportFile {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("File is not valid JSON."); }
  const f = raw as Partial<ExportFile>;
  if (!f || f.format !== EXPORT_FORMAT) throw new Error("Not a Strafe Lab export file.");
  if (f.schema !== SCHEMA_VERSION) throw new Error(`Export schema ${String(f.schema)} is not supported (expected ${SCHEMA_VERSION}).`);
  if (!Array.isArray(f.sessions)) throw new Error("Export has no sessions list.");
  f.sessions.forEach((s, i) => { const p = sessionProblem(s); if (p) throw new Error(`Session ${i + 1}: ${p}.`); });
  return f as ExportFile;
}

/** Upsert by session id. All-or-nothing: validation happens before any write. Returns count imported. */
export async function importAll(db: LabDB, text: string): Promise<number> {
  const f = parseExport(text);
  await db.sessions.bulkPut(f.sessions);
  return f.sessions.length;
}
