import * as core from "@actions/core";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateTask } from "../src/core/evaluator.js";
import { loadPolicy } from "../src/core/policy.js";
import type { CheckReport, Decision } from "../src/core/types.js";
import { resolveChangedFiles } from "./changed-files.js";

function sarif(report: CheckReport): Record<string, unknown> {
  const results = report.decisions
    .filter(
      (decision) => !decision.allowed && decision.status !== "not-covered",
    )
    .map((decision) => ({
      ruleId: `guardspec/${decision.status}`,
      level:
        decision.status === "denied" || decision.status === "conflict"
          ? "error"
          : "warning",
      message: { text: decision.reason },
      locations: [
        { physicalLocation: { artifactLocation: { uri: decision.target } } },
      ],
    }));
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [{ tool: { driver: { name: "GuardSpec", rules: [] } }, results }],
  };
}

function annotate(decision: Decision): void {
  const message = `${decision.status}: ${decision.reason}`;
  if (decision.status === "denied" || decision.status === "conflict")
    core.error(message, { file: decision.target });
  else if (decision.status === "approval-required")
    core.warning(message, { file: decision.target });
}

async function run(): Promise<void> {
  const root = process.cwd();
  const policyPath = core.getInput("policy") || ".agent-policy.yml";
  if (!existsSync(resolve(root, policyPath))) {
    core.setFailed(`GuardSpec policy not found: ${policyPath}`);
    return;
  }
  const policy = await loadPolicy(root, policyPath);
  const report = evaluateTask(policy, {
    paths: resolveChangedFiles(core.getInput("changed-files")),
    aiAssisted: core.getBooleanInput("ai-assisted"),
  });
  report.root = root;
  for (const decision of report.decisions) annotate(decision);
  const output = JSON.stringify(report);
  core.setOutput("result", output);
  const sarifPath = ".guardspec.sarif";
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(sarifPath, JSON.stringify(sarif(report), null, 2)),
  );
  core.setOutput("sarif", sarifPath);
  if (
    !report.valid ||
    (core.getBooleanInput("fail-on-warn") &&
      report.decisions.some(
        (decision) => decision.status === "approval-required",
      ))
  )
    core.setFailed(`GuardSpec check failed with exit code ${report.exitCode}.`);
}

void run().catch((error: unknown) =>
  core.setFailed(
    error instanceof Error ? error.message : "GuardSpec Action failed.",
  ),
);
