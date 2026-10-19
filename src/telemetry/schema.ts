import type { Display } from "../core/display";
import type { DrillId } from "../sim/drills";

/**
 * Telemetry schema versions:
 *  1 (Milestone 0): one sample per rendered frame (`frames`). Kept readable; analysed with the V2 frame path.
 *  2 (Milestone 1): every raw mouse event with its own timestamp (`events`). Metrics come from an offline replay
 *    of this log on a fixed 1 kHz grid, so they cannot depend on frame rate.
 * New sessions are always written at SCHEMA_VERSION.
 */
export const SCHEMA_VERSION = 2;
export const EXPORT_FORMAT = "strafe-lab-export";
export const EXPORT_VERSION = 2;

// ---------- v1: per-frame ----------

/**
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

export interface FrameDrillLog {
  id: DrillId;
  seed: number;
  frames: Frame[];
  extra?: DuoExtra;
}

// ---------- v2: per-event ----------

/**
 * One raw mouse event. t: seconds since drill start (from the event's own timestamp). dx/dy: counts.
 * b: 1 = left button pressed at t (dx = dy = 0). Optional, so Milestone 1 logs stay valid.
 */
export interface InputSample { t: number; dx: number; dy: number; b?: 1 }

export interface EventDrillLog {
  id: DrillId;
  seed: number;
  /** planned duration (s) */
  dur: number;
  /** when the live drill actually stopped (s); replay uses min(tEnd, its own end condition) */
  tEnd: number;
  /** radians per count used for this drill */
  k: number;
  events: InputSample[];
  /** Nemesis segments (Milestone 7): the generated scenario parameters, required to replay */
  params?: import("../sim/nemesis").NemesisParams;
}

export type DrillLog = FrameDrillLog | EventDrillLog;
export const isEventLog = (d: DrillLog): d is EventDrillLog => Array.isArray((d as EventDrillLog).events);

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

export type InputSource = "pointerrawupdate" | "pointermove" | "mousemove" | "synthetic";

/** Input integrity counters accumulated by the capture layer. */
export interface CaptureDiagnostics {
  source: InputSource;
  coalescedApi: boolean;
  /** parent events seen / raw samples logged */
  parents: number;
  samples: number;
  /** coalesced lists whose deltas did not sum to the parent's (parent used instead) */
  coalescedMismatch: number;
  /** samples whose timestamp went backwards (clamped to previous) */
  nonMonotonic: number;
  /** samples sharing a timestamp with the previous one */
  duplicateTs: number;
  /** samples that arrived after the live evaluator had already passed their time */
  late: number;
}

export interface SessionLog {
  schema: 1 | 2;
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: SessionStatus;
  settings: Settings;
  rawInput: boolean;
  sampling: "per-frame" | "event";
  capture?: CaptureDiagnostics;
  /** "v3" = Sensitivity Intelligence v3 (Milestone 2); "battery" = fixed baseline battery (Milestone 3);
   *  "train" = training session (Milestone 7). Absent = the V2 classic protocol. */
  protocol?: "v3" | "battery" | "train";
  /** battery: which fixed held-out seed set was used */
  seedSet?: number;
  /** training (Milestone 7): practice order */
  trainMode?: "variable" | "blocked";
  mode?: "quick" | "standard" | "deep";
  /** seeds every block/segment of the session (see sim/protocol.ts seedFor) */
  sessionSeed?: number;
  blocks: BlockLog[];
}

// ---------- calibration ----------

export type CalibrationKind = "dpi" | "turn360" | "polling" | "ads360";
export interface CalibrationRecord {
  id: string;
  at: string;
  kind: CalibrationKind;
  /** inputs the user gave (e.g. ruler distance, stated DPI, sens) */
  input: Record<string, number | string>;
  /** measured values computed deterministically from the captured counts / intervals */
  result: Record<string, number | string | null>;
}

// ---------- external results (Milestone 3: Firing Range, R5 Reloaded, aim trainer) ----------

export type ExternalKind = "firing-range" | "r5" | "trainer";
export interface ExternalResult {
  id: string;
  at: string;
  kind: ExternalKind;
  /** e.g. "R-99 60 s strafe-dummy damage", or the aim-trainer scenario name */
  measure: string;
  value: number;
  unit: string;
  higherIsBetter: boolean;
  /** free text: exact settings used, video file name */
  notes: string;
}

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  schema: number;
  exportedAt: string;
  sessions: SessionLog[];
  calibrations?: CalibrationRecord[];
  external?: ExternalResult[];
  experiments?: import("../analysis/experiments").Experiment[];
}

const isNum = (v: unknown): v is number => typeof v === "number" && isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Structural check used on import. Returns an error string, or null if the session looks valid. */
export function sessionProblem(s: unknown): string | null {
  if (!isObj(s)) return "session is not an object";
  if (s.schema !== 1 && s.schema !== 2) return `unsupported schema ${String(s.schema)}`;
  if (typeof s.id !== "string" || !s.id) return "missing id";
  if (typeof s.startedAt !== "string") return "missing startedAt";
  if (!["in_progress", "complete", "abandoned"].includes(s.status as string)) return "bad status";
  const st = s.settings;
  if (!isObj(st) || !isNum(st.dpi) || !isNum(st.sens) || !isNum(st.fovScale) || !isObj(st.display)) return "bad settings";
  if (!Array.isArray(s.blocks)) return "blocks is not an array";
  for (const b of s.blocks) {
    if (!isObj(b) || !isNum(b.cm360) || !isObj(b.drills)) return "bad block";
    for (const d of Object.values(b.drills)) {
      if (!isObj(d)) return "bad drill";
      if (s.schema === 1) {
        if (!Array.isArray(d.frames)) return "bad drill";
        for (const f of d.frames as unknown[]) {
          if (!isObj(f) || !isNum(f.t) || !isNum(f.yaw) || !isNum(f.pitch) || !isNum(f.ty) || !isNum(f.tp) || !isNum(f.hw) || !isNum(f.c)) return "bad frame";
        }
      } else {
        if (!Array.isArray(d.events) || !isNum(d.k) || !isNum(d.dur) || !isNum(d.tEnd) || !isNum(d.seed)) return "bad drill";
        for (const e of d.events as unknown[]) if (!isObj(e) || !isNum(e.t) || !isNum(e.dx) || !isNum(e.dy) || (e.b !== undefined && e.b !== 1)) return "bad event";
      }
    }
  }
  return null;
}
