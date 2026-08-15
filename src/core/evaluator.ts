import picomatch from "picomatch";
import type {
  CheckReport,
  Conflict,
  Decision,
  Policy,
  PolicyRule,
  RuleKind,
  TaskRequest,
} from "./types.js";
import { detectConflicts } from "./scanner.js";

const EFFECT_PRIORITY: Record<PolicyRule["effect"], number> = {
  deny: 4,
  require: 3,
  allow: 2,
  warn: 1,
};

function normalizeTarget(target: string): string {
  return target.replaceAll("\\", "/").replace(/^\.\//, "");
}

function specificity(scope: string): number {
  return scope.replaceAll(/[*!?{}[\]]/g, "").length;
}

function matches(rule: PolicyRule, target: string): boolean {
  if (rule.scope === "**" || rule.scope === "*") return true;
  return picomatch.isMatch(normalizeTarget(target), rule.scope, {
    dot: true,
    nocase: false,
  });
}

function ruleKindForAction(action: RuleKind): RuleKind[] {
  if (action === "command") return ["command", "check"];
  if (action === "path") return ["path", "approval"];
  return [action];
}

export function evaluate(
  policy: Policy,
  action: RuleKind,
  target: string,
): Decision {
  const candidates = policy.rules
    .filter(
      (rule) =>
        ruleKindForAction(action).includes(rule.kind) && matches(rule, target),
    )
    .sort(
      (left, right) =>
        specificity(right.scope) - specificity(left.scope) ||
        EFFECT_PRIORITY[right.effect] - EFFECT_PRIORITY[left.effect] ||
        left.id.localeCompare(right.id),
    );
  const exclusiveAllows = policy.rules.filter(
    (rule) =>
      action === "path" &&
      rule.kind === "path" &&
      rule.effect === "allow" &&
      rule.exclusive === true,
  );
  if (candidates.length === 0) {
    if (exclusiveAllows.length > 0)
      return {
        allowed: false,
        status: "denied",
        action,
        target,
        matchedRules: exclusiveAllows,
        reason: "Exclusive allow scope does not include this path.",
        requiredChecks: [],
        approvalRequired: false,
      };
    return {
      allowed: true,
      status: "not-covered",
      action,
      target,
      matchedRules: [],
      reason:
        "No matching policy rule; review repository defaults before proceeding.",
      requiredChecks: [],
      approvalRequired: false,
    };
  }
  const bestSpecificity = specificity(candidates[0]!.scope);
  const applicable = candidates.filter(
    (rule) => specificity(rule.scope) === bestSpecificity,
  );
  const hasAllow = applicable.some((rule) => rule.effect === "allow");
  const hasDeny = applicable.some((rule) => rule.effect === "deny");
  const requiredChecks = policy.rules
    .filter((rule) => rule.kind === "check" && rule.effect === "require")
    .flatMap((rule) => (typeof rule.value === "string" ? [rule.value] : []));
  const approvalRequired = policy.rules.some(
    (rule) =>
      rule.kind === "approval" &&
      rule.effect === "require" &&
      matches(rule, target),
  );
  if (hasAllow && hasDeny)
    return {
      allowed: false,
      status: "conflict",
      action,
      target,
      matchedRules: applicable,
      reason: "Matching allow and deny rules conflict at equal specificity.",
      requiredChecks,
      approvalRequired,
    };
  if (hasDeny)
    return {
      allowed: false,
      status: "denied",
      action,
      target,
      matchedRules: applicable,
      reason: applicable.find((rule) => rule.effect === "deny")!.message,
      requiredChecks,
      approvalRequired,
    };
  if (
    exclusiveAllows.length > 0 &&
    !exclusiveAllows.some((rule) => matches(rule, target))
  )
    return {
      allowed: false,
      status: "denied",
      action,
      target,
      matchedRules: [...applicable, ...exclusiveAllows],
      reason: "Exclusive allow scope does not include this path.",
      requiredChecks,
      approvalRequired,
    };
  if (approvalRequired)
    return {
      allowed: false,
      status: "approval-required",
      action,
      target,
      matchedRules: applicable,
      reason: "A matching policy rule requires human approval.",
      requiredChecks,
      approvalRequired,
    };
  return {
    allowed: true,
    status: "allowed",
    action,
    target,
    matchedRules: applicable,
    reason: applicable[0]!.message,
    requiredChecks,
    approvalRequired,
  };
}

export function evaluateTask(
  policy: Policy,
  request: TaskRequest,
): CheckReport {
  const decisions: Decision[] = [];
  for (const path of request.paths ?? [])
    decisions.push(evaluate(policy, "path", path));
  for (const command of request.commands ?? [])
    decisions.push(evaluate(policy, "command", command));
  for (const domain of request.networkDomains ?? [])
    decisions.push(evaluate(policy, "network", domain));
  for (const server of request.mcpServers ?? [])
    decisions.push(evaluate(policy, "mcp", server));
  if (request.aiAssisted === true)
    decisions.push(evaluate(policy, "disclosure", "ai-assisted-change"));
  const conflicts: Conflict[] = detectConflicts(policy.rules);
  const valid =
    conflicts.length === 0 &&
    decisions.every(
      (decision) => decision.allowed || decision.status === "not-covered",
    );
  return {
    root: "",
    decisions,
    conflicts,
    valid,
    exitCode: conflicts.length > 0 ? 3 : valid ? 0 : 2,
  };
}
