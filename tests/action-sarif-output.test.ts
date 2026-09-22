import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_FILE_BYTES } from "../src/core/fs-safe.js";
import {
  manualProvenance,
  policyTemplate,
  writePolicy,
} from "../src/core/policy.js";

const ROOT = resolve(import.meta.dirname, "..");
const temporary: string[] = [];
const refusal =
  "Refusing to write SARIF report to a symbolic link or non-regular file";

async function workspace(deny = false) {
  const base = await mkdtemp(join(tmpdir(), "guardspec-action-output-"));
  temporary.push(base);
  const root = join(base, "repository");
  await mkdir(root);
  await writePolicy(
    root,
    policyTemplate("sarif-fixture", [
      {
        id: "path-boundary",
        kind: "path",
        effect: deny ? "deny" : "allow",
        scope: "**",
        severity: "high",
        message:
          "Protected paths require a separately reviewed change before modifications can proceed.",
        provenance: [manualProvenance()],
      },
    ]),
  );
  const outputPath = join(base, "action-output.txt");
  await writeFile(outputPath, "");
  return { base, root, outputPath };
}

async function runAction(
  root: string,
  outputPath: string,
  paths = ["src/safe.ts"],
) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GITHUB_") || key.startsWith("INPUT_")) delete env[key];
  }
  Object.assign(env, {
    GITHUB_OUTPUT: outputPath,
    INPUT_POLICY: ".agent-policy.yml",
    "INPUT_CHANGED-FILES": paths.join("\n"),
    "INPUT_AI-ASSISTED": "false",
    "INPUT_FAIL-ON-WARN": "false",
  });
  const result = spawnSync(
    process.execPath,
    [join(ROOT, "action/dist/index.js")],
    {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  expect(result.error).toBeUndefined();
  return { ...result, outputs: await readFile(outputPath, "utf8") };
}

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("packaged Action SARIF output", () => {
  it.each([false, true])(
    "writes a regular report (existing: %s)",
    async (existing) => {
      const { root, outputPath } = await workspace();
      const target = join(root, ".guardspec.sarif");
      if (existing) await writeFile(target, "stale report\n");
      const result = await runAction(root, outputPath);
      expect(result.status).toBe(0);
      const report = JSON.parse(await readFile(target, "utf8")) as {
        version: string;
        runs: Array<{ results: unknown[] }>;
      };
      expect(report.version).toBe("2.1.0");
      expect(report.runs[0]?.results).toEqual([]);
      expect(result.outputs).toContain("sarif<<");
      expect(result.outputs).toContain(".guardspec.sarif");
    },
  );

  it("retains reports larger than the policy input limit", async () => {
    const { root, outputPath } = await workspace(true);
    const paths = Array.from(
      { length: 1600 },
      (_, index) => `src/file-${String(index).padStart(4, "0")}.ts`,
    );
    const result = await runAction(root, outputPath, paths);
    const contents = await readFile(join(root, ".guardspec.sarif"), "utf8");
    const report = JSON.parse(contents) as {
      runs: Array<{ results: unknown[] }>;
    };
    expect(Buffer.byteLength(contents)).toBeGreaterThan(MAX_FILE_BYTES);
    expect(report.runs[0]?.results).toHaveLength(paths.length);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("GuardSpec check failed with exit code 2");
    expect(result.outputs).toContain("sarif<<");
  });

  it("rejects an existing directory without publishing a SARIF path", async () => {
    const { root, outputPath } = await workspace();
    await mkdir(join(root, ".guardspec.sarif"));
    const result = await runAction(root, outputPath);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(refusal);
    expect(result.outputs).not.toContain("sarif<<");
  });

  it("rejects a directory link and preserves the outside canary", async () => {
    const { base, root, outputPath } = await workspace();
    const outside = join(base, "outside");
    await mkdir(outside);
    const canary = join(outside, "canary.txt");
    await writeFile(canary, "unchanged outside canary\n");
    await symlink(
      outside,
      join(root, ".guardspec.sarif"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const result = await runAction(root, outputPath);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(refusal);
    expect(result.outputs).not.toContain("sarif<<");
    expect(await readFile(canary, "utf8")).toBe("unchanged outside canary\n");
  });

  // File symlinks require privileges unavailable on ordinary Windows hosts.
  // Real POSIX leaf symlinks are exercised by the existing Linux CI jobs.
  it.skipIf(process.platform === "win32").each([false, true])(
    "rejects an outside file symlink (dangling: %s)",
    async (dangling) => {
      const { base, root, outputPath } = await workspace();
      const canary = join(base, "outside.sarif");
      if (!dangling) await writeFile(canary, "unchanged outside canary\n");
      await symlink(canary, join(root, ".guardspec.sarif"), "file");
      const result = await runAction(root, outputPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(refusal);
      expect(result.outputs).not.toContain("sarif<<");
      expect(existsSync(canary)).toBe(!dangling);
      if (!dangling)
        expect(await readFile(canary, "utf8")).toBe(
          "unchanged outside canary\n",
        );
    },
  );
});
