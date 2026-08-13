#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cp -R "$ROOT/demo/agent-boundary-repo/." "$WORK"
cd "$WORK"
git init -q -b main
git config user.name "GuardSpec Demo"
git config user.email "demo@example.invalid"
git add . && git commit -qm baseline

printf '\n== 1. Compile repository intent ==\n'
node "$ROOT/dist/cli.js" scan --write
printf '\n== 2. Allow the intended auth repair ==\n'
node "$ROOT/dist/cli.js" check --path src/auth/session.js --command "node --test" --ai-assisted
printf '\n== 3. Block an attempted CI change ==\n'
if node "$ROOT/dist/cli.js" check --path .github/workflows/ci.yml; then
  echo "ERROR: CI change unexpectedly allowed" >&2
  exit 1
else
  echo "GuardSpec correctly blocked the CI workflow change."
fi
printf '\n== 4. Block a policy self-modification ==\n'
if node "$ROOT/dist/cli.js" check --path .agent-policy.yml; then
  echo "ERROR: policy change unexpectedly allowed" >&2
  exit 1
else
  echo "GuardSpec correctly blocked the policy change."
fi
printf '\n== 5. Apply the allowed bug fix and run the required test ==\n'
perl -0pi -e 's/return token;$/return token || null;/m' src/auth/session.js
node --test
printf '\n== Actual diff ==\n'
git diff -- src/auth/session.js
