$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-Cream.ps1')
$creamConfig = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'sourcing-runtime.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$creamRelayDir = $creamConfig.relayRunDir
if (-not [IO.Path]::IsPathRooted($creamRelayDir)) { $creamRelayDir = Join-Path $PSScriptRoot $creamRelayDir }
if (-not (Test-Path -LiteralPath $creamRelayDir)) { throw 'Run Setup-Other-PC.ps1 first.' }
$creamExisting = $false
try { Invoke-RestMethod -Uri 'http://127.0.0.1:8787/status' -TimeoutSec 3 | Out-Null; $creamExisting = $true } catch {}
if ($creamExisting) {
    node (Join-Path $PSScriptRoot 'kream-tools\portable-relay-check.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Port 8787 serves another folder. Existing process was left running.' }
    Write-Host 'Reusing the existing relay.'; exit 0
}
if (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 8787 is occupied. Existing process was left running.' }
$creamNode = (Get-Command node).Source
$creamScript = Join-Path $PSScriptRoot 'kream-tools\relay-server.mjs'
Start-Process -FilePath $creamNode -ArgumentList @(('"' + $creamScript + '"'), ('"' + $creamRelayDir + '"')) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $creamRelayDir 'relay.log') -RedirectStandardError (Join-Path $creamRelayDir 'relay-error.log') | Out-Null
Start-Sleep -Seconds 1
node (Join-Path $PSScriptRoot 'kream-tools\portable-relay-check.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Relay failed to start. See kream-runs/pc-relay/relay-error.log.' }
