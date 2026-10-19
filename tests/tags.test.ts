import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// CLAUDE.md rule: every constant in sim/ and analysis/ carries VERIFIED / APPROX / HYPOTHESIS.
// A tag counts if it is on the same line or in the 4 lines above (a comment block can cover a few constants).
const TAG = /(VERIFIED|APPROX|HYPOTHESIS)/;
const CONST = /^\s*(export )?const [A-Za-z_][A-Za-z0-9_]* = /;
const SKIP_VALUE = /=\s*(\(|\[\s*"|"|createMover|mulberry32|new |\{\s*$|Array|async)/;

describe("constants are tagged", () => {
  for (const dir of ["src/sim", "src/analysis"]) {
    for (const file of readdirSync(dir).filter(f => f.endsWith(".ts"))) {
      it(`${dir}/${file}`, () => {
        const lines = readFileSync(join(dir, file), "utf8").split("\n");
        const missing: string[] = [];
        lines.forEach((line, i) => {
          if (!CONST.test(line) || line.startsWith("    ") || line.startsWith("  ")) return; // module-level only
          if (!/=\s*[-\d.{[A-Z]/.test(line) && !/=\s*\w+ \* /.test(line)) return; // numbers, objects, derived numeric
          if (SKIP_VALUE.test(line)) return;
          const window = lines.slice(Math.max(0, i - 4), i + 1).join("\n");
          if (!TAG.test(window)) missing.push(`${i + 1}: ${line.trim()}`);
        });
        expect(missing).toEqual([]);
      });
    }
  }
});
