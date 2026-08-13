# GuardSpec security model

GuardSpec is a local preflight compiler. Its principal security property is **bounded interpretation**: it reads a constrained set of local repository files, converts only explicit high-confidence instructions into policy candidates, and answers deterministic queries without running user-project commands or contacting external systems.

## Assets and trust boundaries

| Asset                        | Trust level                    | GuardSpec treatment                                                                                      |
| ---------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Repository instruction files | Untrusted input                | Reads as data; extracts a narrow rule grammar; never executes text or follows embedded URLs.             |
| `.agent-policy.yml`          | Human-reviewed configuration   | Strictly parses schema; policy changes are protected by default when created with `init`.                |
| Repository source tree       | Untrusted input                | Bounded walk, file count/size limit, ignored dependency/build directories, no symlink traversal.         |
| CLI input                    | Caller-controlled              | Rejects absolute, Windows-drive, UNC and traversal paths before filesystem resolution.                   |
| MCP clients                  | Untrusted callers              | Server exposes read-only information tools; it has no write, command, network or credential API.         |
| GitHub Action workspace      | Untrusted pull-request content | Action loads checked-out policy and evaluates changed filenames; it does not execute repository scripts. |

## Controls

GuardSpec does not use shell interpolation. It does not execute a test, lint, build, git, package-manager or model command discovered from a policy or instruction source. Its CLI only writes when an operator calls `init`, `scan --write` or `adapters generate`. All other normal commands are read-only.

The local walker ignores `.git`, `node_modules`, build/cache directories and symbolic links. It enforces a maximum individual file size of 512 KB and a maximum discovery count of 2,000 files. `safeResolve` requires non-empty repository-relative paths, rejects `..`, absolute and Windows drive/UNC forms, and checks that a resolved target remains inside the canonical repository root.

The policy parser uses a strict schema with a small fixed vocabulary. Unknown top-level fields and duplicate rule identifiers are rejected. A natural-language extraction is never presented as complete enforcement; unclassified prose remains visible only as a discovered source. Equal-scope allow/deny or incompatible required-value conditions are reported as conflicts, not silently ordered away.

The stdio MCP server follows MCP guidance to reserve stdout for protocol messages. It returns text-formatted JSON only from query tools and logs no task data. It has no writable resource, filesystem mutation tool, remote connection, token input, or command tool.

## Explicit non-guarantees

GuardSpec cannot make another agent obey a policy. It cannot enforce runtime sandboxing, GitHub branch protection, OS permissions, secret access, review approval, vendor-specific hosted Agent behavior, or a remote MCP server’s behavior. It does not claim that a markdown instruction file is sufficient security control. Use it alongside code review, CI, least-privilege tokens, protected branches, and runtime isolation.

## Disclosure process

Do not open public issues for suspected security vulnerabilities, possible repository data exposure or ways to bypass a GuardSpec control. Follow [SECURITY.md](../SECURITY.md) instead. Reports should include a minimal reproducer without secrets or private repository content.
