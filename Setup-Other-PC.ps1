param([switch]$SkipInstall, [switch]$CheckOnly, [switch]$WithBrowserTests)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-Cream.ps1')
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 and reopen PowerShell.' }
'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(":memory:");db.close(); console.log("Node",process.versions.node)' | node -
if ($LASTEXITCODE -ne 0) { throw 'Node.js with node:sqlite support is required. Install Node.js 24.' }
$creamVenvPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (Test-Path -LiteralPath $creamVenvPython) { $creamInterpreter = $creamVenvPython }
elseif (Get-Command py -ErrorAction SilentlyContinue) { $creamInterpreter = & py -3 -c 'import sys; print(sys.executable)' }
elseif (Get-Command python -ErrorAction SilentlyContinue) { $creamInterpreter = (Get-Command python).Source }
else { throw 'Install Python 3.10+ and reopen PowerShell.' }
& $creamInterpreter -I -c 'import sys; sys.exit(sys.version_info < (3,10))'
if ($LASTEXITCODE -ne 0) { throw 'Python 3.10 or later is required.' }
if (-not $SkipInstall -and -not $CheckOnly) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.venv\Scripts\python.exe'))) {
        & $creamInterpreter -m venv (Join-Path $PSScriptRoot '.venv')
        if ($LASTEXITCODE -ne 0) { throw 'Python venv creation failed.' }
    }
    . (Join-Path $PSScriptRoot 'Use-Cream.ps1')
    $creamInterpreter = $creamVenvPython
    & $creamInterpreter -m pip install -r (Join-Path $PSScriptRoot 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
'import sys,requests,bs4,lxml,openpyxl; print("Python",sys.version.split()[0],"openpyxl",openpyxl.__version__)' | & $creamInterpreter -I -
if ($LASTEXITCODE -ne 0) { throw 'Missing Python packages. Run Setup-Other-PC.ps1 without -SkipInstall.' }
if (Get-Command codex -ErrorAction SilentlyContinue) { codex --version }
else { Write-Warning 'Codex CLI is missing. Install/sign in on this PC before live AI workers can run. Offline checks remain available.' }
if ($CheckOnly) { Write-Host 'Read-only environment check complete.'; exit 0 }
if ($WithBrowserTests -and -not $SkipInstall) {
    & npm.cmd ci --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Browser test dependency installation failed.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'sourcing-policy.json'))) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'sourcing-policy.example.json') -Destination (Join-Path $PSScriptRoot 'sourcing-policy.json')
}
$creamRelayDir = Join-Path $PSScriptRoot 'kream-runs\pc-relay'
New-Item -ItemType Directory -Force -Path $creamRelayDir | Out-Null
$creamUtf8 = New-Object System.Text.UTF8Encoding($false)
if (-not (Test-Path -LiteralPath (Join-Path $creamRelayDir 'jobs.json'))) {
    [IO.File]::WriteAllText((Join-Path $creamRelayDir 'jobs.json'), '{"jobs":[]}', $creamUtf8)
}
$creamConfig = @{ relayRunDir = $creamRelayDir; source = 'this-pc-setup' } | ConvertTo-Json
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'sourcing-runtime.json'))) {
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'sourcing-runtime.json'), $creamConfig, $creamUtf8)
}
# Keep historical n8n exports intact; create a local-path copy, inactive.
$creamWorkflow = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'n8n-agent-cream-workflow.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$creamContextNode = $creamWorkflow.nodes | Where-Object { $_.id -eq 'run-context' }
($creamContextNode.parameters.assignments.assignments | Where-Object { $_.name -eq 'project_root' }).value = $PSScriptRoot
$creamPythonExe = $creamInterpreter
$creamExecuteNode = $creamWorkflow.nodes | Where-Object { $_.id -eq 'execute-pilot' }
$creamExecuteNode.parameters.command = '=cd /d "{{ $json.project_root }}" && "' + $creamPythonExe + '" "{{ $json.project_root }}\pilot.py"'
$creamWorkflow.active = $false
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'n8n-agent-cream-this-pc.json'), ($creamWorkflow | ConvertTo-Json -Depth 40), $creamUtf8)
Write-Host 'Setup complete. Run Test-Other-PC.ps1, then Start-TeamBoard.cmd. See README.md for Chrome and MCP setup.'
