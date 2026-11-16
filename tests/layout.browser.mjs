import {chromium} from '/data/home/flower-web/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const out=process.env.RADAR_PREVIEW||'/data/home/.hermes/cache/scratch/lantern-lab-final-a';
const evidence='/data/home/.hermes/cache/scratch/lantern-layout-fix';mkdirSync(evidence,{recursive:true});
const b=await chromium.launch({executablePath:'/data/home/.hermes/tools/chromium-1208/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
try{
 const p=await b.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'});await p.goto('file://'+out+'/dashboard/index.html');await p.waitForSelector('#lab-validation');await p.locator('#lab-validation').click();await p.evaluate(()=>document.fonts.ready);
 const metrics=await p.locator('.validation-table').evaluate(t=>({width:t.getBoundingClientRect().width,heads:[...t.querySelectorAll('th')].map(e=>({text:e.textContent,width:e.getBoundingClientRect().width})),rows:[...t.querySelectorAll('tbody tr')].map(r=>({height:r.getBoundingClientRect().height,cells:[...r.cells].map(e=>({text:e.textContent,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))}))}));
 console.log(JSON.stringify({desktop:metrics}));assert.ok(metrics.heads[0].width>=220,'Model name column must be readable, not a 40px rank column');assert.ok(metrics.rows.every(r=>r.height<=96),'Desktop model rows must not wrap vertically');
 await p.screenshot({path:evidence+'/validation-desktop.png'});
 const sizes=[];
 for(const w of [360,390,430,768]){await p.setViewportSize({width:w,height:844});await p.evaluate(()=>document.fonts.ready);const m=await p.locator('.validation-table').evaluate(t=>({width:innerWidth,document:document.documentElement.scrollWidth,table:t.getBoundingClientRect().width,scroll:t.scrollWidth,client:t.clientWidth,rows:[...t.querySelectorAll('tbody tr')].map(r=>({h:r.getBoundingClientRect().height,first:r.cells[0].getBoundingClientRect().width,text:r.cells[0].textContent}))}));console.log(JSON.stringify(m));assert.ok(m.document<=w);assert.ok(m.scroll<=m.client+1,'Audit must fit mobile without horizontal scrolling');assert.ok(m.rows.every(r=>r.first>=200 && r.h<190),'Model names must remain readable');sizes.push(m);if(w===390)await p.screenshot({path:evidence+'/validation-mobile.png'});}
 writeFileSync(evidence+'/layout-verification.json',JSON.stringify({desktop:metrics,sizes,passed:true},null,2));
}finally{await b.close();}
