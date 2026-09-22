import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { main } from "../src/bin.js";
import { MAX_FILES, walkRepository } from "../src/core/fs-safe.js";
import { scanRepository } from "../src/core/repository-scan.js";
import { inventoryInstructions } from "../src/core/instruction-inventory.js";
import { auditInstructions } from "../src/core/instruction-hygiene.js";
import { assessRuleRelayCompatibility } from "../src/core/rule-relay-compatibility.js";
import { auditRuleRelayLegacyInstructions } from "../src/core/rule-relay-check.js";

const fixture = fileURLToPath(
  new URL("../demo/rule-relay-migration-repo/", import.meta.url),
);
let workspace: string;
let exactRoot: string;
let oversizedRoot: string;
const limitError = /exceeds.*2,?000.*incomplete/i;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "guardspec-discovery-limit-"));
  exactRoot = join(workspace, "exact");
  oversizedRoot = join(workspace, "oversized");
  await mkdir(exactRoot);
  await cp(fixture, oversizedRoot, { recursive: true });
  await mkdir(join(oversizedRoot, "000-fillers"));
  // Keep fixture creation bounded even on hosts with a low open-file limit.
  for (let start = 0; start < MAX_FILES; start += 50) {
    await Promise.all(
      Array.from({ length: Math.min(50, MAX_FILES - start) }, async (_, i) => {
        const name = `${String(start + i).padStart(4, "0")}.txt`;
        await writeFile(join(exactRoot, name), "fixture\n");
        await writeFile(join(oversizedRoot, "000-fillers", name), "fixture\n");
      }),
    );
  }
  await mkdir(join(oversizedRoot, "zzz-protected"));
  await writeFile(
    join(oversizedRoot, "zzz-protected", "AGENTS.md"),
    "Never modify `secrets/**`.\n",
  );
}, 20_000);

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  // A regressed scan --write must not affect the next CLI scenario.
  await rm(join(oversizedRoot, ".agent-policy.yml"), { force: true });
});

afterAll(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

describe("complete repository discovery", () => {
  it("accepts exactly the file limit and does not count ignored directories", async () => {
    await mkdir(join(exactRoot, "node_modules"), { recursive: true });
    await writeFile(join(exactRoot, "node_modules", "ignored.txt"), "ignored");
    const files = await walkRepository(exactRoot);
    expect(files).toHaveLength(MAX_FILES);
    expect(files).not.toContain("node_modules/ignored.txt");
  });

  it("rejects exactly one eligible file beyond the limit", async () => {
    const extra = join(exactRoot, "extra.txt");
    await writeFile(extra, "one file too many\n");
    try {
      await expect(walkRepository(exactRoot)).rejects.toThrow(limitError);
    } finally {
      await rm(extra);
    }
  });

  it.each(["scan", "init"])(
    "preserves a reviewed policy when %s --force cannot finish discovery",
    async (command) => {
      const policyPath = join(oversizedRoot, ".agent-policy.yml");
      const original =
        "# human-reviewed\nversion: 1\nname: retained\nrules: []\n";
      await writeFile(policyPath, original);
      const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      vi.spyOn(process.stderr, "write").mockReturnValue(true);
      await main([
        command,
        "--root",
        oversizedRoot,
        ...(command === "scan" ? ["--write"] : []),
        "--force",
      ]);
      expect(process.exitCode).toBe(4);
      expect(stdout).not.toHaveBeenCalled();
      expect(await readFile(policyPath, "utf8")).toBe(original);
    },
  );

  it.each([
    ["walk", walkRepository],
    ["scan", scanRepository],
    ["inventory", inventoryInstructions],
    ["hygiene", auditInstructions],
    ["migration readiness", assessRuleRelayCompatibility],
    ["legacy validation", auditRuleRelayLegacyInstructions],
  ] as const)("rejects a partial %s result", async (_name, inspect) => {
    await expect(inspect(oversizedRoot)).rejects.toThrow(limitError);
  });

  it.each([
    ["scan", "--json"],
    ["scan", "--write"],
    ["init"],
    ["instructions", "scan", "--json"],
    ["instructions", "check", "--json"],
    ["instructions", "check", "--compat", "rule-relay", "--json"],
    ["instructions", "explain", "src/server.ts", "--json"],
    ["instructions", "compatibility", "rule-relay", "--json"],
  ])("fails closed through the CLI: %s %s", async (...args) => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await main([...args, "--root", oversizedRoot]);
    expect(process.exitCode).toBe(4);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join("")).toMatch(
      limitError,
    );
    expect(existsSync(join(oversizedRoot, ".agent-policy.yml"))).toBe(false);
  });
});
