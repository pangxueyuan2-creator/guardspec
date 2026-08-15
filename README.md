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
```

Exit codes:

- `0` allowed
- `2` denied
- `3` conflict

`check --json` also emits a machine-readable contract (`schema_version`, `policy_digest`, `decision`, `matched_rules`, `protected_paths`) so downstream tools can fail closed by reading the file instead of importing GuardSpec.

## What it does

- Finds common instruction files and extracts explicit allow/deny rules
- Surfaces conflicts instead of silently picking one side
- Writes a human-readable `.agent-policy.yml` that includes source file + line provenance
- Can expose the same policy via CLI, read-only MCP, or GitHub Action

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
guardspec scan          discover rules and conflicts
guardspec init          write a starter policy
guardspec check         preflight a path/command/network/MCP
guardspec explain       show why a rule fired
guardspec doctor
guardspec mcp
```

## Status

Early public version. Single maintainer.  
See [ARCHITECTURE.md](ARCHITECTURE.md) and [docs/security-model.md](docs/security-model.md) for the current boundaries and limitations.

MIT.
