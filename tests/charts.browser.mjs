import { chromium } from '/data/home/flower-web/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const out=process.env.RADAR_PREVIEW || '/data/home/.hermes/cache/scratch/lantern-hermes-preview';
const evidence='/data/home/.hermes/cache/scratch/lantern-ascii';
const browser=await chromium.launch({executablePath:'/data/home/.hermes/tools/chromium-1208/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
try {
  mkdirSync(evidence,{recursive:true});
  const p=await browser.newPage({viewport:{width:1440,height:960}}),errors=[],network=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  await p.goto('file://'+out+'/dashboard/index.html');await p.waitForSelector('tbody tr');await p.evaluate(()=>document.fonts.ready);
  assert.equal(await p.locator('#overview-chart pre.ascii-bars').count(),5,'Overview must show five ASCII charts');
  assert.equal(await p.locator('#overview-chart svg,#overview-chart canvas,tbody svg').count(),0,'Charts must be text');
  const bars=await p.locator('.ascii-bar').evaluateAll(es=>es.map(e=>({text:e.textContent,value:Number(e.dataset.value),max:Number(e.dataset.max)})));
  for(const b of bars){assert.match(b.text,/^\[[#:\.]{24}\]$/);assert.equal((b.text.match(/[#:]/g)||[]).length,Math.round(b.value/b.max*24));}
  const expectedSlugs=await p.evaluate(()=>[...data.rows].sort((a,b)=>b.implied_value_usd-a.implied_value_usd||a.slug.localeCompare(b.slug)).slice(0,5).map(r=>r.slug));
  assert.deepEqual(await p.locator('[data-chart-detail]').evaluateAll(es=>es.map(e=>e.dataset.chartDetail)),expectedSlugs);
  const name=await p.locator('[data-detail]').first().textContent();await p.locator('#search').fill(name);
  assert.equal(await p.locator('[data-chart-detail]').count(),1,'Chart must follow search');
  await p.locator('[data-chart-detail]').click();
  const actual=await p.locator('.scenario-chart .ascii-bar').evaluateAll(es=>es.map(e=>Number(e.dataset.value)));
  const expected=await p.evaluate(()=>{const r=data.rows.find(r=>r.name===document.querySelector('#dialog-title').textContent);return[r.bear_usd,r.implied_value_usd,r.bull_usd];});assert.deepEqual(actual,expected);
  await p.keyboard.press('Escape');assert.equal(await p.evaluate(()=>document.activeElement.hasAttribute('data-chart-detail')),true);
  await p.locator('#search').fill('notfoundzzz');assert.equal(await p.locator('[data-chart-detail]').count(),0);assert.match(await p.locator('#overview-chart').textContent(),/No matching records/);
  await p.locator('#reset').click();await p.locator('[data-tab="live"]').click();assert.match(await p.locator('#overview-chart').textContent(),/Recorded market cap/);
  await p.locator('[data-tab="candidate"]').click();await p.evaluate(()=>document.fonts.ready);await p.screenshot({path:evidence+'/overview.png'});
  await p.locator('[data-chart-detail]').first().click();await p.screenshot({path:evidence+'/detail.png'});await p.keyboard.press('Escape');
  const sizes=[];
  for(const width of [360,390,430,768,1440]){
    await p.setViewportSize({width,height:960});
    const g=await p.evaluate(()=>({width:innerWidth,page:document.documentElement.scrollWidth,charts:[...document.querySelectorAll('.ascii-bars')].map(e=>({client:e.clientWidth,scroll:e.scrollWidth}))}));
    assert.ok(g.page<=width);assert.ok(g.charts.every(e=>e.scroll<=e.client+1),'ASCII charts must fit their container');sizes.push(g);
    await p.locator('[data-chart-detail]').first().click();assert.ok(await p.locator('.scenario-chart').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await p.keyboard.press('Escape');
    if(width===390){await p.locator('#overview-chart').scrollIntoViewIfNeeded();await p.screenshot({path:evidence+'/mobile.png'});}
  }
  assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
  const result={passed:true,barCount:bars.length,sizes,errors,network,checks:['ASCII-only charts','bar lengths match model','top five order','filters','detail values','keyboard return','empty state','live metric labels','five screen widths']};
  writeFileSync(evidence+'/verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {await browser.close();}
