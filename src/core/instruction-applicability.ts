import picomatch from "picomatch";
import { isCopilotPathInstruction } from "./copilot.js";
import { scanRepository } from "./repository-scan.js";
import type { DiscoveredSource, SourceAdapter } from "./types.js";

const INSTRUCTION_ADAPTERS = new Set<SourceAdapter>([
  "agents-md",
  "claude",
  "copilot",
  "cursor",
  "gemini",
  "opencode",
]);

export interface ApplicableInstruction {
  path: string;
  adapter: SourceAdapter;
  matchedScopes: string[];
  rulesExtracted: number;
}

export interface IndeterminateInstruction {
  path: string;
  adapter: SourceAdapter;
  reason: string;
}

export interface InstructionApplicabilityReport {
  root: string;
  target: string;
  applicable: ApplicableInstruction[];
  indeterminate: IndeterminateInstruction[];
  warnings: string[];
}

function normalizeTarget(rawTarget: string): string {
  const trimmed = rawTarget.trim();
  if (!trimmed) throw new Error("Instruction target path must not be empty.");
  if (trimmed.includes("\0"))
    throw new Error("Instruction target path must not contain NUL bytes.");
  if (
    /^[a-zA-Z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("\\")
  ) {
    throw new Error("Instruction target path must be repository-relative.");
  }

  const normalized = trimmed.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(
      "Instruction target path must stay inside the repository and must not contain '..'.",
    );
  }

  const segments = normalized
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0) return ".";
  return segments.join("/").normalize("NFC");
}

function isInstructionSource(source: DiscoveredSource): boolean {
  return INSTRUCTION_ADAPTERS.has(source.adapter);
}

function indeterminateReason(source: DiscoveredSource): string | undefined {
  if (source.adapter === "claude" && source.path.startsWith(".claude/rules/")) {
    return "Claude rule targeting is conditional metadata that GuardSpec does not safely interpret yet.";
  }
  if (source.adapter === "cursor" && source.path.startsWith(".cursor/rules/")) {
    return "Cursor rule targeting is conditional metadata that GuardSpec does not safely interpret yet.";
  }
  if (
    source.adapter === "copilot" &&
    isCopilotPathInstruction(source.path) &&
    source.scope === "invalid applyTo"
  ) {
    return "Copilot applyTo metadata is invalid, so applicability cannot be proven.";
  }
  return undefined;
}

function scopesFor(source: DiscoveredSource): string[] {
  if (source.adapter === "copilot" && isCopilotPathInstruction(source.path)) {
    return source.scope
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);
  }
  return [source.scope];
}

function scopeMatches(target: string, scope: string): boolean {
  const normalizedScope = scope.normalize("NFC");
  if (normalizedScope === "**" || normalizedScope === "*") return true;
  if (
    picomatch.isMatch(target, normalizedScope, {
      dot: true,
      nocase: false,
      nonegate: true,
    })
  ) {
    return true;
  }
  if (normalizedScope.endsWith("/**")) {
    return target === normalizedScope.slice(0, -3);
  }
  return false;
}

function compareByPath(
  left: { path: string; adapter: SourceAdapter },
  right: { path: string; adapter: SourceAdapter },
): number {
  return (
    left.path.localeCompare(right.path) ||
    left.adapter.localeCompare(right.adapter)
  );
}

export async function explainInstructions(
  root: string,
  rawTarget: string,
): Promise<InstructionApplicabilityReport> {
  const target = normalizeTarget(rawTarget);
  const scan = await scanRepository(root);
  const applicable: ApplicableInstruction[] = [];
  const indeterminate: IndeterminateInstruction[] = [];

  for (const source of scan.sources.filter(isInstructionSource)) {
    const reason = indeterminateReason(source);
    if (reason) {
      indeterminate.push({
        path: source.path,
        adapter: source.adapter,
        reason,
      });
      continue;
    }

    const matchedScopes: string[] = [];
    try {
      for (const scope of scopesFor(source)) {
        if (scopeMatches(target, scope)) matchedScopes.push(scope);
      }
    } catch (error) {
      indeterminate.push({
        path: source.path,
        adapter: source.adapter,
        reason: `Instruction scope could not be evaluated safely: ${
          error instanceof Error ? error.message : "invalid scope"
        }`,
      });
      continue;
    }

    if (matchedScopes.length > 0) {
      applicable.push({
        path: source.path,
        adapter: source.adapter,
        matchedScopes,
        rulesExtracted: source.rulesExtracted,
      });
    }
  }

  return {
    root: scan.root,
    target,
    applicable: applicable.sort(compareByPath),
    indeterminate: indeterminate.sort(compareByPath),
    warnings: [...scan.warnings],
  };
}
