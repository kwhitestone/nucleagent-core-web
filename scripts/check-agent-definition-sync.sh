#!/usr/bin/env bash
# Byte-compares Core Web's agent-definition editor with IM Web's (the source of truth).
# Usage: scripts/check-agent-definition-sync.sh <path-to-nucleagent-im-web checkout>
# Exit 0 = identical except HOST_SPECIFIC files; 1 = drift (listed). Not wired into CI.
set -euo pipefail
im="${1:?usage: $0 <nucleagent-im-web dir>}/src/agent-definition"
core="$(cd "$(dirname "$0")/.." && pwd)/src/addons/administration/agents/definition"
# Host-specific files may differ; currently none do (transport.ts is identical).
HOST_SPECIFIC=" "
drift=0
for f in $( (cd "$im" && find . -type f; cd "$core" && find . -type f) | sort -u); do
  [[ "$HOST_SPECIFIC" == *" ${f#./} "* ]] && continue
  if ! cmp -s "$im/$f" "$core/$f"; then echo "DIFF ${f#./}"; drift=1; fi
done
[ "$drift" = 0 ] && echo "agent-definition in sync"
exit "$drift"
