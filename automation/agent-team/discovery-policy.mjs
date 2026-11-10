// Fixed plan. Runtime discovery never calls an LLM or changes these rules.
export const discoveryPolicy=Object.freeze({version:1,engine:'deterministic-round-robin',runtimeAI:false,sort:'popular_score',batchSize:5,lookaheadPages:2,maxPagesPerBatch:10,source:'no1-kream-popularity',unit:'distinct-kream-product-id',revisitCompleted:false});
export const categories=Object.freeze([
 {id:'shoes',name:'신발',pattern:/스니커|운동화|러닝화|런닝화|로퍼|슬리퍼|샌들|부츠|더비|펌프스|에어 포스|에어 조던 \d|삼바|가젤|슈퍼스타|젤 카야노|젤 님버스|\b(sneaker|shoe|sandal|slipper|loafer|boot)\b/i},
 {id:'clothing',name:'의류',pattern:/티셔츠|스웨트|스웻|후드|니트|셔츠|맨투맨|팬츠|바지|스커트|원피스|자켓|재킷|패딩|코트|플리스|바람막이|가디건|트레이닝|\b(hoodie|shirt|jacket|pants|sweater|coat)\b/i},
 {id:'accessories',name:'가방·패션잡화',pattern:/가방|백팩|숄더백|토트백|크로스백|지갑|시계|주얼리|목걸이|팔찌|귀걸이|반지|볼캡|비니|버킷햇|모자|머플러|스카프|키링|벨트|선글라스|양말|\b(bag|wallet|watch|cap|beanie|necklace)\b/i},
 {id:'beauty',name:'뷰티',pattern:/향수|퍼퓸|오드|립스틱|립밤|틴트|세럼|크림|로션|클렌저|스킨케어|파운데이션|\b(perfume|lipstick|serum|cosmetic)\b/i},
 {id:'tech',name:'테크·가전',pattern:/아이폰|아이패드|갤럭시|에어팟|헤드폰|이어폰|스피커|키보드|마우스|카메라|닌텐도|플레이스테이션|그래픽카드|노트북|청소기|드라이어|공기청정|\b(iphone|ipad|airpods|galaxy|nintendo|headphone|laptop)\b/i},
 {id:'living',name:'생활·취미',pattern:/레고|베어브릭|피규어|트레이딩 카드|포켓몬.*카드|카드.*포켓몬|인형|쿠션|러그|의자|테이블|조명|텐트|랜턴|캠핑|텀블러|머그|보틀|\b(lego|bearbrick|figure|cushion|rug|tent)\b/i},
 {id:'special',name:'기타 품목',pattern:/골드바|골드코인|실버바|실버코인|티켓|콘서트|페스티벌|전시|위스키|와인|초콜릿|디저트/},
 {id:'unclassified',name:'미분류 포함 전체',pattern:null}
]);
export function classifyProduct(item){
 const text=[item.titleKo,item.titleEn].join(' ');
 const hits=categories.filter(c=>c.pattern?.test(text));
 // Ambiguous/unknown names remain visible in their own queue; never discarded.
 return {category:hits.length===1?hits[0].id:'unclassified',classification:'title-rule-unverified'};
}
export function candidateFromItem(item,{cursor,rank,observedAt}){
 if(!item||!/^\d{1,12}$/.test(item.productCode)||typeof item.titleKo!=='string'||typeof item.brandProductCode!=='string')throw Error('DISCOVERY_ITEM_INVALID');
 return {kind:'catalog-candidate',kreamId:item.productCode,title:item.titleKo||item.titleEn,model:item.brandProductCode,...classifyProduct(item),
  discovery:{source:discoveryPolicy.source,sort:discoveryPolicy.sort,cursor,rank,observedAt,titleEn:item.titleEn||'',totalSales:item.totalSales??null,countMeaning:'cumulative-not-30d',wishCount:item.wishCount??null}};
}
export function validateCandidate(value){
 if(!value||value.kind!=='catalog-candidate'||!/^\d{1,12}$/.test(value.kreamId)||typeof value.title!=='string'||value.title.length>400||typeof value.model!=='string'||value.model.length>100||!categories.some(c=>c.id===value.category)||!Number.isFinite(Date.parse(value.discovery?.observedAt))||value.discovery?.sort!=='popular_score')throw Error('DISCOVERY_CANDIDATE_INVALID');
 return value;
}
