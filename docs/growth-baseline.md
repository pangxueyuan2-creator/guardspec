# Growth Baseline

**Snapshot date:** 2026-08-13 UTC
**Purpose:** Preserve a truthful starting point for GuardSpec discovery, trials, and documentation experiments. This record is not a forecast and does not turn traffic into an adoption claim.

## GitHub snapshot

| Metric                  |    Value | Collection window / source                        |
| ----------------------- | -------: | ------------------------------------------------- |
| Stars                   |        0 | GitHub repository API snapshot                    |
| Forks                   |        0 | GitHub repository API snapshot                    |
| Watchers                |        0 | GitHub repository API snapshot                    |
| Open issues             |        8 | GitHub repository API snapshot                    |
| Contributors            |        1 | GitHub contributors endpoint                      |
| Releases                |        1 | GitHub releases endpoint                          |
| Latest release          | `v0.1.0` | Published 2026-08-13                              |
| Release asset downloads |        0 | Sum from the releases endpoint at collection time |
| Views                   |        0 | GitHub Traffic, preceding 14 days                 |
| Unique visitors         |        0 | GitHub Traffic, preceding 14 days                 |
| Clones                  |        0 | GitHub Traffic, preceding 14 days                 |
| Unique cloners          |        0 | GitHub Traffic, preceding 14 days                 |

> **Interpretation boundary:** GuardSpec was released on the snapshot day. Zero traffic at this point is a release-stage observation, not evidence of a lack of demand. GitHub Traffic is aggregate and short-lived; it cannot identify users, successful policy compilation, or production adoption.

## Product and discovery evidence

The public README contains an actual `bash demo/run-demo.sh` walkthrough. On the snapshot date, the demo was rerun from a clean shallow clone after a locked dependency install and production build. It compiled a fixture `AGENTS.md`, allowed an intended authentication path and `node --test`, denied a CI workflow path and `.agent-policy.yml` self-modification, ran two real Node tests, and printed the resulting Git diff.

The repository currently provides a CLI, adapter generator, read-only MCP server, GitHub Action, schema, logo, social preview, CI, CodeQL, Dependabot, security model, and release artifact. These are product facts, not a claim that every natural-language instruction can be enforced. GuardSpec only compiles explicit, supported rules and leaves model behavior, command execution, sandboxing, and branch protection outside its boundary.

## Repeatable measurement plan

| Checkpoint | Recollect                                                                                     | Decision use                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Day 7      | Repository metadata, 14-day Traffic, release downloads, issues, Demo reproduction feedback    | Find where the first successful or blocked trial starts, without equating views to adoption.                        |
| Day 14     | Same fields plus direct, public technical mentions and integration questions                  | Improve the exact Quick Start or adapter documentation that users are asking about.                                 |
| Day 30     | Same fields plus PRs, resolved issues, consented adoption notes and documentation conversions | Decide whether the evidence supports a focused integration, a compatibility release, or a narrower target audience. |

Use GitHub repository, releases, contributors, and Traffic endpoints as the primary sources. Log an external mention only with a direct URL and a clear relevance note. No fake engagement, coordinated voting, paid follower acquisition, fake identities, or bulk unsolicited outreach is permitted.
