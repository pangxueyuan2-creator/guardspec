const PATH_SPECIFIC_INSTRUCTION =
  /(^|\/)\.github\/instructions\/.+\.instructions\.md$/i;
const MAX_PATTERNS = 64;
const MAX_PATTERN_LENGTH = 512;

type ParseFailure = { readonly ok: false; readonly error: string };
type ScalarResult = { readonly ok: true; readonly value: string } | ParseFailure;

export type CopilotApplyToResult =
  | { readonly ok: true; readonly patterns: readonly string[] }
  | ParseFailure;

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isCopilotPathInstruction(relativePath: string): boolean {
  return PATH_SPECIFIC_INSTRUCTION.test(normalizePath(relativePath));
}

function scalarValue(rawValue: string): ScalarResult {
  const value = rawValue.trim();
  if (!value) return { ok: false, error: "applyTo must not be empty." };

  const first = value[0];
  if (first === '"' || first === "'") {
    if (value.length < 2 || value.at(-1) !== first) {
      return {
        ok: false,
        error: "applyTo has an unterminated quoted scalar.",
      };
    }
    return { ok: true, value: value.slice(1, -1) };
  }

  return { ok: true, value };
}

function normalizePattern(rawPattern: string): ScalarResult {
  const value = normalizePath(rawPattern.trim());
  if (!value)
    return { ok: false, error: "applyTo contains an empty glob pattern." };
  if (value.length > MAX_PATTERN_LENGTH) {
    return {
      ok: false,
      error: `applyTo glob exceeds ${MAX_PATTERN_LENGTH} characters.`,
    };
  }
  if (value.startsWith("/")) {
    return {
      ok: false,
      error: "applyTo globs must be repository-relative.",
    };
  }
  if (value.split("/").includes("..")) {
    return {
      ok: false,
      error: "applyTo globs must not escape the repository with '..'.",
    };
  }
  return { ok: true, value };
}

export function parseCopilotApplyTo(content: string): CopilotApplyToResult {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") {
    return {
      ok: false,
      error: "Path-specific Copilot instructions must start with YAML frontmatter.",
    };
  }

  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (closingIndex < 0) {
    return {
      ok: false,
      error: "Copilot instruction frontmatter is not closed with '---'.",
    };
  }

  const applyToEntries = lines
    .slice(1, closingIndex)
    .map((line) => /^\s*applyTo\s*:\s*(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null);
  if (applyToEntries.length !== 1) {
    return {
      ok: false,
      error:
        applyToEntries.length === 0
          ? "Path-specific Copilot instructions require one applyTo field."
          : "Path-specific Copilot instructions must not repeat applyTo.",
    };
  }

  const parsedScalar = scalarValue(applyToEntries[0]?.[1] ?? "");
  if (!parsedScalar.ok) return parsedScalar;

  const rawPatterns = parsedScalar.value.split(",");
  if (rawPatterns.length > MAX_PATTERNS) {
    return {
      ok: false,
      error: `applyTo contains more than ${MAX_PATTERNS} glob patterns.`,
    };
  }

  const patterns: string[] = [];
  for (const rawPattern of rawPatterns) {
    const pattern = normalizePattern(rawPattern);
    if (!pattern.ok) return pattern;
    patterns.push(pattern.value);
  }
  return { ok: true, patterns };
}
