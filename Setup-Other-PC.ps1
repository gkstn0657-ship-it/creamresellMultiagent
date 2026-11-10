param([switch]$SkipInstall, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-Cream.ps1')
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 20+ and reopen PowerShell.' }
'if(Number(process.versions.node.split(".")[0])<20)process.exit(1);console.log("Node",process.versions.node)' | node -
if ($LASTEXITCODE -ne 0) { throw 'Node.js 20+ is required.' }
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw 'Install Python with PATH enabled and reopen PowerShell.' }
if (-not $SkipInstall -and -not $CheckOnly) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.venv\Scripts\python.exe'))) {
        python -m venv (Join-Path $PSScriptRoot '.venv')
        if ($LASTEXITCODE -ne 0) { throw 'Python venv creation failed.' }
    }
    . (Join-Path $PSScriptRoot 'Use-Cream.ps1')
    python -m pip install -r (Join-Path $PSScriptRoot 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
'import sys,requests,bs4,lxml,openpyxl; print("Python",sys.version.split()[0],"openpyxl",openpyxl.__version__)' | python -I -
if ($LASTEXITCODE -ne 0) { throw 'Missing Python packages. Run Setup-Other-PC.ps1 without -SkipInstall.' }
if (Get-Command codex -ErrorAction SilentlyContinue) { codex --version }
else { Write-Warning 'Codex CLI is missing. Install/sign in on this PC before live AI workers can run. Offline checks remain available.' }
if ($CheckOnly) { Write-Host 'Read-only environment check complete.'; exit 0 }
$creamRelayDir = Join-Path $PSScriptRoot 'kream-runs\pc-relay'
New-Item -ItemType Directory -Force -Path $creamRelayDir | Out-Null
$creamUtf8 = New-Object System.Text.UTF8Encoding($false)
if (-not (Test-Path -LiteralPath (Join-Path $creamRelayDir 'jobs.json'))) {
    [IO.File]::WriteAllText((Join-Path $creamRelayDir 'jobs.json'), '{"jobs":[]}', $creamUtf8)
}
$creamConfig = @{ relayRunDir = $creamRelayDir; source = 'this-pc-setup' } | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'sourcing-runtime.json'), $creamConfig, $creamUtf8)
# Keep historical n8n exports intact; create a local-path copy, inactive.
$creamWorkflow = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'n8n-agent-cream-workflow.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$creamContextNode = $creamWorkflow.nodes | Where-Object { $_.id -eq 'run-context' }
($creamContextNode.parameters.assignments.assignments | Where-Object { $_.name -eq 'project_root' }).value = $PSScriptRoot
$creamPythonExe = (Get-Command python).Source
$creamExecuteNode = $creamWorkflow.nodes | Where-Object { $_.id -eq 'execute-pilot' }
$creamExecuteNode.parameters.command = '=cd /d "{{ $json.project_root }}" && "' + $creamPythonExe + '" "{{ $json.project_root }}\pilot.py"'
$creamWorkflow.active = $false
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'n8n-agent-cream-this-pc.json'), ($creamWorkflow | ConvertTo-Json -Depth 40), $creamUtf8)
Write-Host 'Setup complete. Read TODAY-OTHER-PC.md, load naver-extension in Chrome, and sign in to KREAM/Naver/Codex.'
