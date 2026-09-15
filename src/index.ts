export * from "./core/types.js";
export { scanRepository } from "./core/repository-scan.js";
export { detectConflicts, calculateRisk } from "./core/scanner.js";
export { evaluate, evaluateTask } from "./core/evaluator.js";
export {
  loadPolicy,
  parsePolicy,
  stringifyPolicy,
  writePolicy,
} from "./core/policy.js";
export { auditInstructions } from "./core/instruction-hygiene.js";
export type {
  InstructionAuditReport,
  InstructionFinding,
  InstructionFindingCode,
} from "./core/instruction-hygiene.js";
export { inventoryInstructions } from "./core/instruction-inventory.js";
export type { InstructionInventoryReport } from "./core/instruction-inventory.js";
export { explainInstructions } from "./core/instruction-applicability.js";
export type {
  ApplicableInstruction,
  IndeterminateInstruction,
  InstructionApplicabilityReport,
} from "./core/instruction-applicability.js";
export { assessRuleRelayCompatibility } from "./core/rule-relay-compatibility.js";
export type {
  RuleRelayAdapter,
  RuleRelayCompatibilityBlocker,
  RuleRelayCompatibilityBlockerCode,
  RuleRelayCompatibilityReport,
  RuleRelayCompatibilityWarning,
  RuleRelayExpandedSource,
  RuleRelayExpectedSource,
  RuleRelayMatchedSource,
  RuleRelayTargetCompatibility,
  RuleRelayTargetExpandedSource,
  RuleRelayTargetMatchedSource,
} from "./core/rule-relay-compatibility.js";
export {
  adapterTarget,
  renderAdapter,
  writeAdapter,
} from "./adapters/generate.js";
