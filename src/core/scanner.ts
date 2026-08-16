import { basename, dirname } from "node:path";
import { existsSync } from "node:fs";
import { safeRead, walkRepository } from "./fs-safe.js";
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

function isCandidate(path: string): boolean {
  return (
    RECOGNIZED.has(basename(path)) ||
    path.startsWith(".claude/rules/") ||
    path.startsWith(".github/instructions/") ||
    path === ".github/copilot-instructions.md" ||
    path.startsWith(".cursor/rules/")
  );
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

export async function scanRepository(root: string): Promise<ScanReport> {
  if (!existsSync(root))
    throw new Error(`Repository root does not exist: ${root}`);
  const files = (await walkRepository(root)).filter(isCandidate);
  const rules: PolicyRule[] = [];
  const sources: DiscoveredSource[] = [];
  const warnings: string[] = [];
  for (const path of files) {
    const adapter = adapterForPath(path);
    if (!adapter) continue;
    try {
      const content = await safeRead(root, path);
      const extracted =
        adapter === "codeowners"
          ? extractCodeowners(path, content)
          : extractTextRules(path, adapter, content);
      rules.push(...extracted);
      sources.push({
        path,
        adapter,
        scope: dirname(path) === "." ? "**" : `${dirname(path)}/**`,
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
