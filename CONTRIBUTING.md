# Contributing to GuardSpec

GuardSpec values narrow, inspectable behavior over feature breadth. Before proposing a feature, explain the concrete repository-policy problem, which source format or deterministic rule it affects, why existing functionality is insufficient, and what GuardSpec should intentionally not do.

## Development setup

Use Node 20 or newer with Corepack and pnpm.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm action:build
```

Every behavioral change must include tests. Extraction changes need a source fixture plus a provenance assertion; evaluator changes need an explicit precedence/conflict test; path handling changes need adversarial traversal/Windows/symlink coverage; Action changes need an output or failure-mode test. Do not add a model key, telemetry, automatic command execution, remote instruction fetch, or hidden policy mutation without first opening a design discussion.

## Policy changes

The public schema is a compatibility contract. Preserve stable rule IDs where possible, document migrations, and ensure generated adapter files identify `.agent-policy.yml` as the source of truth. A new natural-language extraction pattern must be conservative and should never claim more enforcement than it can prove.

## Pull requests

Describe the user problem, scope, security effect, tests run and documentation updates. Avoid mixing refactors with behavior changes. If a PR edits workflows, policy parsing, filesystem safety, Action permissions or MCP tools, clearly call this out for reviewers.
