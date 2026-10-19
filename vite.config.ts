import { defineConfig } from "vitest/config";

// BASE is set by the GitHub Pages workflow ("/strafe-lab/"); local dev and preview serve from "/".
export default defineConfig({
  base: process.env.BASE ?? "/",
  test: { include: ["tests/**/*.test.ts"] },
});
