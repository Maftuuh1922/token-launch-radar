import {chromium} from '/data/home/flower-web/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const base=process.env.RADAR_PREVIEW||'/data/home/.hermes/cache/scratch/lantern-hermes-preview';
const browser=await chromium.launch({executablePath:'/data/home/.hermes/tools/chromium-1208/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
try{
 const p=await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'no-preference'});
 await p.goto('file://'+base+'/dashboard/index.html');await p.waitForSelector('.ascii-bar');
 await p.locator('#search').fill('Steakhouse');
 const start=await p.locator('.ascii-bar').first().evaluate(e=>({animations:e.getAnimations().map(a=>a.playState),text:e.textContent,clip:getComputedStyle(e).clipPath}));
 assert.ok(start.animations.includes('running'),'Bars must animate after filtering');
 await p.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished)));
 const end=await p.locator('.ascii-bar').first().evaluate(e=>({text:e.textContent,clip:getComputedStyle(e).clipPath}));
 assert.equal(start.text,end.text,'Motion must never alter data');assert.notEqual(start.clip,end.clip,'Bars must reveal over time');
 await p.emulateMedia({reducedMotion:'reduce'});await p.locator('#reset').click();
 assert.equal(await p.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length),0,'Reduced motion must disable animations');
 await p.locator('[data-chart-detail]').first().click();assert.equal(await p.locator('.scenario-chart .ascii-bar').count(),3);
 assert.equal(await p.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length),0);
 console.log(JSON.stringify({passed:true,start,end,reduced_motion:true,detail:true}));
}finally{await browser.close();}
