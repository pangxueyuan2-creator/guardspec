import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { scanRepository } from "../src/core/scanner.js";
import { safeRead } from "../src/core/fs-safe.js";
import { isDirectInvocation, main } from "../src/cli.js";

const ROOT = resolve(import.meta.dirname, "..");
const FIXTURES = join(ROOT, "tests", "fixtures");
const temporary: string[] = [];
async function copyFixture(name: string): Promise<string> {
  const target = await mkdtemp(join(tmpdir(), `guardspec-${name}-`));
  temporary.push(target);
  await cp(join(FIXTURES, name), target, { recursive: true });
  return target;
}
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map(async (path) => rm(path, { recursive: true, force: true })),
  );
});

describe("repository scanning", () => {
  it("compiles Python AGENTS, Copilot and CODEOWNERS sources", async () => {
    const root = await copyFixture("python-repo");
    const report = await scanRepository(root);
    expect(report.sources.map((source) => source.adapter)).toEqual(
      expect.arrayContaining(["agents-md", "copilot", "codeowners"]),
    );
    expect(
      report.policy.rules.some(
        (rule) =>
          rule.scope === ".github/workflows/**" && rule.effect === "deny",
      ),
    ).toBe(true);
    expect(report.policy.rules.some((rule) => rule.kind === "approval")).toBe(
      true,
    );
  });
  it("discovers Cursor and nested Monorepo instructions", async () => {
    const node = await copyFixture("node-repo");
    const mono = await copyFixture("monorepo");
    expect(
      (await scanRepository(node)).sources.some(
        (source) => source.adapter === "cursor",
      ),
    ).toBe(true);
    expect(
      (await scanRepository(mono)).sources.filter(
        (source) => source.adapter === "agents-md",
      ),
    ).toHaveLength(2);
  });
  it("reports instruction conflicts instead of silently selecting one", async () => {
    const root = await copyFixture("conflict-repo");
    expect((await scanRepository(root)).conflicts).toHaveLength(1);
  });
  it("does not follow symlink escapes", async () => {
    const root = await copyFixture("security-repo");
    const outside = await mkdtemp(join(tmpdir(), "guardspec-outside-"));
    temporary.push(outside);
    await writeFile(join(outside, "secret.txt"), "secret", "utf8");
    try {
      await symlink(join(outside, "secret.txt"), join(root, "escaped.txt"));
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (
        process.platform === "win32" &&
        (err.code === "EPERM" || err.code === "EACCES")
      ) {
        return;
      }
      throw error;
    }
    await expect(safeRead(root, "escaped.txt")).rejects.toThrow();
  });
});

describe("CLI behavior", () => {
  it("executes the built ESM entry point", () => {
    execFileSync(
      process.execPath,
      [
        join(ROOT, "node_modules", "typescript", "bin", "tsc"),
        "-p",
        "tsconfig.json",
      ],
      { cwd: ROOT, stdio: "pipe" },
    );
    const result = spawnSync(
      process.execPath,
      [join(ROOT, "dist", "cli.js"), "--help"],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
  });
  it("initializes, checks, emits JSON, and generates an adapter", async () => {
    const root = await copyFixture("python-repo");
    const output: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string) => {
      output.push(chunk);
      return true;
    };

    try {
      await main(["init", "--root", root]);
      await main([
        "check",
        "--root",
        root,
        "--path",
        "src/module.py",
        "--json",
      ]);
      await main(["adapters", "generate", "cursor", "--root", root]);
    } finally {
      process.stdout.write = original;
    }
    expect(existsSync(join(root, ".agent-policy.yml"))).toBe(true);
    expect(existsSync(join(root, ".cursor/rules/guardspec.mdc"))).toBe(true);
    expect(output.join("")).toContain("Created .agent-policy.yml");
  });
  it("compiles a scanned repository into agent-boundary/v1 JSON", async () => {
    const root = await copyFixture("python-repo");
    const output: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string) => {
      output.push(String(chunk));
      return true;
    };
    try {
      await main(["init", "--root", root]);
      await main(["compile", "--root", root, "--json"]);
    } finally {
      process.stdout.write = original;
    }
    const compiled = output.join("");
    expect(compiled).toContain("agent-boundary/v1");
    expect(compiled).toContain("exclusive_allow");
    expect(compiled).toContain("allowed_paths");
  });
  it.skipIf(process.platform === "win32")(
    "runs the committed demo script against a real temporary Git tree",
    () => {
      const pnpm = spawnSync("pnpm", ["--version"], { encoding: "utf8" });
      const bash = spawnSync("bash", ["--version"], { encoding: "utf8" });
      if (pnpm.error || pnpm.status !== 0 || bash.error || bash.status !== 0) {
        return;
      }
      execFileSync("pnpm", ["build"], { cwd: ROOT, stdio: "pipe" });
      const result = spawnSync("bash", ["demo/run-demo.sh"], {
        cwd: ROOT,
        encoding: "utf8",
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        "correctly blocked the CI workflow change",
      );
      expect(result.stdout).toContain("Actual diff");
    },
  );
  it("treats Windows-style argv1 as a direct invocation of the same file", () => {
    const abs = resolve(join(ROOT, "src", "cli.ts"));
    const meta = pathToFileURL(abs).href;
    expect(isDirectInvocation(meta, abs)).toBe(true);
    expect(isDirectInvocation(meta, undefined)).toBe(false);
    expect(isDirectInvocation(meta, join(ROOT, "src", "index.ts"))).toBe(false);
    if (process.platform === "win32") {
      expect(meta === `file://${abs}`).toBe(false);
      expect(isDirectInvocation(meta, abs.replaceAll("/", "\\"))).toBe(true);
      expect(isDirectInvocation(meta, abs.toUpperCase())).toBe(true);
    }
  });
  it("spawns the compiled CLI and prints usage instead of silently exiting", () => {
    execFileSync(
      process.execPath,
      [join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"],
      { cwd: ROOT, stdio: "pipe" },
    );
    const cli = join(ROOT, "dist", "cli.js");
    expect(existsSync(cli)).toBe(true);
    const help = spawnSync(process.execPath, [cli, "--help"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("guardspec compile");
    expect(help.stdout.length).toBeGreaterThan(40);
    const compile = spawnSync(
      process.execPath,
      [cli, "compile", "--json", "--root", join(FIXTURES, "python-repo")],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(compile.status).toBe(0);
    expect(compile.stdout).toContain("agent-boundary/v1");
  });
});
