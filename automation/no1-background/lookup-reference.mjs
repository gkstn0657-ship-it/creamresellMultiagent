import fs from 'node:fs';
import path from 'node:path';
import {BackgroundClient} from './client.mjs';
import {lookupReference} from './reference-lookup.mjs';
const options=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');if(!v.startsWith('--')||i<3)throw Error('EXPECTED_NAMED_ARGUMENT');return [v.slice(2,i),v.slice(i+1)];}));
try{
  if(Object.keys(options).some(k=>!['kreamId','model','sourceSize','out'].includes(k)))throw Error('NO1_INVALID_PAYLOAD');
  const result=await lookupReference({kreamId:options.kreamId,model:options.model,sourceSize:options.sourceSize},{client:new BackgroundClient()});
  if(options.out){const dir=path.resolve(options.out);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'reference-lookup.json'),JSON.stringify(result,null,2));}
  console.log(JSON.stringify({status:result.status,source:result.source,benefitPrice:result.benefitPrice,errors:result.errors,error:result.error,schema:result.schema,purchaseAuthorized:false}));
  if(result.status!=='collected')process.exitCode=2;
}catch(e){console.error(/^[A-Z0-9_]+$/.test(e.message)?e.message:'REFERENCE_LOOKUP_FAILED');process.exitCode=1;}
