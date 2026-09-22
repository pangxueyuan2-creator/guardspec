import { describe, expect, it } from "vitest";
import { evaluate, evaluateTask } from "../src/core/evaluator.js";
import type { Policy, PolicyRule } from "../src/core/types.js";

function rule(
  id: string,
  effect: PolicyRule["effect"],
  scope: string,
  kind: PolicyRule["kind"] = "path",
): PolicyRule {
  return {
    id,
    kind,
    effect,
    scope,
    severity: "high",
    message: id,
    provenance: [],
  };
}

const policy: Policy = {
  version: 1,
  name: "preflight-paths",
  rules: [
    rule("allow-all", "allow", "**"),
    rule("deny-ci", "deny", ".github/workflows/**"),
    rule("require-owners", "require", "src/owned/**", "approval"),
  ],
};

describe("repository-relative preflight paths", () => {
  it.each([
    "src/../.github/workflows/ci.yml",
    "src\\..\\.github\\workflows\\ci.yml",
    "../outside.txt",
    ".github/./workflows/ci.yml",
    ".github//workflows/ci.yml",
    "/repo/.github/workflows/ci.yml",
    "\\repo\\.github\\workflows\\ci.yml",
    "C:\\repo\\.github\\workflows\\ci.yml",
    "C:.github/workflows/ci.yml",
    "./C:.github/workflows/ci.yml",
    "\\\\server\\share\\ci.yml",
    "//server/share/ci.yml",
    "src/invalid\0.ts",
    "",
    ".",
    "./",
  ])("denies invalid path %j even with a broad allow", (target) => {
    const decision = evaluate(policy, "path", target);
    expect(decision).toMatchObject({
      allowed: false,
      status: "denied",
      target,
      matchedRules: [],
    });
    expect(decision.reason).toMatch(/repository-relative path/i);

    for (const strictUnknown of [false, true]) {
      const report = evaluateTask(
        policy,
        { paths: [target] },
        { strictUnknown },
      );
      expect(report.valid).toBe(false);
      expect(report.exitCode).toBe(2);
    }
  });

  it.each([
    ".github/workflows/ci.yml",
    "./.github/workflows/ci.yml",
    "././.github/workflows/ci.yml",
    ".github\\workflows\\ci.yml",
    ".\\.github\\workflows\\ci.yml",
  ])(
    "keeps deny precedence for canonical and common path forms %j",
    (target) => {
      const decision = evaluate(policy, "path", target);
      expect(decision.status).toBe("denied");
      expect(decision.matchedRules.map((entry) => entry.id)).toEqual([
        "deny-ci",
      ]);
    },
  );

  it("preserves allows, owner approval and equal-specificity conflicts", () => {
    expect(evaluate(policy, "path", "./src\\safe file.ts").status).toBe(
      "allowed",
    );
    expect(evaluate(policy, "path", "././src/owned/card.ts").status).toBe(
      "approval-required",
    );
    expect(
      evaluate(
        {
          ...policy,
          rules: [
            ...policy.rules,
            rule("allow-ci", "allow", ".github/workflows/**"),
          ],
        },
        "path",
        "././.github/workflows/ci.yml",
      ).status,
    ).toBe("conflict");
  });

  it("rejects invalid direct approval queries without authorizing the target", () => {
    expect(evaluate(policy, "approval", "../outside.txt")).toMatchObject({
      allowed: false,
      status: "denied",
    });
  });

  it("does not interpret commands or MCP names as repository paths", () => {
    const nonPathPolicy: Policy = {
      version: 1,
      name: "non-paths",
      rules: [
        rule("allow-command", "allow", "node ../scripts/check.js", "command"),
        rule("allow-server", "allow", "../server", "mcp"),
      ],
    };
    expect(
      evaluate(nonPathPolicy, "command", "node ../scripts/check.js").status,
    ).toBe("allowed");
    expect(evaluate(nonPathPolicy, "mcp", "../server").status).toBe("allowed");
  });
});
