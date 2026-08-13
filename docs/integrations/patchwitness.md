# Optional PatchWitness Handoff

GuardSpec and [PatchWitness](https://github.com/pangxueyuan2-creator/patchwitness) solve adjacent but different repository-governance questions. This guide describes an optional handoff, not a dependency or endorsement requirement.

> **GuardSpec asks before work begins:** “Do the reviewed, explicit repository rules permit this proposed task?”
> **PatchWitness asks after a change exists:** “What evidence shows the actual change stayed in scope, preserved protected controls, and ran the recorded checks?”

## Boundaries remain separate

| Tool         | Deterministic input                                                                      | Result                                                                            | Deliberate non-goal                                                                       |
| ------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| GuardSpec    | Supported explicit rules in repository instruction sources plus proposed task attributes | Allow, deny, conflict, required checks and provenance                             | Executing repository commands, sandboxing an agent or proving an applied patch is correct |
| PatchWitness | Git change, policy/contract from a trusted base and repository-owned checks              | Change Passport with scope, control-plane, check-execution and integrity evidence | Compiling a broad collection of agent instruction files into a policy before work begins  |

Neither tool replaces human review, branch protection, OS-level sandboxing, dependency scanning, CodeQL, secret scanning or semantic testing.

## Minimal local workflow

First, use GuardSpec to discover and review the repository’s explicit instruction rules. Review the generated policy before committing it; a generated policy is not automatically authoritative.

```bash
# Run inside the repository you want to govern.
guardspec scan --root .
guardspec init --root .
git add .agent-policy.yml
git commit -m "chore: review repository agent policy"
```

Before delegating one specific task, run a preflight question. The path, command and disclosure value below are examples only; replace them with the task’s actual attributes.

```bash
guardspec check --root . \
  --path src/auth/session.ts \
  --command "pnpm test" \
  --ai-assisted
```

After the agent or developer has made a real change, use PatchWitness with a contract reviewed from the trusted base revision. The base revision, policy path and command must reflect the repository’s real workflow.

```bash
patchwitness gate \
  --base origin/main \
  --policy-ref origin/main \
  --contract .patchwitness.toml \
  --clean-room \
  --output .patchwitness/evidence/change.json

patchwitness verify .patchwitness/evidence/change.json
```

The two tools produce distinct artifacts: GuardSpec produces a reviewed `.agent-policy.yml` with instruction provenance; PatchWitness produces a Change Passport for a specific observed change. Keep both artifacts under review according to the repository’s own security and retention rules.

## Failure interpretation

If GuardSpec denies a proposed operation, stop and ask a maintainer to clarify or change the reviewed policy. Do not bypass the policy by editing generated adapters or instruction files inside the same unreviewed task.

If PatchWitness fails, treat the Change Passport as evidence of a policy, scope, protected-path or check-execution problem. A passing PatchWitness result is not proof of semantic correctness, and a denied GuardSpec result is not proof that a change would be harmful. Both tools make narrow claims that must remain visible to reviewers.

## Safe trial conditions

Use a public, synthetic or fully sanitized repository for first trials. Do not paste private repository instructions, credentials, proprietary source code, sensitive logs or unredacted evidence artifacts into public issues or community threads. Review detected command names before choosing to execute any repository test command.
