# Migrating from RuleRelay to GuardSpec

RuleRelay and GuardSpec overlap on instruction discovery, applicability, and hygiene, but they are not assumed to be identical. Migrate in stages so a difference becomes visible before it changes CI behavior.

## 1. Prove discovery, validation, and target parity

Run the compatibility report on the repository you want to migrate. Add representative targets for the paths your agents actually edit.

```bash
guardspec instructions compatibility rule-relay \
  --root /path/to/repo \
  --target src/server.ts \
  --json
```

A report is migration-ready only when `ready` is `true`. GuardSpec fails closed when it cannot reproduce a legacy source, validation finding, or target-level applicability decision. GuardSpec-only sources are reported separately as expanded coverage rather than being mislabeled as RuleRelay parity.

Do not paper over a blocker by deleting a target or weakening an instruction. Investigate whether the difference is an intended GuardSpec semantic, a repository problem, or a real compatibility gap.

## 2. Preserve the RuleRelay check contract during cutover

Before changing CI semantics, replace `rule-relay check` with the compatibility bridge:

```bash
guardspec instructions check --compat rule-relay --root /path/to/repo --json
```

For repositories that used RuleRelay `--strict`, keep the same warning behavior:

```bash
guardspec instructions check \
  --compat rule-relay \
  --strict \
  --root /path/to/repo \
  --json
```

The compatibility bridge is read-only. It does not execute package scripts, repository instructions, models, tools, or network requests.

## 3. Adopt ordinary GuardSpec hygiene deliberately

After the compatibility report is ready and the bridge is stable in CI, compare it with ordinary GuardSpec hygiene:

```bash
guardspec instructions check --root /path/to/repo --json
```

If output differs, review the difference explicitly. GuardSpec intentionally has its own semantics; the migration bridge exists so those differences are not silently introduced during the first cutover.

## 4. Replace discovery and explain workflows

RuleRelay workflows map to these GuardSpec commands:

```text
rule-relay scan                 -> guardspec instructions scan --json
rule-relay check                -> guardspec instructions check --compat rule-relay --json
rule-relay check --strict       -> guardspec instructions check --compat rule-relay --strict --json
rule-relay explain <target>     -> guardspec instructions explain <target> --json
```

Once the compatibility phase is complete, CI may intentionally move from the compatibility check to ordinary `guardspec instructions check`.

## Executable migration proof in this repository

`demo/rule-relay-migration-repo` is a committed RuleRelay-style repository fixture with root agent guidance, path-specific Copilot instructions, a package script, and a representative source target. `tests/rule-relay-migration-demo.test.ts` drives the public CLI against that fixture and asserts that:

- the compatibility report is ready;
- legacy source discovery and target applicability are reproduced;
- the RuleRelay-compatible check is valid;
- ordinary GuardSpec hygiene also passes for the same repository.

That fixture is intentionally small enough to audit but complete enough to guard the documented migration sequence from becoming prose-only guidance.
