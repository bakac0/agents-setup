#!/usr/bin/env bash
# Run again to update from this complete checkout. No automatic skill installation.
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$repo_dir/bin/deploy-config.mjs" ]] || { echo "Run from the complete agent-stack checkout." >&2; exit 1; }
profile_flag=''
if (( $# )); then
  if [[ $# != 2 || "$1" != --profile || ( "$2" != work && "$2" != home ) ]]; then echo 'Usage: bash bin/install-all.sh [--profile work|home]' >&2; exit 2; fi
  profile_flag="$2"
fi
for cmd in node npm git; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Missing prerequisite: $cmd" >&2; exit 1; }
done
if [[ "$(command -v npm)" == /mnt/c/* ]]; then
  echo 'Install Linux Node.js/npm inside WSL, not Windows npm/npx.' >&2; exit 1
fi
node -e 'if (parseInt(process.versions.node) < 22) process.exit(1)'
config_dir="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
profile="$(node --input-type=module - "$repo_dir/bin/profile.mjs" "$config_dir" "$profile_flag" <<'JS'
import {pathToFileURL} from 'node:url';
const {resolveProfile}=await import(pathToFileURL(process.argv[2]));
try { console.log(resolveProfile({configDir:process.argv[3],flag:process.argv[4]||undefined})); }
catch(error) { console.error(error.message); process.exit(1); }
JS
)"
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
    echo "Stable OpenCode >=2.2.5 and <3 required; found: $version" >&2; exit 1
  fi
  minor="${BASH_REMATCH[2]}"; patch="${BASH_REMATCH[3]}"
  if (( minor < 2 || (minor == 2 && patch < 5) )); then echo 'Serena idle lifecycle requires OpenCode >=2.2.5.' >&2; exit 1; fi
  command -v curl >/dev/null 2>&1 || { echo 'curl is required for OpenCode tools.' >&2; exit 1; }
  edit_cli check
else
  echo 'OpenCode not found; skipping the OpenCode section.'
fi

echo '== Updating Playwright CLI (no skill installation) =='
npm install -g @playwright/cli@latest
if [[ "$has_opencode" == false ]]; then echo 'OpenCode section skipped. Manage skills separately.'; exit 0; fi

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
ensure_plugin plannotator '@plannotator/opencode@latest'
ensure_plugin opencode-subagent-intervene 'opencode-subagent-intervene@latest'
# Retire competing runtime plugins, but leave their data, configs and Beads CLI untouched.
for package in '@dietrichgebert/ponytail' '@tarquinen/opencode-dcp' 'opencode-beads'; do
  if opencode_listing plugin | grep -Fq -- "$package"; then opencode plugin remove "$package"; fi
done
ensure_mcp context7 --url https://mcp.context7.com/mcp

npm install --prefix "$cli_packages" --no-save --package-lock=false @rashidrazak/opencode-status-line@latest jsonc-parser@3.3.1
edit_cli
node "$repo_dir/bin/deploy-config.mjs" --profile "$profile" --config-dir "$config_dir"

configure_serena_lifecycle() {
  node - "$config_dir" "$cli_packages/node_modules/jsonc-parser" <<'JS'
const fs = require('node:fs');
const path = require('node:path');
const jsonc = require(process.argv[3]);
const configDir = process.argv[2];
const candidates = ['opencode.json', 'opencode.jsonc'];
const matches = [];
let hasIdleTimeout = false;
for (const name of candidates) {
  const file = path.join(configDir, name);
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const errors = [];
  const config = jsonc.parse(source, errors, { allowTrailingComma: true });
  if (errors.length) throw Error(`Cannot parse ${file}: ${JSON.stringify(errors)}`);
  if (config?.experimental?.location_idle_timeout !== undefined) hasIdleTimeout = true;
  if (config?.mcp?.servers?.serena !== undefined) {
    if (config.mcp.servers.serena?.type !== 'local') {
      throw Error(`Expected a local Serena MCP server in ${file}`);
    }
    matches.push({file, source, config});
  }
}
if (matches.length !== 1) {
  throw Error(matches.length ? 'Ambiguous Serena MCP entries in both global config files' :
    'Serena MCP entry not found in global opencode.json or opencode.jsonc');
}
const {file, source, config} = matches[0];
if (config.experimental !== undefined && (!config.experimental || typeof config.experimental !== 'object' || Array.isArray(config.experimental))) {
  throw Error('Invalid experimental config object');
}
if (hasIdleTimeout) {
  process.stdout.write('Preserving existing location_idle_timeout setting.\n');
  process.exit(0);
}
const edits = jsonc.modify(source, ['experimental','location_idle_timeout'], '5 minutes', {
  formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' },
});
const updated = jsonc.applyEdits(source, edits);
if (updated !== source) {
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, updated, {flag: 'wx', mode: fs.statSync(file).mode & 0o777});
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
process.stdout.write(`Serena idle lifecycle configured in ${file}.\n`);
JS
}

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
configure_serena_lifecycle
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
# RTK is installed above; native V2 hook is enabled only when the binary is reachable.
if command -v rtk >/dev/null 2>&1; then
  if [[ "$config_dir" == "${XDG_CONFIG_HOME:-$HOME/.config}/opencode" ]]; then
    rtk init --global --opencode
    rtk init --show
  else
    echo 'Custom OpenCode config dir: verify RTK generated hook and copy it explicitly if needed.' >&2
  fi
else echo 'RTK not in PATH; restart shell, then run rtk init --global --opencode.' >&2; fi
opencode models
opencode plugin update
opencode plugin list
opencode mcp list
echo 'Installed/updated. Context7 may request browser sign-in on its first lookup.'
echo "Project memory initialization (inside each repository): \"$uv_bin\" tool run --isolated --python 3.13 --from projectmem@latest pjm init --no-global"
echo 'Restart the actual OpenChamber/OpenCode server and verify translator/RTK activation. Skills are managed separately; no Git project initialized.'
