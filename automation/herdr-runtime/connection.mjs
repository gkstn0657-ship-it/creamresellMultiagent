import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {BackgroundClient} from '../no1-background/client.mjs';
import {CONNECTOR_VERSION} from '../no1-background/chrome-extension/protocol.mjs';
import {readConfig} from '../no1-background/local-config.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
export async function connection({repairLocalBridge=false,client=new BackgroundClient()}={}) {
  let status;
  try{status=await client.status();}catch(error){
    if(!repairLocalBridge) return {ready:false,code:error.message};
    readConfig(); // Never replace credentials or pair a browser silently.
    const child=spawn(process.execPath,[fileURLToPath(new URL('../no1-background/run-bridge.mjs',import.meta.url))],{cwd:project,windowsHide:true,detached:true,stdio:'ignore'});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
    for(let i=0;i<10;i++){try{status=await client.status();break;}catch{await new Promise(r=>setTimeout(r,200));}}
    if(!status)return {ready:false,code:'NO1_BRIDGE_UNAVAILABLE'};
  }
  return {ready:status.browserConnected===true&&status.connectorVersion===CONNECTOR_VERSION,browserConnected:status.browserConnected===true,connectorVersion:status.connectorVersion||null,requiredConnectorVersion:CONNECTOR_VERSION,
    ...(!status.browserConnected?{code:'NO1_BROWSER_CONNECTION_REQUIRED'}:status.connectorVersion!==CONNECTOR_VERSION?{code:'NO1_CONNECTOR_UPDATE_REQUIRED'}:{}),authenticatedProductWorkflowVerified:false};
}
