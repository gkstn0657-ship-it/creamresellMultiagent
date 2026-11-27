$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-Cream.ps1')
node (Join-Path $PSScriptRoot 'renew\Cream\kream-tools\preflight.mjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node --test 'automation/agent-team/source-availability.test.mjs' 'automation/agent-team/daily-report.test.mjs' 'automation/no1-background/protocol.test.mjs'
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
python -X utf8 -m unittest discover -s 'automation/team-board' -p 'test_*.py'
exit $LASTEXITCODE
