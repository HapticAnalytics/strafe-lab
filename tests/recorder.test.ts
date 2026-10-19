import { expect, it } from "vitest";
import { BlockRecorder } from "../src/telemetry/recorder";
import type { EventDrillLog } from "../src/telemetry/schema";

it("recorder normalises -0 so JSON export round-trips exactly", () => {
  const r = new BlockRecorder(0, false, 1, 30);
  r.startDrill("pb", 101, 10, 0.001);
  r.events([{ t: -0, dx: -0, dy: 3 }]);
  r.endDrill(10);
  const e = (r.log.drills.pb as EventDrillLog).events[0];
  expect(Object.is(e.t, 0) && Object.is(e.dx, 0)).toBe(true);
  expect(JSON.parse(JSON.stringify(r.log))).toEqual(r.log);
});

it("warm-up 'acc' drill is not stored; tEnd is recorded", () => {
  const r = new BlockRecorder(0, true, null, 30);
  r.startDrill("acc", 505, 4, 0.001); r.endDrill(4);
  r.startDrill("duo", 404, 10, 0.001); r.endDrill(3.2);
  expect(Object.keys(r.log.drills)).toEqual(["duo"]);
  expect((r.log.drills.duo as EventDrillLog).tEnd).toBe(3.2);
});
