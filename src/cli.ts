#!/usr/bin/env node
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanRepository } from "./core/scanner.js";
import { evaluate, evaluateTask } from "./core/evaluator.js";
import { compileBoundary } from "./core/boundary.js";
import { loadPolicy, policyTemplate, writePolicy } from "./core/policy.js";
import { manualProvenance } from "./core/policy.js";
import type { Policy, PolicyRule, TaskRequest } from "./core/types.js";
import { runMcpServer } from "./mcp/server.js";
import { writeAdapter } from "./adapters/generate.js";

export function isDirectInvocation(
  metaUrl: string,
  argv1: string | undefined,
): boolean {
  if (!argv1) return false;
  try {
    const invoked = resolve(argv1);
    const current = resolve(fileURLToPath(metaUrl));
    if (process.platform === "win32") {
      return invoked.toLowerCase() === current.toLowerCase();
    }
    return invoked === current;
  } catch {
    return false;
  }
}

const EXIT = {
  success: 0,
  denied: 2,
  conflict: 3,
  invalid: 4,
  system: 5,
} as const;

function usage(): string {
  return `GuardSpec — compile repository intent into enforceable agent boundaries.

Usage:
  guardspec scan [--root <path>] [--json] [--write]
  guardspec init [--root <path>] [--force]
  guardspec check [--root <path>] [--policy <file>] [--path <path>]... [--command <cmd>]... [--network <domain>]... [--mcp <server>]... [--ai-assisted] [--json]
  guardspec compile [--root <path>] [--policy <file>] [--out <file>] [--json]
  guardspec explain <rule-id|path> [--root <path>] [--policy <file>] [--json]
  guardspec policy validate [--root <path>] [--policy <file>]
  guardspec adapters generate <agent> [--root <path>] [--policy <file>]
  guardspec doctor [--root <path>] [--json]
  guardspec mcp [--root <path>] [--policy <file>]

Exit codes: 0 success, 2 denied, 3 conflict, 4 invalid input, 5 system error.`;
}

interface Args {
  command: string | undefined;
  positional: string[];
  flags: Map<string, string[]>;
}
function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  let command: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--help" || token === "-h") {
      flags.set("help", ["true"]);
      continue;
    }
    if (token.startsWith("--")) {
      const [name, inline] = token.slice(2).split("=", 2);
      if (!name) throw new Error("Malformed flag.");
      const next =
        inline ??
        (argv[index + 1] && !argv[index + 1]!.startsWith("--")
          ? argv[++index]!
          : "true");
      flags.set(name, [...(flags.get(name) ?? []), next]);
      continue;
    }
    if (!command) command = token;
    else positional.push(token);
  }
  return { command, positional, flags };
}
function flag(args: Args, key: string): string | undefined {
  return args.flags.get(key)?.at(-1);
}
function flags(args: Args, key: string): string[] {
  return args.flags.get(key) ?? [];
}
function rootFrom(args: Args): string {
  return resolve(flag(args, "root") ?? process.cwd());
}
function writeOutput(value: unknown, json: boolean): void {
  process.stdout.write(
    `${json ? JSON.stringify(value, null, 2) : String(value)}\n`,
  );
}
function baselineRules(): PolicyRule[] {
  const provenance = [manualProvenance()];
  return [
    {
      id: "baseline-protect-policy",
      kind: "path",
      effect: "deny",
      scope: ".agent-policy.yml",
      severity: "high",
      message:
        "Agent policy modifications require an explicit human-reviewed policy update.",
      provenance,
    },
    {
      id: "baseline-protect-ci",
      kind: "path",
      effect: "deny",
      scope: ".github/workflows/**",
      severity: "high",
      message: "CI workflow modifications are protected by default.",
      provenance,
    },
    {
      id: "baseline-approval-policy",
      kind: "approval",
      effect: "require",
      scope: ".agent-policy.yml",
      severity: "high",
      message: "Human approval is required for policy changes.",
      provenance,
    },
  ];
}
async function currentPolicy(root: string, selected?: string): Promise<Policy> {
  return loadPolicy(root, selected);
}

async function handle(args: Args): Promise<number> {
  if (!args.command || flag(args, "help")) {
    process.stdout.write(usage());
    return EXIT.success;
  }
  const root = rootFrom(args);
  const json = flag(args, "json") === "true";
  if (args.command === "scan") {
    const report = await scanRepository(root);
    if (flag(args, "write") === "true")
      await writePolicy(
        root,
        policyTemplate(report.policy.name, [
          ...baselineRules(),
          ...report.policy.rules,
        ]),
      );
    if (json) writeOutput(report, true);
    else
      writeOutput(
        `Repository Agent Policy\n  Sources: ${report.sources.length}\n  Extracted rules: ${report.policy.rules.length}\n  Conflicts: ${report.conflicts.length}\n  Risk: ${report.risk.level} (${report.risk.score}/100)\n\nProtected paths:\n${
          report.policy.rules
            .filter((rule) => rule.kind === "path" && rule.effect === "deny")
            .map(
              (rule) =>
                `  - ${rule.scope}  ← ${rule.provenance[0]?.source ?? "unknown"}`,
            )
            .join("\n") || "  - none discovered"
        }\n\nRequired checks:\n${
          report.policy.rules
            .filter((rule) => rule.kind === "check")
            .map((rule) => `  - ${String(rule.value)}`)
            .join("\n") || "  - none discovered"
        }\n\nNext action: run \`guardspec init\` to create a reviewable policy, or \`guardspec scan --write\` to write it directly.`,
        false,
      );
    return report.conflicts.length > 0 ? EXIT.conflict : EXIT.success;
  }
  if (args.command === "init") {
    const destination = resolve(root, ".agent-policy.yml");
    if (existsSync(destination) && flag(args, "force") !== "true")
      throw new Error(
        ".agent-policy.yml already exists; use --force only after reviewing it.",
      );
    const report = await scanRepository(root);
    const policy = policyTemplate(report.policy.name, [
      ...baselineRules(),
      ...report.policy.rules,
    ]);
    await writePolicy(root, policy);
    writeOutput(
      json
        ? policy
        : `Created .agent-policy.yml with ${policy.rules.length} reviewable rules from ${report.sources.length} sources.`,
      json,
    );
    return EXIT.success;
  }
  if (args.command === "check") {
    const policy = await currentPolicy(root, flag(args, "policy"));
    const request: TaskRequest = {
      paths: flags(args, "path"),
      commands: flags(args, "command"),
      networkDomains: flags(args, "network"),
      mcpServers: flags(args, "mcp"),
      aiAssisted: flag(args, "ai-assisted") === "true",
    };
    const report = evaluateTask(policy, request);
    report.root = root;
    if (json) writeOutput(report, true);
    else
      writeOutput(
        report.decisions
          .map(
            (decision) =>
              `${decision.status.toUpperCase()} ${decision.action} ${decision.target}\n  ${decision.reason}${decision.requiredChecks.length ? `\n  Required checks: ${decision.requiredChecks.join(", ")}` : ""}`,
          )
          .join("\n"),
        false,
      );
    return report.exitCode;
  }
  if (args.command === "compile") {
    const selected = flag(args, "policy") ?? ".agent-policy.yml";
    const policyPath = resolve(root, selected);
    let policy: Policy;
    if (existsSync(policyPath)) {
      policy = await currentPolicy(root, flag(args, "policy"));
    } else {
      const report = await scanRepository(root);
      policy = policyTemplate(report.policy.name, [
        ...baselineRules(),
        ...report.policy.rules,
      ]);
    }
    const boundary = compileBoundary(policy);
    const out = flag(args, "out");
    if (out) {
      await writeFile(resolve(root, out), `${JSON.stringify(boundary, null, 2)}\n`, "utf8");
    }
    if (json || !out) writeOutput(boundary, true);
    else writeOutput(`Wrote agent-boundary/v1 to ${out}`, false);
    return EXIT.success;
  }
  if (args.command === "explain") {
    const subject = args.positional[0];
    if (!subject)
      throw new Error("explain requires a rule id or repository path.");
    const policy = await currentPolicy(root, flag(args, "policy"));
    const byId = policy.rules.find((rule) => rule.id === subject);
    const result = byId ?? evaluate(policy, "path", subject);
    writeOutput(result, json);
    return EXIT.success;
  }
  if (args.command === "policy" && args.positional[0] === "validate") {
    const policy = await currentPolicy(root, flag(args, "policy"));
    writeOutput(
      json
        ? policy
        : `Policy valid: ${policy.name} (${policy.rules.length} rules).`,
      json,
    );
    return EXIT.success;
  }
  if (args.command === "adapters" && args.positional[0] === "generate") {
    const agent = args.positional[1];
    if (!agent) throw new Error("adapters generate requires an agent name.");
    const policy = await currentPolicy(root, flag(args, "policy"));
    const target = await writeAdapter(root, agent, policy);
    writeOutput(
      json ? { agent, target } : `Generated ${target} from reviewed policy.`,
      json,
    );
    return EXIT.success;
  }
  if (args.command === "doctor") {
    const result = {
      root,
      node: process.version,
      policyPresent: existsSync(
        resolve(root, flag(args, "policy") ?? ".agent-policy.yml"),
      ),
      network: "not used",
      telemetry: "disabled",
      commandExecution: "disabled",
    };
    writeOutput(result, json);
    return EXIT.success;
  }
  if (args.command === "mcp") {
    await runMcpServer(root, flag(args, "policy"));
    return EXIT.success;
  }
  throw new Error(`Unknown command: ${args.command}`);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  try {
    process.exitCode = await handle(parseArgs(argv));
  } catch (error) {
    process.stderr.write(
      `guardspec: ${error instanceof Error ? error.message : "unexpected error"}\n`,
    );
    process.exitCode = EXIT.invalid;
  }
}

if (isDirectInvocation(import.meta.url, process.argv[1])) void main();
