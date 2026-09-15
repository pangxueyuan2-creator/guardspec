import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { assessRuleRelayCompatibility } from "../src/core/rule-relay-compatibility.js";

const temporary: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "guardspec-rule-relay-compat-"));
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

describe("RuleRelay compatibility", () => {
  it("proves legacy discovery while reporting GuardSpec-only expanded coverage", async () => {
    const root = await repository();
    await writeRepoFile(root, "AGENTS.md", "Protect `src/core`.\n");
    await writeRepoFile(root, "CLAUDE.md", "Keep API edits focused.\n");
    await writeRepoFile(root, "GEMINI.md", "Use repository-local context.\n");
    await writeRepoFile(
      root,
      ".cursorrules",
      "Review changes before commit.\n",
    );
    await writeRepoFile(
      root,
      ".github/copilot-instructions.md",
      "Before opening a pull request, run `npm test`.\n",
    );
    await writeRepoFile(
      root,
      ".github/instructions/typescript.instructions.md",
      [
        "---",
        'applyTo: "src/**/*.ts"',
        "---",
        "Before opening a pull request, run `npm test`.",
      ].join("\n"),
    );
    await writeRepoFile(
      root,
      "package.json",
      '{"scripts":{"test":"vitest"}}\n',
    );
    await writeRepoFile(
      root,
      "AGENTS.override.md",
      "GuardSpec override coverage.\n",
    );
    await writeRepoFile(root, "opencode.json", "{}\n");

    const report = await assessRuleRelayCompatibility(root);

    expect(report.schema).toBe("guardspec.dev/rule-relay-compatibility/v1");
    expect(report.ready).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.expectedSources.map((source) => source.path)).toEqual([
      ".cursorrules",
      ".github/copilot-instructions.md",
      ".github/instructions/typescript.instructions.md",
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
    ]);
    expect(report.matchedSources).toHaveLength(report.expectedSources.length);
    expect(report.expandedSources.map((source) => source.path)).toEqual([
      "AGENTS.override.md",
      "opencode.json",
    ]);
    expect(report.replacementCommands.strictCheck).toContain("--strict");
  });

  it("proves nested RuleRelay exact-name sources with directory scopes", async () => {
    const root = await repository();
    await writeRepoFile(
      root,
      "packages/api/CLAUDE.md",
      "Keep API edits focused.\n",
    );
    await writeRepoFile(
      root,
      "packages/api/GEMINI.md",
      "Use package-local context.\n",
    );
    await writeRepoFile(
      root,
      "packages/api/.cursorrules",
      "Review package changes before commit.\n",
    );

    const report = await assessRuleRelayCompatibility(root);

    expect(report.ready).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.expectedSources).toHaveLength(3);
    expect(report.matchedSources).toEqual(
      expect.arrayContaining([
        {
          path: "packages/api/CLAUDE.md",
          adapter: "claude",
          scope: "packages/api/**",
        },
        {
          path: "packages/api/GEMINI.md",
          adapter: "gemini",
          scope: "packages/api/**",
        },
        {
          path: "packages/api/.cursorrules",
          adapter: "cursor",
          scope: "packages/api/**",
        },
      ]),
    );
  });

  it("proves case-insensitive RuleRelay exact-name discovery", async () => {
    const root = await repository();
    await writeRepoFile(
      root,
      "agents.md",
      "Legacy lowercase instruction source.\n",
    );
    await writeRepoFile(
      root,
      "packages/web/claude.md",
      "Legacy lowercase Claude source.\n",
    );
    await writeRepoFile(
      root,
      "packages/web/gemini.MD",
      "Legacy mixed-case Gemini source.\n",
    );
    await writeRepoFile(
      root,
      "packages/web/.CURSORRULES",
      "Legacy uppercase Cursor source.\n",
    );

    const report = await assessRuleRelayCompatibility(root);

    expect(report.ready).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.expectedSources).toHaveLength(4);
    expect(report.matchedSources).toEqual(
      expect.arrayContaining([
        { path: "agents.md", adapter: "agents-md", scope: "**" },
        {
          path: "packages/web/claude.md",
          adapter: "claude",
          scope: "packages/web/**",
        },
        {
          path: "packages/web/gemini.MD",
          adapter: "gemini",
          scope: "packages/web/**",
        },
        {
          path: "packages/web/.CURSORRULES",
          adapter: "cursor",
          scope: "packages/web/**",
        },
      ]),
    );
  });

  it("turns legacy-source hygiene errors into migration blockers", async () => {
    const root = await repository();
    await writeRepoFile(
      root,
      ".github/instructions/bad.instructions.md",
      "---\napplyTo: ../outside/**\n---\nKeep changes focused.\n",
    );

    const report = await assessRuleRelayCompatibility(root);

    expect(report.ready).toBe(false);
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "LEGACY_SOURCE_HYGIENE_ERROR",
          file: ".github/instructions/bad.instructions.md",
        }),
      ]),
    );
  });

  it("exposes blockers as deterministic CLI JSON and a blocking exit code", async () => {
    const root = await repository();
    await writeRepoFile(
      root,
      ".github/instructions/bad.instructions.md",
      "---\napplyTo: ../outside/**\n---\nKeep changes focused.\n",
    );
    const output: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string) => {
      output.push(chunk);
      return true;
    };

    try {
      await main([
        "instructions",
        "compatibility",
        "rule-relay",
        "--root",
        root,
        "--json",
      ]);
    } finally {
      process.stdout.write = original;
    }

    expect(process.exitCode).toBe(4);
    const report = JSON.parse(output.join("")) as {
      ready: boolean;
      blockers: Array<{ code: string; file: string }>;
    };
    expect(report.ready).toBe(false);
    expect(report.blockers).toEqual([
      expect.objectContaining({
        code: "LEGACY_SOURCE_HYGIENE_ERROR",
        file: ".github/instructions/bad.instructions.md",
      }),
    ]);
  });
});
