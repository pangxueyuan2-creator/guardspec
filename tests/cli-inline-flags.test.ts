import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { manualProvenance, policyTemplate } from "../src/core/policy.js";
import type { CheckReport, PolicyRule } from "../src/core/types.js";

const temporary: string[] = [];
const originalExitCode = process.exitCode;

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = originalExitCode;
  await Promise.all(
    temporary
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function runCheck(argv: string[]): Promise<CheckReport> {
  const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  try {
    await main(argv);
    return JSON.parse(
      output.mock.calls.map(([chunk]) => String(chunk)).join(""),
    ) as CheckReport;
  } finally {
    output.mockRestore();
  }
}

describe("CLI inline flag values", () => {
  it.each([
    ["path", "config/a=b.json"],
    ["path", "config/a=b=c.json"],
    ["command", "npm publish --tag=latest"],
    ["command", "npm publish --tag=latest --access=public"],
  ] as const)("checks the complete %s target %j", async (kind, target) => {
    const root = await mkdtemp(join(tmpdir(), "guardspec-inline-flags-"));
    temporary.push(root);
    const rule = (
      id: string,
      effect: PolicyRule["effect"],
      scope: string,
    ): PolicyRule => ({
      id,
      kind,
      effect,
      scope,
      severity: "high",
      message: id,
      provenance: [manualProvenance()],
    });
    await writeFile(
      join(root, ".agent-policy.yml"),
      JSON.stringify(
        policyTemplate("inline-flags", [
          rule("allow-all", "allow", "**"),
          rule("deny-target", "deny", target),
        ]),
      ),
    );
    const common = ["check", "--root", root, "--json", "--strict-unknown"];
    const separated = await runCheck([...common, `--${kind}`, target]);
    expect(separated.decisions[0]).toMatchObject({
      target,
      status: "denied",
    });
    expect(process.exitCode).toBe(2);

    const inline = await runCheck([...common, `--${kind}=${target}`]);
    expect(inline).toEqual(separated);
    expect(process.exitCode).toBe(2);
  });
});
