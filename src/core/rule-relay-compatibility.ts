import { posix } from "node:path";
import { parseCopilotApplyTo } from "./copilot.js";
import { safeRead, walkRepository } from "./fs-safe.js";
import { explainInstructions } from "./instruction-applicability.js";
import { auditInstructions } from "./instruction-hygiene.js";
import { inventoryInstructions } from "./instruction-inventory.js";
import {
  compareRuleRelayValidation,
  type RuleRelayValidationComparison,
} from "./rule-relay-validation.js";
import type { SourceAdapter } from "./types.js";

const SCHEMA = "guardspec.dev/rule-relay-compatibility/v1" as const;
const MAX_TARGETS = 64;

export type RuleRelayAdapter =
  "agents-md" | "claude" | "copilot" | "cursor" | "gemini";

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

export type RuleRelayCompatibilityBlockerCode =
  | "MISSING_RULE_RELAY_SOURCE"
  | "LEGACY_SOURCE_HYGIENE_ERROR"
  | "LEGACY_VALIDATION_FINDING_NOT_REPRODUCED"
  | "LEGACY_TARGET_SOURCE_NOT_APPLICABLE"
  | "LEGACY_TARGET_SOURCE_INDETERMINATE"
  | "LEGACY_TARGET_SCOPE_EXPANDED";

export interface RuleRelayCompatibilityBlocker {
  code: RuleRelayCompatibilityBlockerCode;
  file: string;
  message: string;
  detail?: string;
  target?: string;
}

export interface RuleRelayCompatibilityWarning {
  code: string;
  file: string;
  message: string;
  detail?: string;
}

export interface RuleRelayTargetMatchedSource extends RuleRelayExpectedSource {
  matchedScopes: string[];
}

export interface RuleRelayTargetExpandedSource {
  path: string;
  adapter: SourceAdapter;
  matchedScopes: string[];
}

export interface RuleRelayTargetCompatibility {
  target: string;
  ready: boolean;
  expectedApplicableSources: RuleRelayExpectedSource[];
  matchedApplicableSources: RuleRelayTargetMatchedSource[];
  expandedApplicableSources: RuleRelayTargetExpandedSource[];
  blockers: RuleRelayCompatibilityBlocker[];
}

export interface RuleRelayCompatibilityReport {
  schema: typeof SCHEMA;
  root: string;
  ready: boolean;
  expectedSources: RuleRelayExpectedSource[];
  matchedSources: RuleRelayMatchedSource[];
  expandedSources: RuleRelayExpandedSource[];
  validation: RuleRelayValidationComparison;
  targetChecks: RuleRelayTargetCompatibility[];
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

function isNamedFile(path: string, name: string): boolean {
  const normalized = path.toLowerCase();
  return normalized === name || normalized.endsWith(`/${name}`);
}

function isRuleRelayCopilotRepositoryInstruction(path: string): boolean {
  return isNamedFile(path, ".github/copilot-instructions.md");
}

function isRuleRelayCopilotPathInstruction(path: string): boolean {
  const segments = path.toLowerCase().split("/");
  for (let index = 0; index < segments.length - 2; index += 1) {
    if (segments[index] !== ".github" || segments[index + 1] !== "instructions")
      continue;
    const relative = segments.slice(index + 2).join("/");
    return (
      relative.length > ".instructions.md".length &&
      relative.endsWith(".instructions.md")
    );
  }
  return false;
}

function ruleRelayAdapterForPath(path: string): RuleRelayAdapter | undefined {
  if (isNamedFile(path, "agents.md")) return "agents-md";
  if (
    isRuleRelayCopilotRepositoryInstruction(path) ||
    isRuleRelayCopilotPathInstruction(path)
  ) {
    return "copilot";
  }
  if (isNamedFile(path, "claude.md")) return "claude";
  if (isNamedFile(path, "gemini.md")) return "gemini";
  if (isNamedFile(path, ".cursorrules")) return "cursor";
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
  left: { file: string; code: string; target?: string },
  right: { file: string; code: string; target?: string },
): number {
  return (
    (left.target ?? "").localeCompare(right.target ?? "") ||
    left.file.localeCompare(right.file) ||
    left.code.localeCompare(right.code)
  );
}

function directoryScope(path: string): string {
  const directory = posix.dirname(path);
  return directory === "." ? "." : directory;
}

function isInside(target: string, directory: string): boolean {
  return (
    directory === "." ||
    target === directory ||
    target.startsWith(`${directory}/`)
  );
}

function copilotRepositoryOwner(path: string): string {
  const suffix = ".github/copilot-instructions.md";
  const owner = path.slice(0, path.length - suffix.length).replace(/\/$/, "");
  return owner || ".";
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ruleRelayGlobExpression(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      let end = index;
      while (pattern[end + 1] === "*") end += 1;
      const recursive = end > index;
      index = end;
      if (recursive && pattern[index + 1] === "/") {
        source += "(?:.*/)?";
        index += 1;
      } else {
        source += recursive ? ".*" : "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      continue;
    }
    source += regexEscape(character ?? "");
  }
  return new RegExp(`^${source}$`);
}

async function ruleRelayAppliesToTarget(
  root: string,
  source: RuleRelayExpectedSource,
  target: string,
): Promise<boolean> {
  if (source.adapter !== "copilot") {
    return isInside(target, directoryScope(source.path));
  }

  if (isRuleRelayCopilotRepositoryInstruction(source.path)) {
    return isInside(target, copilotRepositoryOwner(source.path));
  }
  if (!isRuleRelayCopilotPathInstruction(source.path)) return false;

  let content: string;
  try {
    content = await safeRead(root, source.path);
  } catch {
    return false;
  }
  const parsed = parseCopilotApplyTo(content);
  if (!parsed.ok) return false;
  return parsed.patterns.some((pattern) =>
    ruleRelayGlobExpression(pattern).test(target),
  );
}

async function assessTargetCompatibility(
  root: string,
  rawTarget: string,
  expectedSources: readonly RuleRelayExpectedSource[],
): Promise<RuleRelayTargetCompatibility> {
  const guardSpec = await explainInstructions(root, rawTarget);
  const target = guardSpec.target;
  const expectedByPath = new Map(
    expectedSources.map((source) => [source.path, source] as const),
  );
  const expectedApplicableSources: RuleRelayExpectedSource[] = [];
  for (const source of expectedSources) {
    if (await ruleRelayAppliesToTarget(root, source, target)) {
      expectedApplicableSources.push(source);
    }
  }
  expectedApplicableSources.sort(compareByPathAndAdapter);
  const expectedApplicableByPath = new Map(
    expectedApplicableSources.map((source) => [source.path, source] as const),
  );
  const guardApplicableByPath = new Map(
    guardSpec.applicable.map((source) => [source.path, source] as const),
  );
  const guardIndeterminateByPath = new Map(
    guardSpec.indeterminate.map((source) => [source.path, source] as const),
  );

  const blockers: RuleRelayCompatibilityBlocker[] = [];
  const matchedApplicableSources: RuleRelayTargetMatchedSource[] = [];
  for (const expected of expectedApplicableSources) {
    const indeterminate = guardIndeterminateByPath.get(expected.path);
    if (indeterminate) {
      blockers.push({
        code: "LEGACY_TARGET_SOURCE_INDETERMINATE",
        file: expected.path,
        target,
        message:
          "RuleRelay would apply this legacy instruction to the target, but GuardSpec cannot prove its applicability.",
        detail: indeterminate.reason,
      });
      continue;
    }
    const applicable = guardApplicableByPath.get(expected.path);
    if (!applicable || applicable.adapter !== expected.adapter) {
      blockers.push({
        code: "LEGACY_TARGET_SOURCE_NOT_APPLICABLE",
        file: expected.path,
        target,
        message:
          "RuleRelay would apply this legacy instruction to the target, but GuardSpec did not apply the same adapter family.",
      });
      continue;
    }
    matchedApplicableSources.push({
      ...expected,
      matchedScopes: [...applicable.matchedScopes],
    });
  }

  for (const applicable of guardSpec.applicable) {
    const legacy = expectedByPath.get(applicable.path);
    if (!legacy || expectedApplicableByPath.has(applicable.path)) continue;
    blockers.push({
      code: "LEGACY_TARGET_SCOPE_EXPANDED",
      file: applicable.path,
      target,
      message:
        "GuardSpec applies this legacy RuleRelay source to the target, but RuleRelay would not; migration would broaden the legacy rule scope.",
      detail: `GuardSpec matched: ${applicable.matchedScopes.join(", ")}`,
    });
  }

  const expandedApplicableSources = guardSpec.applicable
    .filter((source) => !expectedByPath.has(source.path))
    .map((source) => ({
      path: source.path,
      adapter: source.adapter,
      matchedScopes: [...source.matchedScopes],
    }))
    .sort(compareByPathAndAdapter);

  blockers.sort(compareFinding);
  matchedApplicableSources.sort(compareByPathAndAdapter);
  return {
    target,
    ready: blockers.length === 0,
    expectedApplicableSources,
    matchedApplicableSources,
    expandedApplicableSources,
    blockers,
  };
}

export async function assessRuleRelayCompatibility(
  root: string,
  rawTargets: readonly string[] = [],
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
  const validation = await compareRuleRelayValidation(
    root,
    expectedSources,
    new Set(repositoryFiles),
    audit.findings,
  );
  const expectedByPath = new Map(
    expectedSources.map((source) => [source.path, source] as const),
  );
  const inventoryByPath = new Map(
    inventory.sources.map((source) => [source.path, source] as const),
  );

  const matchedSources: RuleRelayMatchedSource[] = [];
  const blockers: RuleRelayCompatibilityBlocker[] = [];
  for (const finding of validation.missingFindings) {
    blockers.push({
      code: "LEGACY_VALIDATION_FINDING_NOT_REPRODUCED",
      file: finding.file,
      message:
        "RuleRelay would emit this validation finding, but GuardSpec instruction hygiene does not reproduce the same code, severity, and file.",
      detail: `${finding.severity} ${finding.code}`,
    });
  }
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

  const uniqueTargets = [...new Set(rawTargets)];
  if (uniqueTargets.length > MAX_TARGETS) {
    throw new Error(
      `RuleRelay compatibility accepts at most ${MAX_TARGETS} unique targets per run.`,
    );
  }
  const targetChecks: RuleRelayTargetCompatibility[] = [];
  for (const rawTarget of uniqueTargets) {
    targetChecks.push(
      await assessTargetCompatibility(root, rawTarget, expectedSources),
    );
  }
  targetChecks.sort((left, right) => left.target.localeCompare(right.target));
  for (const targetCheck of targetChecks) {
    blockers.push(...targetCheck.blockers);
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
    validation,
    targetChecks,
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
