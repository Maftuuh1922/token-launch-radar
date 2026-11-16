import {chromium} from '/data/home/flower-web/node_modules/playwright/index.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const dir=mkdtempSync('/data/home/.hermes/cache/scratch/lantern-one-');
const p={slug:'reference',name:'Only reference',category:'Lending',chains:['Base'],tvl_usd:1e7,mcap_usd:2e7,gecko_id:'ref',symbol:'R',listed_at:null,change_7d:null};
writeFileSync(join(dir,'input.json'),JSON.stringify({as_of:'2026-11-14',watchlist:[],protocols:[p,{...p,slug:'candidate',name:'Candidate',gecko_id:null,symbol:null,mcap_usd:null}]}));
execFileSync(process.execPath,['main.ts','--prepare','--input',join(dir,'input.json'),'--output',join(dir,'out')]);
const b=await chromium.launch({executablePath:'/data/home/.hermes/tools/chromium-1208/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
try{const page=await b.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('file://'+join(dir,'out/dashboard/index.html'));await page.locator('#lab-validation').click();assert.match(await page.locator('#dialog-content').textContent(),/Unavailable/);assert.ok(!/NaN|Infinity|undefined/.test(await page.locator('#dialog-content').textContent()));assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,errors,cohort:1}));}finally{await b.close();rmSync(dir,{recursive:true,force:true});}
