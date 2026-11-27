import test from 'node:test';
import assert from 'node:assert/strict';
import {likelyResaleCandidate} from './ranking-candidate-policy.mjs';

test('ranking screen excludes clear consumables and gift cards, retaining fashion candidates',()=>{
 for(const productName of ['pH리밸런싱 클리닉 샴푸 510ml','녹두 약산성 클렌징 폼 160ml','테이크핏 초코맛 250mL','무신사머니 50만원 상품권']){
  assert.equal(likelyResaleCandidate({productName}),false,productName);
 }
 for(const productName of ['ACG 후드 재킷 / IR2245-010','[WOMEN] 클래식 울트라 미니 / 1116109-CHE','SHOWER - 808 (a) / BLACK','데일리 푸퍼 숏 패딩 재킷']){
  assert.equal(likelyResaleCandidate({productName}),true,productName);
 }
});
