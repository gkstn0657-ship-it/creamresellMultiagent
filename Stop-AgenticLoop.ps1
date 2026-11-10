$ErrorActionPreference = 'Stop'
$creamConfigFile = Join-Path $PSScriptRoot 'automation\loop-config.json'
$creamLoopConfig = Get-Content -LiteralPath $creamConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
$creamLoopRoot = [IO.Path]::GetFullPath((Join-Path (Split-Path $creamConfigFile) $creamLoopConfig.runRoot))
if (-not (Test-Path -LiteralPath $creamLoopRoot)) { New-Item -ItemType Directory -Path $creamLoopRoot -Force | Out-Null }
[IO.File]::WriteAllText((Join-Path $creamLoopRoot 'STOP'), 'User requested stop', [Text.UTF8Encoding]::new($false))
Write-Host 'STOP recorded. The current read-only operation will finish, then the loop will stop.'
