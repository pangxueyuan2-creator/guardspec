import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main as binMain } from "../src/bin.js";
import { auditInstructions } from "../src/core/instruction-hygiene.js";
import { auditRuleRelayLegacyInstructions } from "../src/core/rule-relay-check.js";

const temporary: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "guardspec-rule-relay-check-"));
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

afterEach(async () => {
  process.exitCode = undefined;
  await Promise.all(
    temporary
      .splice(0)
      .map(async (path) => rm(path, { recursive: true, force: true })),
  );
});

describe("RuleRelay check migration bridge", () => {
  it("surfaces legacy-only validation without changing default GuardSpec hygiene", async () => {
    const root = await repository();
    await writeRepoFile(
      root,
      "AGENTS.md",
      [
        "Before merging, run `pnpm test`.",
        "Inspect the [local artifact](file:missing.md).",
      ].join("\n"),
    );
    await writeRepoFile(root, "package.json", '{"scripts":{}}\n');

    const guardSpec = await auditInstructions(root);
    const legacy = await auditRuleRelayLegacyInstructions(root);

    expect(guardSpec.findings).toEqual([]);
    expect(legacy).toEqual(
      expect.objectContaining({
        schema: "guardspec.dev/rule-relay-check/v1",
        root,
        sources: 1,
        errors: 2,
        warnings: 0,
        valid: false,
      }),
    );
    expect(legacy.findings).toEqual([
      {
        code: "DEAD_LOCAL_LINK",
        severity: "error",
        file: "AGENTS.md",
      },
      {
        code: "MISSING_PACKAGE_SCRIPT",
        severity: "error",
        file: "AGENTS.md",
      },
    ]);
  });

  it("exposes the legacy audit through instructions check --compat rule-relay", async () => {
    const root = await repository();
    await writeRepoFile(root, "AGENTS.md", "Run `pnpm test`.\n");
    await writeRepoFile(root, "package.json", '{"scripts":{}}\n');

    const output = await captureStdout(async () =>
      binMain([
        "instructions",
        "check",
        "--compat",
        "rule-relay",
        "--root",
        root,
        "--json",
      ]),
    );

    expect(process.exitCode).toBe(4);
    const report = JSON.parse(output) as {
      schema: string;
      errors: number;
      warnings: number;
      findings: Array<{ code: string; file: string }>;
    };
    expect(report.schema).toBe("guardspec.dev/rule-relay-check/v1");
    expect(report.errors).toBe(1);
    expect(report.warnings).toBe(0);
    expect(report.findings).toEqual([
      {
        code: "MISSING_PACKAGE_SCRIPT",
        severity: "error",
        file: "AGENTS.md",
      },
    ]);
  });

  it("matches RuleRelay strict warning behavior", async () => {
    const root = await repository();
    await writeRepoFile(root, "AGENTS.md", "Keep changes focused.\n");
    await writeRepoFile(root, "CLAUDE.md", "Keep changes focused.\n");

    await captureStdout(async () =>
      binMain([
        "instructions",
        "check",
        "--compat=rule-relay",
        "--root",
        root,
        "--json",
      ]),
    );
    expect(process.exitCode).toBe(0);

    process.exitCode = undefined;
    const strictOutput = await captureStdout(async () =>
      binMain([
        "instructions",
        "check",
        "--compat=rule-relay",
        "--strict",
        `--root=${root}`,
        "--json",
      ]),
    );
    expect(process.exitCode).toBe(4);
    const report = JSON.parse(strictOutput) as {
      errors: number;
      warnings: number;
    };
    expect(report.errors).toBe(0);
    expect(report.warnings).toBe(2);
  });

  it("delegates the default instructions check unchanged", async () => {
    const root = await repository();
    await writeRepoFile(root, "AGENTS.md", "Run `pnpm test`.\n");
    await writeRepoFile(root, "package.json", '{"scripts":{}}\n');

    const output = await captureStdout(async () =>
      binMain(["instructions", "check", "--root", root, "--json"]),
    );

    expect(process.exitCode).toBe(0);
    const report = JSON.parse(output) as { findings: unknown[] };
    expect(report.findings).toEqual([]);
  });
});
