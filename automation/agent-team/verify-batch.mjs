import fs from 'node:fs';
import path from 'node:path';
import {runBatch} from './batch.mjs';
const seeds=[1,2].map(n=>({kreamId:String(900000000+n),productUrl:`https://www.musinsa.com/products/${900000000+n}`,model:`TEST-ONLY-${n}`,color:'BLACK',option:'L'}));
const dir=path.resolve(process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'kream-runs/agent-team-batch-fixture-verification');
const result=await runBatch({seeds,dir,mode:'fixture',concurrency:2,collect:async request=>({request,queryStatus:'complete',
  note:'Synthetic test data, never a real product or real profit. Evaluate the supplied hypothetical business case. No network lookup is appropriate.',
  scenarioInputs:{purchaseBeforePoints:request.kreamId.endsWith('1')?70000:140000,existingPointsSpent:0,inboundShipping:3000,salePrice:110000,sellerFeeRate:0.05,sellerFixedFee:0,outboundShipping:2000,newPointsExpected:0,quantity:1},
  demand:{sameOptionTrades30d:40,medianSalePrice:110000,daysToSellAssumption:7},
  identity:{sourceProductVerified:true,sourceModelVerified:true,sourceOptionVerified:true,marketModelIndependentlyVerified:true},
  missingFields:['SYNTHETIC_TEST_ONLY'],upstreamFreshnessConfirmed:false}),onEvent:e=>{if(['all_products_collected','product_judgment_started','product_judged','run_incomplete','tool_error'].includes(e.type))console.log(JSON.stringify(e));}});
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify({mode:'fixture-with-real-codex-inference',status:result.status,productCount:result.productCount,judged:result.judged,decisions:result.results.map(r=>({productId:r.productId,decision:r.assessment?.decision,readiness:r.assessment?.readiness})),realProductsVerified:false},null,2));
console.log(JSON.stringify({status:result.status,decisions:result.results.map(r=>r.assessment?.decision)}));
if(result.status!=='complete')process.exitCode=2;
