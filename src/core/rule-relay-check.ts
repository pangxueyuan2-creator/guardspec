import { resolve } from "node:path";
import { assessRuleRelayCompatibility } from "./rule-relay-compatibility.js";
import type { RuleRelayValidationFinding } from "./rule-relay-validation.js";

const SCHEMA = "guardspec.dev/rule-relay-check/v1" as const;

export interface RuleRelayLegacyCheckReport {
  schema: typeof SCHEMA;
  root: string;
  sources: number;
  findings: RuleRelayValidationFinding[];
  errors: number;
  warnings: number;
  valid: boolean;
}

/**
 * Reconstruct RuleRelay v0.1 validation semantics without executing repository
 * commands, probing repository-external paths, or using the network.
 *
 * GuardSpec's default instruction hygiene intentionally remains unchanged; this
 * report exists only as an explicit migration bridge for repositories replacing
 * `rule-relay check`.
 */
export async function auditRuleRelayLegacyInstructions(
  root: string,
): Promise<RuleRelayLegacyCheckReport> {
  const compatibility = await assessRuleRelayCompatibility(resolve(root));
  const findings = compatibility.validation.expectedFindings.map((finding) => ({
    ...finding,
  }));
  const errors = findings.filter(
    (finding) => finding.severity === "error",
  ).length;
  const warnings = findings.length - errors;

  return {
    schema: SCHEMA,
    root: compatibility.root,
    sources: compatibility.expectedSources.length,
    findings,
    errors,
    warnings,
    valid: errors === 0,
  };
}
