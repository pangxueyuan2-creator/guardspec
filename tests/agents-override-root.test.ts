import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { explainInstructions } from "../src/core/instruction-applicability.js";
import { inventoryInstructions } from "../src/core/instruction-inventory.js";
import { adapterForPath } from "../src/core/extract.js";
import { scanRepository } from "../src/core/scanner.js";

const temporary: string[] = [];

async function writeRepoFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const target = join(root, ...relativePath.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function withTempRepository(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "guardspec-agents-override-"));
  temporary.push(root);
  await run(root);
}

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map(async (path) => rm(path, { recursive: true, force: true })),
  );
});

describe("AGENTS.override.md discovery", () => {
  it("classifies root and nested override files as agent instructions", () => {
    expect(adapterForPath("AGENTS.override.md")).toBe("agents-md");
    expect(adapterForPath("packages/api/AGENTS.override.md")).toBe("agents-md");
    expect(adapterForPath("AGENTS.override.txt")).toBeUndefined();
  });

  it("includes a root override in inventory, policy extraction, and applicability", async () => {
    await withTempRepository(async (root) => {
      await writeRepoFile(
        root,
        "AGENTS.override.md",
        "Before opening a pull request, run `pnpm test`.\n",
      );
      await writeRepoFile(
        root,
        "packages/api/AGENTS.override.md",
        "Keep API changes focused.\n",
      );
      await writeRepoFile(root, "AGENTS.override.txt", "Not an instruction.\n");

      const inventory = await inventoryInstructions(root);
      expect(inventory.sources.map((source) => source.path)).toEqual([
        "AGENTS.override.md",
        "packages/api/AGENTS.override.md",
      ]);
      expect(inventory.sources[0]).toEqual(
        expect.objectContaining({
          adapter: "agents-md",
          scope: "**",
          rulesExtracted: 1,
        }),
      );
      expect(inventory.sources[1]).toEqual(
        expect.objectContaining({
          adapter: "agents-md",
          scope: "packages/api/**",
        }),
      );

      const scan = await scanRepository(root);
      expect(
        scan.policy.rules.some(
          (rule) =>
            rule.provenance[0]?.source === "AGENTS.override.md" &&
            rule.kind === "check" &&
            rule.value === "pnpm test",
        ),
      ).toBe(true);

      const rootTarget = await explainInstructions(root, "src/index.ts");
      expect(rootTarget.applicable.map((source) => source.path)).toEqual([
        "AGENTS.override.md",
      ]);

      const nestedTarget = await explainInstructions(
        root,
        "packages/api/src/server.ts",
      );
      expect(nestedTarget.applicable.map((source) => source.path)).toEqual([
        "AGENTS.override.md",
        "packages/api/AGENTS.override.md",
      ]);
    });
  });
});
