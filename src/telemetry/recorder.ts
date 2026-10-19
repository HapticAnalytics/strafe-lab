import type { DrillId } from "../sim/drills";
import type { BlockLog, DrillLog, DuoExtra, Frame } from "./schema";

/** Collects one block's log. Pure data in, pure data out; no DOM or rendering. */
export class BlockRecorder {
  private cur: DrillLog | null = null;
  readonly log: BlockLog;

  constructor(index: number, warm: boolean, round: 1 | 2 | null, cm360: number) {
    this.log = { index, warm, round, cm360, drills: {} };
  }

  startDrill(id: DrillId, seed: number): void {
    this.cur = { id, seed, frames: [] };
    if (id === "duo") this.cur.extra = { kills: [], dmgBody: 0, dmgHead: 0 };
  }

  /** Stores a copy with -0 normalised to 0 (JSON cannot represent -0, and exports must round-trip exactly). */
  frame(f: Frame): void {
    this.cur?.frames.push({ t: f.t + 0, yaw: f.yaw + 0, pitch: f.pitch + 0, ty: f.ty + 0, tp: f.tp + 0, on: f.on, hw: f.hw + 0, c: f.c + 0 });
  }

  get extra(): DuoExtra | undefined { return this.cur?.extra; }

  endDrill(): void {
    if (this.cur && this.cur.id !== "acc") this.log.drills[this.cur.id] = this.cur;
    this.cur = null;
  }
}
