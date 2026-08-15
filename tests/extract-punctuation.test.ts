import { describe, expect, it } from "vitest";
import {
  extractPathToken,
  extractTextRules,
  normalizeUnquotedPathToken,
} from "../src/core/extract.js";
import { evaluate } from "../src/core/evaluator.js";
import { policyTemplate } from "../src/core/policy.js";

function denyScopes(text: string): string[] {
  return extractTextRules("AGENTS.md", "agents-md", text)
    .filter((rule) => rule.kind === "path" && rule.effect === "deny")
    .map((rule) => rule.scope);
}

describe("normalizeUnquotedPathToken", () => {
  it("strips trailing sentence punctuation without touching interior dots", () => {
    expect(normalizeUnquotedPathToken("calculator.py.")).toBe("calculator.py");
    expect(normalizeUnquotedPathToken("archive.tar.gz!")).toBe(
      "archive.tar.gz",
    );
    expect(normalizeUnquotedPathToken("v1.2.3,")).toBe("v1.2.3");
    expect(normalizeUnquotedPathToken(".gitignore.")).toBe(".gitignore");
    expect(normalizeUnquotedPathToken("src/**.")).toBe("src/**");
    expect(normalizeUnquotedPathToken("*.py.")).toBe("*.py");
  });

  it("does not use a character-class rstrip that would eat a legal trailing mark on a glob that needs ?", () => {
    expect(normalizeUnquotedPathToken("file?.ts")).toBe("file?.ts");
    expect(normalizeUnquotedPathToken("src/foo?.py.")).toBe("src/foo?.py");
    expect(normalizeUnquotedPathToken("file?")).toBe("file");
  });
});

describe("extractPathToken quoted vs unquoted", () => {
  it("keeps quoted literal punctuation and strips only unquoted sentence marks", () => {
    expect(extractPathToken("`calculator.py`.")).toBe("calculator.py");
    expect(extractPathToken('"calculator.py".')).toBe("calculator.py");
    expect(extractPathToken("`calculator.py.`.")).toBe("calculator.py.");
    expect(extractPathToken("`hello!`.")).toBe("hello!");
    expect(extractPathToken("calculator.py.")).toBe("calculator.py");
  });
});

describe("trailing punctuation extraction corpus", () => {
  const cases: Array<{ text: string; scope: string }> = [
    { text: "Never modify calculator.py.", scope: "calculator.py" },
    { text: "Never modify calculator.py!", scope: "calculator.py" },
    { text: "Never modify calculator.py?", scope: "calculator.py" },
    { text: "Never modify calculator.py,", scope: "calculator.py" },
    { text: "Never modify calculator.py;", scope: "calculator.py" },
    { text: "Never modify calculator.py:", scope: "calculator.py" },
    { text: "Never modify `calculator.py`.", scope: "calculator.py" },
    { text: 'Never modify "calculator.py".', scope: "calculator.py" },
    { text: "Never modify `calculator.py.`.", scope: "calculator.py." },
    { text: "禁止修改 calculator.py。", scope: "calculator.py" },
    { text: "禁止修改 calculator.py！", scope: "calculator.py" },
    { text: "禁止修改 calculator.py？", scope: "calculator.py" },
    { text: "Never modify archive.tar.gz.", scope: "archive.tar.gz" },
    { text: "Never modify v1.2.3.", scope: "v1.2.3" },
    { text: "Never modify .gitignore.", scope: ".gitignore" },
    { text: "Never modify src/**.", scope: "src/**" },
    { text: "Never modify *.py.", scope: "*.py" },
    { text: "Never modify file?.ts", scope: "file?.ts" },
    // Unquoted "hello!" is a sentence, not a file named hello!. scopeFor then
    // treats the undotted token as a directory tree.
    { text: "Never modify hello!", scope: "hello/**" },
  ];

  it.each(cases)("extracts $scope from $text", ({ text, scope }) => {
    expect(denyScopes(text)).toContain(scope);
  });
});

describe("false ALLOW / false DENY", () => {
  it("denies the real calculator.py when the instruction ends with a sentence period", () => {
    const rules = extractTextRules(
      "AGENTS.md",
      "agents-md",
      "Never modify calculator.py.",
    );
    expect(rules[0]?.scope).toBe("calculator.py");
    const policy = policyTemplate("punct", rules);
    expect(evaluate(policy, "path", "calculator.py").status).toBe("denied");
    expect(evaluate(policy, "path", "README.md").status).toBe("not-covered");
  });

  it("does not deny calculator.py when the quoted token is a different literal", () => {
    const rules = extractTextRules(
      "AGENTS.md",
      "agents-md",
      "Never modify `calculator.py.`.",
    );
    expect(rules[0]?.scope).toBe("calculator.py.");
    const policy = policyTemplate("literal-dot", rules);
    expect(evaluate(policy, "path", "calculator.py").status).toBe(
      "not-covered",
    );
    expect(evaluate(policy, "path", "calculator.py.").status).toBe("denied");
  });
});
