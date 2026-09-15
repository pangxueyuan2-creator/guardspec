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
    expect(report.targetChecks).toEqual([]);
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

  it("audits supplemental legacy sources before declaring migration readiness", async () => {
    const root = await repository();
    await writeRepoFile(
      root,
      "packages/api/claude.md",
      "See [missing guidance](./missing.md).\n",
    );

    const report = await assessRuleRelayCompatibility(root);

    expect(report.ready).toBe(false);
    expect(report.matchedSources).toEqual([
      {
        path: "packages/api/claude.md",
        adapter: "claude",
        scope: "packages/api/**",
      },
    ]);
    expect(report.blockers).toEqual([
      expect.objectContaining({
        code: "LEGACY_SOURCE_HYGIENE_ERROR",
        file: "packages/api/claude.md",
      }),
    ]);
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

  it("proves target-level parity for nested scopes and Copilot applyTo", async () => {
    const root = await repository();
    await writeRepoFile(root, "AGENTS.md", "Repository guidance.\n");
    await writeRepoFile(
      root,
      "packages/api/CLAUDE.md",
      "Package API guidance.\n",
    );
    await writeRepoFile(
      root,
      ".github/copilot-instructions.md",
      "Repository Copilot guidance.\n",
    );
    await writeRepoFile(
      root,
      ".github/instructions/api.instructions.md",
      "---\napplyTo: packages/api/**/*.ts\n---\nAPI TypeScript guidance.\n",
    );
    await writeRepoFile(
      root,
      "packages/api/AGENTS.override.md",
      "GuardSpec-only package override.\n",
    );

    const report = await assessRuleRelayCompatibility(root, [
      "packages/web/src/app.ts",
      "packages/api/src/server.ts",
    ]);

    expect(report.ready).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.targetChecks.map((target) => target.target)).toEqual([
      "packages/api/src/server.ts",
      "packages/web/src/app.ts",
    ]);

    const api = report.targetChecks[0]!;
    expect(api.expectedApplicableSources.map((source) => source.path)).toEqual([
      ".github/copilot-instructions.md",
      ".github/instructions/api.instructions.md",
      "AGENTS.md",
      "packages/api/CLAUDE.md",
    ]);
    expect(api.matchedApplicableSources.map((source) => source.path)).toEqual(
      api.expectedApplicableSources.map((source) => source.path),
    );
    expect(api.expandedApplicableSources.map((source) => source.path)).toEqual([
      "packages/api/AGENTS.override.md",
    ]);

    const web = report.targetChecks[1]!;
    expect(web.expectedApplicableSources.map((source) => source.path)).toEqual([
      ".github/copilot-instructions.md",
      "AGENTS.md",
    ]);
    expect(web.matchedApplicableSources.map((source) => source.path)).toEqual(
      web.expectedApplicableSources.map((source) => source.path),
    );
  });

  it("fails closed when GuardSpec broadens a legacy Copilot glob", async () => {
    const root = await repository();
    await writeRepoFile(
      root,
      ".github/instructions/brackets.instructions.md",
      "---\napplyTo: src/[ab].ts\n---\nLegacy bracket pattern.\n",
    );

    const report = await assessRuleRelayCompatibility(root, ["src/a.ts"]);

    expect(report.ready).toBe(false);
    expect(report.targetChecks).toHaveLength(1);
    expect(report.targetChecks[0]!.expectedApplicableSources).toEqual([]);
    expect(report.targetChecks[0]!.blockers).toEqual([
      expect.objectContaining({
        code: "LEGACY_TARGET_SCOPE_EXPANDED",
        file: ".github/instructions/brackets.instructions.md",
        target: "src/a.ts",
      }),
    ]);
    expect(report.blockers).toEqual(report.targetChecks[0]!.blockers);
  });

  it("accepts repeatable CLI targets and emits deterministic target JSON", async () => {
    const root = await repository();
    await writeRepoFile(root, "AGENTS.md", "Repository guidance.\n");
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
        "--target",
        "z/file.ts",
        "--target",
        "a/file.ts",
        "--json",
      ]);
    } finally {
      process.stdout.write = original;
    }

    expect(process.exitCode).toBe(0);
    const report = JSON.parse(output.join("")) as {
      ready: boolean;
      targetChecks: Array<{ target: string; ready: boolean }>;
    };
    expect(report.ready).toBe(true);
    expect(
      report.targetChecks.map(({ target, ready }) => ({ target, ready })),
    ).toEqual([
      { target: "a/file.ts", ready: true },
      { target: "z/file.ts", ready: true },
    ]);
  });

  it("rejects unsafe compatibility targets through the explain boundary", async () => {
    const root = await repository();
    await writeRepoFile(root, "AGENTS.md", "Repository guidance.\n");

    await expect(
      assessRuleRelayCompatibility(root, ["../outside.ts"]),
    ).rejects.toThrow("must stay inside the repository");
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
