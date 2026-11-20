#!/usr/bin/env bash
# Standalone skills management via Vercel Skills CLI; install-all also syncs skills.
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
command -v node >/dev/null 2>&1 || { echo 'Node.js >=22.20.0 is required.' >&2; exit 1; }
exec node "$repo_dir/bin/install-skills.mjs" "$@"
