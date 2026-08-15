import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isDirectCliInvocation } from "../src/cli.js";

const ROOT = resolve(import.meta.dirname, "..");

describe("CLI entrypoint path comparison", () => {
  it("does not treat POSIX file://${argv} as equal to a Windows argv path", () => {
    const argv1 = "C:\\Users\\tongx\\oss-work\\guardspec\\dist\\cli.js";
    const importMetaUrl =
      "file:///C:/Users/tongx/oss-work/guardspec/dist/cli.js";
    // Node on Windows reports file:///C:/...; naive file://${argv} keeps backslashes.
    const naivePosixJoin = "file://" + argv1;
    expect(naivePosixJoin).not.toEqual(importMetaUrl);
    expect(isDirectCliInvocation(importMetaUrl, argv1)).toBe(true);
  });

  it("matches this module's own import.meta.url to its filesystem path", () => {
    expect(
      isDirectCliInvocation(import.meta.url, fileURLToPath(import.meta.url)),
    ).toBe(true);
  });

  it("matches pathToFileURL(argv) the way Node presents import.meta.url", () => {
    const argv1 = join(ROOT, "dist", "cli.js");
    expect(isDirectCliInvocation(pathToFileURL(argv1).href, argv1)).toBe(true);
  });

  it("rejects a different script path", () => {
    expect(
      isDirectCliInvocation(import.meta.url, join(ROOT, "dist", "cli.js")),
    ).toBe(false);
  });
});

describe("compiled CLI process", () => {
  it("prints usage when invoked as node dist/cli.js --help", () => {
    const cli = join(ROOT, "dist", "cli.js");
    if (!existsSync(cli)) {
      const built = spawnSync(
        process.execPath,
        [
          join(dirname(process.execPath), "npx"),
          "--yes",
          "pnpm@10.22.0",
          "exec",
          "tsc",
          "-p",
          "tsconfig.json",
        ],
        { cwd: ROOT, encoding: "utf8" },
      );
      if (!existsSync(cli)) {
        expect(
          existsSync(cli),
          `dist/cli.js missing; tsc: ${built.stderr}`,
        ).toBe(true);
        return;
      }
    }
    const result = spawnSync(process.execPath, [cli, "--help"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("guardspec check");
  });
});
