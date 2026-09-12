#requires -Version 5.1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Shared   = Join-Path $HOME '.agents\skills'
$OpenCode = Join-Path $HOME '.config\opencode\skills'
$Codex    = Join-Path $HOME '.codex\skills'

$SuperpowersOpenCode = 'superpowers@git+https://github.com/obra/superpowers.git'
$SuperpowersCodex    = 'superpowers@openai-curated'

function Resolve-NativeCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string[]] $Names
    )

    foreach ($name in $Names) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -ne $cmd) {
            return $cmd.Source
        }
    }

    return $null
}

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)]
        [string] $FilePath,

        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]] $Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }
}

function Remove-PathIfExists {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $item = Get-Item -LiteralPath $Path -Force
    $isReparsePoint = ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0

    if ($item.PSIsContainer -and $isReparsePoint) {
        # Remove only the junction/symlink itself, never its target contents.
        Remove-Item -LiteralPath $Path -Force
    }
    else {
        Remove-Item -LiteralPath $Path -Recurse -Force
    }
}

function New-SkillLink {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Target,

        [Parameter(Mandatory = $true)]
        [string] $LinkPath
    )

    Remove-PathIfExists -Path $LinkPath

    # Directory junctions work well for local Windows folders and normally
    # do not require Administrator rights or Developer Mode.
    New-Item -ItemType Junction -Path $LinkPath -Target $Target -Force | Out-Null
}

Write-Host '== Checking environment =='

$Node = Resolve-NativeCommand -Names @('node.exe', 'node')
$Npm  = Resolve-NativeCommand -Names @('npm.cmd', 'npm.exe', 'npm')
$Npx  = Resolve-NativeCommand -Names @('npx.cmd', 'npx.exe', 'npx')

$missing = @()
if (-not $Node) { $missing += 'node' }
if (-not $Npm)  { $missing += 'npm' }
if (-not $Npx)  { $missing += 'npx' }

if ($missing.Count -gt 0) {
    Write-Error "Missing required command(s): $($missing -join ', '). Install Node.js for Windows first."
    exit 1
}

Write-Host "  node: $Node"
Write-Host "  npm:  $Npm"
Write-Host "  npx:  $Npx"

New-Item -ItemType Directory -Force -Path $Shared, $OpenCode, $Codex | Out-Null

Write-Host
Write-Host '== Updating existing skills =='
& $Npx -y 'skills@latest' update -g -y
if ($LASTEXITCODE -ne 0) {
    Write-Warning "skills update returned exit code $LASTEXITCODE; continuing, matching the original script."
}

Write-Host
Write-Host '== Matt Pocock skills =='
Invoke-Native -FilePath $Npx -Arguments @(
    '-y', 'skills@latest', 'add', 'mattpocock/skills',
    '-g', '-y',
    '-a', 'opencode',
    '-a', 'codex',
    '--skill', 'setup-matt-pocock-skills',
    '--skill', 'ask-matt',
    '--skill', 'grill-with-docs',
    '--skill', 'domain-modeling',
    '--skill', 'codebase-design',
    '--skill', 'prototype',
    '--skill', 'handoff',
    '--skill', 'to-spec',
    '--skill', 'to-tickets',
    '--skill', 'code-review',
    '--skill', 'wayfinder'
)

Write-Host
Write-Host '== Chisel =='
Invoke-Native -FilePath $Npx -Arguments @(
    '-y', 'skills@latest', 'add', 'JacobStephens2/skills',
    '-g', '-y',
    '-a', 'opencode',
    '-a', 'codex',
    '--skill', 'chisel'
)

Write-Host
Write-Host '== Caveman =='
Invoke-Native -FilePath $Npx -Arguments @(
    '-y', 'skills@latest', 'add', 'JuliusBrussee/caveman',
    '-g', '-y',
    '-a', 'opencode',
    '-a', 'codex',
    '--skill', 'caveman'
)

Write-Host
Write-Host '== Context7 =='
Invoke-Native -FilePath $Npm -Arguments @('install', '-g', 'ctx7@latest')

Invoke-Native -FilePath $Npx -Arguments @(
    '-y', 'skills@latest', 'add',
    'https://github.com/upstash/context7/tree/master/skills/context7-cli',
    '-g', '-y',
    '-a', 'opencode',
    '-a', 'codex'
)

Write-Host
Write-Host '== Playwright CLI =='
Invoke-Native -FilePath $Npm -Arguments @('install', '-g', '@playwright/cli@latest')

$PlaywrightCli = Resolve-NativeCommand -Names @('playwright-cli.cmd', 'playwright-cli.exe', 'playwright-cli')
if (-not $PlaywrightCli) {
    Write-Error 'playwright-cli was installed but is not available in PATH. Restart the terminal or ensure the npm global bin directory is in PATH.'
    exit 1
}

Invoke-Native -FilePath $PlaywrightCli -Arguments @('install', '--skills=agents', '--global')

Write-Host
Write-Host '== Syncing skills =='

Get-ChildItem -LiteralPath $Shared -Directory | ForEach-Object {
    $skillDir = $_.FullName
    $skillMd = Join-Path $skillDir 'SKILL.md'

    if (-not (Test-Path -LiteralPath $skillMd -PathType Leaf)) {
        return
    }

    $name = $_.Name
    New-SkillLink -Target $skillDir -LinkPath (Join-Path $OpenCode $name)
    New-SkillLink -Target $skillDir -LinkPath (Join-Path $Codex $name)
}

Write-Host
Write-Host '== Installed skills =='

Get-ChildItem -LiteralPath $Shared -Directory | Where-Object {
    Test-Path -LiteralPath (Join-Path $_.FullName 'SKILL.md') -PathType Leaf
} | Select-Object -ExpandProperty Name | Sort-Object -Unique | ForEach-Object {
    Write-Host $_
}

Write-Host
Write-Host 'Done.'
Write-Host
Write-Host 'Restart OpenCode and Codex.'
Write-Host "Shared skills: $Shared"
Write-Host 'Superpowers for Codex: installed/updated as a plugin.'
Write-Host
Write-Host 'OpenCode Superpowers (one-time manual setup):'
Write-Host '  Edit: ~/.config/opencode/opencode.json (or opencode.jsonc)'
Write-Host '  Add to the top-level "plugin" array:'
Write-Host "    `"$SuperpowersOpenCode`""
