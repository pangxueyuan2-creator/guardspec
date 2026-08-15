import type {
  PolicyRule,
  Provenance,
  RuleEffect,
  RuleKind,
  SourceAdapter,
} from "./types.js";

const PATH_PATTERNS: Array<{
  expression: RegExp;
  effect: RuleEffect;
  message: string;
}> = [
  {
    // English + Chinese deny forms. Allow optional spaces so "禁止修改`path`" works.
    expression:
      /(?:do not|don't|never|forbid(?:den)?|must not|禁止|不要|切勿|不得)\s*(?:modify|edit|change|touch|修改|改动|编辑)\s*([`“"'「])?([^`”"'\s,，。；」]+)[`”"'」]?/i,
    effect: "deny",
    message: "Instruction forbids changes to this path.",
  },
  {
    expression:
      /(?:only|may only|只能|仅能|只允许)\s*(?:modify|edit|change|touch|修改|改动|编辑)\s*([`“"'「])?([^`”"'\s,，。；」]+)[`”"'」]?/i,
    effect: "allow",
    message: "Instruction limits changes to this path scope.",
  },
  {
    expression:
      /(?:protect|protected|保护|受保护)\s*(?:path|area|directory|file|路径|目录|文件)?\s*[:=-]?\s*([`“"'「])?([^`”"'\s,，。；」]+)/i,
    effect: "deny",
    message: "Instruction marks this path as protected.",
  },
];

const SENTENCE_SUFFIX = /[.!?,;:。！？、；：…]+$/u;

function pathToken(match: RegExpMatchArray): string | undefined {
  const token = match[2];
  if (!token || match[1]) return token;
  return token.replace(SENTENCE_SUFFIX, "") || token;
}

const COMMAND_PATTERNS: readonly [RegExp, RegExp] = [
  /(?:must|always|required to|before (?:committing|submitting|opening)|必须|需要|提交前|合并前)/i,
  /(?:run|execute|运行|执行)\s*[`“"']([^`”"']+)[`”"']/i,
];

function toId(
  adapter: SourceAdapter,
  kind: RuleKind,
  source: string,
  line: number,
): string {
  return `${adapter}-${kind}-${source
    .replaceAll(/[^a-zA-Z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .toLowerCase()}-${line}`;
}

function scopeFor(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.includes("*")) return normalized;
  if (normalized.endsWith("/")) return `${normalized}**`;
  if (normalized.includes(".")) return normalized;
  return `${normalized}/**`;
}

function provenance(
  source: string,
  line: number,
  adapter: SourceAdapter,
  excerpt: string,
  confidence: Provenance["confidence"] = "high",
): Provenance {
  return { source, line, adapter, excerpt: excerpt.slice(0, 300), confidence };
}

function rule(
  adapter: SourceAdapter,
  kind: RuleKind,
  effect: RuleEffect,
  source: string,
  line: number,
  scope: string,
  message: string,
  value?: PolicyRule["value"],
  confidence: Provenance["confidence"] = "high",
): PolicyRule {
  return {
    id: toId(adapter, kind, source, line),
    kind,
    effect,
    scope,
    ...(value === undefined ? {} : { value }),
    severity:
      effect === "deny" ? "high" : effect === "require" ? "medium" : "low",
    message,
    provenance: [
      provenance(
        source,
        line,
        adapter,
        `${kind}:${effect}:${scope}`,
        confidence,
      ),
    ],
  };
}

export function adapterForPath(path: string): SourceAdapter | undefined {
  if (
    path === "AGENTS.md" ||
    path.endsWith("/AGENTS.md") ||
    path.endsWith("/AGENTS.override.md")
  )
    return "agents-md";
  if (path === "CLAUDE.md" || path.startsWith(".claude/")) return "claude";
  if (
    path === ".github/copilot-instructions.md" ||
    path.startsWith(".github/instructions/")
  )
    return "copilot";
  if (path.startsWith(".cursor/rules/") || path === ".cursorrules")
    return "cursor";
  if (path === "GEMINI.md" || path.startsWith(".gemini/")) return "gemini";
  if (path === "opencode.json") return "opencode";
  if (path === ".mcp.json") return "mcp";
  if (path === "CODEOWNERS" || path.endsWith("/CODEOWNERS"))
    return "codeowners";
  if (
    path === "CONTRIBUTING.md" ||
    path === "SECURITY.md" ||
    path === "README.md" ||
    path.endsWith("/README.md")
  )
    return "repository-doc";
  return undefined;
}

export function extractTextRules(
  source: string,
  adapter: SourceAdapter,
  content: string,
): PolicyRule[] {
  const rules: PolicyRule[] = [];
  for (const [index, text] of content.split(/\r?\n/).entries()) {
    const line = index + 1;
    for (const candidate of PATH_PATTERNS) {
      const match = text.match(candidate.expression);
      const token = match ? pathToken(match) : undefined;
      if (token)
        rules.push(
          rule(
            adapter,
            "path",
            candidate.effect,
            source,
            line,
            scopeFor(token),
            candidate.message,
          ),
        );
    }
    const commandMatch = text.match(COMMAND_PATTERNS[1]);
    if (commandMatch?.[1] && COMMAND_PATTERNS[0].test(text)) {
      rules.push(
        rule(
          adapter,
          "check",
          "require",
          source,
          line,
          "**",
          "Instruction requires this check.",
          commandMatch[1],
        ),
      );
    }
    const bareRun = text.match(
      /^\s*(?:[-*]\s+)?(?:run|execute|运行|执行):\s*`?([^`]+)`?\s*$/i,
    );
    if (bareRun?.[1])
      rules.push(
        rule(
          adapter,
          "check",
          "require",
          source,
          line,
          "**",
          "Explicit listed check.",
          bareRun[1],
        ),
      );
    if (
      /(?:must|required to|必须|需要)\s*(?:disclose|mention|披露|说明).*(?:ai|agent|assistance|AI|人工智能|助手)/i.test(
        text,
      )
    ) {
      rules.push(
        rule(
          adapter,
          "disclosure",
          "require",
          source,
          line,
          "**",
          "Instruction requires AI assistance disclosure.",
          true,
        ),
      );
    }
    const networkDeny = text.match(
      /(?:do not|don't|never|forbid(?:den)?|must not|禁止|不要)\s*(?:use|access|call|reach|使用|访问).*(?:network|internet|external|网络|外网)/i,
    );
    if (networkDeny)
      rules.push(
        rule(
          adapter,
          "network",
          "deny",
          source,
          line,
          "*",
          "Instruction forbids external network access.",
        ),
      );
  }
  return rules;
}

export function extractCodeowners(
  source: string,
  content: string,
): PolicyRule[] {
  return content.split(/\r?\n/).flatMap((text, index) => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const [pattern, ...owners] = trimmed.split(/\s+/);
    if (!pattern || owners.length === 0) return [];
    return [
      rule(
        "codeowners",
        "approval",
        "require",
        source,
        index + 1,
        scopeFor(pattern),
        "CODEOWNERS requires owner review for this scope.",
        owners,
      ),
    ];
  });
}
