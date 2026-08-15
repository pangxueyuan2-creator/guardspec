# GuardSpec

**Compile repository intent into enforceable agent boundaries.**

Coding agents read files like `AGENTS.md`, `CLAUDE.md`, Copilot instructions, and Cursor rules. Those files are usually just prompt guidance. GuardSpec turns the *explicit* rules it can extract into a reviewable policy, then lets you check whether a path, command, network domain, or MCP server is allowed *before* an agent runs.

It does not run models, execute commands, or act as a sandbox. It is a local preflight tool.

## Quick start

```bash
git clone https://github.com/pangxueyuan2-creator/guardspec.git
cd guardspec
corepack enable && pnpm install --frozen-lockfile && pnpm build && pnpm link --global

guardspec scan --root /path/to/repo
guardspec init --root /path/to/repo   # writes .agent-policy.yml
guardspec check --root /path/to/repo --path src/auth/session.ts --command "pnpm test"
```

Exit codes: `0` allowed, `2` denied, `3` conflict.

## What it does

- Discovers common instruction files and extracts explicit path/command/network/MCP rules
- Detects allow/deny conflicts instead of silently picking one
- Writes a human-readable `.agent-policy.yml` with provenance (source + line)
- Can serve the same policy via CLI, read-only MCP, or GitHub Action

## Demo

```bash
pnpm build
bash demo/run-demo.sh
```

## Commands

```text
guardspec scan          Discover rules and conflicts
guardspec init          Write a starter policy
guardspec check         Preflight a path/command/network/MCP
guardspec explain       Show why a rule fired
guardspec doctor
guardspec mcp
```

## Status

Early public version. Single maintainer. See [ARCHITECTURE.md](ARCHITECTURE.md) and [docs/security-model.md](docs/security-model.md) for boundaries.

MIT License.
