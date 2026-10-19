import type { DrillId } from "../sim/drills";
import type { BlockLog, EventDrillLog, InputSample } from "./schema";

/** Collects one block's event log (schema v2). Pure data in, pure data out; no DOM or rendering. */
export class BlockRecorder {
  private cur: EventDrillLog | null = null;
  readonly log: BlockLog;

  constructor(index: number, warm: boolean, round: 1 | 2 | null, cm360: number) {
    this.log = { index, warm, round, cm360, drills: {} };
  }

  startDrill(id: DrillId, seed: number, dur: number, k: number): void {
    this.cur = { id, seed, dur, tEnd: dur, k, events: [] };
  }

  /** Stores copies with -0 normalised to 0 (JSON cannot represent -0, and exports must round-trip exactly). */
  events(samples: InputSample[]): void {
    if (!this.cur) return;
    for (const s of samples) this.cur.events.push(s.b ? { t: s.t + 0, dx: 0, dy: 0, b: 1 } : { t: s.t + 0, dx: s.dx + 0, dy: s.dy + 0 });
  }

  /** The warm-up adjustment drill ("acc") is not stored. */
  endDrill(tEnd: number): void {
    if (this.cur && this.cur.id !== "acc") { this.cur.tEnd = tEnd + 0; this.log.drills[this.cur.id] = this.cur; }
    this.cur = null;
  }
}
