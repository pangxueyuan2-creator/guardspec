import { lstat } from "node:fs/promises";

import { extractTextRules } from "./extract.js";
import { safeRead, safeResolve } from "./fs-safe.js";
import {
  calculateRisk,
  detectConflicts,
  scanRepository as scanRepositoryBase,
} from "./scanner.js";
import type { DiscoveredSource, PolicyRule, ScanReport } from "./types.js";

const ROOT_AGENTS_OVERRIDE = "AGENTS.override.md";

function sortedRules(rules: readonly PolicyRule[]): PolicyRule[] {
  return [...rules].sort((left, right) => left.id.localeCompare(right.id));
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

/**
 * Repository scan used by the public API and instruction-facing commands.
 *
 * The legacy scanner intentionally remains the Action dependency boundary:
 * the Action only needs conflict detection at runtime. Root AGENTS.override.md
 * support is layered here so repository discovery can follow Codex semantics
 * without making an unrelated discovery-only change stale the committed Action
 * bundle. Once conflict detection is decoupled from scanner.ts this compatibility
 * layer can collapse back into the central adapter classifier.
 */
export async function scanRepository(root: string): Promise<ScanReport> {
  const report = await scanRepositoryBase(root);
  if (
    report.sources.some((source) => source.path === ROOT_AGENTS_OVERRIDE) ||
    !(await hasRegularRootOverride(root))
  ) {
    return report;
  }

  try {
    const content = await safeRead(root, ROOT_AGENTS_OVERRIDE);
    const extracted = extractTextRules(
      ROOT_AGENTS_OVERRIDE,
      "agents-md",
      content,
    );
    const source: DiscoveredSource = {
      path: ROOT_AGENTS_OVERRIDE,
      adapter: "agents-md",
      scope: "**",
      bytes: Buffer.byteLength(content),
      rulesExtracted: extracted.length,
    };
    const rules = sortedRules([...report.policy.rules, ...extracted]);
    const conflicts = detectConflicts(rules);
    return {
      ...report,
      sources: [...report.sources, source].sort((left, right) =>
        left.path.localeCompare(right.path),
      ),
      policy: {
        ...report.policy,
        rules,
      },
      conflicts,
      risk: calculateRisk(rules, conflicts),
    };
  } catch (error) {
    return {
      ...report,
      warnings: [
        ...report.warnings,
        `Skipped ${ROOT_AGENTS_OVERRIDE}: ${error instanceof Error ? error.message : "read failure"}`,
      ],
    };
  }
}
