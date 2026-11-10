$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$creamVenv = Join-Path $PSScriptRoot '.venv\Scripts'
if (Test-Path -LiteralPath (Join-Path $creamVenv 'python.exe')) {
    $env:PATH = $creamVenv + [IO.Path]::PathSeparator + $env:PATH
}
$env:PYTHONIOENCODING = 'utf-8'
