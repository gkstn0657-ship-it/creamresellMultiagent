$ErrorActionPreference = 'Stop'
$bridgeDirectory = Join-Path $env:LOCALAPPDATA 'CreamDotBridge'
$pidFile = Join-Path $bridgeDirectory 'worker.pid'
if (Test-Path -LiteralPath $pidFile) {
    $bridgePid = [int](Get-Content -LiteralPath $pidFile)
    if (Get-Process -Id $bridgePid -ErrorAction SilentlyContinue) {
        Write-Output 'Cream Dot bridge is already running.'
        exit 0
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $bridgeDirectory 'connection.json'))) { throw 'Cream Dot connection is not configured.' }
$nodePath = (Get-Command node).Source
$entry = Join-Path $PSScriptRoot 'remote-bridge.mjs'
Start-Process -FilePath $nodePath -ArgumentList @('"' + $entry + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $bridgeDirectory 'runtime.log') -RedirectStandardError (Join-Path $bridgeDirectory 'errors.log')
Write-Output 'Cream Dot bridge started in the background.'
