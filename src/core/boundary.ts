import type { Policy, PolicyRule } from "./types.js";

export const AGENT_BOUNDARY_SCHEMA =
  "https://patchwitness.dev/agent-boundary/v1";

export interface AgentBoundaryProvenance {
  source: string;
  rule: string;
  reason: string;
}

export interface AgentBoundary {
  schema: typeof AGENT_BOUNDARY_SCHEMA;
  version: 1;
  id: string;
  exclusive_allow: boolean;
  allowed_paths: string[];
  denied_paths: string[];
  protected_paths: string[];
  required_checks: string[];
  provenance: AgentBoundaryProvenance[];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function provenanceOf(rule: PolicyRule): AgentBoundaryProvenance {
  return {
    source: rule.provenance[0]?.source ?? "policy",
    rule: rule.id,
    reason: rule.message,
  };
}

export function compileBoundary(policy: Policy): AgentBoundary {
  const pathAllows = policy.rules.filter(
    (rule) => rule.kind === "path" && rule.effect === "allow",
  );
  const exclusiveAllows = pathAllows.filter((rule) => rule.exclusive === true);
  const exclusive_allow = exclusiveAllows.length > 0;
  const allowed_paths = unique(
    exclusive_allow
      ? exclusiveAllows.map((rule) => rule.scope)
      : pathAllows.map((rule) => rule.scope),
  );
  const pathDenies = policy.rules.filter(
    (rule) => rule.kind === "path" && rule.effect === "deny",
  );
  const denied_paths = unique(pathDenies.map((rule) => rule.scope));
  const required_checks = unique(
    policy.rules
      .filter(
        (rule) =>
          (rule.kind === "check" || rule.kind === "command") &&
          rule.effect === "require" &&
          typeof rule.value === "string",
      )
      .map((rule) => String(rule.value)),
  );
  return {
    schema: AGENT_BOUNDARY_SCHEMA,
    version: 1,
    id: policy.name,
    exclusive_allow,
    allowed_paths,
    denied_paths,
    protected_paths: [...denied_paths],
    required_checks,
    provenance: [...exclusiveAllows, ...pathDenies].map(provenanceOf),
  };
}
