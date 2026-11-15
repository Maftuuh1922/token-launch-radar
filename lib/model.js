// SPDX-License-Identifier: MIT
// Pure model, shared verbatim with the dossier's inspectable dashboard source.
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const finite = x => typeof x === 'number' && Number.isFinite(x);
export function quantile(values, q) {
  const a = [...values].sort((a,b) => a-b);
  if (!a.length) return 1;
  const i = (a.length-1)*q, k = Math.floor(i);
  return a[k] + (a[Math.ceil(i)]-a[k])*(i-k);
}
export function exclusion(p) {
  if (/bridge|liquid staking|liquid restaking|restaked btc|staking pool|stablecoin wrapper|^CEX$/i.test(p.category || '')) return 'Wrapper, staking, bridge or exchange category';
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return 'Wrapped or staked product name';
  if (/\s(v\d+(\.\d+)?|\d+\.\d+)$/i.test(p.name)) return 'Versioned product; independent token uncertain';
  if (/^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i.test(p.name)) return 'Exchange-associated product';
  return null;
}
export function validateSnapshot(s) {
  if (!s || Object.getPrototypeOf(s) !== Object.prototype || !Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) throw Error('Invalid snapshot structure');
  if (typeof s.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.as_of) || !Number.isFinite(Date.parse(s.as_of)) || new Date(s.as_of).toISOString().slice(0,10) !== s.as_of) throw Error('Invalid as_of date');
  const seen = new Set();
  for (const p of s.protocols) {
    if (!p || Object.getPrototypeOf(p) !== Object.prototype || !Object.hasOwn(p,'slug') || typeof p.slug !== 'string' || !/^\S{1,128}$/.test(p.slug) || seen.has(p.slug)) throw Error('Invalid or duplicate protocol slug');
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 200 || !finite(p.tvl_usd) || p.tvl_usd <= 0 || p.tvl_usd > 1e14) throw Error('Invalid name or TVL');
    if (!Array.isArray(p.chains) || p.chains.some(c => typeof c !== 'string' || c.length > 100)) throw Error('Invalid chains');
    for (const k of ['category','symbol','gecko_id','listed_at']) if (p[k] != null && typeof p[k] !== 'string') throw Error('Invalid optional string');
    for (const k of ['mcap_usd','change_7d']) if (p[k] != null && !finite(p[k])) throw Error('Invalid numeric field');
    seen.add(p.slug);
  }
  if (new Set(s.watchlist).size !== s.watchlist.length || s.watchlist.some(x => !seen.has(x))) throw Error('Invalid watchlist');
  return s;
}
export function buildCohorts(protocols) {
  // One gecko id contributes once; largest TVL record wins, slug breaks ties.
  const used = new Set(), refs = [];
  for (const p of [...protocols].sort((a,b) => b.tvl_usd-a.tvl_usd || cmp(a.slug,b.slug))) {
    if (exclusion(p) || !p.gecko_id || !(p.mcap_usd > 0) || used.has(p.gecko_id)) continue;
    used.add(p.gecko_id);
    refs.push({slug:p.slug,name:p.name,category:p.category || 'Unclassified',tvl_usd:p.tvl_usd,mcap_usd:p.mcap_usd,raw:p.mcap_usd/p.tvl_usd});
  }
  if (!refs.length) throw Error('No usable live-token comparables');
  const raw = refs.map(r=>clamp(r.raw,0.05,20));
  const lo = quantile(raw,0.1), hi = quantile(raw,0.9);
  for (const r of refs) r.multiple = clamp(r.raw,lo,hi);
  const global = quantile(refs.map(r=>r.multiple),0.5);
  const sectors = new Map();
  for (const r of refs) {
    if (!sectors.has(r.category)) sectors.set(r.category,[]);
    sectors.get(r.category).push(r);
  }
  return {refs:refs.sort((a,b)=>cmp(a.slug,b.slug)),sectors,global,lo,hi};
}
function activity(category) {
  if (/risk curators|capital allocator/i.test(category)) return {mode:'Verify vault',action:'Find a publicly accessible vault curated by this team; check its host, mandate, collateral and withdrawal queue. Only if accessible, test a small unlevered deposit and redemption.',capital:[50,300],monitor:true};
  if (/RWA|CeDeFi|uncollateralized|card|OTC/i.test(category)) return {mode:'Verify access',action:'Check jurisdiction, KYC, accreditation, minimum ticket and redemption terms. Request access only through verified documentation; if restricted or minimum exceeds budget, monitor without depositing.',capital:[0,500],monitor:true};
  if (/leveraged|derivatives|options|basis|synthetics/i.test(category)) return {mode:'Monitor only',action:'Review product documentation and any official participation terms. Use an official testnet if offered; do not open leveraged positions or manufacture trading volume for rewards.',capital:[0,0],monitor:true};
  if (/Dexs|liquidity manager/i.test(category)) return {mode:'Small swap',action:'If the app and pool are verified, make one useful $20–$50 spot swap in a liquid pair. Set slippage at 0.3% or lower; skip thin pools and do not cycle trades to inflate usage.',capital:[50,200],monitor:false};
  if (/lending|CDP|collateral/i.test(category)) return {mode:'Supply only',action:'If a liquid, audited market is open, supply $50–$250 of an asset you already hold, without borrowing. Check utilization, oracle design and withdrawal liquidity before depositing.',capital:[50,250],monitor:false};
  if (/yield|farm|restaking|stablecoin|indexes|reserve/i.test(category)) return {mode:'Test vault',action:'Verify the vault assets, strategy, admin keys, lock period and redemption route. If suitable, test a $50–$200 unlevered deposit; avoid opaque strategies or recursive collateral.',capital:[50,200],monitor:false};
  return {mode:'Research first',action:'Read the official product and participation documentation. Identify one real user action and a reversible exit; if there is no accessible onchain product, monitor updates at zero capital.',capital:[0,100],monitor:true};
}
export function farmPlan(p, state) {
  const chains = [...p.chains].sort(cmp);
  const low = chains.find(c=>/^(Base|Arbitrum|Optimism|Solana|Polygon|BSC|Avalanche|Sui|Aptos|Hyperliquid L1|Unichain)$/i.test(c));
  const chain = low || (chains.includes('Ethereum') ? 'Ethereum' : chains[0] || 'Unreported chain');
  const fees = low ? [1,8] : chain === 'Ethereum' ? [15,80] : [5,40];
  const a = state === 'excluded' ? {mode:'Monitor only',action:'Verify the parent token and redemption mechanics. This is an excluded product, not an independent launch candidate; monitor documentation only and do not bridge or deposit to farm a speculative token.',capital:[0,0],monitor:true} : activity(p.category || '');
  const fee = a.capital[1] === 0 ? [0,0] : fees;
  return {mode:a.mode,chain,capital:a.capital,fees:fee,days:28,monitor:a.monitor,steps:[
    `Day 0 · ${p.name}: verify the official app, contracts, audits and current token/eligibility terms. ${state === 'live' ? 'A token is already recorded; evaluate published incentives only.' : state === 'excluded' ? 'Excluded record: no launch assumption.' : 'No token recorded is not proof of a future launch or airdrop.'}`,
    `Day 0–1 · ${a.action} Capital-at-risk estimate: $${a.capital[0]}–$${a.capital[1]}; capital is not a fee.`,
    `Execution gate · Prefer ${chain} only if this product actually supports it. Budget $${fee[0]}–$${fee[1]} total transaction fees for entry, one check and exit over 28 days; estimates are not snapshot data. Use existing chain funds; bridge fees and bridge risk are extra, so skip bridging by default.`,
    `Days 7, 14, 21 · Spend 10 minutes per week checking official rules, security news, position health and withdrawal queues. Do not wash trade, use leverage or add transactions solely for points. Keep receipts; points and eligibility are unverified.`,
    `By day 28 · Test redemption and revoke unused approvals if you deposited. Stop immediately on security concerns, confirmed reward ineligibility or the fee cap; exit only through verified contracts, allowing for lockups. For 5% annual alternative yield, opportunity cost is capital × 0.05 × days / 365; any reward can be $0.`
  ]};
}
export function buildBoard(snapshot) {
  const s = validateSnapshot(snapshot), cohorts = buildCohorts(s.protocols), watch = new Set(s.watchlist);
  const asOf = Date.parse(s.as_of+'T00:00:00Z');
  const rows = [], live = [], excluded = [];
  for (const p of s.protocols) {
    const reason = exclusion(p), token = !!(p.gecko_id || p.symbol || p.mcap_usd > 0);
    const state = token ? 'live' : reason && !watch.has(p.slug) ? 'excluded' : 'candidate';
    const category = p.category || 'Unclassified';
    const sector = cohorts.sectors.get(category) || [], n = sector.length, weight = n/(n+5);
    const median = n ? quantile(sector.map(r=>r.multiple),0.5) : cohorts.global;
    const multiple = Math.exp(weight*Math.log(median)+(1-weight)*Math.log(cohorts.global));
    const date = typeof p.listed_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.listed_at) ? Date.parse(p.listed_at+'T00:00:00Z') : NaN;
    const age = Number.isFinite(date) && date <= asOf ? Math.floor((asOf-date)/86400000) : null;
    const growth = p.change_7d == null ? null : p.change_7d;
    const growthFactor = growth === null ? 1 : 1+clamp(growth,-50,50)/500;
    const ageFactor = age === null ? 1 : 0.95+0.1*Math.min(age/730,1);
    const base = Math.round(clamp(p.tvl_usd*multiple*growthFactor*ageFactor,1,1e14));
    const spread = n >= 5 && age !== null && growth !== null ? 0.4 : 0.6;
    const plan = farmPlan(p,state);
    const row = {slug:p.slug,name:p.name,category,chains:p.chains,tvl_usd:p.tvl_usd,mcap_usd:p.mcap_usd ?? null,symbol:p.symbol ?? null,gecko_id:p.gecko_id ?? null,listed_at:p.listed_at ?? null,change_7d:growth,state,watchlist:watch.has(p.slug),exclusion:reason,watchlist_override:!!reason && watch.has(p.slug),parent_unknown:!watch.has(p.slug),age_days:age,implied_value_usd:base,bear_usd:Math.round(clamp(base*(1-spread),1,1e14)),bull_usd:Math.round(clamp(base*(1+spread),1,1e14)),multiple,growth_factor:growthFactor,age_factor:ageFactor,sector_n:n,sector_median:median,sector_weight:weight,global_multiple:cohorts.global,cohort_examples:(n ? sector : cohorts.refs).slice(0,4).map(r=>({name:r.name,multiple:r.multiple})),coverage:n>=5 && age!==null && growth!==null ? 'Better' : n ? 'Limited' : 'Fallback',plan,farm_steps:plan.steps};
    (state === 'candidate' ? rows : state === 'live' ? live : excluded).push(row);
    // Mandatory watchlist remains in board even for inconsistent future input.
    if (watch.has(p.slug) && state !== 'candidate') rows.push({...row,watchlist_override:true});
  }
  rows.sort((a,b)=>b.implied_value_usd-a.implied_value_usd || cmp(a.slug,b.slug));
  rows.forEach((r,i)=>r.rank=i+1);
  live.sort((a,b)=>(b.mcap_usd || 0)-(a.mcap_usd || 0) || cmp(a.slug,b.slug));
  excluded.sort((a,b)=>b.tvl_usd-a.tvl_usd || cmp(a.slug,b.slug));
  return {as_of:s.as_of,source:s.source || 'Sealed snapshot',floor_usd:s.floor_usd,rows,live,excluded,reference:cohorts.refs,model:{global_n:cohorts.refs.length,global_multiple:cohorts.global,winsor_low:cohorts.lo,winsor_high:cohorts.hi,watchlist_count:s.watchlist.length}};
}
