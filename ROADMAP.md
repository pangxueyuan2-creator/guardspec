# Roadmap

GuardSpec is the long-lived policy/preflight product. The roadmap favors adoption proof and consolidation over adding parallel micro-tools.

## Now: complete RuleRelay consolidation

- Keep the RuleRelay compatibility report and `--compat rule-relay` validation bridge deterministic and read-only.
- Maintain a committed migration fixture that exercises discovery, target applicability, and validation through the public CLI surface.
- Document a staged migration: prove readiness first, run the compatibility validation bridge, then move to ordinary GuardSpec hygiene once intentional semantic differences are accepted.
- Treat a compatibility blocker as evidence to investigate, not as permission to silently widen GuardSpec semantics.

## Next: prove adoption

- Exercise the migration path against real repositories that already use RuleRelay-style instruction files.
- Record reproducible integration evidence and friction before adding new compatibility semantics.
- Improve TaskToPR / PatchWitness integration documentation only where it supports an actual end-to-end workflow.

## Later: deepen the durable product

- Add policy or instruction semantics only when backed by a concrete consumer and a bounded security model.
- Keep MCP and GitHub Action surfaces aligned with the same deterministic core where their runtime boundaries permit it.
- Prefer release quality, packaging, Windows coverage, and security maintenance over repository-count growth.

## Explicitly not on this roadmap

- A new repository that duplicates RuleRelay or GuardSpec.
- Network/model/tool execution during repository instruction scanning.
- A parser-feature treadmill without an adoption or migration use case.
