import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isCopilotPathInstruction,
  parseCopilotApplyTo,
} from "../src/core/copilot.js";
import { evaluate } from "../src/core/evaluator.js";
import { scanRepository } from "../src/core/scanner.js";

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
  const root = await mkdtemp(join(tmpdir(), "guardspec-copilot-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("Copilot applyTo parsing", () => {
  it("recognizes only path-specific instruction filenames", () => {
    expect(
      isCopilotPathInstruction(
        ".github/instructions/nested/typescript.instructions.md",
      ),
    ).toBe(true);
    expect(
      isCopilotPathInstruction(".github/instructions/nested/notes.md"),
    ).toBe(false);
    expect(isCopilotPathInstruction("docs/typescript.instructions.md")).toBe(
      false,
    );
  });

  it("normalizes BOM, CRLF, quotes, separators and repository paths", () => {
    const parsed = parseCopilotApplyTo(
      '\uFEFF---\r\napplyTo: "./**/*.ts,src/**/*.tsx"\r\n---\r\nUse TypeScript.\r\n',
    );
    expect(parsed).toEqual({
      ok: true,
      patterns: ["**/*.ts", "src/**/*.tsx"],
    });
  });

  it.each([
    ["missing frontmatter", "applyTo: **/*.ts\nUse TypeScript."],
    ["unclosed frontmatter", "---\napplyTo: **/*.ts\nUse TypeScript."],
    ["missing applyTo", "---\ndescription: TypeScript\n---\nUse TypeScript."],
    ["repeated applyTo", "---\napplyTo: **/*.ts\napplyTo: src/**\n---"],
    ["empty applyTo", "---\napplyTo:\n---"],
    ["empty pattern", "---\napplyTo: **/*.ts,\n---"],
    ["absolute path", "---\napplyTo: /src/**/*.ts\n---"],
    ["repository escape", "---\napplyTo: ../src/**/*.ts\n---"],
    ["unterminated quote", '---\napplyTo: "**/*.ts\n---'],
  ])("rejects %s", (_name, content) => {
    expect(parseCopilotApplyTo(content).ok).toBe(false);
  });

  it("bounds pattern count and individual pattern length", () => {
    const tooMany = Array.from(
      { length: 65 },
      (_, index) => `src/${index}/**`,
    ).join(",");
    expect(parseCopilotApplyTo(`---\napplyTo: ${tooMany}\n---`).ok).toBe(
      false,
    );
    expect(
      parseCopilotApplyTo(`---\napplyTo: ${"a".repeat(513)}\n---`).ok,
    ).toBe(false);
  });
});

describe("Copilot path-specific scan semantics", () => {
  it("scopes checks to applyTo and fails closed for unsupported conditional rules", async () => {
    await withTempRepository(async (root) => {
      await writeRepoFile(
        root,
        ".github/instructions/nested/typescript.instructions.md",
        [
          "---",
          'applyTo: "**/*.ts,src/**/*.ts"',
          "---",
          "Before opening a pull request, run `pnpm test`.",
          "Do not modify `.github/workflows/**`.",
        ].join("\n"),
      );
      await writeRepoFile(
        root,
        ".github/instructions/invalid.instructions.md",
        "---\napplyTo: ../outside/**\n---\nBefore opening a pull request, run `bad command`.",
      );
      await writeRepoFile(
        root,
        ".github/instructions/notes.md",
        "Before opening a pull request, run `should-not-compile`.",
      );

      const report = await scanRepository(root);
      const source = report.sources.find((entry) =>
        entry.path.endsWith("typescript.instructions.md"),
      );
      expect(source?.scope).toBe("**/*.ts,src/**/*.ts");
      expect(source?.rulesExtracted).toBe(2);
      expect(
        report.sources.some((entry) => entry.path.endsWith("notes.md")),
      ).toBe(false);
      expect(
        report.warnings.some((warning) =>
          warning.includes(
            "cannot safely intersect these rule kinds with applyTo",
          ),
        ),
      ).toBe(true);
      expect(
        report.warnings.some(
          (warning) =>
            warning.includes("invalid.instructions.md") &&
            warning.includes("must not escape the repository"),
        ),
      ).toBe(true);
      expect(
        report.policy.rules.some((rule) => rule.value === "bad command"),
      ).toBe(false);
      expect(
        report.policy.rules.some(
          (rule) =>
            rule.provenance[0]?.source.endsWith("typescript.instructions.md") &&
            rule.kind !== "check",
        ),
      ).toBe(false);

      const matching = evaluate(report.policy, "path", "src/app.ts");
      expect(matching.requiredChecks).toEqual(["pnpm test"]);
      const nonMatching = evaluate(report.policy, "path", "docs/readme.md");
      expect(nonMatching.requiredChecks).toEqual([]);
    });
  });

  it("keeps repository-wide Copilot instructions repository-wide", async () => {
    await withTempRepository(async (root) => {
      await writeRepoFile(
        root,
        ".github/copilot-instructions.md",
        "Before opening a pull request, run `pnpm lint`.",
      );

      const report = await scanRepository(root);
      expect(report.sources).toHaveLength(1);
      expect(report.sources[0]?.scope).toBe("**");
      expect(report.policy.rules[0]?.scope).toBe("**");
      expect(
        evaluate(report.policy, "path", "docs/readme.md").requiredChecks,
      ).toEqual(["pnpm lint"]);
    });
  });
});
