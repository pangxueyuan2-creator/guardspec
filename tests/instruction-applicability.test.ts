import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { explainInstructions } from "../src/core/instruction-applicability.js";

const temporary: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "guardspec-instruction-explain-"));
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

describe("instruction source applicability", () => {
  it("orders specific sources first without precedence metadata", async () => {
    const root = await repository();
    await writeRepoFile(root, "AGENTS.md", "Run `pnpm test`.\n");
    await writeRepoFile(
      root,
      "packages/api/AGENTS.md",
      "Run `pnpm test:api`.\n",
    );
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
        'applyTo: "packages/api/**/*.ts,src/**/*.ts"',
        "---",
        "Before opening a pull request, run `pnpm typecheck`.",
      ].join("\n"),
    );
    await writeRepoFile(
      root,
      "packages/web/.github/copilot-instructions.md",
      "Before opening a pull request, run `pnpm test:web`.\n",
    );
    await writeRepoFile(
      root,
      ".claude/rules/conditional.md",
      "Conditional Claude rule.\n",
    );
    await writeRepoFile(
      root,
      ".cursor/rules/conditional.mdc",
      "Conditional Cursor rule.\n",
    );

    const report = await explainInstructions(
      root,
      "packages/api/src/server.ts",
    );
    const paths = report.applicable.map((entry) => entry.path);
    expect(paths.slice(0, 2)).toEqual([
      "packages/api/AGENTS.md",
      ".github/instructions/typescript.instructions.md",
    ]);
    expect(paths).toEqual(
      expect.arrayContaining([
        ".cursorrules",
        ".github/copilot-instructions.md",
        ".github/instructions/typescript.instructions.md",
        "AGENTS.md",
        "CLAUDE.md",
        "GEMINI.md",
        "opencode.json",
        "packages/api/AGENTS.md",
      ]),
    );
    expect(paths).not.toContain("packages/web/.github/copilot-instructions.md");
    expect(
      report.applicable.find(
        (entry) =>
          entry.path === ".github/instructions/typescript.instructions.md",
      )?.matchedScopes,
    ).toEqual(["packages/api/**/*.ts"]);
    expect(report.indeterminate.map((entry) => entry.path)).toEqual([
      ".claude/rules/conditional.md",
      ".cursor/rules/conditional.mdc",
    ]);
    expect(report.applicable.every((entry) => !("precedence" in entry))).toBe(
      true,
    );
  });

  it("orders nested exact-name sources first", async () => {
    const root = await repository();
    for (const name of [
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
      ".cursorrules",
    ]) {
      await writeRepoFile(root, name, `Root ${name} guidance.\n`);
      await writeRepoFile(
        root,
        `packages/api/${name}`,
        `Package ${name} guidance.\n`,
      );
    }
    await writeRepoFile(
      root,
      ".github/copilot-instructions.md",
      "Repository Copilot guidance.\n",
    );
    await writeRepoFile(
      root,
      ".github/instructions/api.instructions.md",
      [
        "---",
        'applyTo: "packages/api/**/*.ts"',
        "---",
        "Package Copilot guidance.",
      ].join("\n"),
    );

    const report = await explainInstructions(
      root,
      "packages/api/src/server.ts",
    );

    expect(report.applicable.map((entry) => entry.path)).toEqual([
      "packages/api/AGENTS.md",
      "packages/api/CLAUDE.md",
      ".github/instructions/api.instructions.md",
      "packages/api/.cursorrules",
      "packages/api/GEMINI.md",
      "AGENTS.md",
      "CLAUDE.md",
      ".github/copilot-instructions.md",
      ".cursorrules",
      "GEMINI.md",
    ]);
    expect(report.applicable.every((entry) => !("precedence" in entry))).toBe(
      true,
    );
  });

  it("composes root and nested Copilot repository scopes for sibling targets", async () => {
    const root = await repository();
    await writeRepoFile(
      root,
      ".github/copilot-instructions.md",
      "Repository guidance.\n",
    );
    await writeRepoFile(
      root,
      "packages/api/.github/copilot-instructions.md",
      "API guidance.\n",
    );
    await writeRepoFile(
      root,
      "packages/web/.github/copilot-instructions.md",
      "Web guidance.\n",
    );

    const api = await explainInstructions(root, "packages/api/src/server.ts");
    expect(api.applicable.map((entry) => entry.path)).toEqual([
      "packages/api/.github/copilot-instructions.md",
      ".github/copilot-instructions.md",
    ]);

    const web = await explainInstructions(root, "packages/web/src/page.ts");
    expect(web.applicable.map((entry) => entry.path)).toEqual([
      "packages/web/.github/copilot-instructions.md",
      ".github/copilot-instructions.md",
    ]);
  });

  it("surfaces malformed Copilot applyTo as indeterminate and preserves warnings", async () => {
    const root = await repository();
    await writeRepoFile(
      root,
      ".github/instructions/bad.instructions.md",
      "---\napplyTo: ../outside/**\n---\nDo not modify `src/**`.\n",
    );

    const report = await explainInstructions(root, "src/app.ts");
    expect(report.applicable).toEqual([]);
    expect(report.indeterminate).toEqual([
      expect.objectContaining({
        path: ".github/instructions/bad.instructions.md",
        adapter: "copilot",
      }),
    ]);
    expect(
      report.warnings.some((warning) =>
        warning.includes("must not escape the repository"),
      ),
    ).toBe(true);
  });

  it.each(["../secret", "/etc/passwd", "C:\\secret", "\\\\server\\share"])(
    "rejects unsafe target %s",
    async (target) => {
      await expect(explainInstructions(".", target)).rejects.toThrow(
        /repository-relative|inside the repository/,
      );
    },
  );

  it("exposes specificity ordering through CLI JSON", async () => {
    const root = await repository();
    await writeRepoFile(root, "AGENTS.md", "Repository guidance.\n");
    await writeRepoFile(
      root,
      "packages/api/AGENTS.md",
      "Package guidance.\n",
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
        "explain",
        "packages/api/src/app.ts",
        "--root",
        root,
        "--json",
      ]);
    } finally {
      process.stdout.write = original;
    }

    expect(process.exitCode).toBe(0);
    const report = JSON.parse(output.join("")) as {
      target: string;
      applicable: Array<{ path: string }>;
    };
    expect(report.target).toBe("packages/api/src/app.ts");
    expect(report.applicable.map((entry) => entry.path)).toEqual([
      "packages/api/AGENTS.md",
      "AGENTS.md",
    ]);
  });
});
