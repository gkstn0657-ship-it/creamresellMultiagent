param(
    [string]$Root,
    [string]$WorkId,
    [int]$Port = 8874
)
$ErrorActionPreference = 'Stop'
$taskRepo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
if (-not $Root) { $Root = Join-Path (Split-Path -Parent $taskRepo) 'Cream\kream-runs\agent-teams' }
$taskRoot = [System.IO.Path]::GetFullPath($Root)
$taskNode = (Get-Command node -ErrorAction Stop).Source
$taskEdge = @('C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe','C:\Program Files\Microsoft\Edge\Application\msedge.exe') | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $taskEdge) { throw 'Microsoft Edge is required for the dashboard app window.' }
$taskUrl = "http://127.0.0.1:$Port/"
$taskHealth = "http://127.0.0.1:$Port/health"
$taskReady = $false
try {
    $taskReply = Invoke-RestMethod -Uri $taskHealth -TimeoutSec 2
    if ($taskReply.app -ne 'cream-musinsa-live-dashboard-v1') { throw 'Port is owned by a different service.' }
    $taskReady = $true
} catch [System.Net.WebException] { }
if (-not $taskReady) {
    $taskLogs = Join-Path $env:LOCALAPPDATA 'CreamLiveDashboard'
    New-Item -ItemType Directory -Path $taskLogs -Force | Out-Null
    $taskServer = Join-Path $PSScriptRoot 'server.mjs'
    $taskArgs = @(('"' + $taskServer + '"'), ('"--root=' + $taskRoot + '"'), ('--port=' + $Port))
    if ($WorkId) { $taskArgs += '--work=' + $WorkId }
    Start-Process -FilePath $taskNode -ArgumentList $taskArgs -WorkingDirectory $taskRepo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskLogs 'server.log') -RedirectStandardError (Join-Path $taskLogs 'server-error.log') | Out-Null
    for ($taskAttempt=0; $taskAttempt -lt 40; $taskAttempt++) {
        Start-Sleep -Milliseconds 150
        try {
            $taskReply = Invoke-RestMethod -Uri $taskHealth -TimeoutSec 2
            if ($taskReply.app -eq 'cream-musinsa-live-dashboard-v1') { $taskReady = $true; break }
        } catch [System.Net.WebException] { }
    }
}
if (-not $taskReady) { throw 'Dashboard server did not become ready.' }
Start-Process -FilePath $taskEdge -ArgumentList @('--new-window', '--window-size=1480,980', ('--app=' + $taskUrl)) -WindowStyle Normal | Out-Null
Write-Output "Cream live dashboard opened: $taskUrl"
