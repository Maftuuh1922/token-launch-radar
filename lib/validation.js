// SPDX-License-Identifier: MIT
import {buildCohorts,quantile,clamp,validateSnapshot} from './model.js';
const mean = a => a.reduce((s,x)=>s+x,0)/a.length;
function ageOf(p,now) {
  const date=typeof p.listed_at==='string' && /^\d{4}-\d{2}-\d{2}$/.test(p.listed_at) ? Date.parse(p.listed_at+'T00:00:00Z') : NaN;
  return Number.isFinite(date) && date<=now ? Math.floor((now-date)/86400000) : null;
}
const names={current:'Current sector-shrunk model',globalRatio:'Global median raw MCap/TVL',logLogOLS:'Log-log OLS size model'};
function metrics(points) {
  return Object.fromEntries(Object.entries(names).map(([key,name])=>{
    const e=points.map(p=>Math.abs(Math.log10(p.pred[key])-Math.log10(p.actual)));
    return [key,{name,n:e.length,meanAbsoluteLog10Error:mean(e),
      medianMultiplicativeError:10**quantile(e,0.5),within3x:points.filter(p=>Math.max(p.pred[key]/p.actual,p.actual/p.pred[key])<=3).length/e.length}];
  }));
}
export function validateModel(snapshot) {
  const s=validateSnapshot(snapshot), originals=new Map(s.protocols.map(p=>[p.slug,p]));
  // Full cohort selects token identities only; none of its fitted values are reused.
  const rows=buildCohorts(s.protocols).refs.map(r=>originals.get(r.slug));
  const n=rows.length, folds=Math.min(5,n), points=[], foldMetrics=[];
  if(n<2) throw Error('Validation needs at least two unique reference tokens');
  for(let fold=0;fold<folds;fold++) {
    const train=rows.filter((_,i)=>i%folds!==fold), predict=fitModels(train,s.as_of);
    const held=rows.filter((_,i)=>i%folds===fold).map(p=>({slug:p.slug,category:p.category || 'Unclassified',
      fold,tvl:p.tvl_usd,actual:p.mcap_usd,pred:predict(p),
      sectorN:train.filter(r=>(r.category || 'Unclassified')===(p.category || 'Unclassified')).length}));
    points.push(...held);
    foldMetrics.push({fold,trainN:train.length,n:held.length,models:metrics(held)});
  }
  points.sort((a,b)=>a.slug<b.slug?-1:a.slug>b.slug?1:0);
  return {as_of:s.as_of,n,folds,method:'Sorted slugs, round-robin token folds; train-only fits; pooled held-out metrics. No tuning.',
    limits:'Cross-sectional valuation proxy validation on traded tokens; not a temporal forecast. Selected/surviving tokens and sparse sectors limit coverage. It does not establish pre-token launch payouts, launch probability or returns.',
    coverage:{protocols:s.protocols.length,referenceTokens:n,sectors:new Set(rows.map(p=>p.category || 'Unclassified')).size,
      missingAge:rows.filter(p=>ageOf(p,Date.parse(s.as_of+'T00:00:00Z'))===null).length,
      missingGrowth:rows.filter(p=>p.change_7d==null).length,
      unseenSectorHoldouts:points.filter(p=>!p.sectorN).length,thinSectorHoldouts:points.filter(p=>p.sectorN<5).length,
      referenceTvlRange:[Math.min(...rows.map(p=>p.tvl_usd)),Math.max(...rows.map(p=>p.tvl_usd))]},
    models:metrics(points),foldMetrics,points};
}

// Only original training records enter cohort construction and OLS.
export function fitModels(train,asOf) {
  const c=buildCohorts(train), refs=c.refs;
  const ratio=quantile(refs.map(r=>r.raw),0.5);
  const xs=refs.map(r=>Math.log10(r.tvl_usd)), ys=refs.map(r=>Math.log10(r.mcap_usd));
  const mx=mean(xs), my=mean(ys), variance=mean(xs.map(x=>(x-mx)**2));
  const slope=variance ? mean(xs.map((x,i)=>(x-mx)*(ys[i]-my)))/variance : 0;
  const now=Date.parse(asOf+'T00:00:00Z');
  return p=>{
    const sector=c.sectors.get(p.category || 'Unclassified') || [], n=sector.length, w=n/(n+5);
    const median=n ? quantile(sector.map(r=>r.multiple),0.5) : c.global;
    const multiple=Math.exp(w*Math.log(median)+(1-w)*Math.log(c.global));
    const age=ageOf(p,now);
    const growth=p.change_7d==null ? 1 : 1+clamp(p.change_7d,-50,50)/500;
    const ageFactor=age===null ? 1 : 0.95+0.1*Math.min(age/730,1);
    const pred={current:Math.round(clamp(p.tvl_usd*multiple*growth*ageFactor,1,1e14)),
      globalRatio:p.tvl_usd*ratio,logLogOLS:10**(my+slope*(Math.log10(p.tvl_usd)-mx))};
    if(Object.values(pred).some(x=>!Number.isFinite(x)||x<=0)) throw Error('Predictions must be positive finite values');
    return pred;
  };
}
