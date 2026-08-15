import type {
  PolicyRule,
  Provenance,
  RuleEffect,
  RuleKind,
  SourceAdapter,
} from "./types.js";

const PATH_CAPTURE =
  '(?:[`“"\'「]([^`”"\'」]+)[`”"\'」]|([^`”"\'\\s,，。；]+))';

// Skip English/Chinese filler between the verb and the actual path:
// "edit files under src/" → src/, "修改 文件 位于 src/" → src/.
const PATH_FILLER = String.raw`(?:(?:the|files?|paths?|dirs?|directories|code|sources?|contents?|文件|目录|路径|代码|under|in|inside|within|beneath|from|located|位于|在)\s+)*`;

const PATH_PATTERNS: Array<{
  expression: RegExp;
  effect: RuleEffect;
  message: string;
  exclusive?: boolean;
}> = [
  {
    // English + Chinese deny forms. Quoted paths keep interior spaces.
    expression: new RegExp(
      String.raw`(?:do not|don't|never|forbid(?:den)?|must not|禁止|不要|切勿|不得)\s*(?:modify|edit|change|touch|修改|改动|编辑)\s*` +
        PATH_FILLER +
        PATH_CAPTURE,
      "i",
    ),
    effect: "deny",
    message: "Instruction forbids changes to this path.",
  },
  {
    expression: new RegExp(
      String.raw`(?:only|may only|只能|仅能|只允许)\s*(?:modify|edit|change|touch|修改|改动|编辑)\s*` +
        PATH_FILLER +
        PATH_CAPTURE,
      "i",
    ),
    effect: "allow",
    exclusive: true,
    message: "Instruction limits changes to this path scope.",
  },
  {
    expression: new RegExp(
      String.raw`(?:protect|protected|保护|受保护)\s*(?:path|area|directory|file|路径|目录|文件)?\s*[:=-]?\s*` +
        PATH_FILLER +
        PATH_CAPTURE,
      "i",
    ),
    effect: "deny",
    message: "Instruction marks this path as protected.",
  },
];

const SENTENCE_SUFFIX = /[.!?,;:。！？、；：…]+$/u;

const FILLER_WORDS = new Set([
  "file",
  "files",
  "path",
  "paths",
  "dir",
  "dirs",
  "directory",
  "directories",
  "code",
  "source",
  "sources",
  "content",
  "contents",
  "the",
  "under",
  "in",
  "inside",
  "within",
  "from",
  "located",
  "文件",
  "目录",
  "路径",
  "代码",
]);

const COMMAND_PATTERNS: readonly [RegExp, RegExp] = [
  /(?:must|always|required to|before (?:committing|submitting|opening)|必须|需要|提交前|合并前)/i,
  /(?:run|execute|运行|执行)\s*[`“"']([^`”"']+)[`”"']/i,
];

const LABELED_CHECK =
  /^\s*(?:[-*]\s+)?(?:required\s+checks?|must(?:\s+always)?\s+run|check(?:s)?\s+required|必须运行|必须检查|要求检查|检查命令)\s*[:=]\s*`?(.+?)`?\s*$/i;

const SHELL_INTERPRETERS = new Set([
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "bash",
  "sh",
  "zsh",
  "fish",
  "wscript",
  "cscript",
  "mshta",
]);

const POLICY_EXECUTABLES = new Set([
  "python",
  "python.exe",
  "python3",
  "python3.exe",
  "py",
  "py.exe",
  "pytest",
  "pytest.exe",
  "ruff",
  "ruff.exe",
  "mypy",
  "mypy.exe",
  "npm",
  "npm.cmd",
  "npx",
  "npx.cmd",
  "node",
  "node.exe",
  "pnpm",
  "pnpm.cmd",
  "yarn",
  "yarn.cmd",
  "bun",
  "bun.exe",
  "go",
  "go.exe",
  "cargo",
  "cargo.exe",
  "make",
  "make.exe",
  "uv",
  "uv.exe",
  "hatch",
  "hatch.exe",
  "tox",
  "tox.exe",
  "nox",
  "nox.exe",
]);

export function isSafeRequiredCheck(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  if (/[;&|`$<>\n\r]/.test(trimmed)) return false;
  const first = trimmed.split(/\s+/, 1)[0]?.replace(/^['"]+|['"]+$/g, "") ?? "";
  const base = first.replaceAll("\\", "/").split("/").pop()?.toLowerCase() ?? "";
  if (SHELL_INTERPRETERS.has(base)) return false;
  if (!POLICY_EXECUTABLES.has(base)) return false;
  if (
    /\b(?:python(?:3)?|py|node|perl|ruby|php)(?:\.exe)?\s+(?:-[ce]|--eval)\b/i.test(
      trimmed,
    )
  ) {
    return false;
  }
  return true;
}

function slugPart(value: string): string {
  return value
    .replaceAll(/[^a-zA-Z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .toLowerCase();
}

function toId(
  adapter: SourceAdapter,
  kind: RuleKind,
  source: string,
  line: number,
  disambiguator?: string,
): string {
  const parts = [adapter, kind, slugPart(source), String(line)];
  if (disambiguator) {
    const extra = slugPart(disambiguator).slice(0, 48);
    if (extra) parts.push(extra);
  }
  return parts.join("-");
}

function uniquifyIds(rules: PolicyRule[]): PolicyRule[] {
  const seen = new Map<string, number>();
  return rules.map((entry) => {
    const count = seen.get(entry.id) ?? 0;
    seen.set(entry.id, count + 1);
    if (count === 0) return entry;
    return { ...entry, id: `${entry.id}-${count + 1}` };
  });
}

const HIDDEN_DIRECTORIES = new Set([
  ".git",
  ".github",
  ".gitlab",
  ".circleci",
  ".vscode",
  ".cursor",
  ".husky",
  ".changeset",
  ".idea",
  ".devcontainer",
  ".azuredevops",
]);

const EXTENSIONLESS_FILES = new Set([
  "authors",
  "brewfile",
  "copying",
  "dockerfile",
  "gemfile",
  "gnumakefile",
  "jenkinsfile",
  "justfile",
  "license",
  "makefile",
  "notice",
  "pipfile",
  "procfile",
  "rakefile",
  "vagrantfile",
]);

function lastSegment(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function looksLikeFile(path: string): boolean {
  const base = lastSegment(path);
  const lowered = base.toLowerCase();
  if (HIDDEN_DIRECTORIES.has(lowered)) return false;
  if (EXTENSIONLESS_FILES.has(lowered)) return true;
  // Quoted `calculator.py.` keeps the trailing dot; classify on the stem.
  const stem = base.replace(/\.+$/, "") || base;
  const loweredStem = stem.toLowerCase();
  if (HIDDEN_DIRECTORIES.has(loweredStem)) return false;
  if (EXTENSIONLESS_FILES.has(loweredStem)) return true;
  // .env, .gitignore, .tasktopr.toml — hidden files stay exact.
  if (/^\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(stem)) return true;
  return /\.[A-Za-z0-9]{1,16}$/.test(stem);
}

function scopeFor(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.includes("*")) return normalized;
  if (normalized.endsWith("/")) return `${normalized}**`;
  if (looksLikeFile(normalized)) return normalized;
  return `${normalized.replace(/\/+$/, "")}/**`;
}

function sanitizeUnquotedPath(token: string): string {
  const stripped = token.replace(SENTENCE_SUFFIX, "");
  return stripped || token;
}

function sanitizeCheck(command: string): string {
  return command.trim().replace(SENTENCE_SUFFIX, "").trim();
}

function isFillerToken(token: string): boolean {
  return FILLER_WORDS.has(token.toLowerCase());
}

function looksLikePathToken(token: string): boolean {
  if (!token || isFillerToken(token)) return false;
  if (token.includes("/") || token.includes("\\")) return true;
  if (token.startsWith(".")) return true;
  if (looksLikeFile(token)) return true;
  return false;
}

function unwrapQuotedToken(raw: string): string {
  const quoted = raw.match(/^[`“"'「]([^`”"'」]+)[`”"'」]$/);
  return quoted?.[1] ?? raw;
}

function capturedPath(match: RegExpMatchArray): { path: string; quoted: boolean } | undefined {
  const quoted = match[1];
  if (quoted) return { path: quoted, quoted: true };
  const unquoted = match[2];
  if (!unquoted) return undefined;
  return { path: sanitizeUnquotedPath(unquoted), quoted: false };
}

function resolvePathCapture(
  captured: string,
  quoted: boolean,
  text: string,
): string | undefined {
  if (quoted) return captured;
  const cleaned = sanitizeUnquotedPath(captured);
  if (cleaned && !isFillerToken(cleaned)) return cleaned;
  const firstAt = text.indexOf(captured);
  const rest = firstAt >= 0 ? text.slice(firstAt + captured.length) : text;
  const tokens = rest.match(/[`“"'「]([^`”"'」]+)[`”"'」]|[^\s,，。；]+/g) ?? [];
  for (const raw of tokens) {
    const token = sanitizeUnquotedPath(unwrapQuotedToken(raw));
    if (token && looksLikePathToken(token)) return token;
  }
  return undefined;
}

function quotedPaths(text: string): string[] {
  return [...text.matchAll(/[`“"'「]([^`”"'」]+)[`”"'」]/g)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value && value.trim()));
}

function siblingPaths(text: string, first: string): string[] {
  const quoted = quotedPaths(text);
  if (quoted.length > 0) return quoted;
  const found = [first];
  const firstAt = text.indexOf(first);
  const rest = firstAt >= 0 ? text.slice(firstAt + first.length) : "";
  const extra = new RegExp(
    String.raw`(?:\s*(?:,|and|or|和|以及|与|或)\s*)` + PATH_CAPTURE,
    "gi",
  );
  for (const match of rest.matchAll(extra)) {
    const captured = match[1] || (match[2] ? sanitizeUnquotedPath(match[2]) : undefined);
    if (captured && !isFillerToken(captured)) found.push(captured);
  }
  return found;
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
  exclusive?: boolean,
): PolicyRule {
  return {
    id: toId(adapter, kind, source, line, scope),
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
    ...(exclusive ? { exclusive: true } : {}),
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

function pushRequiredCheck(
  rules: PolicyRule[],
  adapter: SourceAdapter,
  source: string,
  line: number,
  command: string,
  message: string,
): void {
  const sanitized = sanitizeCheck(command);
  if (!sanitized || !isSafeRequiredCheck(sanitized)) return;
  rules.push(
    rule(adapter, "check", "require", source, line, "**", message, sanitized),
  );
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
      if (!match) continue;
      const raw = capturedPath(match);
      if (!raw) continue;
      const resolved = resolvePathCapture(raw.path, raw.quoted, text);
      if (!resolved) continue;
      for (const path of siblingPaths(text, resolved)) {
        rules.push(
          rule(
            adapter,
            "path",
            candidate.effect,
            source,
            line,
            scopeFor(path),
            candidate.message,
            undefined,
            "high",
            candidate.exclusive,
          ),
        );
      }
    }
    const commandMatch = text.match(COMMAND_PATTERNS[1]);
    if (commandMatch?.[1] && COMMAND_PATTERNS[0].test(text)) {
      pushRequiredCheck(
        rules,
        adapter,
        source,
        line,
        commandMatch[1],
        "Instruction requires this check.",
      );
    }
    const bareRun = text.match(
      /^\s*(?:[-*]\s+)?(?:run|execute|运行|执行):\s*`?([^`]+)`?\s*$/i,
    );
    if (bareRun?.[1]) {
      pushRequiredCheck(
        rules,
        adapter,
        source,
        line,
        bareRun[1],
        "Explicit listed check.",
      );
    }
    const labeled = text.match(LABELED_CHECK);
    if (labeled?.[1]) {
      pushRequiredCheck(
        rules,
        adapter,
        source,
        line,
        labeled[1],
        "Labeled required check.",
      );
    }
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
  return uniquifyIds(rules);
}

export function extractCodeowners(
  source: string,
  content: string,
): PolicyRule[] {
  return uniquifyIds(content.split(/\r?\n/).flatMap((text, index) => {
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
  }));
}
