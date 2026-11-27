import test from 'node:test';
import assert from 'node:assert/strict';
import {explorationStatus} from './exploration-status.mjs';

test('source progress keeps collection skips separate from verified market judgments',()=>{
 const data=explorationStatus([{runId:'batch-1',status:'judging',sourceItems:[
  {productId:'1',rank:1,productName:'first'},{productId:'2',rank:2,productName:'second'},
  {productId:'3',rank:3,productName:'third'},{productId:'4',rank:4,productName:'fourth'}],
  sources:[{sourceId:'1',status:'collected',packetProductId:'101',marketKeys:['101','poizon-201']},{sourceId:'2',status:'skipped',reason:'NO_MATCH'},{sourceId:'3',status:'collected',packetProductId:'103'}],
  products:[{productId:'101',verified:true,decision:'adopt',status:'complete'},{productId:'poizon-201',verified:true,decision:'hold',status:'complete'},{productId:'103',verified:false,decision:'adopt',status:'complete'}]}]);
 assert.deepEqual(data.counts,{assigned:4,collected:2,skipped:1,reviewed:1,adopt:1,attention:0,pending:2});
 assert.deepEqual(data.rows.map(r=>r.status),['reviewed','skipped','reviewing','waiting']);
 assert.equal(data.rows[1].reason,'NO_MATCH');
 assert.equal(data.rows[2].markets[0].decision,null);
});
