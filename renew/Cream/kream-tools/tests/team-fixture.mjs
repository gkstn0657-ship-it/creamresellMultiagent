import {writeJson,context,quote,productJobId} from '../agents-core.mjs';
import {collectOffers} from '../agents-offers.mjs';
export function teamFixture(dir,now = '2026-11-08T03:00:00.000Z') {
  const model='801563051-A0029',title=`스톤아일랜드 ${model} 블랙`,url='https://shop.example/product/1';
  writeJson(dir,'agent-policy.json',{costPolicyConfirmed:true,costPolicySource:'SYNTHETIC TEST ONLY',costPolicyVersion:'fixture-v2'});
  writeJson(dir,'k50.json',[{id:'123',model,title,n:30,kreamMed:200000}]);
  writeJson(dir,'k50-ids.json',['123']); writeJson(dir,'jobs.json',{jobs:[]});
  writeJson(dir,'n-cards.json',{123:{matched:[{title,price:120000,shipFee:0,link:url,keyMatch:true,topMalls:[{mall:'롯데ON'}]}]}});
  writeJson(dir,'n-cat.json',{});
  writeJson(dir,'dump-K123.json',{at:now,text:'거래일\n'+Array.from({length:5},()=>'S\n200,000원\n26/11/08').join('\n')});
  const offer=collectOffers(context(dir,{now}))[0],file=`dump-${productJobId(offer)}.json`;
  const text='옵션 S / 판매가 120,000원\n배송비 무료\n판매자: 시험상점\n사업자등록번호 123-45-67890\n실제 판매자는 시험상점, 플랫폼은 중개자\n국내 출고\n반품 가능 7일\n구매 영수증 발급 가능';
  writeJson(dir,file,{at:now,url,title,text,stockProbe:{complete:true,enumerationComplete:true,results:[{size:'S',state:'available',maxQty:2}]}});
  const q=s=>quote(file,'text',s);
  writeJson(dir,'agent-evidence.json',{offers:{[offer.id]:{S:{size:'S',optionEvidence:q('옵션 S / 판매가 120,000원'),unitPrice:{value:120000,evidence:q('옵션 S / 판매가 120,000원')},shipping:{value:0,evidence:q('배송비 무료')}}}},
    sellers:{[offer.id]:{name:'시험상점',businessNumber:'123-45-67890',role:'marketplace',domestic:true,identityEvidence:q('판매자: 시험상점'),businessEvidence:q('사업자등록번호 123-45-67890'),roleEvidence:q('실제 판매자는 시험상점, 플랫폼은 중개자'),dispatchEvidence:q('국내 출고'),returnEvidence:q('반품 가능 7일'),receiptEvidence:q('구매 영수증 발급 가능')}}});
  writeJson(dir,'final-all.json',{rows:[{'크림ID':'123','상품명':title+' [S]','모델번호':model,'판정':'후보','차트 분류':'횡보','판매처 링크':url}],meta:{syntheticOnly:true}});
  return {dir,now,offer,file};
}
