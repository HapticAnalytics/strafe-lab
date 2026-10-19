import { defineConfig } from "@playwright/test";

// Uses the system Edge (always present on Windows) or Chrome in CI, so no browser download is needed.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: { baseURL: "http://localhost:4173", channel: process.env.CI ? "chrome" : "msedge" },
  webServer: { command: "npx vite build && npx vite preview --port 4173 --strictPort", url: "http://localhost:4173", reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
