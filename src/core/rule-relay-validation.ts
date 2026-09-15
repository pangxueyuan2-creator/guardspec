import {
  dirname,
  isAbsolute,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { isCopilotPathInstruction, parseCopilotApplyTo } from "./copilot.js";
import { safeRead } from "./fs-safe.js";
import type { InstructionFinding } from "./instruction-hygiene.js";

const localMarkdownLinks =
  /\[[^\]]*\]\((?!https?:\/\/|mailto:|#)([^)\s]+)(?:\s+[^)]*)?\)/g;
const inlineCode = /`([^`\n]+)`/g;
const packageCommands =
  /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([a-zA-Z0-9:_-]+)(?:\s|$)/;

export type RuleRelayValidationFindingCode =
  | "DEAD_LOCAL_LINK"
  | "DUPLICATE_INSTRUCTION"
  | "INVALID_COPILOT_APPLY_TO"
  | "MISSING_PACKAGE_SCRIPT"
  | "UNSAFE_LOCAL_LINK";

export interface RuleRelayValidationFinding {
  code: RuleRelayValidationFindingCode;
  severity: "error" | "warning";
  file: string;
}

export interface RuleRelayValidationSource {
  path: string;
  adapter: string;
}

export interface RuleRelayValidationComparison {
  expectedFindings: RuleRelayValidationFinding[];
  matchedFindings: RuleRelayValidationFinding[];
  missingFindings: RuleRelayValidationFinding[];
}

interface LoadedLegacyInstruction {
  source: RuleRelayValidationSource;
  content: string;
}

interface PackageManifest {
  scripts?: Record<string, unknown>;
}

function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, "\n").trim();
}

function findingKey(finding: {
  code: string;
  severity: string;
  file: string;
}): string {
  return [finding.file, finding.code, finding.severity].join("\u0000");
}

function compareFindings(
  left: RuleRelayValidationFinding,
  right: RuleRelayValidationFinding,
): number {
  return findingKey(left).localeCompare(findingKey(right));
}

function uniqueFindings(
  findings: readonly RuleRelayValidationFinding[],
): RuleRelayValidationFinding[] {
  const unique = new Map<string, RuleRelayValidationFinding>();
  for (const finding of findings) {
    unique.set(findingKey(finding), finding);
  }
  return [...unique.values()].sort(compareFindings);
}

function pushDuplicateFindings(
  files: readonly LoadedLegacyInstruction[],
  findings: RuleRelayValidationFinding[],
): void {
  const groups = new Map<string, LoadedLegacyInstruction[]>();
  for (const file of files) {
    const key = normalizeContent(file.content);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const file of group) {
      findings.push({
        code: "DUPLICATE_INSTRUCTION",
        severity: "warning",
        file: file.source.path,
      });
    }
  }
}

function pushCopilotApplyToFinding(
  file: LoadedLegacyInstruction,
  findings: RuleRelayValidationFinding[],
): void {
  if (
    file.source.adapter !== "copilot" ||
    !isCopilotPathInstruction(file.source.path)
  ) {
    return;
  }
  if (parseCopilotApplyTo(file.content).ok) return;
  findings.push({
    code: "INVALID_COPILOT_APPLY_TO",
    severity: "error",
    file: file.source.path,
  });
}

function isInsideRepository(root: string, candidate: string): boolean {
  const repositoryRelative = relative(root, candidate);
  return (
    repositoryRelative === "" ||
    (!repositoryRelative.startsWith(`..${sep}`) &&
      repositoryRelative !== ".." &&
      !isAbsolute(repositoryRelative))
  );
}

function repositoryPathExists(
  target: string,
  repositoryFiles: ReadonlySet<string>,
): boolean {
  if (target === ".") return true;
  if (repositoryFiles.has(target)) return true;
  const prefix = `${target.replace(/\/$/, "")}/`;
  for (const path of repositoryFiles) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

function pushLocalLinkFindings(
  root: string,
  file: LoadedLegacyInstruction,
  repositoryFiles: ReadonlySet<string>,
  findings: RuleRelayValidationFinding[],
): void {
  const sourceAbsolutePath = resolve(root, file.source.path);
  for (const match of file.content.matchAll(localMarkdownLinks)) {
    const rawTarget = match[1];
    if (!rawTarget || rawTarget.startsWith("#")) continue;
    const target = rawTarget.split("#", 1)[0];
    if (!target) continue;

    const resolved = resolve(dirname(sourceAbsolutePath), target);
    if (!isInsideRepository(root, resolved)) {
      findings.push({
        code: "UNSAFE_LOCAL_LINK",
        severity: "error",
        file: file.source.path,
      });
      continue;
    }

    const repositoryRelative =
      relative(root, resolved).split(sep).join("/") || ".";
    if (!repositoryPathExists(repositoryRelative, repositoryFiles)) {
      findings.push({
        code: "DEAD_LOCAL_LINK",
        severity: "error",
        file: file.source.path,
      });
    }
  }
}

async function nearestLegacyPackageManifest(
  root: string,
  sourcePath: string,
  repositoryFiles: ReadonlySet<string>,
): Promise<PackageManifest | undefined> {
  let current = posix.dirname(sourcePath);
  while (true) {
    const candidate =
      current === "." ? "package.json" : `${current}/package.json`;
    if (repositoryFiles.has(candidate)) {
      try {
        const parsed: unknown = JSON.parse(await safeRead(root, candidate));
        if (parsed && typeof parsed === "object") {
          return parsed;
        }
        return {};
      } catch {
        // RuleRelay v0.1 continued toward the repository root when a
        // candidate manifest was missing or malformed.
      }
    }
    if (current === ".") return undefined;
    current = posix.dirname(current);
  }
}

async function pushPackageScriptFindings(
  root: string,
  file: LoadedLegacyInstruction,
  repositoryFiles: ReadonlySet<string>,
  findings: RuleRelayValidationFinding[],
): Promise<void> {
  const manifest = await nearestLegacyPackageManifest(
    root,
    file.source.path,
    repositoryFiles,
  );
  if (!manifest?.scripts || typeof manifest.scripts !== "object") return;

  for (const match of file.content.matchAll(inlineCode)) {
    const value = match[1]?.trim();
    if (!value) continue;
    const scriptName = packageCommands.exec(value)?.[1];
    if (!scriptName || Object.hasOwn(manifest.scripts, scriptName)) continue;
    findings.push({
      code: "MISSING_PACKAGE_SCRIPT",
      severity: "error",
      file: file.source.path,
    });
  }
}

async function legacyValidationFindings(
  root: string,
  sources: readonly RuleRelayValidationSource[],
  repositoryFiles: ReadonlySet<string>,
): Promise<RuleRelayValidationFinding[]> {
  const files: LoadedLegacyInstruction[] = [];
  for (const source of sources) {
    try {
      files.push({ source, content: await safeRead(root, source.path) });
    } catch {
      // Discovery parity reports unreadable/missing legacy sources separately.
    }
  }

  const findings: RuleRelayValidationFinding[] = [];
  pushDuplicateFindings(files, findings);
  for (const file of files) {
    pushCopilotApplyToFinding(file, findings);
    pushLocalLinkFindings(root, file, repositoryFiles, findings);
    await pushPackageScriptFindings(root, file, repositoryFiles, findings);
  }
  return uniqueFindings(findings);
}

export async function compareRuleRelayValidation(
  root: string,
  sources: readonly RuleRelayValidationSource[],
  repositoryFiles: ReadonlySet<string>,
  guardFindings: readonly InstructionFinding[],
): Promise<RuleRelayValidationComparison> {
  const expectedFindings = await legacyValidationFindings(
    root,
    sources,
    repositoryFiles,
  );
  const guardKeys = new Set(guardFindings.map(findingKey));
  const matchedFindings = expectedFindings.filter((finding) =>
    guardKeys.has(findingKey(finding)),
  );
  const missingFindings = expectedFindings.filter(
    (finding) => !guardKeys.has(findingKey(finding)),
  );

  return {
    expectedFindings,
    matchedFindings,
    missingFindings,
  };
}
