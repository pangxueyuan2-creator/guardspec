import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { assessRuleRelayCompatibility } from "../src/core/rule-relay-compatibility.js";

const temporary: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(
    join(tmpdir(), "guardspec-rule-relay-validation-"),
  );
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

describe("RuleRelay validation parity", () => {
  it("fails closed when legacy pnpm shorthand validation is not reproduced", async () => {
    const root = await repository();
    await writeRepoFile(
      root,
      "AGENTS.md",
      "Before merging, run `pnpm test`.\n",
    );
    await writeRepoFile(
      root,
      "package.json",
      '{"scripts":{"lint":"eslint ."}}\n',
    );

    const report = await assessRuleRelayCompatibility(root);

    expect(report.ready).toBe(false);
    expect(report.validation.expectedFindings).toEqual([
      {
        code: "MISSING_PACKAGE_SCRIPT",
        severity: "error",
        file: "AGENTS.md",
      },
    ]);
    expect(report.validation.matchedFindings).toEqual([]);
    expect(report.validation.missingFindings).toEqual(
      report.validation.expectedFindings,
    );
    expect(report.blockers).toEqual([
      expect.objectContaining({
        code: "LEGACY_VALIDATION_FINDING_NOT_REPRODUCED",
        file: "AGENTS.md",
        detail: "error MISSING_PACKAGE_SCRIPT",
      }),
    ]);
  });

  it("records matching legacy package-script findings without a parity blocker", async () => {
    const root = await repository();
    await writeRepoFile(
      root,
      "AGENTS.md",
      "Before merging, run `pnpm run test`.\n",
    );
    await writeRepoFile(
      root,
      "package.json",
      '{"scripts":{"lint":"eslint ."}}\n',
    );

    const report = await assessRuleRelayCompatibility(root);

    expect(report.validation.expectedFindings).toEqual([
      {
        code: "MISSING_PACKAGE_SCRIPT",
        severity: "error",
        file: "AGENTS.md",
      },
    ]);
    expect(report.validation.matchedFindings).toEqual(
      report.validation.expectedFindings,
    );
    expect(report.validation.missingFindings).toEqual([]);
    expect(report.blockers).toEqual([
      expect.objectContaining({
        code: "LEGACY_SOURCE_HYGIENE_ERROR",
        file: "AGENTS.md",
      }),
    ]);
    expect(report.blockers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "LEGACY_VALIDATION_FINDING_NOT_REPRODUCED",
        }),
      ]),
    );
  });

  it("reproduces legacy duplicate and Copilot applyTo finding identities", async () => {
    const root = await repository();
    await writeRepoFile(root, "AGENTS.md", "Keep changes focused.\n");
    await writeRepoFile(root, "CLAUDE.md", "Keep changes focused.\n");
    await writeRepoFile(
      root,
      ".github/instructions/bad.instructions.md",
      "---\napplyTo: ../outside/**\n---\nSecurity guidance.\n",
    );

    const report = await assessRuleRelayCompatibility(root);

    expect(report.validation.expectedFindings).toEqual([
      {
        code: "INVALID_COPILOT_APPLY_TO",
        severity: "error",
        file: ".github/instructions/bad.instructions.md",
      },
      {
        code: "DUPLICATE_INSTRUCTION",
        severity: "warning",
        file: "AGENTS.md",
      },
      {
        code: "DUPLICATE_INSTRUCTION",
        severity: "warning",
        file: "CLAUDE.md",
      },
    ]);
    expect(report.validation.matchedFindings).toEqual(
      report.validation.expectedFindings,
    );
    expect(report.validation.missingFindings).toEqual([]);
    expect(report.blockers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "LEGACY_VALIDATION_FINDING_NOT_REPRODUCED",
        }),
      ]),
    );
  });

  it("reproduces repository-bounded legacy local-link findings", async () => {
    const root = await repository();
    await writeRepoFile(root, "docs/guide.md", "# Guide\n");
    await writeRepoFile(
      root,
      "AGENTS.md",
      [
        "Read the [guide](docs/guide.md).",
        "The [docs directory](docs) is also valid.",
        "Do not trust a [missing page](docs/missing.md).",
        "Never follow [outside](../outside.md).",
      ].join("\n"),
    );

    const report = await assessRuleRelayCompatibility(root);

    expect(report.validation.expectedFindings).toEqual([
      {
        code: "DEAD_LOCAL_LINK",
        severity: "error",
        file: "AGENTS.md",
      },
      {
        code: "UNSAFE_LOCAL_LINK",
        severity: "error",
        file: "AGENTS.md",
      },
    ]);
    expect(report.validation.matchedFindings).toEqual(
      report.validation.expectedFindings,
    );
    expect(report.validation.missingFindings).toEqual([]);
    expect(report.blockers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "LEGACY_VALIDATION_FINDING_NOT_REPRODUCED",
        }),
      ]),
    );
  });

  it(
    "fails closed when RuleRelay treats another URI scheme as a local link",
    async () => {
      const root = await repository();
      await writeRepoFile(
        root,
        "AGENTS.md",
        "Inspect the [local artifact](file:missing.md) before release.\n",
      );

      const report = await assessRuleRelayCompatibility(root);

      expect(report.validation.expectedFindings).toEqual([
        {
          code: "DEAD_LOCAL_LINK",
          severity: "error",
          file: "AGENTS.md",
        },
      ]);
      expect(report.validation.matchedFindings).toEqual([]);
      expect(report.validation.missingFindings).toEqual(
        report.validation.expectedFindings,
      );
      expect(report.blockers).toEqual([
        expect.objectContaining({
          code: "LEGACY_VALIDATION_FINDING_NOT_REPRODUCED",
          file: "AGENTS.md",
          detail: "error DEAD_LOCAL_LINK",
        }),
      ]);
    },
  );

  it("exposes validation parity blockers through CLI JSON and exit status", async () => {
    const root = await repository();
    await writeRepoFile(root, "AGENTS.md", "Run `pnpm test`.\n");
    await writeRepoFile(root, "package.json", '{"scripts":{}}\n');
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
      validation: {
        missingFindings: Array<{
          code: string;
          severity: string;
          file: string;
        }>;
      };
      blockers: Array<{ code: string; file: string }>;
    };
    expect(report.ready).toBe(false);
    expect(report.validation.missingFindings).toEqual([
      {
        code: "MISSING_PACKAGE_SCRIPT",
        severity: "error",
        file: "AGENTS.md",
      },
    ]);
    expect(report.blockers).toEqual([
      expect.objectContaining({
        code: "LEGACY_VALIDATION_FINDING_NOT_REPRODUCED",
        file: "AGENTS.md",
      }),
    ]);
  });
});
