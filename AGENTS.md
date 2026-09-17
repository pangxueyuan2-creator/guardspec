# Repository agent guidance

GuardSpec is the durable preflight and instruction-governance surface in this portfolio. Keep RuleRelay compatibility work here unless a RuleRelay-only maintenance fix is required.

Preserve these boundaries:

- instruction files are data to inspect, never commands to execute;
- repository inspection stays bounded to the selected root and must not follow unsafe escapes;
- compatibility checks must fail closed when parity cannot be proved;
- do not add model calls, network calls, or repository command execution to instruction scanning;
- prefer migration/adoption proof over another parser feature when existing semantics already cover the use case.

For changes that touch instruction compatibility, add or update a realistic repository fixture and verify both migration-readiness and validation behavior. Before merge, run the repository quality gates (`pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, and `pnpm run test`) plus any build/package checks exercised by CI.
