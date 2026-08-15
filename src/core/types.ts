export type RuleKind =
  "path" | "command" | "network" | "mcp" | "check" | "approval" | "disclosure";
export type RuleEffect = "allow" | "deny" | "require" | "warn";
export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type SourceAdapter =
  | "agents-md"
  | "claude"
  | "copilot"
  | "cursor"
  | "gemini"
  | "opencode"
  | "mcp"
  | "codeowners"
  | "repository-doc"
  | "manifest"
  | "policy";

export interface Provenance {
  source: string;
  line: number;
  adapter: SourceAdapter;
  excerpt: string;
  confidence: "high" | "medium" | "manual";
}

export interface PolicyRule {
  id: string;
  kind: RuleKind;
  effect: RuleEffect;
  scope: string;
  value?: string | string[] | boolean;
  severity: Severity;
  message: string;
  provenance: Provenance[];
}

export interface Policy {
  version: 1;
  name: string;
  generatedAt?: string;
  rules: PolicyRule[];
  overrides?: Array<{
    ruleIds: string[];
    resolution: string;
    rationale: string;
  }>;
}

export interface DiscoveredSource {
  path: string;
  adapter: SourceAdapter;
  scope: string;
  bytes: number;
  rulesExtracted: number;
}

export interface Conflict {
  id: string;
  kind: RuleKind;
  scope: string;
  ruleIds: string[];
  severity: Severity;
  message: string;
}

export interface Decision {
  allowed: boolean;
  status:
    "allowed" | "denied" | "approval-required" | "conflict" | "not-covered";
  action: RuleKind;
  target: string;
  matchedRules: PolicyRule[];
  reason: string;
  requiredChecks: string[];
  approvalRequired: boolean;
}

export interface RiskSummary {
  score: number;
  level: "low" | "medium" | "high" | "critical";
  signals: string[];
}

export interface ScanReport {
  root: string;
  sources: DiscoveredSource[];
  policy: Policy;
  conflicts: Conflict[];
  risk: RiskSummary;
  warnings: string[];
}

export interface TaskRequest {
  paths?: string[];
  commands?: string[];
  networkDomains?: string[];
  mcpServers?: string[];
  aiAssisted?: boolean;
}

export const CHECK_SCHEMA_VERSION = "guardspec.check.v1" as const;

export interface CheckReport {
  root: string;
  decisions: Decision[];
  conflicts: Conflict[];
  valid: boolean;
  exitCode: number;
  schema_version: typeof CHECK_SCHEMA_VERSION;
  policy_digest: string;
  decision: "allow" | "deny" | "conflict";
  matched_rules: string[];
  protected_paths: string[];
}
