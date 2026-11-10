param([string]$Message = '상품 탐색 상태를 확인해 주세요.')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$taskIcon = New-Object System.Windows.Forms.NotifyIcon
try {
    $taskIcon.Icon = [System.Drawing.SystemIcons]::Warning
    $taskIcon.Text = 'Cream 탐색 감시'
    $taskIcon.Visible = $true
    $taskIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Warning
    $taskIcon.BalloonTipTitle = 'Cream 탐색 상태 알림'
    $taskIcon.BalloonTipText = $Message
    $taskIcon.ShowBalloonTip(8000)
    Start-Sleep -Seconds 9
} finally { $taskIcon.Dispose() }
