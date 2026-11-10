import fs from 'node:fs';
import path from 'node:path';
import {BackgroundClient} from './client.mjs';
import {readRankingFeed} from './ranking-feed.mjs';
const args=process.argv.slice(2);
if(args.some((a,i)=>i%2===0&&!['--limit','--out'].includes(a))||args.length%2)throw Error('Usage: node read-ranking.mjs [--limit 5] [--out path]');
const options=Object.fromEntries(Array.from({length:args.length/2},(_,i)=>[args[i*2],args[i*2+1]]));
try {
  const result=await readRankingFeed(new BackgroundClient(),{limit:options['--limit']===undefined?5:Number(options['--limit'])});
  if(options['--out']){fs.mkdirSync(path.dirname(path.resolve(options['--out'])),{recursive:true});fs.writeFileSync(options['--out'],JSON.stringify(result,null,2)+'\n');}
  console.log(JSON.stringify(result,null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
