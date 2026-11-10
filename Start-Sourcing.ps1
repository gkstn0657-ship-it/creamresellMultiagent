param([string]$RunDir, [int]$Limit=30, [switch]$Replay, [switch]$Legacy,
      [string]$Source='https://kream.co.kr/categories/50/24?sort=popular_score')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-Cream.ps1')
if (-not $RunDir) {
    if ($Replay) { throw 'Replay requires -RunDir pointing to saved observations.' }
    $RunDir = Join-Path $PSScriptRoot ('kream-runs\' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-team')
}
$creamArgs = @((Join-Path $PSScriptRoot 'kream-tools\run-all.mjs'), $RunDir, ('--limit=' + $Limit), ('--source=' + $Source))
if (-not $Legacy -and -not $Replay) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Start-Relay.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Relay startup failed.' }
    $creamArgs += '--agentic'
}
if ($Replay) { $creamArgs += '--replay' }
& node @creamArgs
exit $LASTEXITCODE
