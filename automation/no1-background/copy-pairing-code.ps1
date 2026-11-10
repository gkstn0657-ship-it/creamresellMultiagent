$ErrorActionPreference = 'Stop'
$connectionPath = Join-Path $env:LOCALAPPDATA 'CreamNo1Bridge\connection.json'
$connection = Get-Content -LiteralPath $connectionPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($connection.url -ne 'http://127.0.0.1:8871' -or $connection.key -notmatch '^[a-f0-9]{64}$') { throw 'Invalid local connection configuration' }
Set-Clipboard -Value $connection.key
Write-Output 'Local pairing code copied. Paste it into No1 Background Connector. Do not paste it into chat.'
