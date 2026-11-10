const aliases = {
  '파타고니아':['PATAGONIA'], '스톤아일랜드':['STONE ISLAND'], '아크테릭스':['ARCTERYX','ARC TERYX'],
  '살로몬':['SALOMON'], '나이키':['NIKE'], '아디다스':['ADIDAS'], '아식스':['ASICS'],
  '폴로':['POLO','RALPH LAUREN'], '라코스테':['LACOSTE'], '오니츠카타이거':['ONITSUKA TIGER'],
  '호카':['HOKA'], '컨버스':['CONVERSE'], '칼하트':['CARHARTT'], '코스':['COS'],
  '뉴에라':['NEW ERA'], '메종':['MAISON MARGIELA'], '오프화이트':['OFF WHITE','OFF-WHITE'],
  '디스이즈네버댓':['THISISNEVERTHAT'], '조던':['JORDAN']
};
const compact = value => String(value || '').toUpperCase().replace(/[^A-Z0-9가-힣]/g,'');

// Short numeric style codes are reused across unrelated categories. Require a brand anchor as well.
export function productIdentityCompatible(productTitle,offerTitle,model) {
  if (!/^\d{4,6}(?:\/\d{4,6})?$/.test(String(model || '').trim())) return true;
  const brand = String(productTitle || '').trim().split(/\s+/)[0];
  const candidates = [brand,...(aliases[brand] || [])].map(compact).filter(x=>x.length>=3);
  const target = compact(offerTitle);
  return candidates.some(name=>target.includes(name));
}
