import { lstat } from "node:fs/promises";
import { basename, dirname } from "node:path";

import { extractTextRules } from "./extract.js";
import { safeRead, safeResolve, walkRepository } from "./fs-safe.js";
import {
  calculateRisk,
  detectConflicts,
  scanRepository as scanRepositoryBase,
} from "./scanner.js";
import type {
  DiscoveredSource,
  PolicyRule,
  ScanReport,
  SourceAdapter,
} from "./types.js";

const ROOT_AGENTS_OVERRIDE = "AGENTS.override.md";
const RULE_RELAY_EXACT_ADAPTERS = new Map<string, SourceAdapter>([
  ["agents.md", "agents-md"],
  ["claude.md", "claude"],
  ["gemini.md", "gemini"],
  [".cursorrules", "cursor"],
]);

function sortedRules(rules: readonly PolicyRule[]): PolicyRule[] {
  return [...rules].sort((left, right) => left.id.localeCompare(right.id));
}

function ruleRelayExactAdapterFor(
  relativePath: string,
): SourceAdapter | undefined {
  return RULE_RELAY_EXACT_ADAPTERS.get(basename(relativePath).toLowerCase());
}

function directoryScope(relativePath: string): string {
  const directory = dirname(relativePath).replaceAll("\\", "/");
  return directory === "." ? "**" : `${directory}/**`;
}

async function hasRegularRootOverride(root: string): Promise<boolean> {
  try {
    const metadata = await lstat(safeResolve(root, ROOT_AGENTS_OVERRIDE));
    return metadata.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function appendTextSource(
  root: string,
  relativePath: string,
  adapter: SourceAdapter,
  scope: string,
  sources: DiscoveredSource[],
  rules: PolicyRule[],
  warnings: string[],
): Promise<boolean> {
  try {
    const content = await safeRead(root, relativePath);
    const extracted = extractTextRules(relativePath, adapter, content);
    sources.push({
      path: relativePath,
      adapter,
      scope,
      bytes: Buffer.byteLength(content),
      rulesExtracted: extracted.length,
    });
    rules.push(...extracted);
    return true;
  } catch (error) {
    warnings.push(
      `Skipped ${relativePath}: ${error instanceof Error ? error.message : "read failure"}`,
    );
    return false;
  }
}

/**
 * Repository scan used by the public API and instruction-facing commands.
 *
 * The legacy scanner intentionally remains the Action dependency boundary:
 * the Action only needs conflict detection at runtime. Discovery-only
 * compatibility is layered here so repository-facing commands can follow
 * Codex and RuleRelay semantics without making an unrelated change stale the
 * committed Action bundle. Once conflict detection is decoupled from scanner.ts
 * these compatibility layers can collapse back into the central classifier.
 */
export async function scanRepository(root: string): Promise<ScanReport> {
  const report = await scanRepositoryBase(root);
  const sources = [...report.sources];
  const rules = [...report.policy.rules];
  const warnings = [...report.warnings];
  const existingPaths = new Set(sources.map((source) => source.path));
  let changed = false;

  if (
    !existingPaths.has(ROOT_AGENTS_OVERRIDE) &&
    (await hasRegularRootOverride(root))
  ) {
    const added = await appendTextSource(
      root,
      ROOT_AGENTS_OVERRIDE,
      "agents-md",
      "**",
      sources,
      rules,
      warnings,
    );
    if (added) {
      existingPaths.add(ROOT_AGENTS_OVERRIDE);
      changed = true;
    }
  }

  for (const relativePath of await walkRepository(root)) {
    if (existingPaths.has(relativePath)) continue;
    const adapter = ruleRelayExactAdapterFor(relativePath);
    if (!adapter) continue;

    const added = await appendTextSource(
      root,
      relativePath,
      adapter,
      directoryScope(relativePath),
      sources,
      rules,
      warnings,
    );
    if (added) {
      existingPaths.add(relativePath);
      changed = true;
    }
  }

  if (!changed) {
    return warnings.length === report.warnings.length
      ? report
      : { ...report, warnings };
  }

  const sorted = sortedRules(rules);
  const conflicts = detectConflicts(sorted);
  return {
    ...report,
    sources: sources.sort((left, right) => left.path.localeCompare(right.path)),
    policy: {
      ...report.policy,
      rules: sorted,
    },
    conflicts,
    risk: calculateRisk(sorted, conflicts),
    warnings,
  };
}
