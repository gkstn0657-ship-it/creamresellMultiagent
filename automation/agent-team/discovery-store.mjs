import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {categories,discoveryPolicy,candidateFromItem} from './discovery-policy.mjs';
export class DiscoveryStore {
 constructor(root){
  fs.mkdirSync(root,{recursive:true});this.db=new DatabaseSync(path.join(root,'discovery.sqlite'),{timeout:5000});
  this.db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS candidates(id TEXT PRIMARY KEY,category TEXT NOT NULL,rank INTEGER NOT NULL,payload TEXT NOT NULL,batch_id TEXT);
   CREATE INDEX IF NOT EXISTS candidate_queue ON candidates(category,batch_id,rank);
   CREATE TABLE IF NOT EXISTS claims(batch_id TEXT NOT NULL,position INTEGER NOT NULL,product_id TEXT NOT NULL UNIQUE,PRIMARY KEY(batch_id,position));
   CREATE TABLE IF NOT EXISTS pages(cursor TEXT PRIMARY KEY,next_cursor TEXT,count INTEGER NOT NULL,observed_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS prior_work(product_id TEXT PRIMARY KEY,batch_id TEXT NOT NULL);`);
  for(const [key,value] of Object.entries({cursor:'1',rank:0,turn:0,exhausted:false,policyVersion:discoveryPolicy.version}))this.db.prepare('INSERT OR IGNORE INTO meta VALUES(?,?)').run(key,JSON.stringify(value));
  if(this.get('policyVersion')!==discoveryPolicy.version)throw Error('DISCOVERY_POLICY_MIGRATION_REQUIRED');
 }
 get(k){const row=this.db.prepare('SELECT value FROM meta WHERE key=?').get(k);return row?JSON.parse(row.value):null;}
 set(k,v){this.db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,JSON.stringify(v));}
 transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 queued(){return this.db.prepare('SELECT COUNT(*) AS n FROM candidates WHERE batch_id IS NULL').get().n;}
 appendPage({cursor,items,nextCursor,observedAt}){
  if(!Array.isArray(items)||items.length>200||!Number.isFinite(Date.parse(observedAt))||!/^\d{1,12}$/.test(cursor)||(nextCursor!==null&&!/^\d{1,12}$/.test(nextCursor)))throw Error('DISCOVERY_PAGE_INVALID');
  return this.transaction(()=>{
   if(this.db.prepare('SELECT 1 FROM pages WHERE cursor=?').get(cursor))return {reused:true};
   if(this.get('cursor')!==cursor)throw Error('DISCOVERY_CURSOR_CONFLICT');
   if(nextCursor===cursor||nextCursor&&this.db.prepare('SELECT 1 FROM pages WHERE cursor=?').get(nextCursor))throw Error('DISCOVERY_CURSOR_LOOP');
   if(!items.length&&nextCursor!==null)throw Error('DISCOVERY_EMPTY_NONTERMINAL_PAGE');
   let rank=this.get('rank'),inserted=0;
   for(const item of items){const c=candidateFromItem(item,{cursor,rank:++rank,observedAt});const prior=this.db.prepare('SELECT batch_id FROM prior_work WHERE product_id=?').get(c.kreamId);inserted+=this.db.prepare('INSERT OR IGNORE INTO candidates VALUES(?,?,?,?,?)').run(c.kreamId,c.category,rank,JSON.stringify(c),prior?.batch_id||null).changes;}
   this.db.prepare('INSERT INTO pages VALUES(?,?,?,?)').run(cursor,nextCursor,items.length,observedAt);
   this.set('rank',rank);this.set('cursor',nextCursor);this.set('exhausted',nextCursor===null);this.set('lastReadAt',observedAt);this.set('lastError',null);return {inserted};
  });
 }
 claimed(batchId){return this.db.prepare('SELECT c.payload FROM claims a JOIN candidates c ON c.id=a.product_id WHERE a.batch_id=? ORDER BY a.position').all(batchId).map(r=>JSON.parse(r.payload));}
 importCompleted(root){
  if(!fs.existsSync(root))return;
  this.transaction(()=>{
   for(const id of fs.readdirSync(root).filter(n=>/^batch-[a-f0-9-]{36}$/.test(n))){
    let state;try{state=JSON.parse(fs.readFileSync(path.join(root,id,'batch-state.json'),'utf8'));}catch{continue;}
    if(state.mode!=='live')continue;
    for(const row of (state.results||[]).filter(r=>r.status==='complete'&&/^\d{1,12}$/.test(r.productId))){
     this.db.prepare('INSERT OR IGNORE INTO prior_work VALUES(?,?)').run(row.productId,id);
     this.db.prepare('UPDATE candidates SET batch_id=? WHERE id=? AND batch_id IS NULL').run(id,row.productId);
    }
   }
  });
 }
 claim(batchId,limit){
  if(typeof batchId!=='string'||!/^batch-[a-f0-9-]{36}$/.test(batchId)||!Number.isSafeInteger(limit)||limit<1||limit>5)throw Error('DISCOVERY_CLAIM_INVALID');
  return this.transaction(()=>{
   const old=this.claimed(batchId);if(old.length){if(old.length>limit)throw Error('DISCOVERY_CLAIM_CONFLICT');return old;}
   const selected=[];let turn=this.get('turn');
   for(let scanned=0;selected.length<limit&&scanned<categories.length*limit;scanned++){
    const category=categories[turn%categories.length].id;turn=(turn+1)%categories.length;
    const row=this.db.prepare('SELECT id,payload FROM candidates WHERE category=? AND batch_id IS NULL ORDER BY rank,id LIMIT 1').get(category);if(!row)continue;
    this.db.prepare('UPDATE candidates SET batch_id=? WHERE id=? AND batch_id IS NULL').run(batchId,row.id);
    this.db.prepare('INSERT INTO claims VALUES(?,?,?)').run(batchId,selected.length,row.id);selected.push(JSON.parse(row.payload));
   }
   if(selected.length)this.set('turn',turn);return selected;
  });
 }
 status(){return {policy:discoveryPolicy,cursor:this.get('cursor'),nextCategory:categories[this.get('turn')].id,exhausted:this.get('exhausted'),lastReadAt:this.get('lastReadAt'),lastError:this.get('lastError'),
  categories:categories.map(c=>({id:c.id,name:c.name,...this.db.prepare('SELECT COUNT(*) AS observed, SUM(CASE WHEN batch_id IS NULL THEN 1 ELSE 0 END) AS waiting FROM candidates WHERE category=?').get(c.id)})),
  totals:this.db.prepare('SELECT COUNT(*) AS observed,SUM(CASE WHEN batch_id IS NULL THEN 1 ELSE 0 END) AS waiting,SUM(CASE WHEN batch_id IS NOT NULL THEN 1 ELSE 0 END) AS assigned FROM candidates').get(),coverage:'observed-popularity-feed-only; category labels are title rules, not verified taxonomy'};}
 close(){this.db.close();}
}
