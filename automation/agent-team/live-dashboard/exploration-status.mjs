const marketKeys=row=>[...new Set([row.packetProductId,...(row.marketKeys||[])].filter(Boolean).map(String))];

export function explorationStatus(batches=[]){
 const rows=[];
 for(const [batchOrder,batch] of batches.entries()){
  const results=new Map((batch.sources||[]).map(row=>[String(row.sourceId),row]));
  const products=new Map((batch.products||[]).map(row=>[String(row.productId),row]));
  for(const source of batch.sourceItems||[]){
   const found=results.get(String(source.productId)),markets=found?marketKeys(found).map(id=>{
    const product=products.get(id);
    return {productId:id,verified:product?.verified===true,decision:product?.verified?product.decision:null,status:product?.status||'pending'};
   }):[];
   const status=!found?'waiting':found.status==='skipped'?'skipped':batch.status==='needs_attention'||markets.some(m=>m.status==='needs_attention')?'attention':markets.length&&markets.every(m=>m.verified)?'reviewed':'reviewing';
   rows.push({sourceId:String(source.productId),rank:source.rank??null,name:source.productName||String(source.productId),url:source.productUrl||null,batchId:batch.runId,batchOrder,status,collectionStatus:found?.status||'waiting',reason:found?.reason||null,markets});
  }
 }
 const counts={assigned:rows.length,collected:rows.filter(r=>r.collectionStatus==='collected').length,skipped:rows.filter(r=>r.status==='skipped').length,reviewed:rows.filter(r=>r.status==='reviewed').length,adopt:rows.filter(r=>r.status==='reviewed'&&r.markets.some(m=>m.decision==='adopt')).length,attention:rows.filter(r=>r.status==='attention').length};
 counts.pending=counts.assigned-counts.reviewed-counts.skipped;
 return {counts,rows:rows.sort((a,b)=>b.batchOrder-a.batchOrder||((a.rank??Infinity)-(b.rank??Infinity)))};
}
