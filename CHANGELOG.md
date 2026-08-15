# Changelog

All notable changes to GuardSpec are documented here.

## Unreleased

### Fixed

- Path and command extraction now matches natural Chinese instruction phrasing (no forced Latin-style spaces) while still requiring explicit high-confidence patterns.
- Exclusive-allow (“only / 只能”) now denies unmatched path actions instead of treating them as not-covered, without compiling a global `**` deny that would also block allowed scopes.
- Hidden directories such as `.github/workflows` compile to `/**` directory scopes; `.env`, `Dockerfile`, and other extensionless files stay exact.
- Quoted and sibling paths on one instruction line (`calculator.py` and `test_calculator.py`) become separate rules.
- Windows `node dist/cli.js` now runs `main()` instead of exiting silently (`fileURLToPath` + `resolve` comparison).
- Compiled `agent-boundary/v1` path lists are de-duplicated.
- Extracted required checks that are shell interpreters, unknown executables (`curl`, `wget`, versioned `python3.14`), or inline interpreter payloads (`python -c`, `cmd /c`, `bash -c`) are dropped instead of being forwarded to PatchWitness.
- Sibling path rules on one instruction line now get unique, scope-qualified ids so generated YAML survives `parsePolicy` duplicate-id rejection.
- Boundary provenance entries are de-duplicated by source/rule/reason.
- GitHub Action changed-file discovery now uses `git diff -z` and `--no-renames`, so spaced/Unicode paths stay one entry and a `git mv` of a protected file still lists the source.
- Unquoted path captures strip trailing sentence punctuation (`src/.` → `src/`, `calculator.py.` → `calculator.py`) while quoted paths keep interior punctuation.
- Prose exclusive-allow no longer treats the English word `files` as a scope: `You may only edit files under src/.` compiles to `src/**`, not `files/**`.
- `Required check:` / `必须运行:` labeled commands are extracted when they pass the required-check allowlist.
- Path evaluation folds case on Windows (`picomatch` `nocase`) so `.GITHUB/WORKFLOWS/ci.yml` still matches `.github/workflows/**` and `SRC/ok.ts` still matches exclusive `src/**`. Linux stays case-sensitive.

### Added

- `guardspec --version` (and `--version --json`) reads `package.json` next to the installed `dist/` so source and release artifacts report the same version; `doctor` now includes `version`.
- Tests covering Chinese path allow/deny, required checks, and disclosure patterns.
- `guardspec compile` exports a versioned `agent-boundary/v1` JSON contract for TaskToPR / PatchWitness.
- Spawn regression proving the compiled CLI prints usage and can compile a fixture repo on Windows.

## v0.1.0 — 2026-08-13

The first public release introduces a local TypeScript CLI and library that discovers selected agent/repository instruction sources, preserves line-level provenance for conservative explicit-rule extraction, compiles reviewable `.agent-policy.yml` files, detects equal-scope conflicts, and deterministically preflights paths, commands, network domains, MCP servers and AI disclosure declarations.

It also includes derived adapters for AGENTS/Codex, Claude Code, Copilot, Cursor, Gemini and OpenCode; a read-only stdio MCP query server; a Node 20 GitHub Action with annotations/SARIF; a real temporary-worktree demo; a strict policy schema; research evidence; tests and CI security automation.

This release intentionally does not execute repository commands, fetch remote instructions, invoke an LLM, manage credentials, collect telemetry, modify a repository outside explicit write commands, enforce external Agent behavior, or replace CI/branch-protection controls.
