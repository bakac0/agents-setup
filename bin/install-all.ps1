<# Run again to update from this complete checkout. No automatic skill installation. #>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repoDir = Split-Path -Parent $PSScriptRoot
$deployScript = Join-Path $repoDir 'bin\deploy-config.mjs'
if (-not (Test-Path -LiteralPath $deployScript)) { throw 'Run from the complete agent-stack checkout.' }

function Require-Command([string]$name) {
    $found = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $found) { throw "Missing prerequisite: $name" }
    if ($found.Source) { return $found.Source }
    return $found.Name
}
function Run-Checked([string]$command, [string[]]$arguments) {
    & $command @arguments
    if ($LASTEXITCODE -ne 0) { throw "Failed ($LASTEXITCODE): $command $($arguments -join ' ')" }
}
function OpenCode-Listing([string]$kind) {
    $listing = (& opencode $kind list 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { throw "opencode $kind list failed: $listing" }
    return $listing
}
function Ensure-Plugin([string]$name, [string]$package) {
    if ((OpenCode-Listing 'plugin').IndexOf($name, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        Run-Checked 'opencode' @('plugin','add',$package)
    }
}
function Ensure-Mcp([string]$name, [string[]]$arguments, [switch]$Update) {
    if ($Update -or (OpenCode-Listing 'mcp') -notmatch "(?im)(?<![\w-])$([regex]::Escape($name))(?![\w-])") {
        Run-Checked 'opencode' (@('mcp','add',$name,'--global') + $arguments)
    } else { Write-Host "Preserving existing MCP: $name" }
}
function Install-RemoteScript([string]$url, [hashtable]$options = @{}) {
    $temporary = Join-Path ([IO.Path]::GetTempPath()) "agent-install-$([guid]::NewGuid()).ps1"
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $temporary
        $global:LASTEXITCODE = 0
        & $temporary @options
        if (-not $? -or $LASTEXITCODE -ne 0) { throw "Installer failed: $url (exit $LASTEXITCODE)" }
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

$node = Require-Command 'node'
$npm = if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { 'npm.cmd' } else { Require-Command 'npm' }
Require-Command 'git' | Out-Null
Run-Checked $node @('-e','if (parseInt(process.versions.node) < 22) process.exit(1)')
$hasOpenCode = [bool](Get-Command opencode -ErrorAction SilentlyContinue)
$configDir = if ($env:OPENCODE_CONFIG_DIR) { $env:OPENCODE_CONFIG_DIR } else { Join-Path $HOME '.config\opencode' }
$cliPackages = Join-Path $configDir 'cli-packages'
$statusLinePath = Join-Path $cliPackages 'node_modules\@rashidrazak\opencode-status-line'

# Use Node on stdin so PowerShell 5.1 cannot strip quotes from JavaScript arguments.
$cliEditor = @'
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
'@
if ($hasOpenCode) {
    $version = (& opencode --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^(?:opencode\s+)?v?2\.(\d+)\.(\d+)\s*$') {
        throw "Stable OpenCode >=2.2.5 and <3 required; found: $version"
    }
    $minor = [int]$Matches[1]; $patch = [int]$Matches[2]
    if ($minor -lt 2 -or ($minor -eq 2 -and $patch -lt 5)) { throw 'Serena idle lifecycle requires OpenCode >=2.2.5.' }
    $cliPath = Join-Path $configDir 'cli.json'
    $cliEditor | & $node - $cliPath $statusLinePath check
    if ($LASTEXITCODE -ne 0) { throw 'Invalid cli.json; no packages have been changed.' }
} else { Write-Host 'OpenCode not found; skipping the OpenCode section.' }

Write-Host '== Updating Playwright CLI (no skill installation) =='
Run-Checked $npm @('install','-g','@playwright/cli@latest')
if (-not $hasOpenCode) { Write-Host 'OpenCode section skipped. Manage skills separately.'; return }

Write-Host '== OpenCode plugins and Context7 MCP =='
Ensure-Plugin 'superpowers' 'superpowers@git+https://github.com/obra/superpowers.git'
Ensure-Plugin 'opencode-plugin-litellm' 'opencode-plugin-litellm@latest'
Ensure-Plugin 'plannotator' '@plannotator/opencode@latest'
Ensure-Plugin 'opencode-subagent-intervene' 'opencode-subagent-intervene@latest'
# Leave Beads data, configs and CLI intact; retire only competing runtime plugins.
foreach ($package in @('@dietrichgebert/ponytail','@tarquinen/opencode-dcp','opencode-beads')) {
    if ((OpenCode-Listing 'plugin').Contains($package)) { Run-Checked 'opencode' @('plugin','remove',$package) }
}
Ensure-Mcp 'context7' @('--url','https://mcp.context7.com/mcp')

Run-Checked $npm @('install','--prefix',$cliPackages,'--no-save','--package-lock=false','@rashidrazak/opencode-status-line@latest','jsonc-parser@3.3.1')
$cliEditor | & $node - $cliPath $statusLinePath
if ($LASTEXITCODE -ne 0) { throw 'Could not update cli.json.' }
Run-Checked $node @($deployScript,'--config-dir',$configDir)

$serenaEditor = @'
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
'@

Write-Host '== Serena and ProjectMem (managed Python) =='
$uv = if (Get-Command uv -ErrorAction SilentlyContinue) { Require-Command 'uv' } else { Join-Path $HOME '.local\bin\uv.exe' }
if (-not (Get-Command uv -ErrorAction SilentlyContinue) -and -not (Test-Path -LiteralPath $uv)) {
    Install-RemoteScript 'https://astral.sh/uv/install.ps1'
}
# Isolated versioned caches avoid replacing executables locked by a running MCP.
Run-Checked $uv @('tool','run','--isolated','--refresh','--python','3.13','--from','serena-agent@latest','serena','--help')
Run-Checked $uv @('tool','run','--isolated','--refresh','--python','3.13','--from','projectmem@latest','pjm','--help')
Ensure-Mcp 'serena' @('--',$uv,'tool','run','--isolated','--python','3.13','--from','serena-agent@latest','serena','start-mcp-server','--context','agent','--project-from-cwd','--open-web-dashboard','false') -Update
$serenaEditor | & $node - $configDir (Join-Path $cliPackages 'node_modules\jsonc-parser')
if ($LASTEXITCODE -ne 0) { throw 'Could not configure Serena idle lifecycle.' }
Ensure-Mcp 'projectmem' @('--',$uv,'tool','run','--isolated','--python','3.13','--from','projectmem@latest','python','-m','projectmem.mcp_server') -Update

Write-Host '== Updating Plannotator and RTK =='
$previousMinimal = $env:PLANNOTATOR_MINIMAL
try {
    # Upstream uses $Minimal and $minimal for the same variable; env also
    # selects binary-only mode on installer versions affected by that collision.
    $env:PLANNOTATOR_MINIMAL = '1'
    Install-RemoteScript 'https://plannotator.ai/install.ps1' @{ Minimal = $true; NonInteractive = $true }
} finally { $env:PLANNOTATOR_MINIMAL = $previousMinimal }
# RTK is optional. A broken winget source must not interrupt the rest of the setup.
# Explicit --source winget avoids querying msstore, which may be unavailable.
if (Get-Command winget -ErrorAction SilentlyContinue) {
    try {
        & winget install --id rtk-ai.rtk --exact --source winget --accept-source-agreements --accept-package-agreements --disable-interactivity
        $rtkInstallExit = $LASTEXITCODE
        # 0x8A15002B means that winget has no newer version to install.
        if ($rtkInstallExit -notin @(0,-1978335189)) {
            Write-Warning "RTK installation/update failed (winget exit $rtkInstallExit); continuing without blocking other components. Retry: winget install --id rtk-ai.rtk -e --source winget"
        }
    } catch {
        Write-Warning "RTK installation/update could not run: $($_.Exception.Message). Continuing without blocking other components."
    }
} elseif (Get-Command cargo -ErrorAction SilentlyContinue) {
    try { Run-Checked 'cargo' @('install','--git','https://github.com/rtk-ai/rtk','rtk','--locked') }
    catch { Write-Warning "RTK Cargo install failed: $($_.Exception.Message). Continuing without RTK." }
} else {
    Write-Warning 'RTK skipped: winget and Cargo are unavailable. The other components will still be configured.'
}

# A fresh WinGet installation may not yet have refreshed PATH in this shell.
$rtkCommand = Get-Command rtk -ErrorAction SilentlyContinue
$rtkExe = if ($rtkCommand) { $rtkCommand.Source } else { $null }
if (-not $rtkExe -and $env:LOCALAPPDATA) {
    $wingetRtk = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\rtk.exe'
    if (Test-Path -LiteralPath $wingetRtk) { $rtkExe = $wingetRtk }
}
if ($rtkExe) {
    if ($configDir -eq (Join-Path $HOME '.config\opencode')) {
        try {
            Run-Checked $rtkExe @('init','--global','--opencode')
            Run-Checked $rtkExe @('init','--show')
        } catch { Write-Warning "RTK hook initialization failed: $($_.Exception.Message). Re-run 'rtk init --global --opencode' after checking RTK." }
    } else {
        Write-Warning 'Custom OpenCode config directory: verify RTK generated hook and copy explicitly if needed.'
    }
} else {
    Write-Warning 'RTK executable not found in current PATH or WinGet links; if installation succeeded, restart the terminal and run: rtk init --global --opencode'
}
# Activate the configured plugins before updating the running background server.
Run-Checked 'opencode' @('models')
Run-Checked 'opencode' @('plugin','update')
Run-Checked 'opencode' @('plugin','list')
Run-Checked 'opencode' @('mcp','list')
Write-Host 'Installed/updated. Context7 may request browser sign-in on its first lookup.'
Write-Host "Project memory initialization (inside each repository): & '$uv' tool run --isolated --python 3.13 --from projectmem@latest pjm init --no-global"
Write-Host 'Restart the actual OpenChamber/OpenCode server and verify translator/RTK activation. Skills are managed separately; no Git project initialized.'
