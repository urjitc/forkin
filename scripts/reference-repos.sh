#!/usr/bin/env bash
# Shallow-clones the source our code builds on into repos/ (git-ignored), so agents can read real implementations.
# Re-run to update.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p repos
while read -r name url; do
  if [ -d "repos/$name/.git" ]; then
    git -C "repos/$name" fetch --quiet --depth 1 origin HEAD && git -C "repos/$name" reset --quiet --hard FETCH_HEAD
  else
    git clone --quiet --depth 1 "$url" "repos/$name"
  fi
  echo "repos/$name @ $(git -C "repos/$name" rev-parse --short HEAD)"
done <<'REPOS'
effect https://github.com/Effect-TS/effect.git
agents https://github.com/cloudflare/agents.git
cf-workflow-pool https://github.com/dmmulroy/cf-workflow-pool.git
anti-slop https://github.com/dmmulroy/anti-slop.git
tanstack https://github.com/TanStack/router.git
sandbox-sdk https://github.com/cloudflare/sandbox-sdk.git
containers https://github.com/cloudflare/containers.git
REPOS
