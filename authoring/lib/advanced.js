// SPDX-License-Identifier: MIT
import {buildBoard,buildCohorts,quantile,clamp,validateSnapshot,farmPlan,exclusion} from './model.js';

const METHODS=['ols','sector-k4','sector-k12'], SEED=20261114, RUNS=64;
const cmp=(a,b)=>a.slug<b.slug?-1:a.slug>b.slug?1:0;
const cat=p=>p.category || 'Unclassified';
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const value=log=>Math.round(10**clamp(log,0,14));
function references(rows) {
try {
const originals=new Map(rows.map(p=>[p.slug,p]));
return buildCohorts(rows).refs.map(p=>originals.get(p.slug));
} catch(e) {if(e.message==='No usable live-token comparables')return [];throw e;}
}
// Preserve bootstrap multiplicities.
function fit(train,method) {
const xs=train.map(p=>Math.log10(p.tvl_usd)), ys=train.map(p=>Math.log10(p.mcap_usd));
const mx=mean(xs), my=mean(ys), variance=mean(xs.map(x=>(x-mx)**2));
const slope=variance?mean(xs.map((x,i)=>(x-mx)*(ys[i]-my)))/variance:0;
const intercept=my-slope*mx, k=method==='ols'?0:method==='sector-k4'?4:12;
const sectors=new Map();
train.forEach((p,i)=>{
const s=sectors.get(cat(p)) || {n:0,sum:0};
s.n++;s.sum+=ys[i]-(intercept+slope*xs[i]);sectors.set(cat(p),s);
});
return p=>{
const s=sectors.get(cat(p)), sector_offset=k&&s?s.sum/(s.n+k):0;
const log_tvl=Math.log10(p.tvl_usd), log_value_unclamped=intercept+slope*log_tvl+sector_offset;
return {slug:p.slug,value_usd:value(log_value_unclamped),explanation:{slope,intercept,
sector_offset,sector_n:s?.n || 0,shrink_k:k,log_tvl,log_value_unclamped,
clipped:log_value_unclamped<0 || log_value_unclamped>14}};
};
}
function select(train) {
const folds=Math.min(4,train.length), scores=METHODS.map(method=>({method,meanAbsoluteLog10Error:null}));
if(folds>1)for(const score of scores) {
const errors=[];
for(let fold=0;fold<folds;fold++) {
const predict=fit(train.filter((_,i)=>i%folds!==fold),score.method);
train.filter((_,i)=>i%folds===fold).forEach(p=>errors.push(Math.abs(Math.log10(predict(p).value_usd)-Math.log10(p.mcap_usd))));
}
score.meanAbsoluteLog10Error=mean(errors);
}
let best=scores[0];
for(const s of scores)if(s.meanAbsoluteLog10Error<best.meanAbsoluteLog10Error-1e-12)best=s;
return {selected:train.length?best.method:null,selection_scores:scores};
}
// Never read held targets.
export function nestedPredict(train,held,asOf) {
const refs=references(train), selection=select(refs);
return {...selection,predictions:refs.length?held.map(fit(refs,selection.selected)):[]};
}
function metrics(points,key,name) {
const e=points.map(p=>Math.abs(Math.log10(p.pred[key])-Math.log10(p.actual)));
return {name,n:e.length,meanAbsoluteLog10Error:e.length?mean(e):null,
medianMultiplicativeError:e.length?10**quantile(e,.5):null,
within3x:e.length?points.filter(p=>Math.max(p.pred[key]/p.actual,p.actual/p.pred[key])<=3).length/e.length:null};
}
function evidence(refs,asOf) {
const points=[], folds=Math.min(5,refs.length);
if(folds>1)for(let fold=0;fold<folds;fold++) {
const train=refs.filter((_,i)=>i%folds!==fold), held=refs.filter((_,i)=>i%folds===fold);
const chosen=nestedPredict(train,held,asOf), ols=fit(train,'ols');
const legacy=buildBoard({as_of:asOf,watchlist:[],protocols:[...train,...held.map(p=>({...p,mcap_usd:null,gecko_id:null,symbol:null}))]}).rows;
held.forEach((p,i)=>points.push({slug:p.slug,category:cat(p),tvl:p.tvl_usd,actual:p.mcap_usd,
fold,train_n:train.length,method:chosen.selected,selection_scores:chosen.selection_scores,
pred:{legacy:legacy.find(r=>r.slug===p.slug).implied_value_usd,ols:ols(p).value_usd,selected:chosen.predictions[i].value_usd}}));
}
points.sort(cmp);
return {cv_points:points,models:{legacy:metrics(points,'legacy','Unchanged legacy'),
ols:metrics(points,'ols','Log-log OLS'),selected:metrics(points,'selected','Nested-selected procedure')}};
}
function stability(refs,rows,method) {
let state=SEED;
const ranks=new Map(rows.map(r=>[r.slug,[]]));
for(let b=0;b<RUNS;b++) {
const sample=refs.map(()=>{
state=(Math.imul(state,1664525)+1013904223)>>>0;
return refs[Math.floor(state/4294967296*refs.length)];
});
rows.map(fit(sample,method)).sort((a,b)=>b.value_usd-a.value_usd || cmp(a,b))
.forEach((r,i)=>ranks.get(r.slug).push(i+1));
}
for(const r of rows) {
const a=ranks.get(r.slug);
Object.assign(r.advanced,{rank_low:Math.floor(quantile(a,.1)),rank_high:Math.ceil(quantile(a,.9)),
top20_share:a.filter(x=>x<=20).length/RUNS});
}
}
function emptyBoard(s) {
const b={as_of:s.as_of,source:s.source || 'Sealed snapshot',floor_usd:s.floor_usd,rows:[],live:[],excluded:[],reference:[],
model:{global_n:0,global_multiple:null,winsor_low:null,winsor_high:null,watchlist_count:s.watchlist.length}};
for(const p of [...s.protocols].sort(cmp)) {
const reason=exclusion(p), watchlist=s.watchlist.includes(p.slug);
const state=p.gecko_id || p.symbol || p.mcap_usd>0?'live':reason&&!watchlist?'excluded':'candidate';
const category=cat(p), plan=farmPlan(p,state), r={slug:p.slug,name:p.name,category,chains:p.chains,
tvl_usd:p.tvl_usd,mcap_usd:p.mcap_usd ?? null,symbol:p.symbol ?? null,gecko_id:p.gecko_id ?? null,
listed_at:p.listed_at ?? null,change_7d:p.change_7d ?? null,state,watchlist,exclusion:reason,
watchlist_override:!!reason&&watchlist,parent_unknown:!watchlist,age_days:null,
implied_value_usd:null,bear_usd:null,bull_usd:null,multiple:null,growth_factor:null,
age_factor:null,sector_n:0,sector_median:null,sector_weight:null,global_multiple:null,
cohort_examples:[],coverage:'Unavailable',plan,farm_steps:plan.steps};
b[state==='candidate'?'rows':state==='live'?'live':'excluded'].push(r);
if(watchlist&&state!=='candidate')b.rows.push({...r,watchlist_override:true});
}
b.live.sort((a,b)=>(b.mcap_usd||0)-(a.mcap_usd||0)||cmp(a,b));
b.excluded.sort((a,b)=>b.tvl_usd-a.tvl_usd||cmp(a,b));
return b;
}

export function upgradeBoard(snapshot) {
const s=validateSnapshot(snapshot), refs=references(s.protocols), board=refs.length?buildBoard(s):emptyBoard(s);
const selection=select(refs), report=evidence(refs,s.as_of), predict=fit(refs,selection.selected);
const residuals=report.cv_points.map(p=>Math.abs(Math.log10(p.pred.selected)-Math.log10(p.actual)));
const band=residuals.length?10**Math.min(14,quantile(residuals,.8)):1e14;
const range=[Math.min(...refs.map(p=>p.tvl_usd)),Math.max(...refs.map(p=>p.tvl_usd))];
board.advanced={version:1,...selection,...report,training_n:refs.length,seed:SEED,bootstrap_runs:refs.length>1?RUNS:0,
band_label:residuals.length?'Empirical residual band: OOF P80 absolute log10 error; not calibrated; no coverage guarantee. $1–$100T caps.':'Band unavailable: fewer than two references; bounds uninformative.',
selection_rule:'Exploratory nested cross-validation: sorted token slugs, outer 5 folds, inner 4 (fewer if small); minimum mean absolute log10 error. 1e-12 ties: ols, sector-k4, sector-k12. Final: full-cohort inner CV; no outer tuning.',
limits:'Family design used prior knowledge of this snapshot: not untouched holdout proof; independent later snapshot validation needed. Cross-sectional survivors, not a temporal forecast or launch/pre-token payouts/returns proof. Bootstrap P10/P90 rounded outward; top-20 share conditional on selected method, no guarantee. Monotone OLS can fix ranks despite large value errors. Sparse sectors/extrapolation weaken evidence.',
legacy_evidence_fields:'model, multiple, growth_factor, age_factor, sector_*, global_multiple, cohort_examples, coverage: legacy only.'};
for(const row of board.rows) {
if(!refs.length) {
row.advanced={method:null,legacy_value_usd:null,legacy_rank:null,rank_low:null,rank_high:null,top20_share:null,band_factor:null,extrapolated:true,peers:[],explanation:null};
continue;
}
const result=predict(row);
for(const k of ['implied_value_usd','bear_usd','bull_usd','rank'])row['legacy_'+k]=row[k];
row.advanced={method:selection.selected,legacy_value_usd:row.implied_value_usd,legacy_rank:row.rank,
band_factor:band,extrapolated:row.tvl_usd<range[0] || row.tvl_usd>range[1],explanation:result.explanation,
peers:[...refs].sort((a,b)=>(cat(b)===row.category)-(cat(a)===row.category) ||
Math.abs(Math.log10(a.tvl_usd/row.tvl_usd))-Math.abs(Math.log10(b.tvl_usd/row.tvl_usd)) || cmp(a,b))
.slice(0,4).map(p=>({slug:p.slug,name:p.name,tvl_usd:p.tvl_usd,mcap_usd:p.mcap_usd,category:cat(p)}))};
row.implied_value_usd=result.value_usd;
row.bear_usd=Math.round(clamp(result.value_usd/band,1,1e14));
row.bull_usd=Math.round(clamp(result.value_usd*band,1,1e14));
}
board.rows.sort((a,b)=>b.implied_value_usd-a.implied_value_usd || cmp(a,b));
board.rows.forEach((r,i)=>r.rank=i+1);
if(refs.length>1)stability(refs,board.rows,selection.selected);
else for(const r of board.rows)Object.assign(r.advanced,{rank_low:null,rank_high:null,top20_share:null});
return JSON.parse(JSON.stringify(board,(_,v)=>v===undefined||typeof v==='number'&&!Number.isFinite(v)?null:v));
}
