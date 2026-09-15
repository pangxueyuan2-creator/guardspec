import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { inventoryInstructions } from "../src/core/instruction-inventory.js";

const temporary: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "guardspec-instruction-inventory-"));
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
  process.exitCode = undefined;
  await Promise.all(
    temporary
      .splice(0)
      .map(async (path) => rm(path, { recursive: true, force: true })),
  );
});

describe("instruction source inventory", () => {
  it("lists supported instruction sources without unrelated policy inputs", async () => {
    const root = await repository();
    await writeRepoFile(root, "AGENTS.md", "Run `pnpm test`.\n");
    await writeRepoFile(root, "CLAUDE.md", "Keep changes focused.\n");
    await writeRepoFile(root, "GEMINI.md", "Keep changes focused.\n");
    await writeRepoFile(root, ".cursorrules", "Keep changes focused.\n");
    await writeRepoFile(root, "opencode.json", "{}\n");
    await writeRepoFile(
      root,
      ".github/copilot-instructions.md",
      "Before opening a pull request, run `pnpm lint`.\n",
    );
    await writeRepoFile(
      root,
      ".github/instructions/typescript.instructions.md",
      [
        "---",
        'applyTo: "src/**/*.ts"',
        "---",
        "Before opening a pull request, run `pnpm typecheck`.",
      ].join("\n"),
    );
    await writeRepoFile(root, "README.md", "Run `pnpm docs`.\n");
    await writeRepoFile(root, "CODEOWNERS", "* @maintainer\n");
    await writeRepoFile(root, ".mcp.json", "{}\n");

    const report = await inventoryInstructions(root);

    expect(report.adapters).toEqual([
      "agents-md",
      "claude",
      "copilot",
      "cursor",
      "gemini",
      "opencode",
    ]);
    expect(report.sources.map((source) => source.path)).toEqual([
      ".cursorrules",
      ".github/copilot-instructions.md",
      ".github/instructions/typescript.instructions.md",
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
      "opencode.json",
    ]);
    expect(report.sources.map((source) => source.path)).not.toEqual(
      expect.arrayContaining(["README.md", "CODEOWNERS", ".mcp.json"]),
    );
    expect(
      report.sources.find(
        (source) =>
          source.path === ".github/instructions/typescript.instructions.md",
      ),
    ).toEqual(
      expect.objectContaining({
        adapter: "copilot",
        scope: "src/**/*.ts",
        rulesExtracted: 1,
      }),
    );
  });

  it("preserves malformed Copilot metadata as bounded inventory evidence", async () => {
    const root = await repository();
    await writeRepoFile(
      root,
      ".github/instructions/bad.instructions.md",
      "---\napplyTo: ../outside/**\n---\nRun `pnpm test`.\n",
    );

    const report = await inventoryInstructions(root);

    expect(report.sources).toEqual([
      expect.objectContaining({
        path: ".github/instructions/bad.instructions.md",
        adapter: "copilot",
        scope: "invalid applyTo",
        rulesExtracted: 0,
      }),
    ]);
    expect(
      report.warnings.some((warning) =>
        warning.includes("must not escape the repository"),
      ),
    ).toBe(true);
  });

  it("exposes deterministic JSON through the CLI", async () => {
    const root = await repository();
    await writeRepoFile(root, "AGENTS.md", "Repository guidance.\n");
    await writeRepoFile(root, "README.md", "Repository documentation.\n");
    const output: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string) => {
      output.push(chunk);
      return true;
    };

    try {
      await main(["instructions", "scan", "--root", root, "--json"]);
    } finally {
      process.stdout.write = original;
    }

    expect(process.exitCode).toBe(0);
    const report = JSON.parse(output.join("")) as {
      adapters: string[];
      sources: Array<{ path: string; adapter: string }>;
    };
    expect(report.adapters).toEqual(["agents-md"]);
    expect(report.sources).toEqual([
      expect.objectContaining({ path: "AGENTS.md", adapter: "agents-md" }),
    ]);
  });
});
