import { describe, expect, it } from "vitest";
import { evaluateTask } from "../src/core/evaluator.js";
import { policyDigest, policyTemplate } from "../src/core/policy.js";
import { CHECK_SCHEMA_VERSION, type PolicyRule } from "../src/core/types.js";

function denyCalculator(): PolicyRule {
  return {
    id: "deny-calculator",
    kind: "path",
    effect: "deny",
    scope: "calculator.py",
    severity: "high",
    message: "do not touch calculator.py",
    provenance: [
      {
        source: "AGENTS.md",
        line: 1,
        adapter: "agents-md",
        excerpt: "Never modify calculator.py.",
        confidence: "high",
      },
    ],
  };
}

describe("check JSON contract", () => {
  it("emits stable digest and fail-closed decision fields", () => {
    const policy = policyTemplate("demo", [denyCalculator()]);
    const report = evaluateTask(policy, { paths: ["calculator.py"] });
    expect(report.schema_version).toBe(CHECK_SCHEMA_VERSION);
    expect(report.decision).toBe("deny");
    expect(report.valid).toBe(false);
    expect(report.exitCode).toBe(2);
    expect(report.matched_rules).toEqual(["deny-calculator"]);
    expect(report.protected_paths).toEqual(["calculator.py"]);
    expect(report.policy_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(report.policy_digest).toBe(policyDigest(policy));
  });

  it("keeps policy_digest stable when generatedAt and provenance change", () => {
    const first = policyTemplate("demo", [denyCalculator()]);
    const second = {
      ...first,
      generatedAt: "2099-01-01T00:00:00.000Z",
      rules: first.rules.map((rule) => ({
        ...rule,
        message: "rewritten prose",
        provenance: [
          {
            ...rule.provenance[0]!,
            excerpt: "different excerpt",
            line: 99,
          },
        ],
      })),
    };
    expect(policyDigest(first)).toBe(policyDigest(second));
  });

  it("reports allow when the requested path is not protected", () => {
    const policy = policyTemplate("demo", [denyCalculator()]);
    const report = evaluateTask(policy, { paths: ["README.md"] });
    expect(report.decision).toBe("allow");
    expect(report.valid).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.matched_rules).toEqual([]);
    expect(report.protected_paths).toEqual(["calculator.py"]);
  });
});
