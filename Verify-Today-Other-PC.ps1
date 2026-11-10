$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$no1Exe = Join-Path $env:LOCALAPPDATA 'Programs\no1-center-electron\No1 Seller Center.exe'
$extension = Get-Content -LiteralPath (Join-Path $root 'naver-extension\manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($extension.version -ne '0.4.8') { throw 'The bundled Chrome extension must be version 0.4.8.' }
if (-not (Test-Path -LiteralPath $no1Exe)) { throw "Install No1 Seller Center for this Windows account: $no1Exe" }
$psFiles = Get-ChildItem (Join-Path $root 'automation\no1-mcp-prototype') -Filter '*.ps1'
foreach ($file in $psFiles) {
  $tokens = $null; $errors = $null
  $source = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
  [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors.Count) { throw "No1 UI bridge syntax error: $($file.Name)" }
}

& (Join-Path $root 'Test-Other-PC.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Existing project preflight failed.' }

$tests = @(
  'automation/no1-first.test.mjs',
  'automation/no1-first-runner.test.mjs',
  'automation/no1-mcp-prototype/server.test.mjs',
  'automation/no1-mcp-prototype/server-general.test.mjs',
  'automation/no1-mcp-prototype/server-stock.test.mjs',
  'automation/no1-mcp-prototype/navigation-evidence.test.mjs',
  'automation/automation.test.mjs'
)
& node --test $tests
if ($LASTEXITCODE -ne 0) { throw 'No1 and report regression tests failed.' }

$doctor = & node (Join-Path $root 'automation\commander.mjs') doctor | Out-String | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Commander doctor failed.' }
if ($doctor.codexSignedIn -ne $true) { throw 'Sign in to Codex CLI with ChatGPT on this PC.' }

[pscustomobject]@{
  verified = $true
  projectRoot = $root
  extensionVersion = $extension.version
  no1Executable = $no1Exe
  codexSignedIn = $doctor.codexSignedIn
  note = 'Chrome extension activation, No1 login, Dot computer connection, and live matching-product evidence require manual verification.'
} | ConvertTo-Json -Depth 3
