export function resultDetails(team={},row={}){
 const a=team.assessment||row.assessment;
 const source=(team.observations||[]).filter(o=>o.active!==false).find(o=>o.payload?.rankingSource)?.payload.rankingSource;
 const schemas=a?.marketSchemas||row.marketSchemas||[];
 return {name:source?.productName||team.mission?.product?.model||row.productId,sourceUrl:source?.productUrl||team.mission?.product?.productUrl,at:a?.at||null,unresolved:a?.unresolved||[],readiness:a?.readiness,options:schemas.flatMap(s=>(s.rows||[]).filter(r=>r.sourceOptionMatched===true).map(r=>({platform:s.platform||(String(s.productId).startsWith('poizon-')?'poizon':'kream'),size:r.size,stock:r.stockQuantity,sales:r.expectedSales30d,salesEstimated:r.salesIsEstimated,salesStatus:r.salesStatus,salesBasis:r.salesBasis,asOf:s.salesAsOf?.timestamp,observedAt:s.observedAt,observationId:s.observationId,margins:Object.entries(r.margins||{}).filter(([mode])=>mode!=='desired').map(([mode,m])=>({mode,amount:m.marginAmount,rate:m.marginRate,status:m.status,source:m.source,feeBasis:m.feeBasis,feeSettingsVerified:m.feeSettingsVerified,feeEventVerified:m.feeEventVerified}))}))) };
}
