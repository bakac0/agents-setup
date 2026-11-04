#!/usr/bin/env bash
# Run again to update. Standalone: no sibling scripts or templates required.
set -euo pipefail
if (( $# )); then echo 'Usage: bash install-all.sh (no arguments)' >&2; exit 2; fi
for cmd in node npm npx git; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Missing prerequisite: $cmd" >&2; exit 1; }
done
if [[ "$(command -v npm)" == /mnt/c/* || "$(command -v npx)" == /mnt/c/* ]]; then
  echo 'Install Linux Node.js/npm inside WSL, not Windows npm/npx.' >&2; exit 1
fi
node -e 'if (parseInt(process.versions.node) < 18) process.exit(1)'
if [[ "${AGENTS_SKILLS_DIR:-$HOME/.agents/skills}" != "$HOME/.agents/skills" ]]; then
  echo 'skills -g uses ~/.agents/skills; custom AGENTS_SKILLS_DIR is unsupported.' >&2; exit 1
fi
config_dir="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
cli_packages="$config_dir/cli-packages"
status_line_path="$cli_packages/node_modules/@rashidrazak/opencode-status-line"
has_opencode=false

edit_cli() {
  node - "$config_dir/cli.json" "$status_line_path" "${1:-}" <<'JS'
const fs = require('node:fs'), path = require('node:path');
const [file, pluginPath, check] = process.argv.slice(2);
const plugin = '@rashidrazak/opencode-status-line';
let data = {};
if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Invalid cli.json root');
if (data.plugins === undefined) data.plugins = [];
if (!Array.isArray(data.plugins) || data.plugins.some(p => typeof p !== 'string' &&
    (!p || Array.isArray(p) || typeof p.package !== 'string'))) throw Error('Invalid cli.json plugins');
if (check) process.exit(0);
let found = false, changed = false;
const isStatusLine = p => { const n = typeof p === 'string' ? p : p.package; return n === plugin || n.startsWith(plugin+'@') || n === pluginPath; };
const configured = data.plugins.filter(p => typeof p === 'object' && isStatusLine(p)).at(-1);
data.plugins = data.plugins.flatMap(p => {
  if (!isStatusLine(p)) return [p];
  if (found) { changed = true; return []; }
  found = true;
  const selected = configured || p;
  const n = typeof selected === 'string' ? selected : selected.package;
  if (selected === p && n === pluginPath) return [p];
  changed = true; return [typeof selected === 'string' ? pluginPath : {...selected,package:pluginPath}];
});
if (!found) { data.plugins.push(pluginPath); changed = true; }
if (!changed) process.exit(0);
fs.mkdirSync(path.dirname(file),{recursive:true});
const tmp = file+'.'+process.pid+'.tmp';
try { fs.writeFileSync(tmp,JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600}); fs.renameSync(tmp,file); }
finally { if(fs.existsSync(tmp)) fs.unlinkSync(tmp); }
JS
}
if command -v opencode >/dev/null 2>&1; then
  has_opencode=true
  version="$(opencode --version 2>&1)"
  if [[ ! "$version" =~ ^(opencode[[:space:]]+)?v?2\.([0-9]+)\.([0-9]+)[[:space:]]*$ ]]; then
    echo "Stable OpenCode >=2.0.4 and <3 required; found: $version" >&2; exit 1
  fi
  minor="${BASH_REMATCH[2]}"; patch="${BASH_REMATCH[3]}"
  if (( minor == 0 && patch < 4 )); then echo 'Superpowers requires OpenCode >=2.0.4.' >&2; exit 1; fi
  command -v curl >/dev/null 2>&1 || { echo 'curl is required for OpenCode tools.' >&2; exit 1; }
  edit_cli check
else
  echo 'OpenCode not found; skipping the OpenCode section.'
fi

echo '== Installing/updating shared skills and Playwright =='
targets=(-g -y -a codex)
if [[ "$has_opencode" == true ]]; then targets+=(-a opencode); fi
npx -y skills@latest update -g -y
pocock=(setup-matt-pocock-skills ask-matt grilling grill-with-docs domain-modeling
  codebase-design research prototype handoff to-spec to-tickets code-review
  wayfinder wait-what wizard writing-for-agents)
selection=()
for skill in "${pocock[@]}"; do selection+=(--skill "$skill"); done
missing=false
for skill in "${pocock[@]}"; do [[ -f "$HOME/.agents/skills/$skill/SKILL.md" ]] || missing=true; done
if [[ "$missing" == true ]]; then npx -y skills@latest add mattpocock/skills "${targets[@]}" "${selection[@]}"; fi
if [[ ! -f "$HOME/.agents/skills/chisel/SKILL.md" ]]; then npx -y skills@latest add JacobStephens2/skills "${targets[@]}" --skill chisel; fi
if [[ ! -f "$HOME/.agents/skills/caveman/SKILL.md" ]]; then npx -y skills@latest add JuliusBrussee/caveman "${targets[@]}" --skill caveman; fi
npm install -g @playwright/cli@latest
playwright-cli install --skills=agents --global
if [[ "$has_opencode" == false ]]; then echo 'Shared tools updated. OpenCode section skipped.'; exit 0; fi

opencode_listing() {
  local listing
  listing="$(opencode "$1" list 2>&1)" || { echo "opencode $1 list failed: $listing" >&2; return 1; }
  printf '%s\n' "$listing"
}
ensure_plugin() {
  local listing
  listing="$(opencode_listing plugin)"
  if ! printf '%s\n' "$listing" | grep -Fqi -- "$1"; then opencode plugin add "$2"; fi
}
ensure_mcp() {
  local name="$1" listing; shift
  listing="$(opencode_listing mcp)"
  if printf '%s\n' "$listing" | grep -Eq "(^|[^[:alnum:]_-])${name}([^[:alnum:]_-]|$)"; then
    echo "Preserving existing MCP: $name"
  else opencode mcp add "$name" --global "$@"; fi
}

echo '== OpenCode plugins and Context7 MCP =='
ensure_plugin superpowers 'superpowers@git+https://github.com/obra/superpowers.git'
ensure_plugin opencode-plugin-litellm 'opencode-plugin-litellm@latest'
ensure_plugin ponytail '@dietrichgebert/ponytail@latest'
ensure_plugin opencode-dcp '@tarquinen/opencode-dcp@latest'
ensure_plugin plannotator '@plannotator/opencode@latest'
npm_root="$(npm root -g)"
if [[ -f "$npm_root/@beads/bd/package.json" ]]; then npm update -g --ignore-scripts @beads/bd
else npm install -g --ignore-scripts @beads/bd@latest; fi
beads_version="$(node -e 'process.stdout.write(require(process.argv[1]).version)' "$npm_root/@beads/bd/package.json")"
if ! bd version 2>/dev/null | grep -Fq -- "$beads_version"; then
  beads_platform="$(uname -s | tr '[:upper:]' '[:lower:]')"
  case "$(uname -m)" in x86_64) beads_arch=amd64;; aarch64|arm64) beads_arch=arm64;; *) echo 'Unsupported Beads architecture.' >&2; exit 1;; esac
  beads_archive="$(mktemp "${TMPDIR:-/tmp}/beads.XXXXXX")"
  trap 'rm -f -- "$beads_archive"' EXIT
  curl -fsSL --connect-timeout 20 --max-time 180 "https://github.com/gastownhall/beads/releases/download/v$beads_version/beads_${beads_version}_${beads_platform}_${beads_arch}.tar.gz" -o "$beads_archive"
  tar -xOf "$beads_archive" bd > "$npm_root/@beads/bd/bin/bd"
  chmod +x "$npm_root/@beads/bd/bin/bd"
  rm -f -- "$beads_archive"
  trap - EXIT
fi
bd version
if (( minor > 1 || (minor == 1 && patch >= 2) )); then ensure_plugin opencode-beads 'opencode-beads@latest'
else echo 'WARNING: opencode-beads requires OpenCode >=2.1.2; skipped.' >&2; fi
if (( minor >= 2 )); then ensure_plugin opencode-subagent-intervene 'opencode-subagent-intervene@latest'
else echo 'WARNING: Subagent Intervene requires OpenCode >=2.2.0; skipped.' >&2; fi
ensure_mcp context7 --url https://mcp.context7.com/mcp

ponytail_dir="${PONYTAIL_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/ponytail}"
if [[ ! -e "$ponytail_dir/config.json" ]]; then
  mkdir -p "$ponytail_dir"; printf '%s\n' '{"defaultMode":"lite"}' > "$ponytail_dir/config.json"
fi
npm install --prefix "$cli_packages" --no-save --package-lock=false @rashidrazak/opencode-status-line@latest
edit_cli
mkdir -p "$config_dir/agents"
if [[ ! -e "$config_dir/agents/reviewer.md" ]]; then
  cat > "$config_dir/agents/reviewer.md" <<'AGENT'
---
description: Independent read-only review of correctness, regressions, security and tests
mode: subagent
permissions:
  - action: edit
    resource: "*"
    effect: deny
  - action: shell
    resource: "*"
    effect: deny
  - action: shell
    resource: "git diff*"
    effect: allow
  - action: shell
    resource: "git status*"
    effect: allow
---
Review the diff and surrounding code. Use shell only for git diff and git status.
Report actionable findings with severity, file/line, and the failure scenario.
Check requirements, correctness, regressions, security and tests. Modify no files.
AGENT
fi

echo '== Serena and ProjectMem (managed Python) =='
work="$(mktemp -d "${TMPDIR:-/tmp}/agent-install.XXXXXX")"
trap 'rm -f -- "$work/uv.sh" "$work/plannotator.sh" "$work/rtk.sh"; rmdir -- "$work"' EXIT
uv_bin="$(command -v uv || true)"
if [[ -z "$uv_bin" && -x "$HOME/.local/bin/uv" ]]; then uv_bin="$HOME/.local/bin/uv"; fi
if [[ -z "$uv_bin" ]]; then
  curl -fsSL https://astral.sh/uv/install.sh -o "$work/uv.sh"
  sh "$work/uv.sh"
  uv_bin="$(command -v uv || true)"
fi
if [[ -z "$uv_bin" && -x "$HOME/.local/bin/uv" ]]; then uv_bin="$HOME/.local/bin/uv"; fi
[[ -n "$uv_bin" ]] || { echo 'uv installation failed: executable not found.' >&2; exit 1; }
# Isolated versioned caches leave environments of running MCP processes intact.
"$uv_bin" tool run --isolated --refresh --python 3.13 --from serena-agent@latest serena --help
"$uv_bin" tool run --isolated --refresh --python 3.13 --from projectmem@latest pjm --help
opencode mcp add serena --global -- "$uv_bin" tool run --isolated --python 3.13 --from serena-agent@latest serena start-mcp-server --context agent --project-from-cwd --open-web-dashboard false
opencode mcp add projectmem --global -- "$uv_bin" tool run --isolated --python 3.13 --from projectmem@latest python -m projectmem.mcp_server

echo '== Updating Plannotator and RTK =='
curl -fsSL https://plannotator.ai/install.sh -o "$work/plannotator.sh"
bash "$work/plannotator.sh" --minimal
if command -v brew >/dev/null 2>&1; then
  if brew list rtk >/dev/null 2>&1; then brew upgrade rtk; else brew install rtk; fi
elif command -v cargo >/dev/null 2>&1; then
  cargo install --git https://github.com/rtk-ai/rtk rtk --locked
else
  curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh -o "$work/rtk.sh"
  sh "$work/rtk.sh"
fi
opencode models
opencode plugin update
opencode plugin list
opencode mcp list
echo 'Installed/updated. Context7 may request browser sign-in on its first lookup.'
echo "Project memory initialization (inside each repository): \"$uv_bin\" tool run --isolated --python 3.13 --from projectmem@latest pjm init --no-global"
echo 'RTK hook is not enabled. LiteLLM needs your provider configuration. No Git project was initialized.'
