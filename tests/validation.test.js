// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildBoard,buildCohorts,quantile} from '../lib/model.js';
const validation = await import('../lib/validation.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const p = (slug,extra={}) => ({slug,name:slug,category:'Lending',chains:['Base'],
  tvl_usd:1e7,mcap_usd:2e7,gecko_id:slug,symbol:null,listed_at:null,change_7d:null,...extra});
const fixture = protocols => ({as_of:'2026-11-14',watchlist:[],protocols});
const powerLaw = Array.from({length:15},(_,i) => p(`ref-${String(i).padStart(2,'0')}`,
  {tvl_usd:1e6*(i+1),mcap_usd:1e6*(i+1)**1.5}));
const close = (a,b) => assert.ok(Math.abs(a-b)<=1e-10*Math.max(1,Math.abs(b)),`${a} != ${b}`);

test('train-only baselines recover a power law and ignore held-out valuation',()=>{
  assert.equal(typeof validation.fitModels,'function');
  const predict = validation.fitModels(powerLaw,'2026-11-14');
  const held = p('held',{tvl_usd:7.5e6});
  const actual = 1e6*7.5**1.5;
  const result = predict(held);
  close(result.logLogOLS,actual);
  close(result.globalRatio,held.tvl_usd*quantile(powerLaw.map(r=>r.mcap_usd/r.tvl_usd),0.5));
  assert.deepEqual(predict({...held,mcap_usd:1e13}),result);
  Object.defineProperty(held,'mcap_usd',{get(){throw Error('held-out target accessed');}});
  assert.deepEqual(predict(held),result);
});

test('current candidate equals unchanged buildBoard with training-only cohort',()=>{
  const train = powerLaw.map((r,i)=>({...r,category:i%3?'Lending':'Dexs',
    mcap_usd:i===0?1e12:i===1?1:r.mcap_usd}));
  const predict = validation.fitModels(train,'2026-11-14');
  for (const extra of [
    {category:'Lending',listed_at:'2025-01-01',change_7d:12},
    {category:'Dexs',listed_at:'2026-11-14',change_7d:-1e4},
    {category:'Unseen',listed_at:'2030-01-01',change_7d:1e4},
    {category:null,listed_at:'unknown',change_7d:null},
    {tvl_usd:1e14,listed_at:'2020-01-01',change_7d:0}
  ]) {
    const held = p('held',{...extra,mcap_usd:null,gecko_id:null});
    const expected = buildBoard(fixture([...train,held])).rows[0].implied_value_usd;
    assert.equal(predict(held).current,expected);
  }
});

test('fixed five-fold report predicts every unique token once and is order invariant',()=>{
  assert.equal(typeof validation.validateModel,'function');
  const s = fixture([...powerLaw,
    p('duplicate',{gecko_id:powerLaw[0].gecko_id,tvl_usd:1e5,mcap_usd:1e12}),
    p('excluded',{category:'Bridge'}),p('missing',{mcap_usd:null}),
    p('unknown-id',{gecko_id:null}),p('nonpositive',{mcap_usd:0})]);
  const before = structuredClone(s), report = validation.validateModel(s);
  assert.deepEqual(s,before);
  assert.deepEqual(validation.validateModel(s),report);
  assert.deepEqual(validation.validateModel({...s,protocols:[...s.protocols].reverse()}),report);
  assert.equal(report.n,15);
  assert.equal(report.folds,5);
  assert.equal(report.points.length,15);
  assert.equal(report.foldMetrics.length,5);
  assert.equal(new Set(report.points.map(p=>p.slug)).size,15);
  assert.equal(report.coverage.protocols,s.protocols.length);
  assert.equal(report.coverage.referenceTokens,15);
  assert.match(report.method,/sorted slugs/i);
  assert.match(report.limits,/cross-sectional/i);
  assert.match(report.limits,/pre-token.*payout/i);
  assert.match(report.limits,/not.*temporal/i);
  report.points.forEach((point,i)=>{
    const original = powerLaw[i];
    assert.equal(point.slug,original.slug);
    assert.equal(point.fold,i%5);
    assert.equal(point.tvl,original.tvl_usd);
    assert.equal(point.actual,original.mcap_usd);
    close(point.pred.logLogOLS,point.actual);
    const train = powerLaw.filter((_,j)=>j%5!==point.fold);
    assert.deepEqual(point.pred,validation.fitModels(train,s.as_of)(original));
  });
  for (const fold of report.foldMetrics) {
    assert.equal(fold.n,3);
    assert.equal(fold.trainN,12);
    assert.equal(fold.models.logLogOLS.n,3);
  }
  const ols = report.models.logLogOLS;
  assert.equal(ols.n,15);
  close(ols.meanAbsoluteLog10Error,0);
  close(ols.medianMultiplicativeError,1);
  assert.equal(ols.within3x,1);
});

test('changing an entire held-out fold target leaves its predictions identical',()=>{
  const s=fixture(powerLaw), before=validation.validateModel(s);
  const changed=fixture(powerLaw.map((r,i)=>i%5===0?{...r,mcap_usd:r.mcap_usd*1e5}:r));
  const after=validation.validateModel(changed);
  const selected=r=>r.points.filter(p=>p.fold===0).map(p=>({slug:p.slug,pred:p.pred}));
  assert.deepEqual(selected(after),selected(before));
  assert.notEqual(after.models.current.meanAbsoluteLog10Error,before.models.current.meanAbsoluteLog10Error);
});

test('metric pooling uses every held-out error with multiplicative under/over symmetry',()=>{
  const report=validation.validateModel(fixture(powerLaw.map((r,i)=>({...r,
    mcap_usd:r.mcap_usd*(i%2?100:0.01)}))));
  for(const group of [report,...report.foldMetrics]) {
    const points=group===report?report.points:report.points.filter(p=>p.fold===group.fold);
    for(const [key,metric] of Object.entries(group.models)) {
      const factors=points.map(p=>Math.max(p.pred[key]/p.actual,p.actual/p.pred[key]));
      const errors=factors.map(Math.log10).sort((a,b)=>a-b);
      const mid=(errors.length-1)/2;
      close(metric.meanAbsoluteLog10Error,errors.reduce((s,x)=>s+x,0)/errors.length);
      close(metric.medianMultiplicativeError,10**((errors[Math.floor(mid)]+errors[Math.ceil(mid)])/2));
      close(metric.within3x,factors.filter(x=>x<=3).length/factors.length);
      assert.equal(metric.n,points.length);
    }
  }
});

test('small samples expose coverage gaps and refuse in-sample fallback',()=>{
  const s=fixture([p('a',{category:'Unique',listed_at:'bad'}),
    p('b',{category:'Other',listed_at:'2030-01-01',mcap_usd:8e7})]);
  const report=validation.validateModel(s);
  assert.equal(report.folds,2);
  assert.equal(report.coverage.missingAge,2);
  assert.equal(report.coverage.missingGrowth,2);
  assert.equal(report.coverage.unseenSectorHoldouts,2);
  assert.equal(report.coverage.thinSectorHoldouts,2);
  assert.deepEqual(report.coverage.referenceTvlRange,[1e7,1e7]);
  close(report.points[0].pred.logLogOLS,8e7);
  assert.throws(()=>validation.validateModel(fixture([p('alone')])),/at least two/i);
  assert.throws(()=>validation.validateModel(fixture([])),/comparables/i);
  assert.throws(()=>validation.validateModel({...s,as_of:'2026-02-30'}),/as_of/i);
  const pred=validation.fitModels([p('a',{mcap_usd:1e7}),p('b',{mcap_usd:9e7})],s.as_of)(p('held'));
  close(pred.logLogOLS,3e7);
});

test('within-three-times includes the exact boundary in both directions',()=>{
  const report=validation.validateModel(fixture([p('a',{mcap_usd:1e7}),p('b',{mcap_usd:3e7})]));
  assert.equal(report.models.globalRatio.within3x,1);
});

test('numeric extrapolation failure is explicit rather than a fabricated metric',()=>{
  const predict=validation.fitModels([p('a',{tvl_usd:1e7,mcap_usd:1}),
    p('b',{tvl_usd:1e7+1,mcap_usd:1e300})],'2026-11-14');
  assert.throws(()=>predict(p('held',{tvl_usd:1e14})),/non-finite|positive finite/i);
});

test('sealed snapshot has complete finite OOF metrics and exact current predictions',()=>{
  const input=process.env.RADAR_TEST_INPUT || '/input/snapshot.json';
  const s=JSON.parse(readFileSync(input,'utf8'));
  const original=new Map(s.protocols.map(p=>[p.slug,p]));
  const report=validation.validateModel(s);
  assert.equal(report.n,86);
  assert.deepEqual(report.foldMetrics.map(f=>f.n),[18,17,17,17,17]);
  assert.deepEqual(report.coverage,{protocols:758,referenceTokens:86,sectors:26,
    missingAge:20,missingGrowth:0,unseenSectorHoldouts:15,thinSectorHoldouts:39,
    referenceTvlRange:[5045118,4903633832]});
  assert.deepEqual(report.points.map(p=>p.slug),buildCohorts(s.protocols).refs.map(r=>r.slug));
  for(const fold of report.foldMetrics) {
    const train=report.points.filter(p=>p.fold!==fold.fold).map(p=>original.get(p.slug));
    const held=report.points.filter(p=>p.fold===fold.fold);
    const board=buildBoard({...s,watchlist:[],protocols:[...train,...held.map(p=>({
      ...original.get(p.slug),mcap_usd:null,symbol:null,gecko_id:null}))]});
    for(const point of held) {
      assert.equal(point.pred.current,board.rows.find(r=>r.slug===point.slug).implied_value_usd);
      assert.equal(point.actual,original.get(point.slug).mcap_usd);
    }
  }
  const expected={current:[0.7243212580153447,4.949289044539045,34/86],
    globalRatio:[0.7055090126364323,4.564795705468667,33/86],
    logLogOLS:[0.6340208580626829,3.261106165639588,42/86]};
  for(const [key,[mae,median,within]] of Object.entries(expected)) {
    close(report.models[key].meanAbsoluteLog10Error,mae);
    close(report.models[key].medianMultiplicativeError,median);
    close(report.models[key].within3x,within);
  }
  assert.deepEqual(validation.validateModel({...s,protocols:[...s.protocols].reverse()}),report);
  assert.deepEqual(JSON.parse(JSON.stringify(report)),report);
  assert.ok(readFileSync(new URL('../lib/validation.js',import.meta.url)).length<=4500);
});
