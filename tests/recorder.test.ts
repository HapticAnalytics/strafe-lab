import { expect, it } from "vitest";
import { BlockRecorder } from "../src/telemetry/recorder";

it("recorder normalises -0 so JSON export round-trips exactly", () => {
  const r = new BlockRecorder(0, false, 1, 30);
  r.startDrill("pb", 101);
  r.frame({ t: 0, yaw: -0, pitch: -0, ty: 0, tp: 0, on: 0, hw: 0.01, c: -0 });
  r.endDrill();
  const f = r.log.drills.pb!.frames[0];
  expect(Object.is(f.yaw, 0) && Object.is(f.pitch, 0) && Object.is(f.c, 0)).toBe(true);
  expect(JSON.parse(JSON.stringify(r.log))).toEqual(r.log);
});

it("duo drill gets an extra block; warm-up 'acc' drill is not stored", () => {
  const r = new BlockRecorder(0, true, null, 30);
  r.startDrill("acc", 505); r.endDrill();
  r.startDrill("duo", 404);
  expect(r.extra).toEqual({ kills: [], dmgBody: 0, dmgHead: 0 });
  r.endDrill();
  expect(Object.keys(r.log.drills)).toEqual(["duo"]);
});
