import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const output=await build({entryPoints:[fileURLToPath(new URL('./app.mjs',import.meta.url))],bundle:true,format:'esm',write:false,minify:true,target:'es2022'});
const base=new URL('./',import.meta.url);
let html=fs.readFileSync(new URL('index.html',base),'utf8').replace('/* STYLES */',()=>fs.readFileSync(new URL('style.css',base),'utf8')).replace('/* SCRIPT */',()=>output.outputFiles[0].text.replace(/<\/script/gi,'<\\/script'));
fs.mkdirSync(new URL('dist/',base),{recursive:true});fs.writeFileSync(new URL('dist/panel.html',base),html);console.log(JSON.stringify({built:'dist/panel.html',bytes:Buffer.byteLength(html)}));
