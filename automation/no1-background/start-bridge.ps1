$ErrorActionPreference = 'Stop'
$configPath = Join-Path $env:LOCALAPPDATA 'CreamNo1Bridge\connection.json'
$node = (Get-Command node -ErrorAction Stop).Source

function Test-CreamBridge {
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { return $false }
    $config = Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath | ConvertFrom-Json
    if ($config.url -ne 'http://127.0.0.1:8871' -or $config.key -notmatch '^[a-f0-9]{64}$') {
        throw 'Invalid local No1 bridge configuration.'
    }
    try {
        $reply = Invoke-RestMethod -Uri 'http://127.0.0.1:8871/status' -MaximumRedirection 0 -TimeoutSec 2 -Headers @{'X-No1-Bridge-Key' = $config.key}
        return ($reply.transport -eq 'chrome-official-relay' -and $reply.browserConnected -is [bool])
    } catch { return $false }
}

if (Test-CreamBridge) { Write-Output 'No1 local bridge is ready.'; return }
$entry = Join-Path $PSScriptRoot 'run-bridge.mjs'
$process = Start-Process -FilePath $node -ArgumentList ('"' + $entry + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 200
    if (Test-CreamBridge) { Write-Output 'No1 local bridge is ready.'; return }
    if ($process.HasExited) { break }
}
throw 'The local No1 bridge could not open port 8871 or verify its local configuration.'
