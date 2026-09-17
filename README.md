# GuardSpec

Turns the rules people write in AGENTS.md, CLAUDE.md, Cursor rules, and similar files into something you can actually check before an agent runs.

Most of those files are just prompt guidance. GuardSpec extracts the explicit path / command / network / MCP rules it can find, writes a reviewable policy, and lets you ask whether a given path or command is allowed.

It does not run models, execute commands, or act as a sandbox. It is only a local preflight tool.

## Install

Node.js 20+ and pnpm are required.

```bash
git clone https://github.com/pangxueyuan2-creator/guardspec.git
cd guardspec
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm link --global

guardspec doctor
```

## Quick start

```bash
guardspec scan --root /path/to/repo
guardspec init --root /path/to/repo          # writes .agent-policy.yml
guardspec check --root /path/to/repo \
  --path src/auth/session.ts \
  --command "pnpm test"
guardspec instructions check --root /path/to/repo
guardspec instructions explain src/auth/session.ts --root /path/to/repo
```

Exit codes:

- `0` allowed / hygiene check passed
- `2` denied
- `3` conflict
- `4` invalid input / hygiene errors (or warnings with `--strict`)

## What it does

- Finds common instruction files and extracts explicit allow/deny rules
- Surfaces conflicts instead of silently picking one side
- Writes a human-readable `.agent-policy.yml` that includes source file + line provenance
- Checks instruction hygiene for invalid Copilot `applyTo`, exact duplicates, broken local links, and missing package scripts
- Explains which instruction sources can be proven applicable to one target path without inventing cross-agent precedence
- Can expose the same policy via CLI, read-only MCP, or GitHub Action

`guardspec instructions check` is read-only: it never executes commands from instruction files, calls a model, or uses the network. It reports errors for invalid path-specific Copilot metadata, broken or repository-escaping local Markdown links, and explicit `npm|pnpm|yarn|bun run <script>` references missing from the nearest `package.json`. Exact duplicate instruction content is a warning; add `--strict` to make warnings fail the check. Use `--json` for a deterministic structured report.

`guardspec instructions explain <target-path>` is also read-only. It reports source-level applicability for directory-scoped instruction files and Copilot repository / `applyTo` scopes. Conditional rule families that GuardSpec cannot safely interpret yet are reported as **indeterminate** instead of being silently treated as applicable or inapplicable. This command does not assign a universal precedence order across different agents.

## Migrating from RuleRelay

GuardSpec contains an explicit, read-only RuleRelay migration bridge. Prove discovery, validation, and representative target applicability before changing CI:

```bash
guardspec instructions compatibility rule-relay \
  --root /path/to/repo \
  --target src/server.ts \
  --json
```

During cutover, preserve RuleRelay validation behavior with:

```bash
guardspec instructions check --compat rule-relay --root /path/to/repo --json
```

A committed migration fixture is exercised by the test suite so this path is not documentation-only. See [docs/migrations/rule-relay.md](docs/migrations/rule-relay.md) for the staged migration and the deliberate transition to ordinary GuardSpec hygiene.

## How it relates to the other two tools

Different jobs, optional to use together:

- [TaskToPR](https://github.com/pangxueyuan2-creator/tasktopr) — turn one Issue into an isolated branch + real tests + optional PR, with evidence
- [PatchWitness](https://github.com/pangxueyuan2-creator/patchwitness) — after a change exists, produce a Change Passport for scope, protected paths, and executed checks

GuardSpec only answers the preflight question. It does not depend on the other two.

## Demo

```bash
pnpm build
bash demo/run-demo.sh
```

## Commands

```text
guardspec scan                                      discover rules and conflicts
guardspec init                                      write a starter policy
guardspec check                                     preflight a path/command/network/MCP
guardspec instructions check                        validate instruction-file hygiene
guardspec instructions check --compat rule-relay    preserve RuleRelay check semantics during migration
guardspec instructions compatibility rule-relay     prove RuleRelay migration readiness
guardspec instructions explain                      show source applicability for one target
guardspec explain                                   show why a compiled policy rule fired
guardspec doctor
guardspec mcp
```

## Status

Early public version. Single maintainer.  
See [ARCHITECTURE.md](ARCHITECTURE.md) and [docs/security-model.md](docs/security-model.md) for the current boundaries and limitations.

MIT.
