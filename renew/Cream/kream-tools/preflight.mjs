// 실행 전 점검 (2026-11-07): 사이트에 접속하기 전에 1분 안에 사고를 막는다.
// 사용: node kream-tools/preflight.mjs <run-dir> [--need-relay] [--keep]
//   run-all 이 시작할 때 자동으로 부른다(--need-relay). 실패 항목이 하나라도 있으면 종료 코드 1.
//   점검: ① Node·Python·openpyxl ② 모든 스크립트 문법 ③ 코드 대조·배송비·포인트 단위 시험
//         ④ 가짜 상품 3개로 전체 흐름(run-all --replay) 재생 → 판정·엑셀까지 나오는지(실행 중 에러를 여기서 잡음)
//         ⑤ 릴레이: 켜져 있는지, 최신 버전인지, 이 폴더를 서비스하는지, 8787 포트를 다른 프로그램이 잡고 있지 않은지
//         ⑥ 확장 접속, STOP 파일, 감시자 상태
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
import { TOOLS, ROOT, RELAY_VERSION, alive, cmdline, portOwner, readLock, sameDir } from './proc.mjs';
const args = process.argv.slice(2); const dirArg = args.find((a) => !a.startsWith('--'));
const runDir = dirArg ? path.resolve(dirArg) : null; const NEED_RELAY = args.includes('--need-relay'); const KEEP = args.includes('--keep');
const results = []; const add = (level, name, msg = '') => { results.push({ level, name, msg }); console.log(`[${level}] ${name}${msg ? ' — ' + msg : ''}`); };
const PASS = (n, m) => add('통과', n, m), WARN = (n, m) => add('주의', n, m), FAIL = (n, m) => add('실패', n, m);

// ① 환경
const nodeMajor = Number(process.versions.node.split('.')[0]); nodeMajor >= 20 ? PASS('Node', process.versions.node) : FAIL('Node', `${process.versions.node} (20 이상 필요)`);
const py = spawnSync('python', ['-I', '-c', `import sys, openpyxl; compile(open(r'${path.join(TOOLS, 'export-xlsx.py')}', encoding='utf-8').read(), 'export-xlsx.py', 'exec'); print(sys.version.split()[0], openpyxl.__version__)`], { encoding: 'utf8' });
py.status === 0 ? PASS('Python·openpyxl·엑셀 스크립트', py.stdout.trim()) : FAIL('Python·openpyxl·엑셀 스크립트', (py.stderr || py.error || '').toString().split('\n').slice(-2).join(' ').slice(0, 200));

// ② 문법
const scripts = [...fs.readdirSync(TOOLS).filter((f) => f.endsWith('.mjs')).map((f) => path.join(TOOLS, f)), ...(fs.existsSync(path.join(ROOT, 'naver-extension')) ? fs.readdirSync(path.join(ROOT, 'naver-extension')).filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, 'naver-extension', f)) : [])];
const bad = scripts.filter((f) => spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }).status !== 0).map((f) => path.basename(f));
bad.length ? FAIL('스크립트 문법', bad.join(', ')) : PASS('스크립트 문법', `${scripts.length}개`);

// ③ 단위 시험
try {
  const { codeMatch, parseShip, parsePoints } = await import('./code-match.mjs');
  const t = [
    [codeMatch('801563051-A0029', '스톤아일랜드 801563051-A0029 니트').code, 'exact', '코드 정확 일치'],
    [codeMatch('801563051-A0029', '스톤아일랜드 801563051 A0029').code, 'spacing', '띄어쓰기 차이'],
    [codeMatch('801563051-A0029', '스톤아일랜드 801563051-V0020').code, false, '색상 코드 불일치'],
    [parseShip('무료'), 0, '배송비 무료'], [parseShip('3,000원'), 3000, '배송비 3,000원'], [parsePoints('포인트 최대 17,500원', 350000).won, 17500, '최대 적립 포인트'],
  ];
  const wrong = t.filter(([got, want]) => got !== want).map(([got, want, n]) => `${n}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
  wrong.length ? FAIL('코드 대조·배송비·포인트', wrong.join(' / ')) : PASS('코드 대조·배송비·포인트', `${t.length}개 시험`);
} catch (e) { FAIL('코드 대조·배송비·포인트', String(e.message || e)); }

// ③-2 네이버 API 변환(fixture, 네트워크 없음): 해외직구·중고·색상불일치 제외, 정확/띄어쓰기 일치만 상위 N
try {
  const os = await import('node:os');
  const fx = fs.mkdtempSync(path.join(os.tmpdir(), 'kream-napi-'));
  const items = [
    { title: '스톤아일랜드 701563051-A0029 니트 블랙', lprice: '240000', mallName: '롯데ON', productType: '2', link: 'x/a', productId: '1' },
    { title: '해외 스톤아일랜드 701563051-A0029', lprice: '200000', mallName: '해외구매대행', productType: '2', link: 'x/b', productId: '2' },
    { title: '중고 스톤아일랜드 701563051-A0029', lprice: '150000', mallName: '중고', productType: '5', link: 'x/c', productId: '3' },
    { title: '스톤아일랜드 701563051-V0099 네이비', lprice: '230000', mallName: '롯데ON', productType: '2', link: 'x/d', productId: '4' },
  ];
  fs.writeFileSync(path.join(fx, 'fx.json'), JSON.stringify({ items }));
  fs.writeFileSync(path.join(fx, 'k50.json'), JSON.stringify([{ id: '700000001', title: '점검', model: '701563051-A0029', n: 30, kreamMed: 300000, q1: '701563051 A0029', sizes: {} }]));
  const r = spawnSync(process.execPath, [path.join(TOOLS, 'naver-api.mjs'), fx, '--fixture=' + path.join(fx, 'fx.json'), '--top=3'], { encoding: 'utf8' });
  if (r.status !== 0) FAIL('네이버 API 변환', (r.stderr || r.stdout || '').trim().split(/\r?\n/)[0].slice(0, 160));
  else { const o = JSON.parse(fs.readFileSync(path.join(fx, 'n-cards.json'), 'utf8'))['700000001'];
    const m = o.matched; const ok = m.length === 1 && m[0].codeType === 'exact' && !m.some((c) => c.overseas || c.used);
    ok ? PASS('저장된 API 응답 변환(라이브 종료)', '해외·중고·색상불일치 제외, 정확 일치 1개') : FAIL('네이버 API 변환', '필터 결과 예상과 다름: ' + JSON.stringify(m.map((c) => c.title)).slice(0, 120)); }
  fs.rmSync(fx, { recursive: true, force: true });
} catch (e) { FAIL('네이버 API 변환', String(e.message || e).slice(0, 160)); }

// ④ 전체 흐름 재생(가짜 상품 3개, 사이트 접속 없음)
const agentsTest = spawnSync(process.execPath, ['--test', ...['agents.test.mjs','agents-batch.test.mjs','agents-extract.test.mjs','agents-faults.test.mjs','agents-team.test.mjs','naver-search-mode.test.mjs','kream-list-url.test.mjs','margin-screen.test.mjs'].map(f => path.join(TOOLS,'tests',f))], { encoding: 'utf8', timeout: 60000 });
agentsTest.status === 0 ? PASS('6개 에이전트 회귀 검증', '옵션·판매자·대체 탐색·감사·성과·실패 처리') : FAIL('6개 에이전트 회귀 검증', String(agentsTest.stdout || agentsTest.stderr || agentsTest.error).slice(-1000));
const fx = fs.mkdtempSync(path.join(os.tmpdir(), 'kream-preflight-'));
try {
  const W = (f, o) => fs.writeFileSync(path.join(fx, f), typeof o === 'string' ? o : JSON.stringify(o));
  const prods = [
    { id: '900000001', model: '900000001-A0029', title: '스톤아일랜드 900000001-A0029 니트', price: 200000, expect: (r) => r['판정'] === '사람 검토' && /판매처·옵션별 검증/.test(r['사유']), want: '사람 검토(필수 증빙 없음)' },
    { id: '900000002', model: '900000002-V0029', title: '스톤아일랜드 900000002-V0020 니트', price: 150000, expect: (r) => r['판정'] === '사람 검토' && /일치 신품 미확인/.test(r['사유']), want: '추가 탐색(수집 매물은 색상 불일치)' },
    { id: '900000003', model: '900000003-A0029', title: '스톤아일랜드 900000003-A0029 니트', price: 320000, expect: (r) => r['판정'] === '제외' && /사이즈별.*마진 부족/.test(r['사유']), want: '제외(관측 옵션 마진 부족)' },
  ];
  W('k50-ids.json', prods.map((p) => p.id)); W('jobs.json', { jobs: [] });
  const k50 = prods.map((p) => ({ id: p.id, title: `[점검] ${p.title}`, model: p.model, n: 30, kreamMed: 300000, sizes: {}, q1: p.model.replace(/-/g, ' '), q2: null, fmtOk: false }));
  W('k50.json', k50); W('k50-all.json', k50);
  W('agent-policy.json', { costPolicyConfirmed: true, costPolicySource: 'SYNTHETIC TEST ONLY', costPolicyVersion: 'preflight-v2' });
  W('chart.json', Object.fromEntries(prods.map((p) => [p.id, { 분류: '횡보', 판단: '매수 가능', 점수: 0, 근거: ['점검용'], 지표: { 최근30일체결: 10 }, 구분: '통과', strict: { 구분: '통과', 판단: '매수 가능' } }])));
  for (const p of prods) {
    W(`dump-K${p.id}.json`, { at: new Date().toISOString(), text: '거래일\n' + Array.from({ length: 5 }, () => 'S\n300,000원\n오늘').join('\n') });
    const chunks = ['검색결과', '찜하기1', [p.title, `${p.price.toLocaleString('en-US')}원`, '배송비', '무료', '판매처 3'].join('\n'), ['쇼핑몰별 최저가', '롯데ON', p.price.toLocaleString('en-US')].join('\n')];
    W(`dump-N${p.id}-s.json`, { url: 'preflight', title: p.title, text: chunks.join('\n\t\n'), links: [] });
  }
  const r = spawnSync(process.execPath, [path.join(TOOLS, 'run-all.mjs'), fx, '--replay', '--skip-kream', '--max-prod=8'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  const tail = ((r.stdout || '') + (r.stderr || '')).split('\n').filter(Boolean).slice(-3).join(' / ').slice(0, 300);
  if (r.status !== 0) FAIL('전체 흐름 재생', `실행 스크립트가 에러로 멈춤: ${tail}`);
  else {
    const fin = JSON.parse(fs.readFileSync(path.join(fx, 'final-all.json'), 'utf8')).rows;
    const wrong = prods.filter((p) => { const row = fin.find((x) => x['크림ID'] === p.id); return !row || !p.expect(row); }).map((p) => { const row = fin.find((x) => x['크림ID'] === p.id); return `${p.id}: 기대 ${p.want}, 실제 ${row ? row['판정'] + ' / ' + String(row['사유']).slice(0, 40) : '행 없음'}`; });
    const xlsx = fs.readdirSync(fx).find((f) => f.endsWith('.xlsx'));
    if (wrong.length) FAIL('전체 흐름 재생', `판정이 기대와 다름: ${wrong.join(' / ')}`);
    else if (!xlsx) FAIL('전체 흐름 재생', `엑셀이 만들어지지 않음: ${tail}`);
    else PASS('전체 흐름 재생', '가짜 상품 3개 → 검색 해석·마진·판정·엑셀 정상');
  }
} catch (e) { FAIL('전체 흐름 재생', String(e.message || e).slice(0, 200)); }
finally { if (!KEEP) try { fs.rmSync(fx, { recursive: true, force: true }); } catch {} else console.log('   재생 폴더 보존:', fx); }

// ⑤ 릴레이·포트 ⑥ 확장·STOP·감시자
if (runDir) {
  if (!fs.existsSync(runDir)) FAIL('실행 폴더', `없음: ${runDir}`);
  else {
    try { JSON.parse(fs.readFileSync(path.join(runDir, 'jobs.json'), 'utf8')); PASS('실행 폴더', runDir); } catch { fs.existsSync(path.join(runDir, 'jobs.json')) ? FAIL('실행 폴더', 'jobs.json 을 읽을 수 없음(깨진 JSON)') : PASS('실행 폴더', `${runDir} (jobs.json 은 실행 중 생성)`); }
    if (fs.existsSync(path.join(runDir, 'STOP'))) WARN('STOP 파일', '차단 감지로 멈춘 상태. 사람이 확인한 뒤 /resume 필요');
  }
  let h = null; try { const r = await fetch('http://127.0.0.1:8787/health', { signal: AbortSignal.timeout(3000) }); h = r.ok ? await r.json() : { outdated: true }; } catch {}
  const owner = portOwner();
  if (!h) {
    if (owner) { const cl = cmdline(owner); /relay-server\.mjs/.test(cl) ? FAIL('릴레이', `8787 포트는 릴레이(PID ${owner})가 잡고 있는데 응답이 없음. 그 프로세스를 끄고 다시 띄우세요`) : FAIL('8787 포트', `다른 프로그램(PID ${owner})이 사용 중: ${cl.slice(0, 100)}`); }
    else (NEED_RELAY ? FAIL : WARN)('릴레이', `꺼짐. 켜기: node kream-tools/start-watch.mjs ${runDir}`);
  } else if ((h.outdated || (h.version || 1) < RELAY_VERSION) && args.includes('--verified-legacy-relay')) {
    try {
      const {RelayTransport} = await import('../../../kream-tools/relay-transport.mjs');
      const transport = new RelayTransport(runDir,runDir); await transport.verify();
      if (transport.stopped()) throw new Error('STOP 감지');
      const response = await fetch('http://127.0.0.1:8787/jobs',{signal:AbortSignal.timeout(3000)});
      if (!response.ok || !Array.isArray((await response.json()).jobs)) throw new Error('작업 큐 응답 오류');
      PASS('기존 릴레이 연결','실행 폴더·작업 큐 직접 확인. 기존 속도 제한과 STOP 유지');
      WARN('기존 릴레이 상태 정보','/health 미지원: 확장 동작은 새 덤프 수신으로 확인');
    } catch (error) { FAIL('기존 릴레이 연결',error.message); }
  } else if (h.outdated || (h.version || 1) < RELAY_VERSION) FAIL('릴레이', `예전 버전(${h.version || 1} < ${RELAY_VERSION}) 실행 중. node kream-tools/start-watch.mjs ${runDir} 로 다시 띄우세요`);
  else if (!sameDir(h.dir, runDir)) FAIL('릴레이', `다른 폴더를 서비스 중: ${h.dir}. 이대로 시작하면 확장이 엉뚱한 작업을 받음. node kream-tools/start-watch.mjs ${runDir}`);
  else {
    PASS('릴레이', `PID ${h.pid}, 버전 ${h.version}, 이 폴더 서비스 중, 남은 작업 ${h.pending}`);
    const seen = [h.lastPollAgoSec, h.progressAgoSec, h.lastDumpAgoSec].filter((x) => x != null); const silent = seen.length ? Math.min(...seen) : h.uptimeSec;
    silent > 150 ? WARN('확장 접속', `${silent}초째 접속 없음. 크롬·확장·"자동 실행" 확인`) : PASS('확장 접속', h.lastPollAgoSec == null ? '릴레이 막 시작(곧 접속)' : `${h.lastPollAgoSec}초 전`);
  }
  const l = readLock();
  if (l && alive(l.pid) && sameDir(l.runDir, runDir)) PASS('감시자', `PID ${l.pid}`);
  else if (l && alive(l.pid)) WARN('감시자', `다른 폴더를 감시 중: ${l.runDir}`);
  else WARN('감시자', `꺼짐. 켜기: node kream-tools/start-watch.mjs ${runDir}`);
}

const fails = results.filter((r) => r.level === '실패').length, warns = results.filter((r) => r.level === '주의').length;
console.log(`사전 점검: 통과 ${results.length - fails - warns}, 주의 ${warns}, 실패 ${fails}`);
process.exit(fails ? 1 : 0);
