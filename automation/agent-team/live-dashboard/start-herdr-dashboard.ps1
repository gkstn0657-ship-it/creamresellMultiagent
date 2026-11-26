param([int]$Port = 8875)
$ErrorActionPreference = 'Stop'
$taskRepo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
$taskNode = (Get-Command node -ErrorAction Stop).Source
$taskLog = Join-Path $taskRepo 'kream-runs\herdr-dashboard'
New-Item -ItemType Directory -Path $taskLog -Force | Out-Null
$taskUrl = "http://127.0.0.1:$Port"
try {
    $taskHealth = Invoke-RestMethod "$taskUrl/health" -TimeoutSec 2
    if ($taskHealth.app -eq 'cream-musinsa-live-dashboard-v1') {
        Invoke-RestMethod "$taskUrl/api/herdr" -TimeoutSec 2 | Out-Null
        Write-Output "$taskUrl/herdr"
        exit 0
    }
} catch { }
# Starts only the dashboard. Never resumes sourcing or launches No1.
Start-Process -FilePath $taskNode -ArgumentList @('automation/agent-team/live-dashboard/server.mjs', "--port=$Port") -WorkingDirectory $taskRepo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskLog 'stdout.log') -RedirectStandardError (Join-Path $taskLog 'stderr.log') | Out-Null
for ($taskAttempt = 0; $taskAttempt -lt 20; $taskAttempt++) {
    Start-Sleep -Milliseconds 250
    try { Invoke-RestMethod "$taskUrl/api/herdr" -TimeoutSec 2 | Out-Null; Write-Output "$taskUrl/herdr"; exit 0 } catch { }
}
throw 'DASHBOARD_START_FAILED: inspect kream-runs/herdr-dashboard/stderr.log'
