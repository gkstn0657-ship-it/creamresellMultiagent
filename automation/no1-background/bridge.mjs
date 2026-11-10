import http from 'node:http';
import crypto from 'node:crypto';
import {COMMANDS, PRODUCT_COMMANDS, CONNECTOR_VERSION, validateCommand, validateProjectedData, safeCode} from './chrome-extension/protocol.mjs';

export function createBridge({key, requestTimeoutMs = 55000, now = Date.now} = {}) {
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw Error('NO1_INVALID_BRIDGE_CONFIG');
  let active = null; let lastPollAt = 0; let connectorVersion = null; let waiter=null; const timings=[];
  const equal = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && crypto.timingSafeEqual(Buffer.from(value), Buffer.from(key));
  const connected = () => lastPollAt > 0 && (now() - lastPollAt < 40000 || Boolean(active?.delivered&&now()<active.deadline));
  const status = () => ({transport: 'chrome-official-relay', browserConnected: connected(), connectorVersion, requestPending: Boolean(active), commands: [...COMMANDS], productProbeAvailable: connectorVersion === CONNECTOR_VERSION, pipelineProductQueriesEnabled: connected() && connectorVersion === CONNECTOR_VERSION, authentication: 'check-platform-status-separately', uiFallbackEnabled: false,dispatch:'long-poll',recentTimings:timings.slice(-30)});
  const deliver=()=>{if(!waiter||!active||active.delivered)return;const w=waiter;waiter=null;clearTimeout(w.timer);active.delivered=true;active.deliveredAt=now();w.send(200,{job:{id:active.id,cmd:active.cmd,payload:active.payload,deadline:active.deadline}});};
  const releaseWaiter=()=>{if(waiter){const w=waiter;waiter=null;clearTimeout(w.timer);w.send(200,{job:null});}};
  const settle = (value) => {
    if (!active) return;
    const current = active; active = null; clearTimeout(current.timer);
    timings.push({cmd:current.cmd,at:new Date(current.startedAt).toISOString(),queueMs:current.deliveredAt==null?null:current.deliveredAt-current.startedAt,totalMs:now()-current.startedAt,ok:value.ok});if(timings.length>30)timings.shift();
    current.resolve(value);
  };
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const extensionOrigin = typeof origin === 'string' && /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
    const send = (code, value) => {
      if (res.destroyed) return;
      res.writeHead(code, {'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extensionOrigin ? {'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type, X-No1-Bridge-Key, X-No1-Connector-Version', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Vary': 'Origin'} : {})});
      res.end(JSON.stringify(value));
    };
    const port = server.address()?.port;
    if (req.headers.host !== `127.0.0.1:${port}` || (origin !== undefined && !extensionOrigin)) { send(403, {error: 'FORBIDDEN'}); return; }
    if (req.method === 'OPTIONS') { send(204, null); return; }
    if (!equal(req.headers['x-no1-bridge-key'])) { send(401, {error: 'UNAUTHORIZED'}); return; }
    let pathname; try { pathname = new URL(req.url, 'http://127.0.0.1').pathname; } catch { send(400, {error: 'INVALID_REQUEST'}); return; }
    if (req.method === 'GET' && pathname === '/status') { send(200, status()); return; }
    if (req.method === 'GET' && pathname === '/next') {
      lastPollAt = now();
      connectorVersion = req.headers['x-no1-connector-version'] === CONNECTOR_VERSION ? CONNECTOR_VERSION : null;
      releaseWaiter();
      const wait=Math.min(20000,Math.max(0,Number(new URL(req.url,'http://127.0.0.1').searchParams.get('wait'))||0));
      const w={send,timer:null};waiter=w;deliver();
      if(waiter===w){if(!wait){releaseWaiter();return;}w.timer=setTimeout(()=>{if(waiter===w)releaseWaiter();},wait);res.on('close',()=>{if(waiter===w){waiter=null;clearTimeout(w.timer);}});}
      return;
    }
    if (req.method !== 'POST' || !['/rpc', '/result', '/disconnect'].includes(pathname)) { send(404, {error: 'NOT_FOUND'}); return; }
    let raw = ''; let body;
    try {
      req.setEncoding('utf8');
      for await (const chunk of req) { raw += chunk; if (raw.length > 262144) throw Error(); }
      body = JSON.parse(raw);
    } catch { send(400, {error: 'INVALID_REQUEST'}); return; }
    if (pathname === '/disconnect') { lastPollAt = 0; releaseWaiter();settle({ok: false, error: {code: 'NO1_CONNECTION_STOPPED'}}); send(200, {ok: true}); return; }
    if (pathname === '/result') {
      if (!active || !active.delivered || body.id !== active.id || now() > active.deadline) { send(409, {error: 'RESULT_NOT_EXPECTED'}); return; }
      let result;
      try {
        if (body.ok === true) result = {ok: true, data: validateProjectedData(active.cmd, body.data, active.payload)};
        else if (body.ok === false) result = {ok: false, error: {code: safeCode(body.error?.code)}};
        else throw Error();
      } catch { settle({ok: false, error: {code: 'NO1_INVALID_RESPONSE'}}); send(400, {error: 'INVALID_RESULT'}); return; }
      settle(result); send(200, {ok: true}); return;
    }
    try { validateCommand(body.cmd, body.payload); } catch (error) { send(400, {ok: false, error: {code: safeCode(error.message)}}); return; }
    if (PRODUCT_COMMANDS.includes(body.cmd) && connectorVersion !== CONNECTOR_VERSION) { send(409, {ok: false, error: {code: 'NO1_CONNECTOR_UPDATE_REQUIRED'}}); return; }
    if (active) { send(409, {ok: false, error: {code: 'NO1_BRIDGE_BUSY'}}); return; }
    if (!status().browserConnected) { send(503, {ok: false, error: {code: 'NO1_BRIDGE_DISCONNECTED'}}); return; }
    const id = crypto.randomUUID();
    const result = await new Promise(resolve => {
      const timeout = PRODUCT_COMMANDS.includes(body.cmd) ? Math.max(requestTimeoutMs, 110000) : requestTimeoutMs;
      active = {id, cmd: body.cmd, payload: body.payload, startedAt:now(),delivered: false, deadline: now() + timeout, resolve, timer: setTimeout(() => settle({ok: false, error: {code: 'NO1_BRIDGE_TIMEOUT'}}), timeout)};
      deliver();
      res.on('close', () => { if (!res.writableEnded && active?.id === id) settle({ok: false, error: {code: 'NO1_BRIDGE_DISCONNECTED'}}); });
    });
    send(200, result);
  });
  server.on('close', () => settle({ok: false, error: {code: 'NO1_BRIDGE_DISCONNECTED'}}));
  server.requestTimeout = 10000;
  return {server, status, close: async () => { releaseWaiter();settle({ok: false, error: {code: 'NO1_BRIDGE_DISCONNECTED'}}); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }};
}
