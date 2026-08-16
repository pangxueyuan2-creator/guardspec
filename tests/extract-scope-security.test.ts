import { describe, expect, it } from "vitest";
import { evaluate } from "../src/core/evaluator.js";
import { extractCodeowners, extractTextRules } from "../src/core/extract.js";
import { policyTemplate } from "../src/core/policy.js";

function policyFor(lines: string) {
  return policyTemplate(
    "scope",
    extractTextRules("AGENTS.md", "agents-md", lines),
  );
}

describe("directory tokens govern their children", () => {
  it("protects a dotted directory mentioned with 'the' and a noun", () => {
    const policy = policyFor("Protect the .github/workflows directory.");
    expect(evaluate(policy, "path", ".github/workflows/ci.yml").status).toBe(
      "denied",
    );
  });

  it("denies children of a dotted directory path", () => {
    const policy = policyFor("Do not modify .github/actions.");
    expect(evaluate(policy, "path", ".github/actions/release.sh").status).toBe(
      "denied",
    );
  });

  it("denies children of an undotted directory path", () => {
    const policy = policyFor("Do not modify src/security.");
    expect(evaluate(policy, "path", "src/security/util.py").status).toBe(
      "denied",
    );
  });

  it("still denies exact dotfile targets", () => {
    const policy = policyFor("Never modify .gitignore.");
    expect(evaluate(policy, "path", ".gitignore").status).toBe("denied");
  });

  it("keeps file-like tokens exact", () => {
    const policy = policyFor("Never modify calculator.py.");
    expect(evaluate(policy, "path", "calculator.py").status).toBe("denied");
    expect(evaluate(policy, "path", "calculator.py.bak").status).toBe(
      "not-covered",
    );
  });
});

describe("CODEOWNERS root-anchored patterns", () => {
  it("requires approval for children of /docs/", () => {
    const policy = policyTemplate(
      "co",
      extractCodeowners("CODEOWNERS", "/docs/ @docs"),
    );
    expect(evaluate(policy, "path", "docs/readme.md").status).toBe(
      "approval-required",
    );
  });

  it("requires approval for /README.md", () => {
    const policy = policyTemplate(
      "co",
      extractCodeowners("CODEOWNERS", "/README.md @docs"),
    );
    expect(evaluate(policy, "path", "README.md").status).toBe(
      "approval-required",
    );
  });

  it("does not over-require for paths outside the anchored directory", () => {
    const policy = policyTemplate(
      "co",
      extractCodeowners("CODEOWNERS", "/docs/ @docs"),
    );
    expect(evaluate(policy, "path", "src/app.ts").status).toBe("not-covered");
  });
});

describe("glob negation in extracted scopes", () => {
  it("treats a leading-bang token literally instead of inverting the rule", () => {
    const policy = policyFor("Do not modify !important.md");
    expect(evaluate(policy, "path", "other.py").status).toBe("not-covered");
    expect(evaluate(policy, "path", "important.md").status).toBe("not-covered");
  });
});
