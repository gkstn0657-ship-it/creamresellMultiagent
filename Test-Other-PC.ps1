$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-Cream.ps1')
node (Join-Path $PSScriptRoot 'renew\Cream\kream-tools\preflight.mjs')
exit $LASTEXITCODE
