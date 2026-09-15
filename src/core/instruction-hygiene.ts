import { posix } from "node:path";
import { isCopilotPathInstruction, parseCopilotApplyTo } from "./copilot.js";
import { safeRead, walkRepository } from "./fs-safe.js";
import { scanRepository } from "./scanner.js";
import type { DiscoveredSource } from "./types.js";

export type InstructionFindingCode =
  | "DEAD_LOCAL_LINK"
  | "DUPLICATE_INSTRUCTION"
  | "INVALID_COPILOT_APPLY_TO"
  | "MISSING_PACKAGE_SCRIPT"
  | "UNSAFE_LOCAL_LINK";

export interface InstructionFinding {
  code: InstructionFindingCode;
  severity: "error" | "warning";
  message: string;
  file: string;
  detail?: string;
}

export interface InstructionAuditReport {
  root: string;
  sources: number;
  findings: InstructionFinding[];
  errors: number;
  warnings: number;
  valid: boolean;
}

interface LoadedInstruction {
  source: DiscoveredSource;
  content: string;
}

interface PackageManifest {
  scripts?: Record<string, unknown>;
}

const localMarkdownLinks = /\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g;
const inlineCode = /`([^`\n]+)`/g;
const explicitPackageRun =
  /^(?:npm|pnpm|yarn|bun)\s+run\s+([a-zA-Z0-9:_-]+)(?:\s|$)/;
const uriScheme = /^[a-z][a-z0-9+.-]*:/i;

function isAgentInstructionSource(source: DiscoveredSource): boolean {
  return (
    source.adapter === "agents-md" ||
    source.adapter === "claude" ||
    source.adapter === "copilot" ||
    source.adapter === "cursor" ||
    source.adapter === "gemini" ||
    source.adapter === "opencode"
  );
}

function normalizeContent(content: string): string {
  return content.replace(/\r\n?/g, "\n").trim();
}

function pushDuplicateFindings(
  files: readonly LoadedInstruction[],
  findings: InstructionFinding[],
): void {
  const groups = new Map<string, LoadedInstruction[]>();
  for (const file of files) {
    const key = normalizeContent(file.content);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const locations = group
      .map((file) => file.source.path)
      .sort()
      .join(", ");
    for (const file of group) {
      findings.push({
        code: "DUPLICATE_INSTRUCTION",
        severity: "warning",
        message: `Instruction content is duplicated across: ${locations}`,
        file: file.source.path,
        detail:
          "Choose a canonical source or keep only a short compatibility shim.",
      });
    }
  }
}

function pushCopilotApplyToFinding(
  file: LoadedInstruction,
  findings: InstructionFinding[],
): void {
  if (
    file.source.adapter !== "copilot" ||
    !isCopilotPathInstruction(file.source.path)
  ) {
    return;
  }
  const parsed = parseCopilotApplyTo(file.content);
  if (parsed.ok) return;
  findings.push({
    code: "INVALID_COPILOT_APPLY_TO",
    severity: "error",
    message:
      "Path-specific Copilot instructions have invalid applyTo metadata.",
    file: file.source.path,
    detail: parsed.error,
  });
}

function localTarget(
  rawTarget: string,
  sourcePath: string,
): { skip: true } | { skip: false; path?: string; error?: string } {
  let target = rawTarget.trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1);
  }
  if (!target || target.startsWith("#") || uriScheme.test(target)) {
    return { skip: true };
  }

  target = target.split(/[?#]/, 1)[0] ?? "";
  if (!target) return { skip: true };
  try {
    target = decodeURIComponent(target);
  } catch {
    return {
      skip: false,
      error: `Local Markdown link is not valid URI encoding: ${rawTarget}`,
    };
  }
  target = target.replaceAll("\\", "/");
  if (target.startsWith("/")) {
    return {
      skip: false,
      error: `Local Markdown link must be repository-relative: ${rawTarget}`,
    };
  }

  const resolved = posix.normalize(
    posix.join(posix.dirname(sourcePath), target),
  );
  if (
    resolved === ".." ||
    resolved.startsWith("../") ||
    resolved.startsWith("/")
  ) {
    return {
      skip: false,
      error: `Local Markdown link escapes the repository: ${rawTarget}`,
    };
  }
  return { skip: false, path: resolved };
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

function pushLinkFindings(
  file: LoadedInstruction,
  repositoryFiles: ReadonlySet<string>,
  findings: InstructionFinding[],
): void {
  for (const match of file.content.matchAll(localMarkdownLinks)) {
    const rawTarget = match[1];
    if (!rawTarget) continue;
    const target = localTarget(rawTarget, file.source.path);
    if (target.skip) continue;
    if (target.error) {
      findings.push({
        code: "UNSAFE_LOCAL_LINK",
        severity: "error",
        message: target.error,
        file: file.source.path,
      });
      continue;
    }
    if (target.path && !repositoryPathExists(target.path, repositoryFiles)) {
      findings.push({
        code: "DEAD_LOCAL_LINK",
        severity: "error",
        message: `Local Markdown link does not exist: ${rawTarget}`,
        file: file.source.path,
        detail: `Expected ${target.path}`,
      });
    }
  }
}

async function nearestPackageManifest(
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
          return parsed as PackageManifest;
        }
        return undefined;
      } catch {
        return undefined;
      }
    }
    if (current === ".") return undefined;
    current = posix.dirname(current);
  }
}

async function pushPackageScriptFindings(
  root: string,
  file: LoadedInstruction,
  repositoryFiles: ReadonlySet<string>,
  findings: InstructionFinding[],
): Promise<void> {
  const manifest = await nearestPackageManifest(
    root,
    file.source.path,
    repositoryFiles,
  );
  if (!manifest?.scripts || typeof manifest.scripts !== "object") return;

  for (const match of file.content.matchAll(inlineCode)) {
    const value = match[1]?.trim();
    if (!value) continue;
    const command = explicitPackageRun.exec(value);
    const scriptName = command?.[1];
    if (!scriptName || Object.hasOwn(manifest.scripts, scriptName)) continue;
    findings.push({
      code: "MISSING_PACKAGE_SCRIPT",
      severity: "error",
      message: `Referenced package script is not declared: ${scriptName}`,
      file: file.source.path,
      detail: `Command: ${value}`,
    });
  }
}

function sortFindings(findings: InstructionFinding[]): InstructionFinding[] {
  return findings.sort((left, right) =>
    [left.file, left.code, left.message, left.detail ?? ""]
      .join("\u0000")
      .localeCompare(
        [right.file, right.code, right.message, right.detail ?? ""].join(
          "\u0000",
        ),
      ),
  );
}

export async function auditInstructions(
  root: string,
): Promise<InstructionAuditReport> {
  const scan = await scanRepository(root);
  const repositoryFiles = new Set(await walkRepository(root));
  const files: LoadedInstruction[] = [];
  for (const source of scan.sources.filter(isAgentInstructionSource)) {
    try {
      files.push({ source, content: await safeRead(root, source.path) });
    } catch {
      // scanRepository already bounds discovery/read failures; do not invent a second result.
    }
  }

  const findings: InstructionFinding[] = [];
  pushDuplicateFindings(files, findings);
  for (const file of files) {
    pushCopilotApplyToFinding(file, findings);
    pushLinkFindings(file, repositoryFiles, findings);
    await pushPackageScriptFindings(root, file, repositoryFiles, findings);
  }

  sortFindings(findings);
  const errors = findings.filter(
    (finding) => finding.severity === "error",
  ).length;
  const warnings = findings.length - errors;
  return {
    root,
    sources: files.length,
    findings,
    errors,
    warnings,
    valid: errors === 0,
  };
}
