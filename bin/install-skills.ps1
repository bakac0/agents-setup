# Standalone skills management via Vercel Skills CLI; install-all also syncs skills.
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'install-skills.mjs'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js >=22.20.0 is required.' }
& node $script @args
if ($LASTEXITCODE -ne 0) { throw "Vercel Skills installer failed ($LASTEXITCODE)." }
