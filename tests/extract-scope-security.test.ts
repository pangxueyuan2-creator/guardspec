import { describe, expect, it } from "vitest";
import { evaluate } from "../src/core/evaluator.js";
import { extractCodeowners, extractTextRules } from "../src/core/extract.js";
import { policyTemplate } from "../src/core/policy.js";

function policyFor(text: string) {
  return policyTemplate(
    "scope",
    extractTextRules("AGENTS.md", "agents-md", text),
  );
}

describe("extracted directory scopes", () => {
  it("protects a dotted directory mentioned with an article", () => {
    const policy = policyFor("Protect the .github/workflows directory.");
    expect(evaluate(policy, "path", ".github/workflows/ci.yml").status).toBe(
      "denied",
    );
  });

  it("denies children of dotted and undotted directory paths", () => {
    expect(
      evaluate(
        policyFor("Do not modify .github/actions."),
        "path",
        ".github/actions/release.sh",
      ).status,
    ).toBe("denied");
    expect(
      evaluate(
        policyFor("Do not modify src/security."),
        "path",
        "src/security/util.ts",
      ).status,
    ).toBe("denied");
  });

  it("keeps file-like tokens from overmatching sibling names", () => {
    const policy = policyFor("Never modify calculator.py.");
    expect(evaluate(policy, "path", "calculator.py").status).toBe("denied");
    expect(evaluate(policy, "path", "calculator.py.bak").status).toBe(
      "not-covered",
    );
  });

  it("covers the bare directory entry as well as its descendants", () => {
    const policy = policyFor("Do not modify src/security");
    expect(evaluate(policy, "path", "src/security").status).toBe("denied");
  });
});

describe("CODEOWNERS root anchors", () => {
  it("requires approval for root-anchored directory children", () => {
    const policy = policyTemplate(
      "co",
      extractCodeowners("CODEOWNERS", "/docs/ @docs"),
    );
    expect(evaluate(policy, "path", "docs/readme.md").status).toBe(
      "approval-required",
    );
    expect(evaluate(policy, "path", "src/app.ts").status).toBe("not-covered");
  });

  it("requires approval for a root-anchored file", () => {
    const policy = policyTemplate(
      "co",
      extractCodeowners("CODEOWNERS", "/README.md @docs"),
    );
    expect(evaluate(policy, "path", "README.md").status).toBe(
      "approval-required",
    );
  });
});

describe("leading bang scopes", () => {
  it("treats leading bang literally instead of negating the security rule", () => {
    const policy = policyFor("Do not modify !important.md");
    expect(evaluate(policy, "path", "other.py").status).toBe("not-covered");
    expect(evaluate(policy, "path", "important.md").status).toBe(
      "not-covered",
    );
    expect(evaluate(policy, "path", "!important.md").status).toBe("denied");
  });
});
