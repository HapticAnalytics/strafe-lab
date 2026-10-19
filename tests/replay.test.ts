import { describe, expect, it } from "vitest";
import { flags, frameAt, loadReplay } from "../src/analysis/replayView";
import { viewDrill } from "../src/analysis/track";
import { scoreSkill } from "../src/analysis/skills";
import { radPerCount } from "../src/core/units";
import { synthPlayerEvents } from "../src/input/synthetic";
import { DRILLS, type DrillId } from "../src/sim/drills";
import { buildScenario } from "../src/sim/scenario";
import type { EventDrillLog } from "../src/telemetry/schema";

const K = radPerCount(32, 800);
const log = (id: DrillId, lag = 0.1): EventDrillLog => {
  const d = DRILLS[id], sc = buildScenario(id, d.seed, d.dur);
  return { id, seed: d.seed, dur: d.dur, tEnd: d.dur, k: K, events: synthPlayerEvents(sc, K, { lag, gain: 0.5, seed: 4 }, 1000) };
};

describe("Milestone 4 acceptance: replay reproduces logged metrics exactly", () => {
  for (const id of ["pb", "close", "mid", "duo"] as DrillId[]) {
    it(id, () => {
      const l = log(id);
      expect(loadReplay(l, 800).m1!.metrics).toEqual(viewDrill(l, 800).m1);
    });
  }
  it("spawn drills: replayed spawn records equal the scored ones", () => {
    const l = log("flick", 0.12);
    expect(loadReplay(l, 800).ev.spawns).toEqual(scoreSkill(l, 800)!.spawns);
  });
});

describe("replay frames", () => {
  it("crosshair at time t equals the evaluated sample", () => {
    const r = loadReplay(log("close"), 800);
    const f = frameAt(r, 3.2105);
    expect(f.aim).toEqual({ yaw: r.samples[f.index].yaw, pitch: r.samples[f.index].pitch });
    expect(f.index).toBe(3211);
  });
  it("2v1: a killed enemy is not shown after its kill time", () => {
    const r = loadReplay(log("duo", 0), 800);
    const k = r.ev.kills[0];
    expect(frameAt(r, k.t - 0.01).targets.some(x => x.i === k.i)).toBe(true);
    expect(frameAt(r, k.t + 0.01).targets.some(x => x.i === k.i)).toBe(false);
  });
  it("spawn: only the active target is shown", () => {
    const r = loadReplay(log("flick", 0.12), 800);
    const s = r.ev.spawns[1];
    expect(frameAt(r, s.at + 0.01).targets.map(x => x.i)).toEqual([s.i]);
  });
  it("flags are sorted and include reversals and losses for a laggy tracker", () => {
    const f = flags(loadReplay(log("close", 0.2), 800));
    for (let i = 1; i < f.length; i++) expect(f[i].t).toBeGreaterThanOrEqual(f[i - 1].t);
    expect(f.some(x => x.kind === "reversal")).toBe(true);
    expect(f.some(x => x.kind === "loss")).toBe(true);
  });
});
