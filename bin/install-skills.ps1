# Explicit skills management via Vercel Skills CLI. Never called by install-all.ps1.
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'install-skills.mjs'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js >=22.20.0 is required.' }
& node $script @args
if ($LASTEXITCODE -ne 0) { throw "Vercel Skills installer failed ($LASTEXITCODE)." }
