param([Parameter(Mandatory)][string]$Root,[Parameter(Mandatory)][string]$WorkId,[Parameter(Mandatory)][string]$Label)
$ErrorActionPreference='Stop'
$dir=Join-Path (Join-Path $Root 'explorations') $WorkId
$file=Join-Path $dir 'exploration-watchdog.json'
$receipt=Join-Path $dir 'dashboard-notification.json'
$notifier=Join-Path $PSScriptRoot '../team-board/sourcing_alert.py'
$last=''
if(Test-Path $receipt){$last=(Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json).key}
$mutex=[Threading.Mutex]::new($false,"Local\CreamNotify-$WorkId")
if(!$mutex.WaitOne(0)){exit}
try {
 $unreadableSince=$null
 while($true){
  try {
   try {
    $w=Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    $age=([DateTimeOffset]::UtcNow-[DateTimeOffset]$w.at).TotalSeconds
    $unreadableSince=$null
   } catch {
    if($null -eq $unreadableSince){$unreadableSince=[DateTimeOffset]::UtcNow}
    $age=([DateTimeOffset]::UtcNow-$unreadableSince).TotalSeconds
    $w=$null
   }
   $status=if(!$w.terminal -and $age -gt 120){'감시 응답 지연'}else{switch ($w.status){
    'complete' {'목표 달성'}
    'source_exhausted' {'랭킹 소진'}
    'stopped' {'사용자 요청으로 중지'}
    'waiting' {"연결 대기 ($($w.reason))"}
    'blocked' {"점검 필요 ($($w.reason))"}
    default {if($w.status -in 'watching','restarted'){'실행 중'}}
   }}
   if($status -and $status -ne $last){
    & py -3 -X utf8 $notifier --work $WorkId --label $Label --status $status
    if($LASTEXITCODE -ne 0){throw "Dashboard notification write failed"}
    @{key=$status; sentAt=[DateTimeOffset]::Now.ToString('o'); pid=$PID} | ConvertTo-Json | Set-Content -LiteralPath $receipt -Encoding utf8
    $last=$status
   }
   $pending = & py -3 -X utf8 $notifier --work $WorkId --dispatch
   if($LASTEXITCODE -ne 0){throw "Dashboard action dispatch failed"}
   if($w.terminal){
    # Keep forwarding an outstanding worker result after the exploration ends.
    if($pending -ne 'pending'){break}
   }
  } catch {Write-Warning $_.Exception.Message}
  Start-Sleep -Seconds 10
 }
} finally {$mutex.ReleaseMutex(); $mutex.Dispose()}
