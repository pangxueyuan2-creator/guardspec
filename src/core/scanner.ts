import { basename, dirname } from "node:path";
import { existsSync } from "node:fs";
import {
  copilotRepositoryInstructionScope,
  isCopilotPathInstruction,
  isCopilotRepositoryInstruction,
  parseCopilotApplyTo,
} from "./copilot.js";
import { safeRead, walkRepositoryDetailed } from "./fs-safe.js";
import {
  adapterForPath,
  extractCodeowners,
  extractTextRules,
} from "./extract.js";
import { policyTemplate } from "./policy.js";
import type {
  Conflict,
  DiscoveredSource,
  PolicyRule,
  RiskSummary,
  ScanReport,
  SourceAdapter,
} from "./types.js";

const RECOGNIZED = new Set([
  "AGENTS.md",
  "AGENTS.override.md",
  "CLAUDE.md",
  "GEMINI.md",
  "CODEOWNERS",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "README.md",
  "opencode.json",
  ".mcp.json",
  ".cursorrules",
]);

const INSTRUCTION_ADAPTERS = new Set<SourceAdapter>([
  "agents-md",
  "claude",
  "copilot",
  "cursor",
  "gemini",
  "opencode",
]);

function isCandidate(path: string): boolean {
  return (
    RECOGNIZED.has(basename(path)) ||
    path.startsWith(".claude/rules/") ||
    isCopilotPathInstruction(path) ||
    isCopilotRepositoryInstruction(path) ||
    path.startsWith(".cursor/rules/")
  );
}

function isInstructionCandidate(path: string): boolean {
  const adapter = adapterForPath(path);
  return adapter !== undefined && INSTRUCTION_ADAPTERS.has(adapter);
}

function symlinkDetail(path: string, target?: string): string {
  return target ? `${path} -> ${target}` : path;
}

function conflictKey(rule: PolicyRule): string {
  // Normalize to NFC so visually identical spellings of one scope are grouped
  // together — the evaluator matches on the same normalized form.
  return `${rule.kind}:${rule.scope.normalize("NFC")}`;
}

export function detectConflicts(rules: PolicyRule[]): Conflict[] {
  const grouped = new Map<string, PolicyRule[]>();
  for (const current of rules) {
    const key = conflictKey(current);
    grouped.set(key, [...(grouped.get(key) ?? []), current]);
  }
  const conflicts: Conflict[] = [];
  for (const [key, group] of grouped) {
    const effects = new Set(group.map((entry) => entry.effect));
    const values = new Set(
      group.map((entry) => JSON.stringify(entry.value ?? null)),
    );
    const incompatibleEffects = effects.has("allow") && effects.has("deny");
    const incompatibleValues =
      group.some(
        (entry) => entry.kind === "check" || entry.kind === "command",
      ) &&
      values.size > 1 &&
      effects.has("require");
    if (!incompatibleEffects && !incompatibleValues) continue;
    const [kind, scope] = key.split(":") as [Conflict["kind"], string];
    conflicts.push({
      id: `conflict-${kind}-${scope.replaceAll(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`,
      kind,
      scope,
      ruleIds: group.map((entry) => entry.id).sort(),
      severity: incompatibleEffects ? "high" : "medium",
      message: incompatibleEffects
        ? `Both allow and deny rules apply to ${scope}.`
        : `Multiple required values apply to ${scope}.`,
    });
  }
  return conflicts.sort((left, right) => left.id.localeCompare(right.id));
}

export function calculateRisk(
  rules: PolicyRule[],
  conflicts: Conflict[],
): RiskSummary {
  const signals: string[] = [];
  let score = 0;
  const protectedPaths = rules.filter(
    (rule) => rule.kind === "path" && rule.effect === "deny",
  );
  if (protectedPaths.length === 0) {
    score += 20;
    signals.push("No explicit protected-path rule was discovered.");
  }
  if (
    !rules.some((rule) => rule.kind === "check" && rule.effect === "require")
  ) {
    score += 20;
    signals.push("No required check was discovered.");
  }
  if (
    !rules.some((rule) => rule.kind === "network" && rule.effect === "deny")
  ) {
    score += 10;
    signals.push("No explicit network restriction was discovered.");
  }
  if (
    !rules.some((rule) => rule.kind === "approval" && rule.effect === "require")
  ) {
    score += 10;
    signals.push("No approval gate was discovered.");
  }
  if (conflicts.length > 0) {
    score += conflicts.length * 20;
    signals.push(`${conflicts.length} unresolved policy conflict(s) detected.`);
  }
  const level =
    score >= 60
      ? "critical"
      : score >= 40
        ? "high"
        : score >= 20
          ? "medium"
          : "low";
  return { score: Math.min(score, 100), level, signals };
}

function scopeCopilotPathRules(
  source: string,
  rules: PolicyRule[],
  patterns: readonly string[],
  warnings: string[],
): PolicyRule[] {
  const unsupported = rules.filter((rule) => rule.kind !== "check");
  if (unsupported.length > 0) {
    const kinds = [...new Set(unsupported.map((rule) => rule.kind))].sort();
    warnings.push(
      `Skipped ${unsupported.length} conditional rule(s) from ${source} (${kinds.join(", ")}): GuardSpec cannot safely intersect these rule kinds with applyTo yet.`,
    );
  }

  return rules
    .filter((rule) => rule.kind === "check")
    .flatMap((rule) =>
      patterns.map((scope, index) => ({
        ...rule,
        id: `${rule.id}-applyto-${index + 1}`,
        scope,
      })),
    );
}

function scopeNestedCopilotRepositoryRules(
  source: string,
  rules: PolicyRule[],
  scope: string,
  warnings: string[],
): PolicyRule[] {
  if (scope === "**") return rules;

  const unsupported = rules.filter((rule) => rule.kind !== "check");
  if (unsupported.length > 0) {
    const kinds = [...new Set(unsupported.map((rule) => rule.kind))].sort();
    warnings.push(
      `Skipped ${unsupported.length} nested repository rule(s) from ${source} (${kinds.join(", ")}): GuardSpec cannot safely intersect these rule kinds with the nested Copilot repository scope yet.`,
    );
  }

  return rules
    .filter((rule) => rule.kind === "check")
    .map((rule) => ({ ...rule, scope }));
}

export async function scanRepository(root: string): Promise<ScanReport> {
  if (!existsSync(root))
    throw new Error(`Repository root does not exist: ${root}`);
  const walk = await walkRepositoryDetailed(root);
  const files = walk.files.filter(isCandidate);
  const rules: PolicyRule[] = [];
  const sources: DiscoveredSource[] = [];
  const warnings: string[] = [];

  for (const symlink of walk.symlinks) {
    if (symlink.kind === "directory") {
      warnings.push(
        `Skipped symlinked directory: ${symlinkDetail(symlink.path, symlink.target)}. GuardSpec does not traverse symlinked directories.`,
      );
      continue;
    }
    if (isInstructionCandidate(symlink.path)) {
      warnings.push(
        `Skipped symlinked instruction source: ${symlinkDetail(symlink.path, symlink.target)}. GuardSpec does not read symlinked instruction files.`,
      );
    }
  }

  for (const path of files) {
    const adapter = adapterForPath(path);
    if (!adapter) continue;
    try {
      const content = await safeRead(root, path);
      let extracted =
        adapter === "codeowners"
          ? extractCodeowners(path, content)
          : extractTextRules(path, adapter, content);
      let sourceScope = dirname(path) === "." ? "**" : `${dirname(path)}/**`;

      if (adapter === "copilot" && isCopilotPathInstruction(path)) {
        const applyTo = parseCopilotApplyTo(content);
        if (!applyTo.ok) {
          warnings.push(`Skipped ${path}: ${applyTo.error}`);
          sources.push({
            path,
            adapter,
            scope: "invalid applyTo",
            bytes: Buffer.byteLength(content),
            rulesExtracted: 0,
          });
          continue;
        }
        sourceScope = applyTo.patterns.join(",");
        extracted = scopeCopilotPathRules(
          path,
          extracted,
          applyTo.patterns,
          warnings,
        );
      } else if (
        adapter === "copilot" &&
        isCopilotRepositoryInstruction(path)
      ) {
        const repositoryScope = copilotRepositoryInstructionScope(path);
        if (!repositoryScope) {
          warnings.push(`Skipped ${path}: invalid Copilot repository scope.`);
          continue;
        }
        sourceScope = repositoryScope;
        extracted = scopeNestedCopilotRepositoryRules(
          path,
          extracted,
          repositoryScope,
          warnings,
        );
      }

      rules.push(...extracted);
      sources.push({
        path,
        adapter,
        scope: sourceScope,
        bytes: Buffer.byteLength(content),
        rulesExtracted: extracted.length,
      });
    } catch (error) {
      warnings.push(
        `Skipped ${path}: ${error instanceof Error ? error.message : "read failure"}`,
      );
    }
  }
  const policy = policyTemplate(basename(root), rules);
  const conflicts = detectConflicts(policy.rules);
  return {
    root,
    sources: sources.sort((left, right) => left.path.localeCompare(right.path)),
    policy,
    conflicts,
    risk: calculateRisk(policy.rules, conflicts),
    warnings,
  };
}
