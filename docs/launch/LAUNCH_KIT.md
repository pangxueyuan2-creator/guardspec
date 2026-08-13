# GuardSpec Launch Kit

**Status:** Prepared, not automatically published.
**Version:** `v0.1.0`
**Primary audience:** Maintainers and platform engineers who use multiple Coding Agents and need repository-local, inspectable rules before changes begin.

This kit converts the real GuardSpec demo into venue-specific technical material. It does not authorize mass posting, coordinated engagement, copied comments, fabricated adoption claims, or claims that GuardSpec replaces sandboxing, branch protection, code review, CI permissions, or post-change verification.

## The product claim to keep consistent

> GuardSpec compiles explicit repository instructions into a reviewed `.agent-policy.yml` and answers deterministic preflight questions about a proposed path, command, network request, MCP server, or AI-assistance disclosure. It is local-first and does not run repository commands, contact a model, or mutate agent permissions.

The full demo backs a narrower, testable story: from an actual `AGENTS.md`, GuardSpec permits an intended `src/auth/session.js` fix and `node --test`, while denying both `.github/workflows/ci.yml` and `.agent-policy.yml` self-modification. The demo then runs two real Node tests and prints the actual diff. Use the demo result; do not substitute imaginary customer anecdotes.

## Channel qualification matrix

| Channel                              | Appropriate asset                                                         | Preconditions                                                                                       | Do not do                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| GitHub repository and Release        | README, Quick Start, demo, social preview, release notes                  | CI and CodeQL green; docs links resolve; Demo rerun                                                 | Claim marketplace adoption, compatibility or enforcement beyond tested behavior         |
| GitHub Discussion                    | Welcome / feedback discussion                                             | Discussions enabled; maintainer can respond during the first week                                   | Create a faux Q&A or solicit Stars as the primary request                               |
| Hacker News Show HN                  | The runnable demo and source repository                                   | The maintainer personally made the project, can respond, and the demo is barrier-free enough to try | Post a landing page, version-only update, ask for votes/comments, or repeat submissions |
| Reddit r/opensource                  | A problem-first post tagged Promotional where required                    | Re-read visible rules on the day; tailor to the community; state affiliation                        | Cross-post the same copy, use sensational titles, drive-by post, or manufacture Karma   |
| DEV Community / Hashnode             | Independent technical article with real commands, limitations and sources | Cite sources and disclose AI assistance where required                                              | Publish a thin announcement, plagiarize text, or hide project affiliation               |
| Maintainer-to-maintainer integration | A small issue/PR proposal against a relevant project                      | Read that project’s contribution and issue rules; identify a specific tested handoff                | Mass-open generic issues or request promotion in exchange for anything                  |

Hacker News requires a non-trivial project the maker can discuss and that readers can try; it explicitly prohibits asking friends for votes or comments.[1] The public r/opensource rule set prohibits spam, excessive self-promotion, drive-by posting and sensationalized titles, while requiring correct flairs.[2] DEV’s Code of Conduct requires sources to be cited and AI assistance to be disclosed according to its guidelines.[3]

## Show HN draft

**Title**

```text
Show HN: GuardSpec – compile repo instructions into deterministic agent preflight rules
```

**Submission text**

```text
I built GuardSpec after seeing repository guidance split across AGENTS.md, CLAUDE.md, Copilot instructions, Cursor rules, CODEOWNERS and security notes. They give an agent useful context, but a maintainer cannot consistently ask a simple preflight question such as: “may this task modify this path and run this command?”

GuardSpec is a local TypeScript CLI that discovers supported instruction sources, preserves line-level provenance, compiles explicit rules into a reviewed .agent-policy.yml, and returns deterministic decisions for paths, commands, network domains, MCP server names, and AI-assistance disclosure. It also ships a read-only MCP server and a GitHub Action.

The included demo creates a temporary repository from a real AGENTS.md. It allows an intended auth fix and node --test, blocks a CI workflow change and policy self-modification, runs two actual Node tests, and prints the diff:

  git clone https://github.com/pangxueyuan2-creator/guardspec.git
  cd guardspec
  corepack enable && pnpm install --frozen-lockfile && pnpm build
  bash demo/run-demo.sh

GuardSpec does not execute discovered repository commands, fetch remote instructions, call a model, change an agent’s permissions, or claim to sandbox the agent. It only makes supported explicit rules inspectable and queryable before work begins.

I would value technical criticism on two questions: which instruction formats should be prioritized next, and where should a deterministic preflight boundary end so that it remains honest and useful?
```

**Maintainer response plan**

Respond with the exact command that reproduces a question, acknowledge unsupported natural-language rules, and treat bug reports or counterexamples as more valuable than general praise. If a comment asks whether GuardSpec replaces a sandbox or CI protection, answer no and point to the boundary statement in the README.

## Reddit r/opensource draft

**Suggested title**

```text
[Promotional] I made a local tool that turns explicit AGENTS.md and agent-rule files into reviewable preflight checks
```

**Post body**

```text
I maintain GuardSpec, a local-first TypeScript CLI for a narrow problem: repositories often have guidance in AGENTS.md, CLAUDE.md, Copilot/Cursor instructions, CODEOWNERS, and security notes, but that guidance is not one deterministic preflight surface across Coding Agents.

GuardSpec discovers supported rule sources, preserves provenance, compiles explicit rules into a reviewed .agent-policy.yml, and can answer whether a proposed path, command, network request, MCP server, or AI-disclosure requirement is permitted. The included real demo allows an auth fix but blocks a CI workflow and policy self-modification, then runs node --test on a temporary repository.

Repository and runnable demo: https://github.com/pangxueyuan2-creator/guardspec

It is intentionally not an LLM reviewer, an OS sandbox, a replacement for branch protection, or a claim that every sentence in Markdown can be enforced. It never calls a model or executes commands discovered from the repository.

I am looking for maintainers who can identify an instruction format or conflict case that needs deterministic handling. Please do not share private policies, tokens, source code, or confidential repository data.
```

Use only after checking that current r/opensource rules, flair choices, and local community culture still permit it. Do not repost to additional subreddits until feedback from this tailored post changes the implementation or the technical question.

## DEV / Hashnode article outline

**Working title:** `Tests passed. What repository rule said the agent could make that change?`

The article should not start with GuardSpec. Start with the concrete maintainer problem: agent guidance has become fragmented, and non-uniform Markdown instructions are difficult to audit as a pre-execution decision. Then show the smallest runnable example—`AGENTS.md` declaring `path:deny:.github/workflows/**`—and execute `scan`, `init`, and `check`. Include the `ALLOWED` and `DENIED` examples from `demo/run-demo.sh` exactly as they print.

The central technical section should explain the conversion boundary: GuardSpec compiles **supported explicit rules**, records source and line provenance, and raises equal-scope conflicts rather than silently picking allow or deny. A follow-up section should compare this with a post-change evidence gate, such as PatchWitness, without claiming either tool is required or interchangeable. End with documented limitations: no model, no remote instruction fetch, no discovered command execution, no automatic policy rewrite, no OS sandbox.

Use the following disclosure in the article footer when relevant:

```text
Disclosure: I maintain GuardSpec. The examples were run from the public repository. AI assistance was used in preparing this article where applicable; all commands, product boundaries, and factual claims were reviewed against the source repository and cited documentation.
```

## Integration and contribution invitations

| Candidate                  | Specific ask                                                                  | First artifact                                                                     | Success criterion                                                       |
| -------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Cline or Claude Code users | Test a generated policy adapter against a public or sanitized repository      | A reproducible issue with source format, expected extracted rule and actual result | A new fixture and deterministic test, or a documented unsupported case  |
| GitHub Actions users       | Run the Action on a non-sensitive PR with a reviewed policy                   | Sanitized Action log and policy shape                                              | A clear least-privilege setup note or a bug fix                         |
| MCP host users             | Call the read-only `preflight_task` tool against a local sample repository    | Minimal configuration and tool result                                              | A documented compatibility example that does not expose repository data |
| Security reviewers         | Challenge path traversal, symlink, conflict, or policy self-mutation handling | Responsible disclosure or a public minimized reproduction                          | A tested fix and security-model documentation update                    |
| Policy authors             | Propose an explicit rule syntax from a real instruction file                  | One source excerpt and expected provenance                                         | Conservative parser support; no claim to understand ambiguous prose     |

The first request is for **reproducible evidence**, not testimonials. Each invitation must say that users should redact or avoid private policies, credentials, proprietary source, and sensitive logs.

## Measurement and stop conditions

Record one launch experiment at a time in the growth report. Measure repository views and clones as GitHub aggregates, demo reproduction feedback, issues, discussion quality, release downloads and permissioned integrations separately. Do not treat a Star, clone, or reaction as an installation or endorsement.

Stop or revise the message if the technical thread shows repeated confusion about whether GuardSpec is a sandbox, a general LLM guardrail, or a product that executes tests. In that case, improve the example and boundary language before expanding to another venue.

## References

[1]: https://news.ycombinator.com/showhn.html "Hacker News Show HN Guidelines"
[2]: https://www.reddit.com/r/opensource/ "r/opensource community rules"
[3]: https://dev.to/code-of-conduct "DEV Community Code of Conduct"
