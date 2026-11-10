import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, VERSION } from './agents-core.mjs';

export function recordIncident(dir, error = null, stageOverride = null, health = null) {
  const stage = readJson(dir, 'stage.json', {}), stop = fs.existsSync(path.join(dir, 'STOP'));
  const message = String(error?.message || error || (stageOverride === '완료' ? '' : stage.error) || '').slice(0, 1500);
  const kind = stop ? 'BLOCKED' : /JSON|파싱/.test(message) ? 'PARSE_ERROR' : /엑셀|export-xlsx|Python/.test(message) ? 'EXPORT_ERROR' : /품질경보/.test(message) ? 'QUALITY_ERROR' : /릴레이|EADDRINUSE/.test(message) ? 'RELAY_ERROR' : /정체|덤프/.test(message) ? 'COLLECTION_STALLED' : message ? 'STAGE_ERROR' : 'OK';
  const at = new Date().toISOString(), item = { version: VERSION, runId: stage.runId || null, at, stage: stageOverride || stage.stage || '미확인',
    status: kind === 'OK' ? 'ok' : 'needs-attention', kind, message,
    nextAction: kind === 'BLOCKED' ? '차단 원문 확인 후 사람이 재개 결정' : kind === 'RELAY_ERROR' ? '릴레이 상태·서비스 폴더 확인. 기존 watchdog --fix 사용' : kind === 'EXPORT_ERROR' ? 'Python 종료 코드·오류 확인 후 엑셀 단계 재실행' : kind === 'OK' ? '추가 조치 없음' : '실패 단계의 로그와 입력을 확인한 뒤 같은 명령으로 재개',
    recovery: { automaticAction: 'none', resume: stage.resume || null },
    evidence: { files: ['stage.json', 'run-all.log', 'relay.log', 'watchdog.log'].filter((f) => fs.existsSync(path.join(dir, f))),
      health: health ? { pending: health.pending, stop: health.stop, dirMatches: path.resolve(health.dir || dir) === path.resolve(dir) } : null } };
  const history = readJson(dir, 'incident.json', { items: [] });
  const fingerprint = JSON.stringify([item.runId, item.stage, item.kind, item.message]);
  if (!history.items.some((i) => JSON.stringify([i.runId, i.stage, i.kind, i.message]) === fingerprint)) history.items.push(item);
  writeJson(dir, 'incident.json', { version: VERSION, at, current: item, items: history.items }); return item;
}
