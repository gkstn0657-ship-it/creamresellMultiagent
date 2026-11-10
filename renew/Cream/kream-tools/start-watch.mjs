// 감시 켜기/끄기 (2026-11-07). 릴레이와 감시자를 숨김 백그라운드로 띄우고 서로 지키게 한다.
//   켜기:  node kream-tools/start-watch.mjs <run-dir>
//          → <run-dir>/watchdog.enabled 생성, 릴레이가 이 폴더를 최신 버전으로 서비스 중이 아니면 다시 띄움, 감시자(--fix) 실행.
//            Claude Code 세션이나 이 창을 닫아도 계속 돈다. 감시자가 죽으면 릴레이가, 릴레이가 죽으면 감시자가 다시 띄운다.
//   끄기:  node kream-tools/start-watch.mjs <run-dir> --stop        → 감시자 종료·서로 지키기 해제(릴레이는 유지)
//          node kream-tools/start-watch.mjs <run-dir> --stop --all  → 릴레이까지 종료
//   상태:  node kream-tools/start-watch.mjs <run-dir> --status
import fs from 'node:fs'; import path from 'node:path';
import { TOOLS, ROOT, RELAY_VERSION, launchDetached, alive, cmdline, portOwner, readLock, sameDir } from './proc.mjs';
const args = process.argv.slice(2); const dirArg = args.find((a) => !a.startsWith('--'));
if (!dirArg) { console.error('사용: node kream-tools/start-watch.mjs <run-dir> [--stop [--all] | --status]'); process.exit(1); }
const runDir = path.resolve(dirArg); const ENABLED = path.join(runDir, 'watchdog.enabled');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const health = async () => { try { const r = await fetch('http://127.0.0.1:8787/health', { signal: AbortSignal.timeout(3000) }); return r.ok ? await r.json() : { outdated: true }; } catch { return null; } };
const killIf = (pid, re, label) => { if (!pid || !alive(pid)) return false; const cl = cmdline(pid); if (!re.test(cl)) { console.log(`${label} PID ${pid} 는 예상한 프로그램이 아니라 끄지 않음: ${cl.slice(0, 100)}`); return false; } try { process.kill(pid); } catch {} return true; };
const status = async () => {
  const h = await health(); const l = readLock();
  console.log(`릴레이: ${!h ? '꺼짐' : h.outdated ? '예전 버전' : `PID ${h.pid}, 버전 ${h.version}, 폴더 ${sameDir(h.dir, runDir) ? '일치' : '다름 → ' + h.dir}, 남은 작업 ${h.pending}/${h.total}`}`);
  console.log(`감시자: ${l && alive(l.pid) ? `PID ${l.pid}, 폴더 ${sameDir(l.runDir, runDir) ? '일치' : '다름 → ' + l.runDir}` : '꺼짐'} | 서로 지키기: ${fs.existsSync(ENABLED) ? '켬' : '끔'}`);
};

if (args.includes('--status')) { await status(); process.exit(0); }
if (args.includes('--stop')) {
  try { fs.unlinkSync(ENABLED); } catch {}
  const l = readLock(); if (l && sameDir(l.runDir, runDir) && killIf(l.pid, /watchdog\.mjs/, '감시자')) console.log(`감시자 종료(PID ${l.pid})`);
  if (args.includes('--all')) { const h = await health(); if (h && h.pid && killIf(h.pid, /relay-server\.mjs/, '릴레이')) console.log(`릴레이 종료(PID ${h.pid})`); }
  await sleep(800); await status(); process.exit(0);
}

if (!fs.existsSync(runDir)) { console.error(`실행 폴더가 없음: ${runDir}`); process.exit(1); }
const l0 = readLock();
if (l0 && alive(l0.pid) && !sameDir(l0.runDir, runDir) && /watchdog\.mjs/.test(cmdline(l0.pid))) { console.error(`다른 폴더(${l0.runDir})를 감시하는 감시자가 실행 중. 먼저: node kream-tools/start-watch.mjs "${l0.runDir}" --stop`); process.exit(2); }
fs.writeFileSync(ENABLED, new Date().toISOString());
let h = await health();
if (!h || h.outdated || (h.version || 1) < RELAY_VERSION || !sameDir(h.dir, runDir)) {
  const pid = portOwner();
  if (pid && !killIf(pid, /relay-server\.mjs/, '8787 포트 사용 프로그램')) { console.error('8787 포트를 다른 프로그램이 쓰고 있어 릴레이를 띄울 수 없음'); process.exit(2); }
  if (pid) await sleep(1200);
  launchDetached('relay', [path.join(TOOLS, 'relay-server.mjs'), runDir], ROOT, path.join(runDir, 'relay.log'));
  await sleep(2500); h = await health();
  console.log(h && sameDir(h.dir, runDir) ? `릴레이 시작(PID ${h.pid}, 버전 ${h.version})` : '릴레이 시작 실패: relay.log 확인');
} else console.log(`릴레이 그대로 사용(PID ${h.pid}, 버전 ${h.version})`);
const l = readLock();
if (l && alive(l.pid) && sameDir(l.runDir, runDir)) console.log(`감시자 그대로 사용(PID ${l.pid})`);
else { launchDetached('watchdog', [path.join(TOOLS, 'watchdog.mjs'), runDir, '--fix'], ROOT, path.join(runDir, 'watchdog.out.log')); await sleep(2500); }
await status();
console.log(`기록: ${path.join(runDir, 'watchdog.log')}`);
