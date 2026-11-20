$ErrorActionPreference = 'Stop'
$repoDir = Split-Path -Parent $PSScriptRoot
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js >=22.20.0 is required.' }
& $node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if (major < 22 || major === 22 && minor < 20) process.exit(1)'
if ($LASTEXITCODE -ne 0) { throw 'Node.js >=22.20.0 is required.' }
& $node (Join-Path $repoDir 'bin\install.mjs') @args
exit $LASTEXITCODE
