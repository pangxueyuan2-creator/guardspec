# Changelog

All notable changes to GuardSpec are documented here.

## Unreleased

### Fixed

- Path and command extraction now matches natural Chinese instruction phrasing (no forced Latin-style spaces) while still requiring explicit high-confidence patterns.

### Added

- Tests covering Chinese path allow/deny, required checks, and disclosure patterns.

## v0.1.0 — 2026-08-13

The first public release introduces a local TypeScript CLI and library that discovers selected agent/repository instruction sources, preserves line-level provenance for conservative explicit-rule extraction, compiles reviewable `.agent-policy.yml` files, detects equal-scope conflicts, and deterministically preflights paths, commands, network domains, MCP servers and AI disclosure declarations.

It also includes derived adapters for AGENTS/Codex, Claude Code, Copilot, Cursor, Gemini and OpenCode; a read-only stdio MCP query server; a Node 20 GitHub Action with annotations/SARIF; a real temporary-worktree demo; a strict policy schema; research evidence; tests and CI security automation.

This release intentionally does not execute repository commands, fetch remote instructions, invoke an LLM, manage credentials, collect telemetry, modify a repository outside explicit write commands, enforce external Agent behavior, or replace CI/branch-protection controls.
