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
