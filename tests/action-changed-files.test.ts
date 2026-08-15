import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveChangedFiles } from "../action/changed-files.js";

const temporary: string[] = [];

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "guardspec-action-"));
  temporary.push(root);
  git(root, "init");
  git(root, "config", "user.email", "tests@guardspec.dev");
  git(root, "config", "user.name", "GuardSpec Tests");
  await writeFile(join(root, "seed.txt"), "seed\n", "utf8");
  git(root, "add", "seed.txt");
  git(root, "commit", "-m", "seed");
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map(async (path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Action changed-file discovery", () => {
  it("fails closed when HEAD has no parent and no event base is available", async () => {
    const root = await repository();
    expect(() => resolveChangedFiles("", { cwd: root, eventPath: "" })).toThrow(
      "Unable to determine changed files",
    );
  });

  it("uses the pull-request base so earlier commits cannot evade the gate", async () => {
    const root = await repository();
    const base = git(root, "rev-parse", "HEAD");
    const workflow = join(root, ".github", "workflows", "ci.yml");
    await mkdir(join(root, ".github", "workflows"), { recursive: true });
    await writeFile(workflow, "name: changed\n", "utf8");
    git(root, "add", ".github/workflows/ci.yml");
    git(root, "commit", "-m", "change protected workflow");
    await writeFile(join(root, "README.md"), "follow-up\n", "utf8");
    git(root, "add", "README.md");
    git(root, "commit", "-m", "add harmless follow-up");

    const eventPath = join(root, "event.json");
    await writeFile(
      eventPath,
      JSON.stringify({ pull_request: { base: { sha: base } } }),
      "utf8",
    );
    expect(resolveChangedFiles("", { cwd: root, eventPath })).toEqual([
      ".github/workflows/ci.yml",
      "README.md",
    ]);
  });

  it("keeps spaced and Unicode paths as single entries", async () => {
    const root = await repository();
    const base = git(root, "rev-parse", "HEAD");
    await writeFile(join(root, "my file 安全.txt"), "payload\n", "utf8");
    git(root, "add", "my file 安全.txt");
    git(root, "commit", "-m", "unicode path");

    const eventPath = join(root, "event.json");
    await writeFile(
      eventPath,
      JSON.stringify({ pull_request: { base: { sha: base } } }),
      "utf8",
    );
    expect(resolveChangedFiles("", { cwd: root, eventPath })).toEqual([
      "my file 安全.txt",
    ]);
  });

  it("lists both sides of a protected-path rename", async () => {
    const root = await repository();
    await mkdir(join(root, ".github", "workflows"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, ".github", "workflows", "ci.yml"), "name: ci\n", "utf8");
    git(root, "add", ".github/workflows/ci.yml");
    git(root, "commit", "-m", "add workflow");
    const base = git(root, "rev-parse", "HEAD");
    git(root, "mv", ".github/workflows/ci.yml", "src/ci.yml");
    git(root, "commit", "-m", "rename workflow into src");

    const eventPath = join(root, "event.json");
    await writeFile(
      eventPath,
      JSON.stringify({ pull_request: { base: { sha: base } } }),
      "utf8",
    );
    const changed = resolveChangedFiles("", { cwd: root, eventPath }).sort();
    expect(changed).toEqual([".github/workflows/ci.yml", "src/ci.yml"]);
  });
});
