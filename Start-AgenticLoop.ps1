param([switch]$Once)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-Cream.ps1')
$creamLoopArgs = @((Join-Path $PSScriptRoot 'automation\loop.mjs'))
if ($Once) { $creamLoopArgs += '--once' }
& node @creamLoopArgs
exit $LASTEXITCODE
