#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { main as guardSpecMain } from "./cli.js";
import { auditRuleRelayLegacyInstructions } from "./core/rule-relay-check.js";

const INVALID_EXIT = 4;

function flagValue(argv: readonly string[], name: string): string | undefined {
  const long = `--${name}`;
  const inline = `${long}=`;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token?.startsWith(inline)) return token.slice(inline.length);
    if (token === long) {
      const next = argv[index + 1];
      return next && !next.startsWith("--") ? next : "true";
    }
  }
  return undefined;
}

function hasFlag(argv: readonly string[], name: string): boolean {
  return flagValue(argv, name) !== undefined;
}

function isInstructionCheck(argv: readonly string[]): boolean {
  return argv[0] === "instructions" && argv[1] === "check";
}

function write(value: unknown, json: boolean): void {
  process.stdout.write(
    `${json ? JSON.stringify(value, null, 2) : String(value)}\n`,
  );
}

async function runRuleRelayCheck(argv: readonly string[]): Promise<void> {
  const root = resolve(flagValue(argv, "root") ?? process.cwd());
  const strict = hasFlag(argv, "strict");
  const json = hasFlag(argv, "json");
  const report = await auditRuleRelayLegacyInstructions(root);

  if (json) {
    write(report, true);
  } else {
    write(
      `RuleRelay-compatible instruction hygiene\n  Sources: ${report.sources}\n  Errors: ${report.errors}\n  Warnings: ${report.warnings}${
        report.findings.length > 0
          ? `\n\n${report.findings
              .map(
                (finding) =>
                  `${finding.severity.toUpperCase()} ${finding.code} ${finding.file}`,
              )
              .join("\n")}`
          : "\n\nNo RuleRelay-compatible instruction findings."
      }`,
      false,
    );
  }

  process.exitCode =
    report.errors > 0 || (strict && report.warnings > 0) ? INVALID_EXIT : 0;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (!isInstructionCheck(argv)) {
    await guardSpecMain([...argv]);
    return;
  }

  const compatibility = flagValue(argv, "compat");
  if (compatibility === undefined) {
    await guardSpecMain([...argv]);
    return;
  }
  if (compatibility !== "rule-relay") {
    process.stderr.write(
      `guardspec: instructions check --compat supports only rule-relay, received ${compatibility}.\n`,
    );
    process.exitCode = INVALID_EXIT;
    return;
  }

  try {
    await runRuleRelayCheck(argv);
  } catch (error) {
    process.stderr.write(
      `guardspec: ${error instanceof Error ? error.message : "unexpected error"}\n`,
    );
    process.exitCode = INVALID_EXIT;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main();
