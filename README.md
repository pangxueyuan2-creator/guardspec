# GuardSpec

Turns the rules people write in AGENTS.md, CLAUDE.md, Cursor rules, and similar files into something you can actually check before an agent runs.

Most of those files are just prompts. GuardSpec compiles them into an explicit policy, then evaluates planned file changes against that policy.

## What it does

- Extracts protected paths, deny patterns, and allow rules from common agent instruction files
- Produces a machine-readable policy with a stable digest
- Checks a proposed change set (or live Git status) and returns allow / deny / conflict
- Works as a CLI, a GitHub Action, and an MCP server

## Install

```bash
npm install -g guardspec
# or
pnpm add -g guardspec
```

## Quick start

```bash
guardspec check --root /path/to/repo \
  --planned-files src/auth/session.js
```

Exit codes:

- `0` allowed
- `2` denied
- `3` conflict

## Policy sources

GuardSpec reads, in priority order:

1. `AGENTS.md`
2. `.github/instructions/*.instructions.md`
3. `CLAUDE.md` / `.cursorrules` / similar known files

It does not invent rules. It only enforces what is already written.

## Relationship to TaskToPR and PatchWitness

- **GuardSpec** decides whether a change is allowed by policy *before* it is applied.
- **TaskToPR** turns an issue into a PR; it can consume GuardSpec decisions but is not a substitute for them.
- **PatchWitness** verifies what actually landed in Git after the fact and issues a Change Passport.

They are complementary. GuardSpec is the preflight gate.

## Development

```bash
pnpm install
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm action:build
```

## License

MIT
