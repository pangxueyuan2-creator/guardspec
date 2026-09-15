import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { auditInstructions } from "../src/core/instruction-hygiene.js";
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
  const root = await mkdtemp(join(tmpdir(), "guardspec-hygiene-"));
  temporary.push(root);
  await run(root);
}

afterEach(async () => {
  process.exitCode = undefined;
  await Promise.all(
    temporary
      .splice(0)
      .map(async (path) => rm(path, { recursive: true, force: true })),
  );
});

describe("instruction hygiene audit", () => {
  it("accepts valid local links and declared package scripts", async () => {
    await withTempRepository(async (root) => {
      await writeRepoFile(
        root,
        "package.json",
        JSON.stringify({ scripts: { test: "vitest run" } }),
      );
      await writeRepoFile(root, "docs/guide.md", "# Guide\n");
      await writeRepoFile(
        root,
        "AGENTS.md",
        "Read [the guide](docs/guide.md).\nBefore opening a pull request, run `npm run test`.\n",
      );

      const report = await auditInstructions(root);
      expect(report.valid).toBe(true);
      expect(report.errors).toBe(0);
      expect(report.warnings).toBe(0);
      expect(report.findings).toEqual([]);
    });
  });

  it("fails closed for invalid applyTo, dead or escaping links, and missing scripts", async () => {
    await withTempRepository(async (root) => {
      await writeRepoFile(
        root,
        "package.json",
        JSON.stringify({ scripts: { test: "vitest run" } }),
      );
      await writeRepoFile(
        root,
        "AGENTS.md",
        [
          "Read [missing docs](docs/missing.md).",
          "Do not follow [outside](../outside.md).",
          "Before opening a pull request, run `npm run missing`.",
        ].join("\n"),
      );
      await writeRepoFile(
        root,
        ".github/instructions/bad.instructions.md",
        "---\napplyTo: ../outside/**\n---\nKeep changes small.\n",
      );

      const report = await auditInstructions(root);
      expect(report.valid).toBe(false);
      expect(report.errors).toBe(4);
      expect(new Set(report.findings.map((finding) => finding.code))).toEqual(
        new Set([
          "DEAD_LOCAL_LINK",
          "INVALID_COPILOT_APPLY_TO",
          "MISSING_PACKAGE_SCRIPT",
          "UNSAFE_LOCAL_LINK",
        ]),
      );
    });
  });

  it("uses the nearest package manifest and resolves nested links within the repository", async () => {
    await withTempRepository(async (root) => {
      await writeRepoFile(
        root,
        "package.json",
        JSON.stringify({ scripts: { root: "echo root" } }),
      );
      await writeRepoFile(root, "docs/api.md", "# API\n");
      await writeRepoFile(
        root,
        "packages/api/package.json",
        JSON.stringify({ scripts: { "test:api": "vitest run" } }),
      );
      await writeRepoFile(
        root,
        "packages/api/AGENTS.md",
        [
          "Read [API docs](../../docs/api.md).",
          "Run `npm run test:api` before review.",
          "Do not assume `npm run root` exists in this package.",
        ].join("\n"),
      );

      const report = await auditInstructions(root);
      expect(report.errors).toBe(1);
      expect(report.findings).toEqual([
        expect.objectContaining({
          code: "MISSING_PACKAGE_SCRIPT",
          file: "packages/api/AGENTS.md",
          detail: "Command: npm run root",
        }),
      ]);
    });
  });

  it("reports deterministic duplicate warnings and lets strict mode promote warnings to failure", async () => {
    await withTempRepository(async (root) => {
      await writeRepoFile(root, "AGENTS.md", "Shared guidance.\n");
      await writeRepoFile(root, "packages/api/AGENTS.md", "Shared guidance.\n");

      const first = await auditInstructions(root);
      const second = await auditInstructions(root);
      expect(second).toEqual(first);
      expect(first.valid).toBe(true);
      expect(first.errors).toBe(0);
      expect(first.warnings).toBe(2);
      expect(
        first.findings.every(
          (finding) => finding.code === "DUPLICATE_INSTRUCTION",
        ),
      ).toBe(true);

      const output: string[] = [];
      const original = process.stdout.write.bind(process.stdout);
      process.stdout.write = (chunk: string) => {
        output.push(chunk);
        return true;
      };
      try {
        process.exitCode = undefined;
        await main(["instructions", "check", "--root", root, "--json"]);
        expect(process.exitCode).toBe(0);
        expect(JSON.parse(output.at(-1) ?? "{}")).toMatchObject({
          errors: 0,
          warnings: 2,
          valid: true,
        });

        process.exitCode = undefined;
        await main(["instructions", "check", "--root", root, "--strict"]);
        expect(process.exitCode).toBe(4);
      } finally {
        process.stdout.write = original;
      }
    });
  });

  it("surfaces symlinked instruction sources without traversing or reading them", async () => {
    if (process.platform === "win32") return;

    await withTempRepository(async (root) => {
      await writeRepoFile(
        root,
        "real-instructions.md",
        "Do not modify secrets/**.\n",
      );
      await writeRepoFile(
        root,
        "real-rules/hidden.md",
        "Not directly discoverable.\n",
      );
      await symlink("real-instructions.md", join(root, "AGENTS.md"), "file");
      await symlink(
        "real-instructions.md",
        join(root, "notes-link.md"),
        "file",
      );
      await symlink("real-rules", join(root, "linked-rules"), "dir");

      const scan = await scanRepository(root);
      expect(scan.sources).toEqual([]);
      expect(scan.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "Skipped symlinked instruction source: AGENTS.md",
          ),
          expect.stringContaining("Skipped symlinked directory: linked-rules"),
        ]),
      );
      expect(
        scan.warnings.some((warning) => warning.includes("notes-link.md")),
      ).toBe(false);

      const report = await auditInstructions(root);
      expect(report.valid).toBe(true);
      expect(report.errors).toBe(0);
      expect(report.warnings).toBe(1);
      expect(report.findings).toEqual([
        expect.objectContaining({
          code: "SYMLINKED_INSTRUCTION_SOURCE",
          severity: "warning",
          file: "AGENTS.md",
          detail: "Target: real-instructions.md",
        }),
      ]);

      process.exitCode = undefined;
      await main(["instructions", "check", "--root", root]);
      expect(process.exitCode).toBe(0);
      process.exitCode = undefined;
      await main(["instructions", "check", "--root", root, "--strict"]);
      expect(process.exitCode).toBe(4);
    });
  });
});
