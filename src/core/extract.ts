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
      /(?:do not|don't|never|forbid(?:den)?|must not|禁止|不要|切勿|不得)\s*(?:modify|edit|change|touch|修改|改动|编辑)\s*(?:the\s+)?(?:following\s+|以下\s*)?(?:paths|path|areas|area|directories|directory|files|file|路径|目录|文件)?\s*[:=-]?\s*([`“"'「])?([^`”"'\s,，、。；」]+)[`”"'」]?/i,
    effect: "deny",
    message: "Instruction forbids changes to this path.",
  },
  {
    expression:
      /(?:only|may only|只能|仅能|只允许)\s*(?:modify|edit|change|touch|修改|改动|编辑)\s*(?:the\s+)?(?:following\s+|以下\s*)?(?:paths|path|areas|area|directories|directory|files|file|路径|目录|文件)?\s*[:=-]?\s*([`“"'「])?([^`”"'\s,，、。；」]+)[`”"'」]?/i,
    effect: "allow",
    message: "Instruction limits changes to this path scope.",
  },
  {
    expression:
      /(?:protect|protected|保护|受保护)\s*(?:the\s+)?(?:following\s+|以下\s*)?(?:paths|path|areas|area|directories|directory|files|file|路径|目录|文件)?\s*[:=-]?\s*([`“"'「])?([^`”"'\s,，、。；」]+)/i,
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

// Separators that introduce a further path in a list: ", b", ", or c",
// " or d", "、e", "和 f". Word boundaries keep "orchestrate" out.
const LIST_SEPARATOR =
  /^\s*(?:[,、]\s*(?:(?:and|or|nor)\s+)?|\b(?:and|or|nor)\b\s+|\s*(?:或(?:者)?|及|以及|和)\s*)\s*(?:the\s+)?/i;

// When a list continuation names an obvious verb, the instruction is a
// second clause ("... or run tests"), not another path. Quoted tokens are
// always paths and skip the stopword check.
const LIST_STOPWORDS = new Set([
  "run",
  "execute",
  "test",
  "build",
  "deploy",
  "commit",
  "push",
  "open",
  "create",
  "use",
  "call",
  "access",
  "reach",
  "install",
  "publish",
  "merge",
  "rebase",
  "delete",
  "remove",
  "modify",
  "edit",
  "change",
  "touch",
  "add",
  "运行",
  "执行",
  "测试",
  "构建",
  "部署",
  "提交",
  "创建",
  "使用",
  "调用",
  "访问",
  "安装",
  "发布",
  "合并",
  "删除",
  "移除",
  "修改",
  "添加",
]);

function continuationPaths(text: string, offset: number): string[] {
  const tokens: string[] = [];
  let rest = text.slice(offset);
  for (;;) {
    const separator = rest.match(LIST_SEPARATOR);
    if (!separator) break;
    const after = rest.slice(separator[0].length);
    const candidate = after.match(
      /^([`“"'「])?([^`”"'\s,，、。；」]+)[`”"'」]?/,
    );
    if (!candidate?.[2]) break;
    const quoted = Boolean(candidate[1]);
    const token = quoted
      ? candidate[2]
      : candidate[2].replace(SENTENCE_SUFFIX, "") || candidate[2];
    if (!quoted && LIST_STOPWORDS.has(token.toLowerCase())) break;
    tokens.push(token);
    rest = after.slice(candidate[0].length);
  }
  return tokens;
}

const COMMAND_PATTERNS: readonly [RegExp, RegExp] = [
  /(?:must|always|required to|before (?:committing|submitting|opening)|必须|需要|提交前|合并前)/i,
  /(?:run|execute|运行|执行)\s*[`“"']([^`”"']+)[`”"']/i,
];

const DOT_DIRECTORIES = new Set([
  ".claude",
  ".cursor",
  ".devcontainer",
  ".gemini",
  ".git",
  ".github",
  ".vscode",
]);

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
  const lastSegment = normalized.split("/").pop() ?? normalized;
  // A dot beyond the first character marks a file-like token (app.py,
  // archive.tar.gz). Standalone dotfiles stay exact, while known repository
  // control directories and bare directory names govern their descendants.
  if (
    lastSegment.slice(1).includes(".") ||
    (lastSegment.startsWith(".") && !DOT_DIRECTORIES.has(lastSegment))
  )
    return normalized;
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
      if (match) {
        for (const extra of continuationPaths(
          text,
          (match.index ?? 0) + match[0].length,
        )) {
          rules.push(
            rule(
              adapter,
              "path",
              candidate.effect,
              source,
              line,
              scopeFor(extra),
              candidate.message,
            ),
          );
        }
      }
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
    const anchored = pattern.startsWith("/") ? pattern.slice(1) : pattern;
    return [
      rule(
        "codeowners",
        "approval",
        "require",
        source,
        index + 1,
        scopeFor(anchored),
        "CODEOWNERS requires owner review for this scope.",
        owners,
      ),
    ];
  });
}
