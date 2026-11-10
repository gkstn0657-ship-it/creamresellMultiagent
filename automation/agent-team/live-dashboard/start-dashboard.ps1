param(
    [string]$Root,
    [string]$WorkId,
    [int]$Port = 8875
)
$ErrorActionPreference = 'Stop'
$taskRepo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
if (-not $Root) { $Root = Join-Path (Split-Path -Parent $taskRepo) 'Cream\kream-runs\agent-teams' }
$taskRoot = [System.IO.Path]::GetFullPath($Root)
$taskNode = (Get-Command node -ErrorAction Stop).Source
if (-not $WorkId) {
    $taskOrders = Join-Path $taskRoot 'work-orders'
    if (Test-Path -LiteralPath $taskOrders) {
        foreach ($taskFile in (Get-ChildItem -LiteralPath $taskOrders -Filter 'work-*.json' -File | Sort-Object LastWriteTime -Descending)) {
            try { $taskWork = Get-Content -LiteralPath $taskFile.FullName -Raw | ConvertFrom-Json } catch { continue }
            if ($taskWork.status -eq 'open' -and $taskWork.continuous -eq $true) { $WorkId = $taskWork.id; break }
        }
    }
}
if ($WorkId -and $WorkId -match '^work-[a-f0-9-]{36}$') {
    $taskWorkDir = Join-Path $taskRoot ('explorations\' + $WorkId)
    $taskWatchLock = Join-Path $taskWorkDir 'watchdog.lock'
    $taskWatchRunning = $false
    if (Test-Path -LiteralPath $taskWatchLock) {
        try {
            $taskWatchPid = [int](Get-Content -LiteralPath $taskWatchLock -Raw)
            $taskWatchRunning = [bool](Get-Process -Id $taskWatchPid -ErrorAction SilentlyContinue)
        } catch { $taskWatchRunning = $false }
    }
    if (-not $taskWatchRunning) {
        New-Item -ItemType Directory -Path $taskWorkDir -Force | Out-Null
        $taskWatchScript = Join-Path $taskRepo 'automation\agent-team\live-watchdog.mjs'
        Start-Process -FilePath $taskNode -ArgumentList @(('"' + $taskWatchScript + '"'),('"--root=' + $taskRoot + '"'),('--work=' + $WorkId)) -WorkingDirectory $taskRepo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskWorkDir 'watchdog.log') -RedirectStandardError (Join-Path $taskWorkDir 'watchdog-error.log') | Out-Null
    }
    $taskRemoteLock = Join-Path $taskWorkDir 'remote-watchdog.lock'
    $taskRemoteRunning = $false
    if (Test-Path -LiteralPath $taskRemoteLock) {
        try {
            $taskRemotePid = [int](Get-Content -LiteralPath $taskRemoteLock -Raw)
            $taskRemoteRunning = [bool](Get-Process -Id $taskRemotePid -ErrorAction SilentlyContinue)
        } catch { $taskRemoteRunning = $false }
    }
    if (-not $taskRemoteRunning) {
        New-Item -ItemType Directory -Path $taskWorkDir -Force | Out-Null
        $taskRemoteScript = Join-Path $taskRepo 'automation\agent-team\remote-watchdog.mjs'
        Start-Process -FilePath $taskNode -ArgumentList @(('"' + $taskRemoteScript + '"'),('"--root=' + $taskRoot + '"'),('--work=' + $WorkId)) -WorkingDirectory $taskRepo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskWorkDir 'remote-watchdog.log') -RedirectStandardError (Join-Path $taskWorkDir 'remote-watchdog-error.log') | Out-Null
    }
}
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
