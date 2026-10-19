import type { Display } from "../core/display";
import type { DrillId } from "../sim/drills";

/** Bump when the stored shape changes; add a migration in storage/migrate.ts. */
export const SCHEMA_VERSION = 1;
export const EXPORT_FORMAT = "strafe-lab-export";

/**
 * One logged sample. v1 samples once per rendered frame (known limitation, fixed in Milestone 1 by
 * event-level capture, which will be schema v2).
 * t: seconds since the drill started. yaw/pitch: crosshair, radians. ty/tp: target bearing, radians.
 * on: 0 miss, 1 body, 2 head. hw: target half-width in radians. c: cumulative mouse counts.
 */
export interface Frame { t: number; yaw: number; pitch: number; ty: number; tp: number; on: 0 | 1 | 2; hw: number; c: number }

export interface DuoExtra {
  kills: { i: number; t: number }[];
  dmgBody: number;
  dmgHead: number;
  elapsed?: number;
  dealt?: number;
}

export interface DrillLog {
  id: DrillId;
  seed: number;
  frames: Frame[];
  extra?: DuoExtra;
}

export interface BlockLog {
  index: number;
  warm: boolean;
  /** 1 = wide sweep, 2 = zoom round, null = warm-up */
  round: 1 | 2 | null;
  cm360: number;
  drills: Partial<Record<DrillId, DrillLog>>;
}

/** fovScale is Apex cl_fovScale (4:3 hFOV = 70 x fovScale, uncapped). display = game aspect + scaling. */
export interface Settings { dpi: number; sens: number; fovScale: number; display: Display }

export type SessionStatus = "in_progress" | "complete" | "abandoned";

export interface SessionLog {
  schema: typeof SCHEMA_VERSION;
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: SessionStatus;
  settings: Settings;
  rawInput: boolean;
  sampling: "per-frame";
  blocks: BlockLog[];
}

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  schema: number;
  exportedAt: string;
  sessions: SessionLog[];
}

const isNum = (v: unknown): v is number => typeof v === "number" && isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Structural check used on import. Returns an error string, or null if the session looks valid. */
export function sessionProblem(s: unknown): string | null {
  if (!isObj(s)) return "session is not an object";
  if (s.schema !== SCHEMA_VERSION) return `unsupported schema ${String(s.schema)}`;
  if (typeof s.id !== "string" || !s.id) return "missing id";
  if (typeof s.startedAt !== "string") return "missing startedAt";
  if (!["in_progress", "complete", "abandoned"].includes(s.status as string)) return "bad status";
  const st = s.settings;
  if (!isObj(st) || !isNum(st.dpi) || !isNum(st.sens) || !isNum(st.fovScale) || !isObj(st.display)) return "bad settings";
  if (!Array.isArray(s.blocks)) return "blocks is not an array";
  for (const b of s.blocks) {
    if (!isObj(b) || !isNum(b.cm360) || !isObj(b.drills)) return "bad block";
    for (const d of Object.values(b.drills)) {
      if (!isObj(d) || !Array.isArray(d.frames)) return "bad drill";
      for (const f of d.frames as unknown[]) {
        if (!isObj(f) || !isNum(f.t) || !isNum(f.yaw) || !isNum(f.pitch) || !isNum(f.ty) || !isNum(f.tp) || !isNum(f.hw) || !isNum(f.c)) return "bad frame";
      }
    }
  }
  return null;
}
