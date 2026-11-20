#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
command -v node >/dev/null 2>&1 || { echo 'Node.js >=22.20.0 is required.' >&2; exit 1; }
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if (major < 22 || major === 22 && minor < 20) process.exit(1)' || { echo 'Node.js >=22.20.0 is required.' >&2; exit 1; }
exec node "$repo_dir/bin/install.mjs" "$@"
