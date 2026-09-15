import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { adapterForPath } from "../src/core/extract.js";
import { explainInstructions } from "../src/core/instruction-applicability.js";
import { inventoryInstructions } from "../src/core/instruction-inventory.js";
import { scanRepository } from "../src/core/scanner.js";

const temporary: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "guardspec-agents-override-"));
  temporary.push(root);
  return root;
}

async function writeRepoFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const target = join(root, ...relativePath.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map(async (path) => rm(path, { recursive: true, force: true })),
  );
});

describe("AGENTS.override.md discovery", () => {
  it("classifies root and nested overrides without promoting lookalikes", () => {
    expect(adapterForPath("AGENTS.override.md")).toBe("agents-md");
    expect(adapterForPath("packages/api/AGENTS.override.md")).toBe("agents-md");
    expect(adapterForPath("AGENTS.override.mdx")).toBeUndefined();
    expect(adapterForPath("notes/AGENTS.override.txt")).toBeUndefined();
  });

  it("includes the root override in scan and instruction inventory", async () => {
    const root = await repository();
    await writeRepoFile(
      root,
      "AGENTS.override.md",
      "Do not modify `secrets/`.\n",
    );
    await writeRepoFile(
      root,
      "packages/api/AGENTS.override.md",
      "Before opening a pull request, run `pnpm test:api`.\n",
    );
    await writeRepoFile(root, "AGENTS.override.mdx", "Unrelated lookalike.\n");

    const scan = await scanRepository(root);
    expect(scan.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "AGENTS.override.md",
          adapter: "agents-md",
          scope: "**",
        }),
        expect.objectContaining({
          path: "packages/api/AGENTS.override.md",
          adapter: "agents-md",
          scope: "packages/api/**",
        }),
      ]),
    );
    expect(scan.sources.map((source) => source.path)).not.toContain(
      "AGENTS.override.mdx",
    );
    expect(
      scan.policy.rules.some(
        (rule) =>
          rule.provenance[0]?.source === "AGENTS.override.md" &&
          rule.kind === "path" &&
          rule.effect === "deny" &&
          rule.scope === "secrets/**",
      ),
    ).toBe(true);

    const inventory = await inventoryInstructions(root);
    expect(inventory.sources.map((source) => source.path)).toEqual([
      "AGENTS.override.md",
      "packages/api/AGENTS.override.md",
    ]);
  });

  it("reports root override guidance for repository-relative targets", async () => {
    const root = await repository();
    await writeRepoFile(root, "AGENTS.override.md", "Repository override.\n");
    await writeRepoFile(
      root,
      "packages/api/AGENTS.override.md",
      "API override.\n",
    );

    const api = await explainInstructions(root, "packages/api/src/server.ts");
    expect(api.applicable.map((entry) => entry.path)).toEqual([
      "AGENTS.override.md",
      "packages/api/AGENTS.override.md",
    ]);

    const web = await explainInstructions(root, "packages/web/src/page.ts");
    expect(web.applicable.map((entry) => entry.path)).toEqual([
      "AGENTS.override.md",
    ]);
  });
});
