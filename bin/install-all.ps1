<# Run again to update. Standalone: no files beside this script are required. #>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

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
$npx = if (Get-Command npx.cmd -ErrorAction SilentlyContinue) { 'npx.cmd' } else { Require-Command 'npx' }
Require-Command 'git' | Out-Null
Run-Checked $node @('-e','if (parseInt(process.versions.node) < 18) process.exit(1)')
if ($env:AGENTS_SKILLS_DIR -and [IO.Path]::GetFullPath($env:AGENTS_SKILLS_DIR) -ne [IO.Path]::GetFullPath((Join-Path $HOME '.agents\skills'))) {
    throw 'skills -g uses ~/.agents/skills; custom AGENTS_SKILLS_DIR is unsupported.'
}
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
        throw "Stable OpenCode >=2.0.4 and <3 required; found: $version"
    }
    $minor = [int]$Matches[1]; $patch = [int]$Matches[2]
    if ($minor -eq 0 -and $patch -lt 4) { throw 'Superpowers requires OpenCode >=2.0.4.' }
    $cliPath = Join-Path $configDir 'cli.json'
    $cliEditor | & $node - $cliPath $statusLinePath check
    if ($LASTEXITCODE -ne 0) { throw 'Invalid cli.json; no packages have been changed.' }
} else { Write-Host 'OpenCode not found; skipping the OpenCode section.' }

Write-Host '== Installing/updating shared skills and Playwright =='
$targets = @('-g','-y','-a','codex')
if ($hasOpenCode) { $targets += @('-a','opencode') }
Run-Checked $npx @('-y','skills@latest','update','-g','-y')
$pocock = @('setup-matt-pocock-skills','ask-matt','grilling','grill-with-docs','domain-modeling',
    'codebase-design','research','prototype','handoff','to-spec','to-tickets','code-review',
    'wayfinder','wait-what','wizard','writing-for-agents')
$selection = @()
foreach ($skill in $pocock) { $selection += @('--skill',$skill) }
$sharedSkills = Join-Path $HOME '.agents\skills'
$missingPocock = @($pocock | Where-Object { -not (Test-Path -LiteralPath (Join-Path $sharedSkills "$_\SKILL.md")) })
if ($missingPocock.Count) { Run-Checked $npx (@('-y','skills@latest','add','mattpocock/skills') + $targets + $selection) }
if (-not (Test-Path -LiteralPath (Join-Path $sharedSkills 'chisel\SKILL.md'))) {
    Run-Checked $npx (@('-y','skills@latest','add','JacobStephens2/skills') + $targets + @('--skill','chisel'))
}
if (-not (Test-Path -LiteralPath (Join-Path $sharedSkills 'caveman\SKILL.md'))) {
    Run-Checked $npx (@('-y','skills@latest','add','JuliusBrussee/caveman') + $targets + @('--skill','caveman'))
}
Run-Checked $npm @('install','-g','@playwright/cli@latest')
Run-Checked 'playwright-cli' @('install','--skills=agents','--global')
if (-not $hasOpenCode) { Write-Host 'Shared tools updated. OpenCode section skipped.'; return }

Write-Host '== OpenCode plugins and Context7 MCP =='
Ensure-Plugin 'superpowers' 'superpowers@git+https://github.com/obra/superpowers.git'
Ensure-Plugin 'opencode-plugin-litellm' 'opencode-plugin-litellm@latest'
Ensure-Plugin 'ponytail' '@dietrichgebert/ponytail@latest'
Ensure-Plugin 'opencode-dcp' '@tarquinen/opencode-dcp@latest'
Ensure-Plugin 'plannotator' '@plannotator/opencode@latest'
# The npm postinstall downloader can hang on Windows; fetch the same official
# release with the native HTTP client and verify the executable ourselves.
$npmRoot = (& $npm root -g | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot locate global npm packages.' }
$beadsDir = Join-Path $npmRoot '@beads\bd'
if (Test-Path -LiteralPath (Join-Path $beadsDir 'package.json')) {
    Run-Checked $npm @('update','-g','--ignore-scripts','@beads/bd')
} else { Run-Checked $npm @('install','-g','--ignore-scripts','@beads/bd@latest') }
$beadsVersion = (Get-Content -LiteralPath (Join-Path $beadsDir 'package.json') -Raw | ConvertFrom-Json).version
$currentBeads = ''
if (Get-Command bd -ErrorAction SilentlyContinue) {
    try {
        $currentBeads = (& bd version 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { $currentBeads = '' }
    } catch { Write-Host 'Repairing missing or unusable Beads binary.' }
}
if ($currentBeads -notmatch "(?<![\d.])$([regex]::Escape($beadsVersion))(?![\d.])") {
    $architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'amd64' }
    $zip = Join-Path ([IO.Path]::GetTempPath()) "beads-$([guid]::NewGuid()).zip"
    try {
        Invoke-WebRequest -UseBasicParsing -TimeoutSec 180 -Uri "https://github.com/gastownhall/beads/releases/download/v$beadsVersion/beads_${beadsVersion}_windows_${architecture}.zip" -OutFile $zip
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $archive = [IO.Compression.ZipFile]::OpenRead($zip)
        try {
            $entry = $archive.GetEntry('bd.exe')
            if (-not $entry) { throw 'Official Beads archive does not contain bd.exe.' }
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $beadsDir 'bin\bd.exe'), $true)
        } finally { $archive.Dispose() }
    } finally { if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force } }
}
Run-Checked 'bd' @('version')
if ($minor -gt 1 -or ($minor -eq 1 -and $patch -ge 2)) { Ensure-Plugin 'opencode-beads' 'opencode-beads@latest' }
else { Write-Warning 'opencode-beads requires OpenCode >=2.1.2; skipped.' }
if ($minor -ge 2) { Ensure-Plugin 'opencode-subagent-intervene' 'opencode-subagent-intervene@latest' }
else { Write-Warning 'Subagent Intervene requires OpenCode >=2.2.0; skipped.' }
Ensure-Mcp 'context7' @('--url','https://mcp.context7.com/mcp')

$ponytailDir = if ($env:PONYTAIL_CONFIG_DIR) { $env:PONYTAIL_CONFIG_DIR } else { Join-Path $env:APPDATA 'ponytail' }
if (-not (Test-Path -LiteralPath (Join-Path $ponytailDir 'config.json'))) {
    New-Item -ItemType Directory -Path $ponytailDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $ponytailDir 'config.json') -Value '{"defaultMode":"lite"}' -Encoding UTF8
}
Run-Checked $npm @('install','--prefix',$cliPackages,'--no-save','--package-lock=false','@rashidrazak/opencode-status-line@latest')
$cliEditor | & $node - $cliPath $statusLinePath
if ($LASTEXITCODE -ne 0) { throw 'Could not update cli.json.' }
$reviewerPath = Join-Path $configDir 'agents\reviewer.md'
if (-not (Test-Path -LiteralPath $reviewerPath)) {
    New-Item -ItemType Directory -Path (Split-Path $reviewerPath) -Force | Out-Null
    @'
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
'@ | Set-Content -LiteralPath $reviewerPath -Encoding UTF8
}

Write-Host '== Serena and ProjectMem (managed Python) =='
$uv = if (Get-Command uv -ErrorAction SilentlyContinue) { Require-Command 'uv' } else { Join-Path $HOME '.local\bin\uv.exe' }
if (-not (Get-Command uv -ErrorAction SilentlyContinue) -and -not (Test-Path -LiteralPath $uv)) {
    Install-RemoteScript 'https://astral.sh/uv/install.ps1'
}
# Isolated versioned caches avoid replacing executables locked by a running MCP.
Run-Checked $uv @('tool','run','--isolated','--refresh','--python','3.13','--from','serena-agent@latest','serena','--help')
Run-Checked $uv @('tool','run','--isolated','--refresh','--python','3.13','--from','projectmem@latest','pjm','--help')
Ensure-Mcp 'serena' @('--',$uv,'tool','run','--isolated','--python','3.13','--from','serena-agent@latest','serena','start-mcp-server','--context','agent','--project-from-cwd','--open-web-dashboard','false') -Update
Ensure-Mcp 'projectmem' @('--',$uv,'tool','run','--isolated','--python','3.13','--from','projectmem@latest','python','-m','projectmem.mcp_server') -Update

Write-Host '== Updating Plannotator and RTK =='
$previousMinimal = $env:PLANNOTATOR_MINIMAL
try {
    # Upstream uses $Minimal and $minimal for the same variable; env also
    # selects binary-only mode on installer versions affected by that collision.
    $env:PLANNOTATOR_MINIMAL = '1'
    Install-RemoteScript 'https://plannotator.ai/install.ps1' @{ Minimal = $true; NonInteractive = $true }
} finally { $env:PLANNOTATOR_MINIMAL = $previousMinimal }
if (Get-Command winget -ErrorAction SilentlyContinue) {
    & winget install --id rtk-ai.rtk --exact --accept-source-agreements --accept-package-agreements --disable-interactivity
    # 0x8A15002B: already current; winget install also upgrades installed packages.
    if ($LASTEXITCODE -notin @(0,-1978335189)) { throw "RTK install/update failed ($LASTEXITCODE)." }
} elseif (Get-Command cargo -ErrorAction SilentlyContinue) {
    Run-Checked 'cargo' @('install','--git','https://github.com/rtk-ai/rtk','rtk','--locked')
} else { throw 'RTK requires winget or Cargo. Install one and rerun this script.' }

# Activate the configured plugins before updating the running background server.
Run-Checked 'opencode' @('models')
Run-Checked 'opencode' @('plugin','update')
Run-Checked 'opencode' @('plugin','list')
Run-Checked 'opencode' @('mcp','list')
Write-Host 'Installed/updated. Context7 may request browser sign-in on its first lookup.'
Write-Host "Project memory initialization (inside each repository): & '$uv' tool run --isolated --python 3.13 --from projectmem@latest pjm init --no-global"
Write-Host 'RTK hook is not enabled. LiteLLM needs your provider configuration. No Git project was initialized.'
