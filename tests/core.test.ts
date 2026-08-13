import { describe, expect, it } from "vitest";
import { evaluate, evaluateTask } from "../src/core/evaluator.js";
import { extractTextRules } from "../src/core/extract.js";
import {
  parsePolicy,
  policyTemplate,
  stringifyPolicy,
} from "../src/core/policy.js";
import { detectConflicts } from "../src/core/scanner.js";
import { normalizeRepositoryPath } from "../src/core/fs-safe.js";
import type { Policy, PolicyRule } from "../src/core/types.js";

function rule(
  id: string,
  effect: PolicyRule["effect"],
  scope: string,
): PolicyRule {
  return {
    id,
    kind: "path",
    effect,
    scope,
    severity: "high",
    message: id,
    provenance: [
      {
        source: "AGENTS.md",
        line: 1,
        adapter: "agents-md",
        excerpt: id,
        confidence: "high",
      },
    ],
  };
}

describe("policy parser", () => {
  it("parses and serializes a stable policy", () => {
    const policy = policyTemplate("demo", [
      rule("deny-ci", "deny", ".github/workflows/**"),
    ]);
    const parsed = parsePolicy(stringifyPolicy(policy));
    expect(parsed.name).toBe("demo");
    expect(parsed.rules[0]?.id).toBe("deny-ci");
  });
  it("rejects duplicate ids and malformed schemas", () => {
    expect(() =>
      parsePolicy("version: 1\nname: x\nrules: []\nunknown: true"),
    ).toThrow("Invalid policy schema");
    expect(() =>
      parsePolicy(
        `version: 1\nname: x\nrules:\n  - ${JSON.stringify(rule("same", "allow", "src/**"))}\n  - ${JSON.stringify(rule("same", "deny", "src/**"))}`,
      ),
    ).toThrow();
  });
});

describe("deterministic evaluator", () => {
  const policy: Policy = {
    version: 1,
    name: "demo",
    rules: [
      rule("allow-auth", "allow", "src/auth/**"),
      rule("deny-ci", "deny", ".github/workflows/**"),
      {
        id: "required-test",
        kind: "check",
        effect: "require",
        scope: "**",
        value: "node --test",
        severity: "medium",
        message: "Run tests",
        provenance: [
          {
            source: "AGENTS.md",
            line: 4,
            adapter: "agents-md",
            excerpt: "test",
            confidence: "high",
          },
        ],
      },
      {
        id: "owner-review",
        kind: "approval",
        effect: "require",
        scope: "src/payments/**",
        severity: "medium",
        message: "Owner review",
        provenance: [
          {
            source: "CODEOWNERS",
            line: 1,
            adapter: "codeowners",
            excerpt: "owners",
            confidence: "high",
          },
        ],
      },
    ],
  };
  it("allows a scoped source change and denies a protected workflow", () => {
    expect(evaluate(policy, "path", "src/auth/session.ts").status).toBe(
      "allowed",
    );
    expect(evaluate(policy, "path", ".github/workflows/ci.yml").status).toBe(
      "denied",
    );
  });
  it("requires approval for owned paths and returns required checks", () => {
    const decision = evaluate(policy, "path", "src/payments/card.ts");
    expect(decision.status).toBe("approval-required");
    expect(decision.requiredChecks).toEqual(["node --test"]);
  });
  it("reports equal-scope allow deny conflicts", () => {
    const conflicted = {
      ...policy,
      rules: [...policy.rules, rule("deny-auth", "deny", "src/auth/**")],
    };
    expect(evaluate(conflicted, "path", "src/auth/session.ts").status).toBe(
      "conflict",
    );
    expect(detectConflicts(conflicted.rules)).toHaveLength(1);
  });
  it("evaluates a multi-action task with stable denied exit code", () => {
    const report = evaluateTask(policy, {
      paths: ["src/auth/session.ts", ".github/workflows/ci.yml"],
      commands: ["node --test"],
    });
    expect(report.valid).toBe(false);
    expect(report.exitCode).toBe(2);
  });
});

describe("extraction and path safety", () => {
  it("extracts explicit path, check and disclosure rules with provenance", () => {
    const rules = extractTextRules(
      "AGENTS.md",
      "agents-md",
      "Only modify `src/安全/**`.\nDo not modify `.github/workflows/**`.\nBefore opening a pull request, run `npm test`.\nAI-assisted contributions must disclose AI assistance.",
    );
    expect(rules.map((entry) => entry.kind)).toContain("path");
    expect(
      rules.some(
        (entry) => entry.kind === "check" && entry.value === "npm test",
      ),
    ).toBe(true);
    expect(rules.some((entry) => entry.kind === "disclosure")).toBe(true);
  });
  it("rejects traversal, absolute and Windows drive paths", () => {
    expect(() => normalizeRepositoryPath("../secret")).toThrow();
    expect(() => normalizeRepositoryPath("/etc/passwd")).toThrow();
    expect(() => normalizeRepositoryPath("C:\\Windows\\System32")).toThrow();
    expect(normalizeRepositoryPath("src/安全/file.ts")).toBe(
      "src/安全/file.ts",
    );
  });
});
