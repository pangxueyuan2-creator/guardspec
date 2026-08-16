import { describe, expect, it } from "vitest";
import { evaluate } from "../src/core/evaluator.js";
import { extractTextRules } from "../src/core/extract.js";
import { policyTemplate } from "../src/core/policy.js";
import type { Policy, PolicyRule } from "../src/core/types.js";

function policyFor(lines: string) {
  return policyTemplate(
    "multipath",
    extractTextRules("AGENTS.md", "agents-md", lines),
  );
}

function scopes(lines: string): string[] {
  return extractTextRules("AGENTS.md", "agents-md", lines)
    .filter((rule) => rule.kind === "path")
    .map((rule) => rule.scope);
}

describe("multi-path extraction", () => {
  it("extracts both paths from an or-separated deny line", () => {
    expect(scopes("Do not modify a.py or b.py")).toEqual(["a.py", "b.py"]);
  });

  it("extracts comma lists including a trailing or", () => {
    expect(scopes("Do not modify src, docs, or scripts.")).toEqual([
      "src/**",
      "docs/**",
      "scripts/**",
    ]);
  });

  it("extracts Chinese path lists", () => {
    expect(scopes("禁止修改 src、docs 或者 scripts 和 tools")).toEqual([
      "src/**",
      "docs/**",
      "scripts/**",
      "tools/**",
    ]);
  });

  it("does not turn a second verb clause into a path", () => {
    expect(scopes("Do not modify src or run tests")).toEqual(["src/**"]);
  });

  it("extracts protect-the-following lists", () => {
    expect(scopes("Protect the following paths: src, private-dir")).toEqual([
      "src/**",
      "private-dir/**",
    ]);
  });

  it("extracts only-modify-the-following allow lists", () => {
    const policy = policyFor(
      "You may only modify the following files: src/app.ts, src/lib.ts",
    );
    expect(evaluate(policy, "path", "src/app.ts").status).toBe("allowed");
    expect(evaluate(policy, "path", "src/lib.ts").status).toBe("allowed");
    expect(evaluate(policy, "path", "docs/x.md").status).toBe("not-covered");
  });
});

describe("required checks respect rule scope", () => {
  function checkRule(id: string, scope: string, value: string): PolicyRule {
    return {
      id,
      kind: "check",
      effect: "require",
      scope,
      value,
      severity: "medium",
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

  const policy: Policy = {
    version: 1,
    name: "scoped-checks",
    rules: [
      {
        id: "allow-all",
        kind: "path",
        effect: "allow",
        scope: "**",
        severity: "low",
        message: "allow all",
        provenance: [
          {
            source: "AGENTS.md",
            line: 1,
            adapter: "agents-md",
            excerpt: "allow all",
            confidence: "high",
          },
        ],
      },
      checkRule("global-check", "**", "npm test"),
      checkRule("src-check", "src/**", "npm run lint:src"),
    ],
  };

  it("attaches both checks inside the scoped directory", () => {
    const decision = evaluate(policy, "path", "src/app.ts");
    expect(decision.requiredChecks).toEqual(["npm test", "npm run lint:src"]);
  });

  it("attaches only the global check outside the scoped directory", () => {
    const decision = evaluate(policy, "path", "docs/readme.md");
    expect(decision.requiredChecks).toEqual(["npm test"]);
  });
});
