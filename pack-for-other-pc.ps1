param([string]$Destination)
$ErrorActionPreference = 'Stop'
if (-not $Destination) { $Destination = Join-Path $PSScriptRoot ('Cream-other-pc-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip') }
& python (Join-Path $PSScriptRoot 'tools\pack_workspace.py') --root $PSScriptRoot --output $Destination
if ($LASTEXITCODE -ne 0) { throw 'Portable archive creation failed.' }
& python (Join-Path $PSScriptRoot 'tools\pack_workspace.py') --verify $Destination
if ($LASTEXITCODE -ne 0) { throw 'Portable archive integrity check failed.' }
