import { describe, expect, it } from "vitest";
import { evaluate } from "../src/core/evaluator.js";
import { extractTextRules } from "../src/core/extract.js";
import { policyTemplate } from "../src/core/policy.js";

function pathScope(text: string): string | undefined {
  return extractTextRules("AGENTS.md", "agents-md", text).find(
    (rule) => rule.kind === "path",
  )?.scope;
}

describe("unquoted path sentence punctuation", () => {
  const cases = [
    ["Never modify calculator.py.", "calculator.py"],
    ["Do not edit archive.tar.gz!", "archive.tar.gz"],
    ["Must not touch .gitignore?", ".gitignore"],
    ["Only modify src/core/**;", "src/core/**"],
    ["Protect path: config.yaml:", "config.yaml"],
    ["禁止修改 calculator.py。", "calculator.py"],
    ["不要改动 src/core/**！", "src/core/**"],
    ["仅能编辑 src/core/**；", "src/core/**"],
  ] as const;

  it.each(cases)("extracts %s as %s", (text, expected) => {
    expect(pathScope(text)).toBe(expected);
  });

  it("denies the real path instead of leaving it uncovered", () => {
    const rules = extractTextRules(
      "AGENTS.md",
      "agents-md",
      "Never modify calculator.py.",
    );
    const policy = policyTemplate("punctuation", rules);
    expect(evaluate(policy, "path", "calculator.py").status).toBe("denied");
  });

  it("preserves trailing punctuation inside a quoted path", () => {
    expect(pathScope("Never modify `calculator.py.`.")).toBe("calculator.py.");
  });
});
