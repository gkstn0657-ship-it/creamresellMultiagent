param([Parameter(Mandatory=$true)][string]$OutputDirectory, [int]$MaxSeconds = 240)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class No1WindowObserver {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr param);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  public static long[] Visible(int[] ids) {
    var pids = new HashSet<int>(ids); var result = new List<long>();
    EnumWindows((hwnd, param) => { uint pid; GetWindowThreadProcessId(hwnd, out pid); if (pids.Contains((int)pid) && IsWindowVisible(hwnd)) result.Add(hwnd.ToInt64()); return true; }, IntPtr.Zero);
    return result.ToArray();
  }
  public static int ForegroundPid() { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return (int)pid; }
}
'@
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$no1Ids = @(Get-Process -Name 'No1 Seller Center' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
if (-not $no1Ids.Count) { throw 'NO1_PROCESS_NOT_RUNNING' }
$baseline = @([No1WindowObserver]::Visible([int[]]$no1Ids))
$baselineForeground = $no1Ids -contains [No1WindowObserver]::ForegroundPid()
$started = [DateTimeOffset]::UtcNow
$ready = @{startedAt=$started.ToString('o'); processCount=$no1Ids.Count; initialVisibleWindowCount=$baseline.Count; initiallyForeground=$baselineForeground}
$ready | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'observer-ready.json') -Encoding UTF8
$samples = 0; $newVisible = @(); $focusChangedToNo1 = $false; $lastPidRefresh = $started
do {
  if (([DateTimeOffset]::UtcNow - $lastPidRefresh).TotalSeconds -ge 1) {
    $no1Ids = @(Get-Process -Name 'No1 Seller Center' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    $lastPidRefresh = [DateTimeOffset]::UtcNow
  }
  $visible = @([No1WindowObserver]::Visible([int[]]$no1Ids))
  foreach ($handle in $visible) { if ($baseline -notcontains $handle -and $newVisible -notcontains $handle) { $newVisible += $handle } }
  if (-not $baselineForeground -and $no1Ids -contains [No1WindowObserver]::ForegroundPid()) { $focusChangedToNo1 = $true }
  $samples++
  Start-Sleep -Milliseconds 100
} while (-not (Test-Path -LiteralPath (Join-Path $OutputDirectory 'STOP-OBSERVER')) -and ([DateTimeOffset]::UtcNow - $started).TotalSeconds -lt $MaxSeconds)
@{startedAt=$started.ToString('o'); finishedAt=[DateTimeOffset]::UtcNow.ToString('o'); samples=$samples; newVisibleNo1WindowCount=$newVisible.Count; focusChangedToNo1=$focusChangedToNo1; initiallyForeground=$baselineForeground; observationPassed=($newVisible.Count -eq 0 -and -not $focusChangedToNo1); limitation='100ms sampling; current session observation, not a guarantee for every future app state'; uiOperationsPerformed=$false} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'window-observation.json') -Encoding UTF8
