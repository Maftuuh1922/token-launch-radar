// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildBoard,buildCohorts,validateSnapshot,exclusion} from '../lib/model.js';
const input=process.env.RADAR_TEST_INPUT || '/input/snapshot.json';
const s=JSON.parse(readFileSync(input,'utf8'));
const b=buildBoard(s);
const p=(slug,extra={})=>({slug,name:slug,category:'Lending',chains:['Base'],tvl_usd:1e7,mcap_usd:null,gecko_id:null,symbol:null,listed_at:'2025-01-01',change_7d:5,...extra});
const fixture=(extra=[])=>({as_of:'2026-11-14',watchlist:[],protocols:[...Array.from({length:10},(_,i)=>p('ref'+i,{gecko_id:'coin'+i,symbol:'C'+i,mcap_usd:1e7*(1+i/10)})),p('candidate'),...extra]});
test('sealed universe is covered, disjoint and watchlist exact',()=>{
 assert.equal(b.rows.length+b.live.length+b.excluded.length,s.protocols.length);
 assert.equal(new Set([...b.rows,...b.live,...b.excluded].map(r=>r.slug)).size,s.protocols.length);
 assert.deepEqual(b.rows.filter(r=>r.watchlist).map(r=>r.slug).sort(),[...s.watchlist].sort());
 assert.ok(b.rows.length>=100 && b.rows.length<=4000);
 for(const r of b.rows)assert.equal(r.state,'candidate');
 for(const r of b.live)assert.ok(r.gecko_id || r.symbol || r.mcap_usd>0);
 for(const p of s.protocols.filter(p=>!p.gecko_id&&!p.symbol&&!(p.mcap_usd>0)&&!exclusion(p)))assert.ok(b.rows.some(r=>r.slug===p.slug));
});
test('ranks, ties, values and scenario bounds',()=>{
 b.rows.forEach((r,i)=>{assert.equal(r.rank,i+1);assert.ok(Number.isSafeInteger(r.implied_value_usd)&&r.implied_value_usd>0&&r.implied_value_usd<=1e14);assert.ok(r.bear_usd<=r.implied_value_usd&&r.bull_usd>=r.implied_value_usd);if(i)assert.ok(b.rows[i-1].implied_value_usd>=r.implied_value_usd);});
 assert.ok(new Set(b.rows.map(r=>r.implied_value_usd)).size>1);
 const f=fixture([p('aaa'),p('zzz')]);const out=buildBoard(f).rows;assert.deepEqual(out.map(r=>r.slug),['aaa','candidate','zzz']);
});
test('all numeric output finite; farm steps meet bounds and costs separated',()=>{
 const walk=x=>{if(typeof x==='number')assert.ok(Number.isFinite(x));else if(x&&typeof x==='object')Object.values(x).forEach(walk);};walk(b);
 for(const r of [...b.rows,...b.live,...b.excluded]){assert.ok(r.farm_steps.length>=3&&r.farm_steps.length<=12);for(const step of r.farm_steps)assert.ok(step.trim().length>=20&&step.trim().length<=600,`${r.slug}: ${step.length}`);assert.ok(r.farm_steps.some(s=>s.includes('Capital-at-risk')));}
});
test('determinism and protocol input permutation invariance',()=>{
 assert.deepEqual(buildBoard(s),b);assert.deepEqual(buildBoard({...s,protocols:[...s.protocols].reverse()}),b);
});
test('missing growth and date are neutral and visibly flagged',()=>{
 const r=buildBoard(fixture([p('missing',{listed_at:null,change_7d:null,category:null})])).rows.find(r=>r.slug==='missing');
 assert.equal(r.age_days,null);assert.equal(r.growth_factor,1);assert.equal(r.age_factor,1);assert.equal(r.coverage,'Fallback');assert.equal(r.multiple,r.global_multiple);
});
test('category cohorts isolate sectors and deduplicate identifiers',()=>{
 const c=buildCohorts(fixture([p('dex',{category:'Dexs',gecko_id:'dex',mcap_usd:2e7}),p('duplicate',{gecko_id:'coin0',mcap_usd:9e7,tvl_usd:9e6}),p('wrapped',{name:'Wrapped Example',gecko_id:'wrapped',mcap_usd:1e10})]).protocols);
 assert.equal(c.refs.length,11);assert.equal(c.sectors.get('Dexs').length,1);assert.equal(c.sectors.get('Lending').length,10);assert.ok(!c.refs.some(r=>r.slug==='duplicate'||r.slug==='wrapped'));
});
test('single extreme comparable does not dominate median estimates',()=>{
 const base=buildBoard(fixture()).rows[0].implied_value_usd;
 const out=buildBoard(fixture([p('outlier',{gecko_id:'extreme',mcap_usd:1e14})])).rows[0].implied_value_usd;
 assert.ok(out/base<1.15 && out/base>0.85);
 const r=buildBoard(fixture([p('extreme-growth',{change_7d:1e12})])).rows.find(r=>r.slug==='extreme-growth');assert.equal(r.growth_factor,1.1);
});
test('watchlist override keeps excluded and live records without duplicate board slugs',()=>{
 const f=fixture([p('bridge',{category:'Bridge'}),p('live-watch',{symbol:'TOKEN'})]);f.watchlist=['bridge','live-watch'];
 const o=buildBoard(f);assert.ok(o.rows.find(r=>r.slug==='bridge').watchlist_override);assert.equal(o.rows.find(r=>r.slug==='live-watch').state,'live');assert.equal(new Set(o.rows.map(r=>r.slug)).size,o.rows.length);
 assert.throws(()=>buildBoard({...f,watchlist:['unknown']}),/watchlist/);assert.throws(()=>buildBoard({...f,watchlist:['bridge','bridge']}),/watchlist/);
});
test('prototype-like keys are inert, malformed fields rejected',()=>{
 const f=fixture([p('__proto__',{category:'__proto__'}),p('constructor',{category:'constructor'})]);
 assert.equal(buildBoard(f).rows.length,3);assert.equal({}.polluted,undefined);
 for(const invalid of [p('bad slug'),p('nan',{tvl_usd:NaN}),p('inf',{change_7d:Infinity}),p('chains',{chains:[{}]})])assert.throws(()=>validateSnapshot(fixture([invalid])));
 assert.throws(()=>validateSnapshot({...fixture(),as_of:'2026-02-30'}));
 assert.throws(()=>validateSnapshot({...fixture(),protocols:[Object.create(p('inherited'))]}));
 assert.throws(()=>buildBoard({as_of:'2026-11-14',protocols:[p('alone')],watchlist:[]}),/comparables/);
});
for (const chains of [['Binance'], ['Ethereum', 'Binance']]) {
 test(`Binance low-fee selection preserves original chains: ${chains.join('+')}`,()=>{
  const original = [...chains];
  const f = fixture([p('binance-regression',{name:'Chain fee regression',chains})]);
  const row = buildBoard(f).rows.find(r=>r.slug==='binance-regression');
  assert.equal(row.plan.chain,'Binance');
  assert.deepEqual(row.plan.fees,[1,8]);
  assert.deepEqual(row.chains,original);
  assert.deepEqual(f.protocols.find(r=>r.slug==='binance-regression').chains,original);
 });
}
test('chain and category plans respect access and prohibit leverage',()=>{
 const o=buildBoard(fixture([p('eth',{chains:['Ethereum']}),p('rwa',{category:'RWA'}),p('derivative',{category:'Derivatives'}),p('curator',{category:'Risk Curators'})]));
 const row=id=>o.rows.find(r=>r.slug===id);
 assert.deepEqual(row('eth').plan.fees,[15,80]);assert.deepEqual(row('candidate').plan.fees,[1,8]);assert.match(row('rwa').farm_steps[1],/KYC/);assert.deepEqual(row('derivative').plan.capital,[0,0]);assert.match(row('curator').farm_steps[1],/curated/);
});
