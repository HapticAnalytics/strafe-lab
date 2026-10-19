import { expect, test } from "@playwright/test";
import { synthSession } from "../helpers";

test("setup screen loads with no console errors and shows conversions", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/");
  await expect(page.locator("#calc")).toContainText("32.5 cm/360");
  await page.fill("#fov", "1.9");
  await expect(page.locator("#calc")).toContainText("133.0° FOV at 4:3");
  expect(errors).toEqual([]);
});

test("the V2 drill starts in the new app", async ({ page }) => {
  await page.goto("/");
  await page.click("#startBtn");
  await expect(page.locator("#range")).toBeVisible();
  await expect(page.locator("#ovTitle")).toHaveText("Get your hand moving");
  await expect(page.locator("#view")).toBeVisible();
  await page.click("#ovQuit");
  await expect(page.locator("#setup")).toBeVisible();
});

test("an imported session survives a reload and its results re-render from the log", async ({ page }, info) => {
  const s = synthSession("e2e");
  // need >= 3 scored blocks for a result
  s.blocks = [...s.blocks, { ...s.blocks[0], index: 2, cm360: 45 }, { ...s.blocks[1], index: 3, cm360: 60 }];
  const file = info.outputPath("export.json");
  const fs = await import("node:fs");
  fs.writeFileSync(file, JSON.stringify({ format: "strafe-lab-export", schema: 1, exportedAt: "2026-01-01T00:00:00.000Z", sessions: [s] }));
  await page.goto("/");
  await page.setInputFiles("#importFile", file);
  await expect(page.locator("#histNote")).toHaveText("Imported 1 session(s).");
  await page.reload();
  await expect(page.locator("#histList")).toContainText("complete");
  await page.click("[data-open='e2e']");
  await expect(page.locator("#results .bignum")).toBeVisible();
  await expect(page.locator("#results table tbody tr")).toHaveCount(4);
});

test("settings survive a reload", async ({ page }) => {
  await page.goto("/");
  await page.fill("#dpi", "1600");
  await page.selectOption("#aspect", "1");
  await page.selectOption("#scaling", "blackbars");
  await page.click("#startBtn"); // settings are saved on start
  await page.click("#ovQuit");
  await page.reload();
  await expect(page.locator("#dpi")).toHaveValue("1600");
  await expect(page.locator("#aspect")).toHaveValue("1");
  await expect(page.locator("#scaling")).toHaveValue("blackbars");
});

test("an event-level (v2) session shows the Milestone 1 tracking detail", async ({ page }, info) => {
  const { synthSessionV2 } = await import("../helpers");
  const s = synthSessionV2("e2e-v2");
  const file = info.outputPath("v2.json");
  (await import("node:fs")).writeFileSync(file, JSON.stringify({ format: "strafe-lab-export", schema: 2, exportedAt: "2026-01-01T00:00:00.000Z", sessions: [s] }));
  await page.goto("/");
  await page.setInputFiles("#importFile", file);
  await expect(page.locator("#histNote")).toHaveText("Imported 1 session(s).");
  await page.click("[data-open='e2e-v2']");
  await expect(page.locator("#results")).toContainText("Tracking detail");
  await expect(page.locator("#results")).toContainText("Reversal response");
  await expect(page.locator("#results")).toContainText("Input: synthetic");
});

test("calibration screen opens and lists no calibrations initially", async ({ page }) => {
  await page.goto("/");
  await page.click("#calOpen");
  await expect(page.locator("#calib")).toBeVisible();
  await expect(page.locator("#calList")).toContainText("No calibrations yet.");
  await expect(page.locator("#adsOptic option")).toHaveCount(7);
  await page.click("#calBack");
  await expect(page.locator("#setup")).toBeVisible();
});

test("a v3 sens-finder session shows the range, interval and per-skill fits", async ({ page }, info) => {
  const { synthSessionV3 } = await import("../helpers");
  const file = info.outputPath("v3.json");
  (await import("node:fs")).writeFileSync(file, JSON.stringify({ format: "strafe-lab-export", schema: 2, exportedAt: "2026-01-01T00:00:00.000Z", sessions: [synthSessionV3("e2e-v3")] }));
  await page.goto("/");
  await page.setInputFiles("#importFile", file);
  await expect(page.locator("#histList")).toContainText("Quick");
  await page.click("[data-open=e2e-v3]");
  await expect(page.locator("#results")).toContainText("Best sens by skill");
  await expect(page.locator("#results")).toContainText("95% interval");
  await expect(page.locator("#results")).toContainText("Shotgun flick");
});

test("mode selector offers Quick, Standard and Deep with durations", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#mode option")).toHaveCount(3);
  await expect(page.locator("#mode")).toHaveValue("standard");
  await expect(page.locator("#mode option").first()).toContainText("Quick · about");
});

test("baseline screen: add a Firing Range result and see it in the noise-floor table", async ({ page }) => {
  await page.goto("/");
  await page.click("#baseOpen");
  await expect(page.locator("#baseline")).toBeVisible();
  await expect(page.locator("#baseStatus")).toContainText("0 batteries");
  await page.fill("#extValue", "3150");
  await page.click("#extSave");
  await expect(page.locator("#extList")).toContainText("R-99 60 s strafe damage: 3150.0 dmg");
  await expect(page.locator("#floorTable")).toContainText("Firing Range · R-99 60 s strafe damage");
});

test("the baseline battery starts at the player's own sens", async ({ page }) => {
  await page.goto("/");
  await page.click("#baseOpen");
  await page.click("#batteryBtn");
  await expect(page.locator("#range")).toBeVisible();
  await expect(page.locator("#ovEyebrow")).toContainText("Baseline battery · round 1 of 2");
  await page.click("#ovQuit");
});

test("replay: flagged moments are one click away and the replay renders", async ({ page }, info) => {
  const { synthSessionV2 } = await import("../helpers");
  const file = info.outputPath("rp.json");
  (await import("node:fs")).writeFileSync(file, JSON.stringify({ format: "strafe-lab-export", schema: 2, exportedAt: "2026-01-01T00:00:00.000Z", sessions: [synthSessionV2("e2e-rp")] }));
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/");
  await page.setInputFiles("#importFile", file);
  await page.click("[data-replay='e2e-rp']");
  await expect(page.locator("#replay")).toBeVisible();
  await page.selectOption("#rpDrill", "close");
  const first = page.locator("[data-flag]").last();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page.locator("#rpTime")).not.toHaveText(/^0\.00 s/);
  await page.screenshot({ path: info.outputPath("replay.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("dashboard renders sens history and explains the fingerprint is not ready", async ({ page }, info) => {
  const { synthSessionV3 } = await import("../helpers");
  const file = info.outputPath("dash.json");
  const ext = [{ id: "x1", at: "2026-01-01T10:00:00.000Z", kind: "firing-range", measure: "R-99 60 s strafe damage", value: 3000, unit: "dmg", higherIsBetter: true, notes: "" }];
  (await import("node:fs")).writeFileSync(file, JSON.stringify({ format: "strafe-lab-export", schema: 2, exportedAt: "2026-01-01T00:00:00.000Z", sessions: [synthSessionV3("d3")], external: ext }));
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/");
  await page.setInputFiles("#importFile", file);
  await page.click("#dashOpen");
  await expect(page.locator("#dashboard")).toContainText("Sensitivity history");
  await expect(page.locator("#dashboard")).toContainText("needs a noise floor first");
  await expect(page.locator("#dashboard")).toContainText("R-99 60 s strafe damage");
  await page.screenshot({ path: info.outputPath("dashboard.png"), fullPage: true });
  expect(errors).toEqual([]);
});
