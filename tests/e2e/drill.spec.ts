import { expect, test } from "@playwright/test";

// Drives a real drill: pointer lock + raw mouse movement through the live loop. Skips if the headless browser
// refuses pointer lock (then only the manual run on the gaming PC covers this path).
test("live drill runs: pointer lock, mouse events are captured, block advances", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/");
  await page.click("#startBtn");
  await page.click("#ovGo");
  await page.waitForTimeout(500);
  const locked = await page.evaluate(() => !!document.pointerLockElement);
  test.skip(!locked, "pointer lock not available in this headless browser");
  await page.waitForTimeout(700);
  await page.keyboard.press("Space");
  // move the mouse around for a few seconds of the warm-up
  for (let i = 0; i < 120; i++) { await page.mouse.move(400 + 200 * Math.sin(i / 6), 300 + 50 * Math.cos(i / 9)); await page.waitForTimeout(16); }
  await expect(page.locator("#hudDrill")).not.toHaveText("Ready");
  expect(errors).toEqual([]);
});

test("a full warm-up block logs raw events and is saved", async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/");
  await page.click("#startBtn");
  await page.click("#ovGo");
  await page.waitForTimeout(500);
  test.skip(!(await page.evaluate(() => !!document.pointerLockElement)), "pointer lock not available");
  await page.waitForTimeout(700);
  await page.keyboard.press("Space");
  let i = 0;
  while (!(await page.locator("#overlay").isVisible())) {
    await page.mouse.move(400 + 150 * Math.sin(i / 7), 300 + 40 * Math.cos(i / 11));
    await page.waitForTimeout(10);
    i++;
  }
  await expect(page.locator("#ovTitle")).toHaveText("Next block");
  const saved = await page.evaluate(() => new Promise<{ blocks: number; events: number; sampling: string }>(res => {
    const req = indexedDB.open("strafe-lab");
    req.onsuccess = () => {
      const tx = req.result.transaction("sessions").objectStore("sessions").getAll();
      tx.onsuccess = () => {
        const s = tx.result[tx.result.length - 1];
        const ev = Object.values(s.blocks[0].drills as Record<string, { events: unknown[] }>).reduce((a, d) => a + d.events.length, 0);
        res({ blocks: s.blocks.length, events: ev, sampling: s.sampling });
      };
    };
  }));
  expect(saved.blocks).toBe(1);
  expect(saved.sampling).toBe("event");
  expect(saved.events).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});
