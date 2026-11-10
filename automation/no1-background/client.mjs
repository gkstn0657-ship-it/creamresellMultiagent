import {readConfig} from './local-config.mjs';
import {validateCommand, validateProjectedData, safeCode} from './chrome-extension/protocol.mjs';
const queues=new Map();
export class BackgroundClient {
  constructor({config = readConfig, fetcher = fetch,serialize=true} = {}) { this.config = config; this.fetcher = fetcher;this.serialize=serialize; }
  async call(path, body) {
    const config = this.config();
    try {
      const res = await this.fetcher(config.url + path, {method: body ? 'POST' : 'GET', headers: {'X-No1-Bridge-Key': config.key, ...(body ? {'Content-Type': 'application/json'} : {})}, ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(body ? 120000 : 3000), redirect: 'error'});
      const data = await res.json();
      if (!res.ok && !data?.error?.code) throw Error('NO1_BRIDGE_UNAVAILABLE');
      return data;
    } catch { throw Error('NO1_BRIDGE_UNAVAILABLE'); }
  }
  status() { return this.call('/status'); }
  async request(cmd, payload = {}) {
    validateCommand(cmd, payload);
    const execute=async()=>{const result=await this.call('/rpc',{cmd,payload});if(result?.ok!==true)throw Error(safeCode(result?.error?.code));return validateProjectedData(cmd,result.data,payload);};
    if(!this.serialize)return execute();
    const key=this.config().url,pending=(queues.get(key)||Promise.resolve()).then(execute),tail=pending.catch(()=>{});queues.set(key,tail);
    try{return await pending;}finally{if(queues.get(key)===tail)queues.delete(key);}
  }
}
