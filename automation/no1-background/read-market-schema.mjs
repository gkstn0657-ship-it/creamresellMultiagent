import fs from 'node:fs';
import path from 'node:path';
import {BackgroundClient} from './client.mjs';
import {probeProduct} from './product-probe.mjs';
import {buildMarketSchema} from '../agent-team/market-schema.mjs';
// Explicit single-product read for repeatable verification; never starts an AI batch.
const args=Object.fromEntries(process.argv.slice(2).map(x=>{const at=x.indexOf('=');if(!x.startsWith('--')||at<3)throw Error('EXPECTED_NAMED_ARGUMENT');return [x.slice(2,at),x.slice(at+1)];}));
const request=Object.fromEntries(['kreamId','productUrl','model','color','option'].map(k=>[k,args[k]]));
const client=new BackgroundClient();
try{
  const status=await client.status();if(status.connectorVersion!=='0.6.0')throw Error('NO1_CONNECTOR_UPDATE_REQUIRED');
  const payload=await probeProduct(client,request),observation={kind:'no1_product',mode:'live',observedAt:payload.observedAt,payload};
  const schema=buildMarketSchema(observation,args.desiredSellingPrice===undefined?{}:{desiredSellingPrice:Number(args.desiredSellingPrice)});
  if(args.out){const directory=path.resolve(args.out);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'observation.json'),JSON.stringify(observation,null,2));fs.writeFileSync(path.join(directory,'schema.json'),JSON.stringify(schema,null,2));}
  console.log(JSON.stringify(schema));
}catch(error){console.error(/^[A-Z0-9_]+$/.test(error.message)?error.message:'SCHEMA_QUERY_FAILED');process.exitCode=1;}
