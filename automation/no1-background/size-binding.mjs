import fs from 'node:fs';
const registry=JSON.parse(fs.readFileSync(new URL('./size-evidence.json',import.meta.url),'utf8'));
export const sizeKey=value=>String(value??'').trim().toUpperCase().replace(/\s+/g,'')
  // Only the existing apparel size annotation is equivalent to its letter size.
  // Never strip gender, width, or a second region from shoe labels.
  .replace(/^(XXS|XS|S|M|L|XL|XXL|2XL|3XL)\(\d{2,3}\)$/,'$1');
export function matchMarketSize({stock,productUrl,kreamId,sourceSize,prices,now=Date.now(),evidence=registry.entries}){
  const exact=prices.filter(p=>sizeKey(p.size)===sizeKey(sourceSize));
  if(exact.length===1)return {price:exact[0],evidence:{kind:'same-size-label',sourceSize,marketSize:exact[0].size}};
  if(exact.length>1)return null;
  const eligible=evidence.filter(e=>now-Date.parse(e.verifiedAt)>=0&&now-Date.parse(e.verifiedAt)<=90*86400000&&
    e.bindings.some(b=>b.kreamId===kreamId&&b.model===stock.makerNumber&&b.productUrl===productUrl)&&
    stock.name?.includes(e.sourceNameMarker)&&e.pairs[sourceSize]);
  if(eligible.length!==1)return null;
  const e=eligible[0],matches=prices.filter(p=>sizeKey(p.size)===sizeKey(e.pairs[sourceSize]));
  if(matches.length!==1)return null;
  return {price:matches[0],evidence:{kind:'scoped-manufacturer-chart',id:e.id,sourceSize,marketSize:matches[0].size,
    verifiedAt:e.verifiedAt,chartUrl:e.chartUrl,productEvidenceUrl:e.productEvidenceUrl,
    localLabelEvidenceUrl:e.localLabelEvidenceUrl,basis:e.basis}};
}
