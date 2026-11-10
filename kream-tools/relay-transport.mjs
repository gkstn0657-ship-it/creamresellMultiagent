import fs from 'node:fs';
import path from 'node:path';
import { hash,readJson,writeJson,acquireRunLock,canonicalUrl } from '../renew/Cream/kream-tools/agents-core.mjs';

// Reuses the running legacy relay without killing or replacing any process.
// Canonical jobs live in a fresh run. Only namespaced transport jobs are added
// to the relay's existing queue; original captures retain their observation time.
export class RelayTransport {
  constructor(targetDir, serviceDir, options = {}) {
    this.target = path.resolve(targetDir); this.service = path.resolve(serviceDir);
    this.url = options.url || 'http://127.0.0.1:8787'; this.fetch = options.fetch || fetch;
    this.prefix = `A${hash(this.target).slice(0,12)}-`; this.verified = false;
  }
  async verify() {
    const marker = `.relay-identity-${process.pid}-${hash(Date.now()).slice(0,8)}.json`;
    writeJson(this.service,marker,{kind:'local-relay-identity'});
    try {
      const response = await this.fetch(this.url+'/status',{signal:AbortSignal.timeout(3000)});
      const files = response.ok ? await response.json() : null;
      if (!Array.isArray(files) || !files.includes(marker)) throw new Error('기존 릴레이 실행 폴더 확인 실패');
      this.verified = true;
    } finally { fs.unlinkSync(path.join(this.service,marker)); }
  }
  stopped() { return fs.existsSync(path.join(this.target,'STOP')) || fs.existsSync(path.join(this.service,'STOP')); }
  async sync() {
    if (!this.verified) await this.verify();
    if (this.stopped()) throw new Error('STOP 감지: 기존 릴레이 중단 상태 유지');
    if (this.target === this.service) return {queued:0,copied:0};
    const jobs = readJson(this.target,'jobs.json',{jobs:[]}).jobs;
    const manifest = readJson(this.target,'relay-transport.json',{serviceDir:this.service,items:{}});
    let queued = 0,copied = 0;
    const release = acquireRunLock(this.service);
    try {
      const queue = readJson(this.service,'jobs.json',{jobs:[]}),byId = new Map(queue.jobs.map(j => [j.id,j]));
      for (const job of jobs) {
        if (!/^[\w.-]{1,60}$/.test(job.id) || !canonicalUrl(job.url)) throw new Error('전송 작업 ID·URL 오류');
        if (fs.existsSync(path.join(this.target,`dump-${job.id}.json`))) continue;
        const alias = this.prefix+job.id, sourceFile = path.join(this.service,`dump-${alias}.json`);
        const transportJob = {...job,id:alias};
        const prior = byId.get(alias);
        if (prior && JSON.stringify(prior) !== JSON.stringify(transportJob)) throw new Error('전송 작업 내용 충돌');
        if (!prior) { queue.jobs.push(transportJob);byId.set(alias,transportJob);queued++; }
        manifest.items[job.id] = {id:job.id,transportId:alias,url:job.url};
        if (fs.existsSync(sourceFile)) {
          const dump = JSON.parse(fs.readFileSync(sourceFile,'utf8').replace(/^\uFEFF/,''));
          if (!dump.job || dump.job.id !== alias || canonicalUrl(dump.job.url) !== canonicalUrl(job.url)) throw new Error('수집 원본과 전송 작업 불일치');
          writeJson(this.target,`dump-${job.id}.json`,{...dump,transport:{sourceRun:this.service,sourceFile:path.basename(sourceFile),canonicalId:job.id,originalAt:dump.at || null}}); copied++;
        }
      }
      if (queued) writeJson(this.service,'jobs.json',queue);
      writeJson(this.target,'relay-transport.json',{...manifest,at:new Date().toISOString(),queued,copied});
    } finally { release(); }
    return {queued,copied};
  }
  cancelPending() {
    if (this.target === this.service) return;
    const release = acquireRunLock(this.service);
    try {
      const queue = readJson(this.service,'jobs.json',{jobs:[]});
      queue.jobs = queue.jobs.filter(j => !j.id.startsWith(this.prefix) || fs.existsSync(path.join(this.service,`dump-${j.id}.json`)));
      writeJson(this.service,'jobs.json',queue);
    } finally { release(); }
  }
}
