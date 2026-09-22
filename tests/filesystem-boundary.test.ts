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
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/bin.js";
import { renderAdapter, writeAdapter } from "../src/adapters/generate.js";
import { MAX_FILE_BYTES } from "../src/core/fs-safe.js";
import {
  loadPolicy,
  manualProvenance,
  policyTemplate,
  stringifyPolicy,
  writePolicy,
} from "../src/core/policy.js";

const temporary: string[] = [];
const boundaryError = /symbolic link|symlink|escapes repository root/i;

async function workspace() {
  const base = await mkdtemp(join(tmpdir(), "guardspec-file-boundary-"));
  temporary.push(base);
  const root = join(base, "repository");
  const outside = join(base, "outside-canary");
  await mkdir(root);
  await mkdir(outside);
  return { root, outside };
}

async function directoryLink(target: string, link: string) {
  await symlink(
    target,
    link,
    process.platform === "win32" ? "junction" : "dir",
  );
}

async function rejectedCli(root: string, args: string[]) {
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  await main([...args, "--root", root]);
  expect(process.exitCode).toBe(4);
  expect(stdout).not.toHaveBeenCalled();
  expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join("")).toMatch(
    boundaryError,
  );
}

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("policy filesystem boundaries", () => {
  it("rejects a policy read through an external directory link", async () => {
    const { root, outside } = await workspace();
    await writeFile(
      join(outside, "policy.yml"),
      stringifyPolicy(policyTemplate("outside-canary", [])),
    );
    await directoryLink(outside, join(root, "linked"));
    await expect(loadPolicy(root, "linked/policy.yml")).rejects.toThrow(
      boundaryError,
    );
  });

  it.each([false, true])(
    "rejects writing an external policy through a directory link (existing: %s)",
    async (existing) => {
      const { root, outside } = await workspace();
      const canary = join(outside, "policy.yml");
      if (existing) await writeFile(canary, "unchanged outside canary\n");
      await directoryLink(outside, join(root, "linked"));
      await expect(
        writePolicy(root, policyTemplate("local", []), "linked/policy.yml"),
      ).rejects.toThrow(boundaryError);
      expect(existsSync(canary)).toBe(existing);
      if (existing)
        expect(await readFile(canary, "utf8")).toBe(
          "unchanged outside canary\n",
        );
    },
  );

  it.each([
    ["policy", "validate"],
    ["check", "--path", "src/example.ts"],
    ["explain", "src/example.ts"],
  ])("fails closed in the policy CLI: %s %s", async (...args) => {
    const { root, outside } = await workspace();
    await writeFile(
      join(outside, "policy.yml"),
      stringifyPolicy(policyTemplate("outside-canary", [])),
    );
    await directoryLink(outside, join(root, "linked"));
    await rejectedCli(root, [
      ...args,
      "--policy",
      "linked/policy.yml",
      "--json",
    ]);
  });

  it("accepts the read size limit and rejects one byte more before parsing", async () => {
    const { root } = await workspace();
    const base = stringifyPolicy(policyTemplate("sized", []));
    const atLimit =
      base +
      "#" +
      "x".repeat(MAX_FILE_BYTES - Buffer.byteLength(base) - 2) +
      "\n";
    await writeFile(join(root, ".agent-policy.yml"), atLimit);
    expect((await loadPolicy(root)).name).toBe("sized");
    await writeFile(join(root, ".agent-policy.yml"), atLimit + "\n");
    await expect(loadPolicy(root)).rejects.toThrow(/oversized/i);
  });

  it("keeps ordinary reads and writes working when the selected root is a directory alias", async () => {
    const { root, outside } = await workspace();
    const alias = join(outside, "selected-root");
    await directoryLink(root, alias);
    const policy = policyTemplate("normal", []);
    await writePolicy(alias, policy);
    expect(await loadPolicy(alias)).toEqual(policy);
    await writeAdapter(alias, "cursor", policy);
    expect(
      await readFile(join(root, ".cursor/rules/guardspec.mdc"), "utf8"),
    ).toBe(renderAdapter("cursor", policy));
    await writeAdapter(alias, "cursor", policyTemplate("regenerated", []));
    expect(
      await readFile(join(root, ".cursor/rules/guardspec.mdc"), "utf8"),
    ).toContain("regenerated");
  });
});

describe("adapter filesystem boundaries", () => {
  it.each([
    ["copilot", ".github", "copilot-instructions.md"],
    ["cursor", ".cursor", "rules/guardspec.mdc"],
  ])(
    "rejects %s generation before creating any external file or parent",
    async (agent, directory, target) => {
      const { root, outside } = await workspace();
      await directoryLink(outside, join(root, directory));
      await expect(
        writeAdapter(root, agent, policyTemplate("local", [])),
      ).rejects.toThrow(boundaryError);
      expect(existsSync(join(outside, target))).toBe(false);
      expect(existsSync(join(outside, "rules"))).toBe(false);
    },
  );

  it("preserves an external file even if it has the generated marker", async () => {
    const { root, outside } = await workspace();
    const content = renderAdapter(
      "copilot",
      policyTemplate("outside-canary", []),
    );
    const canary = join(outside, "copilot-instructions.md");
    await writeFile(canary, content);
    await directoryLink(outside, join(root, ".github"));
    await expect(
      writeAdapter(root, "copilot", policyTemplate("local", [])),
    ).rejects.toThrow(boundaryError);
    expect(await readFile(canary, "utf8")).toBe(content);
  });

  it.each([
    ["copilot", ".github", "copilot-instructions.md"],
    ["cursor", ".cursor", "rules/guardspec.mdc"],
  ])(
    "rejects %s CLI generation without external side effects",
    async (agent, directory, target) => {
      const { root, outside } = await workspace();
      await writePolicy(root, policyTemplate("local", []));
      await directoryLink(outside, join(root, directory));
      await rejectedCli(root, ["adapters", "generate", agent, "--json"]);
      expect(existsSync(join(outside, target))).toBe(false);
      expect(existsSync(join(outside, "rules"))).toBe(false);
    },
  );

  it("does not create directories if rendering fails", async () => {
    const { root } = await workspace();
    const policy = policyTemplate("local", []);
    Object.defineProperty(policy, "name", {
      get() {
        throw new Error("synthetic render failure");
      },
    });
    await expect(writeAdapter(root, "cursor", policy)).rejects.toThrow(
      "synthetic render failure",
    );
    expect(existsSync(join(root, ".cursor"))).toBe(false);
  });

  it.each(["policy", "adapter"])(
    "does not overwrite an existing %s with output larger than its read limit",
    async (kind) => {
      const { root } = await workspace();
      const policy = policyTemplate("large", [
        {
          id: "oversized-scope",
          kind: "path",
          effect: "deny",
          scope: "é".repeat(MAX_FILE_BYTES),
          severity: "high",
          message: "Synthetic oversized scope",
          provenance: [manualProvenance()],
        },
      ]);
      const target = join(
        root,
        kind === "policy" ? ".agent-policy.yml" : "AGENTS.md",
      );
      const original =
        kind === "policy"
          ? stringifyPolicy(policyTemplate("original", []))
          : renderAdapter("agents", policyTemplate("original", []));
      await writeFile(target, original);
      const operation =
        kind === "policy"
          ? writePolicy(root, policy)
          : writeAdapter(root, "agents", policy);
      await expect(operation).rejects.toThrow(/oversized/i);
      expect(await readFile(target, "utf8")).toBe(original);
    },
  );
});

// File symlinks require privileges unavailable on ordinary Windows hosts.
// Directory-junction cases above always run on Windows; Linux CI also exercises leaves.
describe.skipIf(process.platform === "win32")("file symlink boundaries", () => {
  it.each([false, true])(
    "rejects writing through a policy file symlink (dangling: %s)",
    async (dangling) => {
      const { root, outside } = await workspace();
      const canary = join(outside, "policy.yml");
      const original = stringifyPolicy(policyTemplate("outside-canary", []));
      if (!dangling) await writeFile(canary, original);
      await symlink(canary, join(root, ".agent-policy.yml"), "file");
      await expect(
        writePolicy(root, policyTemplate("local", [])),
      ).rejects.toThrow(boundaryError);
      expect(existsSync(canary)).toBe(!dangling);
      if (!dangling) {
        await expect(loadPolicy(root)).rejects.toThrow(boundaryError);
        expect(await readFile(canary, "utf8")).toBe(original);
      }
    },
  );

  it.each([
    ["init", "--force"],
    ["scan", "--write", "--force"],
  ])("rejects the %s CLI even with force", async (...args) => {
    const { root, outside } = await workspace();
    const canary = join(outside, "policy.yml");
    const original = stringifyPolicy(policyTemplate("outside-canary", []));
    await writeFile(canary, original);
    await symlink(canary, join(root, ".agent-policy.yml"), "file");
    await rejectedCli(root, [...args, "--json"]);
    expect(await readFile(canary, "utf8")).toBe(original);
  });

  it.each([false, true])(
    "rejects an adapter file symlink (dangling: %s)",
    async (dangling) => {
      const { root, outside } = await workspace();
      const canary = join(outside, "instructions.md");
      const original = renderAdapter(
        "agents",
        policyTemplate("outside-canary", []),
      );
      if (!dangling) await writeFile(canary, original);
      await symlink(canary, join(root, "AGENTS.md"), "file");
      await expect(
        writeAdapter(root, "agents", policyTemplate("local", [])),
      ).rejects.toThrow(boundaryError);
      expect(existsSync(canary)).toBe(!dangling);
      if (!dangling) expect(await readFile(canary, "utf8")).toBe(original);
    },
  );
});
