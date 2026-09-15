import { walkRepository } from "./fs-safe.js";
import { auditInstructions } from "./instruction-hygiene.js";
import { inventoryInstructions } from "./instruction-inventory.js";
import type { SourceAdapter } from "./types.js";

const SCHEMA = "guardspec.dev/rule-relay-compatibility/v1" as const;
const copilotRepositoryInstruction =
  /(^|\/)\.github\/copilot-instructions\.md$/i;
const copilotPathInstruction =
  /(^|\/)\.github\/instructions\/.+\.instructions\.md$/i;

export type RuleRelayAdapter =
  | "agents-md"
  | "claude"
  | "copilot"
  | "cursor"
  | "gemini";

export interface RuleRelayExpectedSource {
  path: string;
  adapter: RuleRelayAdapter;
}

export interface RuleRelayMatchedSource extends RuleRelayExpectedSource {
  scope: string;
}

export interface RuleRelayExpandedSource {
  path: string;
  adapter: SourceAdapter;
  scope: string;
}

export interface RuleRelayCompatibilityBlocker {
  code: "MISSING_RULE_RELAY_SOURCE" | "LEGACY_SOURCE_HYGIENE_ERROR";
  file: string;
  message: string;
  detail?: string;
}

export interface RuleRelayCompatibilityWarning {
  code: string;
  file: string;
  message: string;
  detail?: string;
}

export interface RuleRelayCompatibilityReport {
  schema: typeof SCHEMA;
  root: string;
  ready: boolean;
  expectedSources: RuleRelayExpectedSource[];
  matchedSources: RuleRelayMatchedSource[];
  expandedSources: RuleRelayExpandedSource[];
  blockers: RuleRelayCompatibilityBlocker[];
  warnings: RuleRelayCompatibilityWarning[];
  scanWarnings: string[];
  replacementCommands: {
    scan: string;
    check: string;
    strictCheck: string;
    explain: string;
  };
}

function ruleRelayAdapterForPath(path: string): RuleRelayAdapter | undefined {
  if (/(^|\/)AGENTS\.md$/i.test(path)) return "agents-md";
  if (
    copilotRepositoryInstruction.test(path) ||
    copilotPathInstruction.test(path)
  ) {
    return "copilot";
  }
  if (/(^|\/)CLAUDE\.md$/i.test(path)) return "claude";
  if (/(^|\/)GEMINI\.md$/i.test(path)) return "gemini";
  if (/(^|\/)\.cursorrules$/i.test(path)) return "cursor";
  return undefined;
}

function compareByPathAndAdapter(
  left: { path: string; adapter: string },
  right: { path: string; adapter: string },
): number {
  return (
    left.path.localeCompare(right.path) ||
    left.adapter.localeCompare(right.adapter)
  );
}

function compareFinding(
  left: { file: string; code: string },
  right: { file: string; code: string },
): number {
  return (
    left.file.localeCompare(right.file) || left.code.localeCompare(right.code)
  );
}

export async function assessRuleRelayCompatibility(
  root: string,
): Promise<RuleRelayCompatibilityReport> {
  const repositoryFiles = await walkRepository(root);
  const expectedSources = repositoryFiles
    .flatMap((path): RuleRelayExpectedSource[] => {
      const adapter = ruleRelayAdapterForPath(path);
      return adapter ? [{ path, adapter }] : [];
    })
    .sort(compareByPathAndAdapter);

  const [inventory, audit] = await Promise.all([
    inventoryInstructions(root),
    auditInstructions(root),
  ]);
  const expectedByPath = new Map(
    expectedSources.map((source) => [source.path, source] as const),
  );
  const inventoryByPath = new Map(
    inventory.sources.map((source) => [source.path, source] as const),
  );

  const matchedSources: RuleRelayMatchedSource[] = [];
  const blockers: RuleRelayCompatibilityBlocker[] = [];
  for (const expected of expectedSources) {
    const discovered = inventoryByPath.get(expected.path);
    if (!discovered || discovered.adapter !== expected.adapter) {
      blockers.push({
        code: "MISSING_RULE_RELAY_SOURCE",
        file: expected.path,
        message: `RuleRelay would discover this as ${expected.adapter}, but GuardSpec did not discover the same adapter family.`,
      });
      continue;
    }
    matchedSources.push({
      ...expected,
      scope: discovered.scope,
    });
  }

  for (const finding of audit.findings) {
    if (finding.severity === "error" && expectedByPath.has(finding.file)) {
      blockers.push({
        code: "LEGACY_SOURCE_HYGIENE_ERROR",
        file: finding.file,
        message: finding.message,
        ...(finding.detail ? { detail: finding.detail } : {}),
      });
    }
  }

  const expandedSources = inventory.sources
    .filter((source) => !expectedByPath.has(source.path))
    .map((source) => ({
      path: source.path,
      adapter: source.adapter,
      scope: source.scope,
    }))
    .sort(compareByPathAndAdapter);

  const warnings = audit.findings
    .filter((finding) => finding.severity === "warning")
    .map((finding) => ({
      code: finding.code,
      file: finding.file,
      message: finding.message,
      ...(finding.detail ? { detail: finding.detail } : {}),
    }))
    .sort(compareFinding);

  blockers.sort(compareFinding);
  matchedSources.sort(compareByPathAndAdapter);

  return {
    schema: SCHEMA,
    root: inventory.root,
    ready: blockers.length === 0,
    expectedSources,
    matchedSources,
    expandedSources,
    blockers,
    warnings,
    scanWarnings: [...inventory.warnings].sort(),
    replacementCommands: {
      scan: "guardspec instructions scan --json",
      check: "guardspec instructions check --json",
      strictCheck: "guardspec instructions check --strict --json",
      explain: "guardspec instructions explain <target-path> --json",
    },
  };
}
