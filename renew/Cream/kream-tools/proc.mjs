// 감시자·릴레이·시작 도구가 함께 쓰는 프로세스 함수 (2026-11-07)
//  launchDetached: 부모(감시자, Claude Code 세션)가 꺼져도 살아남는 숨김 프로세스로 node 스크립트를 실행한다.
//                  Windows 는 WMI(Win32_Process.Create)로 띄워 부모의 프로세스 묶음 밖에서 돌게 하고 cmd 창을 숨긴다.
//  alive / cmdline / portOwner: 프로세스 확인. toast: Windows 알림 띄우기(기다리지 않음).
import fs from 'node:fs'; import path from 'node:path'; import { spawn, spawnSync, execSync } from 'node:child_process';
export const TOOLS = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
export const ROOT = path.join(TOOLS, '..');
export const RELAY_VERSION = 2;   // 릴레이 코드가 바뀌면 올린다. 감시자는 이보다 낮은 릴레이를 예전 버전으로 보고 다시 띄움
export const LOCK = path.join(ROOT, 'kream-runs', 'watchdog.lock');
const ps = (script, wait = true) => {
  const args = ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
  if (wait) return spawnSync('powershell', args, { encoding: 'utf8', windowsHide: true });
  spawn('powershell', args, { windowsHide: true, detached: true, stdio: 'ignore' }).unref(); return null;
};
export function launchDetached(name, args, cwd, logFile) {
  if (process.platform === 'win32') {
    const cmdFile = path.join(path.dirname(logFile), `start-${name}.cmd`);
    fs.writeFileSync(cmdFile, `@echo off\r\n${[process.execPath, ...args].map((a) => `"${a}"`).join(' ')} >> "${logFile}" 2>&1\r\n`);
    const r = ps(`$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }; $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = 'cmd /c "${cmdFile}"'; CurrentDirectory = '${cwd}'; ProcessStartupInformation = $si }; $r.ProcessId`);
    return Number(String(r.stdout || '').trim()) || null;
  }
  const fd = fs.openSync(logFile, 'a'); const c = spawn(process.execPath, args, { cwd, detached: true, stdio: ['ignore', fd, fd] }); c.unref(); return c.pid;
}
export function alive(pid) { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
export function cmdline(pid) {
  try {
    if (process.platform === 'win32') return String(ps(`(Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}').CommandLine`).stdout || '').trim();
    return execSync(`ps -o args= -p ${Number(pid)}`, { encoding: 'utf8' }).trim();
  } catch { return ''; }
}
export function portOwner(port = 8787) {
  try {
    if (process.platform === 'win32') { const o = execSync('netstat -ano -p tcp', { encoding: 'utf8' }); const l = o.split(/\r?\n/).find((x) => new RegExp(`127\\.0\\.0\\.1:${port}\\s`).test(x) && /LISTEN/.test(x)); return l ? Number(l.trim().split(/\s+/).pop()) : null; }
    const p = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' }).trim(); return p ? Number(p.split('\n')[0]) : null;
  } catch { return null; }
}
export function toast(title, body) {
  if (process.platform !== 'win32') return;
  const q = (s) => String(s).replace(/'/g, "''").slice(0, 200);
  ps(`[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$x = $t.GetElementsByTagName('text'); $x.Item(0).AppendChild($t.CreateTextNode('${q(title)}')) > $null; $x.Item(1).AppendChild($t.CreateTextNode('${q(body)}')) > $null
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($t))`, false);
}
export function readLock() { try { return JSON.parse(fs.readFileSync(LOCK, 'utf8')); } catch { return null; } }
export const sameDir = (a, b) => path.resolve(String(a)).toLowerCase() === path.resolve(String(b)).toLowerCase();
