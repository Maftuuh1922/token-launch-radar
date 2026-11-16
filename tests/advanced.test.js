// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildBoard,buildCohorts,quantile} from '../lib/model.js';
import {validateModel} from '../lib/validation.js';
const advanced = await import('../lib/advanced.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const p=(slug,extra={})=>({slug,name:slug,category:'Lending',chains:['Base'],
  tvl_usd:1e7,mcap_usd:2e7,gecko_id:slug,symbol:null,listed_at:null,change_7d:null,...extra});
const fixture=protocols=>({as_of:'2026-11-14',watchlist:[],protocols});
const powerLaw=Array.from({length:20},(_,i)=>p(`ref-${String(i).padStart(2,'0')}`,
  {tvl_usd:1e6*(i+1),mcap_usd:1e6*(i+1)**1.5}));
const close=(a,b,tol=1e-10)=>assert.ok(Math.abs(a-b)<=tol*Math.max(1,Math.abs(b)),`${a} != ${b}`);

test('nested selection recovers a power law without reading held-out targets',()=>{
  assert.equal(typeof advanced.nestedPredict,'function');
  const held=p('held',{tvl_usd:7.5e6});
  const before=structuredClone(powerLaw);
  const out=advanced.nestedPredict(powerLaw,[held],'2026-11-14');
  assert.equal(out.selected,'ols');
  assert.equal(out.predictions[0].slug,'held');
  assert.ok(Math.abs(out.predictions[0].value_usd-1e6*7.5**1.5)<=0.5);
  assert.deepEqual(out.selection_scores.map(r=>r.method),['ols','sector-k4','sector-k12']);
  assert.deepEqual(advanced.nestedPredict(powerLaw,[{...held,mcap_usd:1e13}],'2026-11-14'),out);
  Object.defineProperty(held,'mcap_usd',{get(){throw Error('held-out target accessed');}});
  assert.deepEqual(advanced.nestedPredict(powerLaw,[held],'2026-11-14'),out);
  assert.deepEqual(advanced.nestedPredict([...powerLaw].reverse(),[held],'2026-11-14'),out);
  assert.deepEqual(powerLaw,before);
});

test('production values and nested OOF evidence use the same selected procedure',()=>{
  assert.equal(typeof advanced.upgradeBoard,'function');
  const s=fixture([...powerLaw,p('candidate',{gecko_id:null,mcap_usd:null,tvl_usd:7.5e6})]);
  const old=buildBoard(s), before=structuredClone(s), board=advanced.upgradeBoard(s);
  const row=board.rows[0], report=board.advanced;
  assert.deepEqual(s,before);
  for(const key of ['reference','live','excluded','model'])assert.deepEqual(board[key],old[key]);
  assert.equal(report.training_n,20);
  assert.equal(report.selected,'ols');
  assert.equal(report.cv_points.length,20);
  assert.deepEqual(report.cv_points.map(p=>p.slug),old.reference.map(p=>p.slug));
  assert.equal(row.implied_value_usd,advanced.nestedPredict(powerLaw,[row],s.as_of).predictions[0].value_usd);
  assert.notEqual(row.implied_value_usd,old.rows[0].implied_value_usd);
  assert.equal(row.advanced.legacy_value_usd,old.rows[0].implied_value_usd);
  assert.equal(row.legacy_implied_value_usd,old.rows[0].implied_value_usd);
  assert.deepEqual(row.plan,old.rows[0].plan);
  assert.match(report.selection_rule,/inner.*4/i);
  assert.match(report.selection_rule,/outer.*5/i);
  assert.match(report.limits,/cross-sectional/i);
  assert.match(report.limits,/not.*temporal/i);
  for(const point of report.cv_points) {
    const train=powerLaw.filter((_,i)=>i%5!==point.fold);
    const held=powerLaw.find(p=>p.slug===point.slug);
    const out=advanced.nestedPredict(train,[held],s.as_of);
    assert.equal(point.pred.selected,out.predictions[0].value_usd);
    assert.equal(point.method,out.selected);
    assert.deepEqual(point.selection_scores,out.selection_scores);
    const legacy=buildBoard(fixture([...train,{...held,mcap_usd:null,gecko_id:null}])).rows[0];
    assert.equal(point.pred.legacy,legacy.implied_value_usd);
  }
  for(const [key,m] of Object.entries(report.models)) {
    const errors=report.cv_points.map(p=>Math.abs(Math.log10(p.pred[key])-Math.log10(p.actual)));
    assert.equal(m.n,20);assert.equal(typeof m.name,'string');
    close(m.meanAbsoluteLog10Error,errors.reduce((s,x)=>s+x,0)/errors.length);
    close(m.medianMultiplicativeError,10**quantile(errors,.5));
    close(m.within3x,errors.filter(e=>e<=Math.log10(3)).length/errors.length);
  }
});

// Separate reference implementation: no production fitting/selection imports.
function independentFit(train,method) {
  const x=train.map(p=>Math.log10(p.tvl_usd)), y=train.map(p=>Math.log10(p.mcap_usd));
  const xm=x.reduce((a,b)=>a+b)/x.length, ym=y.reduce((a,b)=>a+b)/y.length;
  const xx=x.reduce((s,v)=>s+(v-xm)**2,0);
  const slope=xx?x.reduce((s,v,i)=>s+(v-xm)*(y[i]-ym),0)/xx:0;
  const intercept=ym-slope*xm;
  const k=method==='sector-k4'?4:method==='sector-k12'?12:0;
  return p=>{
    const sector=train.map((q,i)=>({q,i})).filter(({q})=>(q.category||'Unclassified')===(p.category||'Unclassified'));
    const offset=k?sector.reduce((s,{i})=>s+y[i]-intercept-slope*x[i],0)/(sector.length+k):0;
    return Math.round(10**Math.max(0,Math.min(14,intercept+slope*Math.log10(p.tvl_usd)+offset)));
  };
}
const sectorData=Array.from({length:40},(_,i)=>p(`ref-${String(i).padStart(2,'0')}`,
  {tvl_usd:1e6*(1+Math.floor(i/2)),mcap_usd:1e6*(1+Math.floor(i/2))**.7*(i%2?5:.2),category:i%2?'Dexs':'Lending'}));

test('sector selection equals independent fixed-candidate four-fold search',()=>{
  const methods=['ols','sector-k4','sector-k12'];
  const scores=methods.map(method=>{
    let total=0;
    for(let fold=0;fold<4;fold++) {
      const predict=independentFit(sectorData.filter((_,i)=>i%4!==fold),method);
      sectorData.filter((_,i)=>i%4===fold).forEach(p=>total+=Math.abs(Math.log10(predict(p))-Math.log10(p.mcap_usd)));
    }
    return total/sectorData.length;
  });
  const out=advanced.nestedPredict(sectorData,[p('held',{category:'Dexs'})],'2026-11-14');
  const best=methods[scores.indexOf(Math.min(...scores))];
  assert.equal(best,'sector-k4');
  assert.equal(out.selected,best);
  scores.forEach((score,i)=>close(out.selection_scores[i].meanAbsoluteLog10Error,score));
  assert.equal(out.predictions[0].value_usd,independentFit(sectorData,best)(p('held',{category:'Dexs'})));
});

test('residual bands and 64 conditional bootstrap ranks match independent calculations',()=>{
  const candidates=Array.from({length:27},(_,i)=>p(`candidate-${i}`,{gecko_id:null,mcap_usd:null,
    category:i%3?'Dexs':'Unknown',tvl_usd:1e6*(i+1)}));
  const s=fixture([...sectorData,...candidates]), board=advanced.upgradeBoard(s), report=board.advanced;
  assert.equal(report.bootstrap_runs,64);
  assert.equal(report.seed,20261114);
  assert.match(report.band_label,/empirical residual band/i);
  assert.match(report.band_label,/not.*calibrated|no.*guarantee/i);
  assert.match(report.limits,/conditional.*selected method/i);
  const errors=report.cv_points.map(p=>Math.abs(Math.log10(p.pred.selected)-Math.log10(p.actual)));
  const factor=10**quantile(errors,.8);
  let state=report.seed;
  const ranks=new Map(candidates.map(p=>[p.slug,[]]));
  for(let b=0;b<64;b++) {
    const sample=sectorData.map(()=>{
      state=(Math.imul(state,1664525)+1013904223)>>>0;
      return sectorData[Math.floor(state/4294967296*sectorData.length)];
    });
    const predict=independentFit(sample,report.selected);
    candidates.map(p=>({slug:p.slug,value:predict(p)})).sort((a,b)=>b.value-a.value||(a.slug<b.slug?-1:a.slug>b.slug?1:0))
      .forEach((p,i)=>ranks.get(p.slug).push(i+1));
  }
  for(const row of board.rows) {
    close(row.advanced.band_factor,factor);
    const rr=ranks.get(row.slug);
    assert.equal(row.advanced.rank_low,Math.floor(quantile(rr,.1)));
    assert.equal(row.advanced.rank_high,Math.ceil(quantile(rr,.9)));
    assert.equal(row.advanced.top20_share,rr.filter(r=>r<=20).length/64);
    assert.ok(row.bear_usd<=row.implied_value_usd&&row.implied_value_usd<=row.bull_usd);
    assert.equal(row.bear_usd,Math.round(Math.max(1,row.implied_value_usd/factor)));
    assert.equal(row.bull_usd,Math.round(Math.min(1e14,row.implied_value_usd*factor)));
    assert.equal(row.advanced.extrapolated,row.tvl_usd<1e6||row.tvl_usd>20e6);
    assert.ok(row.advanced.peers.length>0&&row.advanced.peers.length<=4);
    for(const peer of row.advanced.peers) {
      assert.deepEqual(Object.keys(peer).sort(),['category','mcap_usd','name','slug','tvl_usd']);
      assert.ok(board.reference.some(p=>p.slug===peer.slug));
    }
    const e=row.advanced.explanation;
    assert.equal(row.implied_value_usd,Math.round(10**Math.max(0,Math.min(14,e.intercept+e.slope*Math.log10(row.tvl_usd)+e.sector_offset))));
  }
  assert.deepEqual(advanced.upgradeBoard({...s,protocols:[...s.protocols].reverse()}),board);
});

test('changing all held-out targets cannot influence their model choice or predictions',()=>{
  const before=advanced.upgradeBoard(fixture(sectorData)).advanced;
  const after=advanced.upgradeBoard(fixture(sectorData.map((p,i)=>i%5===2?{...p,mcap_usd:p.mcap_usd*1e6}:p))).advanced;
  const projected=r=>r.cv_points.filter(p=>p.fold===2).map(({slug,pred,method,selection_scores})=>({slug,pred,method,selection_scores}));
  assert.deepEqual(projected(after),projected(before));
  assert.notEqual(before.models.selected.meanAbsoluteLog10Error,after.models.selected.meanAbsoluteLog10Error);
});

function finiteTree(x) {
  if(typeof x==='number')assert.ok(Number.isFinite(x),`non-finite ${x}`);
  else if(x&&typeof x==='object')Object.values(x).forEach(finiteTree);
}
test('no references produce an explicit unestimated board without synthetic comparables',()=>{
  const s=fixture([p('candidate',{gecko_id:null,mcap_usd:null}),p('bridge',{category:'Bridge',gecko_id:null,mcap_usd:null}),
    p('live',{symbol:'TOKEN',gecko_id:null,mcap_usd:null})]);
  s.watchlist=['bridge','live'];
  const board=advanced.upgradeBoard(s);
  assert.equal(board.advanced.training_n,0);
  assert.equal(board.advanced.selected,null);
  assert.equal(board.advanced.bootstrap_runs,0);
  assert.deepEqual(board.reference,[]);
  assert.deepEqual(board.advanced.cv_points,[]);
  assert.equal(board.model.global_n,0);
  assert.equal(board.rows.length,3);
  assert.equal(board.live.length,1);
  assert.equal(board.rows.find(p=>p.slug==='live').state,'live');
  assert.equal(board.rows.find(p=>p.slug==='bridge').watchlist,true);
  assert.equal(board.advanced.models.selected.n,0);
  assert.equal(board.advanced.models.selected.meanAbsoluteLog10Error,null);
  assert.match(board.advanced.band_label,/unavailable/i);
  for(const row of board.rows) {
    assert.equal(row.implied_value_usd,null);
    assert.equal(row.bear_usd,null);assert.equal(row.bull_usd,null);
    assert.equal(row.advanced.rank_low,null);assert.equal(row.advanced.top20_share,null);
    assert.deepEqual(row.advanced.peers,[]);
  }
  finiteTree(board);
  assert.deepEqual(advanced.upgradeBoard({...s,protocols:[...s.protocols].reverse()}),board);
  assert.equal(advanced.upgradeBoard(fixture([])).rows.length,0);
});

test('one reference and numerical extremes have bounded values and honest unavailable evidence',()=>{
  const one=advanced.upgradeBoard(fixture([p('ref'),p('candidate',{gecko_id:null,mcap_usd:null,tvl_usd:1e14})]));
  assert.equal(one.advanced.models.selected.n,0);
  assert.equal(one.advanced.models.selected.meanAbsoluteLog10Error,null);
  assert.match(one.advanced.band_label,/unavailable/i);
  assert.equal(one.rows[0].bear_usd,1);assert.equal(one.rows[0].bull_usd,1e14);
  for(const train of [
    [p('a',{tvl_usd:1e7,mcap_usd:1}),p('b',{tvl_usd:1e7+1,mcap_usd:1e300})],
    [p('a',{tvl_usd:1e-300,mcap_usd:1e300}),p('b',{tvl_usd:2e-300,mcap_usd:1e300})],
    [p('a',{tvl_usd:1e14,mcap_usd:1e-300}),p('b',{tvl_usd:1e14,mcap_usd:1e-299})]
  ]) {
    const board=advanced.upgradeBoard(fixture([...train,p('candidate',{gecko_id:null,mcap_usd:null,tvl_usd:1e14})]));
    finiteTree(board);
    const row=board.rows[0];
    assert.ok(row.bear_usd>=1&&row.bull_usd<=1e14);
    assert.ok(row.bear_usd<=row.implied_value_usd&&row.implied_value_usd<=row.bull_usd);
    assert.deepEqual(JSON.parse(JSON.stringify(board)),board);
  }
  assert.throws(()=>advanced.upgradeBoard({...fixture(powerLaw),as_of:'2026-02-30'}),/as_of/);
});

test('deep-frozen inputs remain untouched and reporting is explicitly exploratory',()=>{
  const s=fixture([...powerLaw,p('candidate',{mcap_usd:null,gecko_id:null})]);
  const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
  const board=advanced.upgradeBoard(freeze(s));
  assert.match(board.advanced.selection_rule,/exploratory nested cross-validation/i);
  assert.match(board.advanced.limits,/prior knowledge.*snapshot/i);
  assert.match(board.advanced.limits,/independent later snapshot/i);
  assert.match(board.advanced.limits,/not untouched/i);
  assert.ok(readFileSync(new URL('../lib/advanced.js',import.meta.url)).length<=8500);
});

test('sealed cohort stays exact, legacy is unchanged, and production ranks change',()=>{
  const input=process.env.RADAR_TEST_INPUT || '/data/home/makefun-work/token-radar-01-kit/input/snapshot.json';
  const s=JSON.parse(readFileSync(input,'utf8')), before=structuredClone(s);
  const old=buildBoard(s), oldValidation=validateModel(s), b=advanced.upgradeBoard(s), a=b.advanced;
  assert.equal(a.training_n,86);assert.equal(a.cv_points.length,86);
  assert.equal(new Set(a.cv_points.map(p=>p.slug)).size,86);
  assert.deepEqual(a.cv_points.map(p=>p.slug),buildCohorts(s.protocols).refs.map(p=>p.slug));
  assert.deepEqual([0,1,2,3,4].map(f=>a.cv_points.filter(p=>p.fold===f).length),[18,17,17,17,17]);
  for(const point of a.cv_points)assert.equal(point.pred.legacy,oldValidation.points.find(p=>p.slug===point.slug).pred.current);
  for(const key of ['meanAbsoluteLog10Error','medianMultiplicativeError','within3x'])
    assert.equal(a.models.legacy[key],oldValidation.models.current[key]);
  for(const key of ['reference','model','live','excluded'])assert.deepEqual(b[key],old[key]);
  const out=advanced.nestedPredict(s.protocols,b.rows,s.as_of);
  assert.equal(a.selected,out.selected);assert.deepEqual(a.selection_scores,out.selection_scores);
  const values=new Map(out.predictions.map(p=>[p.slug,p.value_usd]));
  assert.ok(b.rows.some(r=>r.rank!==r.advanced.legacy_rank));
  assert.ok(a.models.selected.meanAbsoluteLog10Error<a.models.legacy.meanAbsoluteLog10Error);
  for(const r of b.rows) {
    const previous=old.rows.find(p=>p.slug===r.slug);
    assert.equal(r.implied_value_usd,values.get(r.slug));
    for(const k of ['state','watchlist','watchlist_override','plan','chains','category','age_days'])assert.deepEqual(r[k],previous[k]);
    assert.equal(r.advanced.legacy_rank,previous.rank);
    assert.equal(r.advanced.legacy_value_usd,previous.implied_value_usd);
    assert.ok(Number.isSafeInteger(r.implied_value_usd)&&r.implied_value_usd>=1&&r.implied_value_usd<=1e14);
    assert.ok(r.bear_usd>=1&&r.bear_usd<=r.implied_value_usd&&r.bull_usd>=r.implied_value_usd&&r.bull_usd<=1e14);
    assert.ok(r.advanced.rank_low>=1&&r.advanced.rank_low<=r.advanced.rank_high&&r.advanced.rank_high<=b.rows.length);
    assert.ok(r.advanced.top20_share>=0&&r.advanced.top20_share<=1);
  }
  assert.deepEqual(s,before);finiteTree(b);
  assert.deepEqual(JSON.parse(JSON.stringify(b)),b);
  assert.deepEqual(advanced.upgradeBoard(s),b);
  assert.deepEqual(advanced.upgradeBoard({...s,protocols:[...s.protocols].reverse()}),b);
  assert.match(a.limits,/monotone OLS.*rank/i);
});

test('duplicate ids, excluded tokens, watchlist overrides and unusual categories remain safe',()=>{
  const s=fixture([...sectorData,
    p('duplicate',{gecko_id:sectorData[0].gecko_id,tvl_usd:1e5,mcap_usd:1e13}),
    p('excluded-ref',{category:'Bridge'}),p('no-id',{gecko_id:null}),
    p('bridge',{category:'Bridge',gecko_id:null,mcap_usd:null}),
    p('__proto__',{category:'__proto__',gecko_id:null,mcap_usd:null}),
    p('constructor',{category:'constructor',gecko_id:null,mcap_usd:null}),
    p('watch-live',{gecko_id:null,symbol:'LIVE',mcap_usd:null})]);
  s.watchlist=['bridge','watch-live'];
  const b=advanced.upgradeBoard(s), old=buildBoard(s);
  assert.deepEqual(b.reference,old.reference);
  assert.equal(b.advanced.training_n,40);
  assert.deepEqual(b.rows.map(p=>p.slug).sort(),old.rows.map(p=>p.slug).sort());
  assert.deepEqual(b.live,old.live);assert.deepEqual(b.excluded,old.excluded);
  assert.equal(b.rows.find(p=>p.slug==='watch-live').state,'live');
  assert.equal(b.rows.find(p=>p.slug==='bridge').watchlist_override,true);
  assert.equal({}.polluted,undefined);finiteTree(b);
});
