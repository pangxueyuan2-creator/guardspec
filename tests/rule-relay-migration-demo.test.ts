import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { main as binMain } from "../src/bin.js";

const fixtureRoot = fileURLToPath(
  new URL("../demo/rule-relay-migration-repo/", import.meta.url),
);

async function captureStdout(run: () => Promise<void>): Promise<string> {
  const output: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string) => {
    output.push(chunk);
    return true;
  };
  try {
    await run();
  } finally {
    process.stdout.write = original;
  }
  return output.join("");
}

afterEach(() => {
  process.exitCode = undefined;
});

describe("committed RuleRelay migration proof", () => {
  it("proves readiness, legacy validation, and ordinary GuardSpec hygiene", async () => {
    const compatibilityOutput = await captureStdout(async () =>
      binMain([
        "instructions",
        "compatibility",
        "rule-relay",
        "--root",
        fixtureRoot,
        "--target",
        "src/server.ts",
        "--json",
      ]),
    );

    expect(process.exitCode).toBe(0);
    const compatibility = JSON.parse(compatibilityOutput) as {
      ready: boolean;
      expectedSources: Array<{ path: string }>;
      blockers: unknown[];
      targetChecks: Array<{
        target: string;
        ready: boolean;
        expectedApplicableSources: Array<{ path: string }>;
      }>;
    };
    expect(compatibility.ready).toBe(true);
    expect(compatibility.blockers).toEqual([]);
    expect(compatibility.expectedSources.map(({ path }) => path)).toEqual([
      ".github/instructions/src.instructions.md",
      "AGENTS.md",
    ]);
    expect(compatibility.targetChecks).toEqual([
      expect.objectContaining({
        target: "src/server.ts",
        ready: true,
        expectedApplicableSources: [
          expect.objectContaining({
            path: ".github/instructions/src.instructions.md",
          }),
          expect.objectContaining({ path: "AGENTS.md" }),
        ],
      }),
    ]);

    process.exitCode = undefined;
    const legacyCheckOutput = await captureStdout(async () =>
      binMain([
        "instructions",
        "check",
        "--compat",
        "rule-relay",
        "--root",
        fixtureRoot,
        "--json",
      ]),
    );
    expect(process.exitCode).toBe(0);
    const legacyCheck = JSON.parse(legacyCheckOutput) as {
      valid: boolean;
      errors: number;
      warnings: number;
    };
    expect(legacyCheck).toEqual(
      expect.objectContaining({ valid: true, errors: 0, warnings: 0 }),
    );

    process.exitCode = undefined;
    const guardSpecOutput = await captureStdout(async () =>
      binMain([
        "instructions",
        "check",
        "--root",
        fixtureRoot,
        "--json",
      ]),
    );
    expect(process.exitCode).toBe(0);
    const guardSpec = JSON.parse(guardSpecOutput) as {
      valid: boolean;
      errors: number;
      warnings: number;
    };
    expect(guardSpec).toEqual(
      expect.objectContaining({ valid: true, errors: 0, warnings: 0 }),
    );
  });
});
