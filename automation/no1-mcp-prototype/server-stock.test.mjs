import test from 'node:test';import assert from 'node:assert/strict';import {dispatch,validateStockArgs,validateStockEvidence} from './server-stock.mjs';
const a={productUrl:'https://www.musinsa.com/products/7481180',model:'NBNPG41033',color:'(19)BLACK',option:'L(100)'};const now=Date.now();const t=new Date(now-1000).toISOString();const e={...a,identityVerified:true,resultUrlVerifiedFromCopy:true,previousResultCleared:true,maximumBenefitPriceKrw:370280,stockQuantity:40,benefitConditionsVerbatim:['test only'],queryStartedAt:t,queryCompletedAt:t,capturedAt:t};
test('legacy tools and background diagnostics coexist',async()=>assert.deepEqual((await dispatch({id:1,method:'tools/list'})).result.tools.map(x=>x.name),['no1_read_price_comparison','no1_search_price_comparison','no1_search_stock_estimate','no1_background_status','no1_background_supported_sites','no1_background_musinsa_login','no1_background_runtime_settings','no1_background_product_probe','no1_background_displayed_schema']));
test('arbitrary URL and args rejected',()=>{assert.throws(()=>validateStockArgs({...a,productUrl:'https://evil.test/7481180'}));assert.throws(()=>validateStockArgs({...a,command:'x'}));});
for(const k of ['productUrl','model','color','option'])test(k+' mismatch blocked',()=>assert.throws(()=>validateStockEvidence({...e,[k]:'wrong'},a,now)));
test('previous result prohibited',()=>assert.throws(()=>validateStockEvidence({...e,previousResultCleared:false},a,now)));
test('search-input-only URL prohibited',()=>assert.throws(()=>validateStockEvidence({...e,resultUrlVerifiedFromCopy:false},a,now)));
test('stale query prohibited',()=>assert.throws(()=>validateStockEvidence({...e,queryStartedAt:new Date(now-601000).toISOString()},a,now)));
test('estimate cannot be checkout or promotion',()=>{const r=validateStockEvidence(e,a,now);assert.equal(r.actualCheckoutPriceConfirmed,false);assert.equal(r.promotionAllowed,false);assert.equal(r.priceType,'maximum-benefit-estimate');assert.equal(r.upstreamFreshnessConfirmed,false);});

const gated={...e,benefitStatus:'login-required',maximumBenefitPriceKrw:null,benefitConditionsVerbatim:['Musinsa에 로그인하시면 이 상품의 최대혜택가·쿠폰·등급 할인·적립금을 포함한 상세 혜택 정보를 확인할 수 있습니다.']};
test('login-gated benefits preserve stock but never invent a zero price',()=>{
  const r=validateStockEvidence(gated,a,now);assert.equal(r.stockQuantity,40);assert.equal(r.maximumBenefitPriceKrw,null);
  assert.equal(r.benefitStatus,'login-required');assert.equal(r.priceType,'unavailable');assert.equal(r.promotionAllowed,false);assert.ok(r.missingFields.includes('benefitLogin'));
});
test('login gate requires its visible notice and cannot coexist with a claimed benefit price',()=>{
  assert.throws(()=>validateStockEvidence({...gated,benefitConditionsVerbatim:['unknown']},a,now),/BENEFIT_LOGIN_STATE_INVALID/);
  assert.throws(()=>validateStockEvidence({...gated,maximumBenefitPriceKrw:0},a,now),/BENEFIT_LOGIN_STATE_INVALID/);
  assert.throws(()=>validateStockEvidence({...gated,benefitStatus:'available'},a,now),/STOCK_ESTIMATE_INCOMPLETE/);
});
