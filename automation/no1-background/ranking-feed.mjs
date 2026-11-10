import fs from 'node:fs';
import {projectRankingSettings,projectRankingProducts} from './chrome-extension/ranking-data.mjs';
export const rankingPolicy=Object.freeze(JSON.parse(fs.readFileSync(new URL('./ranking-policy.json',import.meta.url),'utf8')));
export const rankingFeedTool={
  name:'no1_background_ranking_feed',
  description:'Read Musinsa Ranking Analysis using its currently selected category, period, gender and age. Popularity rank ascending, ALL section; never keyword search, NEW or rising. Background only, no UI changes. Preview does not advance a discovery cursor, consume a work order or run product judgments. Requires Connector 0.7.0.',
  inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:1000}},additionalProperties:false},
  annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:true}
};
export async function readRankingFeed(client,args={}) {
  if(!args||Array.isArray(args)||Object.keys(args).some(k=>k!=='limit')||!Number.isSafeInteger(args.limit??5)||(args.limit??5)<1||(args.limit??5)>1000)throw Error('NO1_INVALID_PAYLOAD');
  const settings=projectRankingSettings(await client.request('musinsa:ranking:settings',{}));
  const request={section:rankingPolicy.section,...settings};
  if(request.category==='000')delete request.category;
  const {products}=projectRankingProducts(await client.request('musinsa:ranking:products',request));
  return {source:rankingPolicy.source,order:rankingPolicy.order,settings,section:request.section,observedAt:new Date().toISOString(),total:products.length,products:products.slice(0,args.limit??5),cursorAdvanced:false,purchaseAuthorized:false};
}
