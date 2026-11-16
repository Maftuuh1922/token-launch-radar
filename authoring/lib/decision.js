function evaluatePlan(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('options must be an object');
  const keys = ['capital','fees','days','apy','hours','hourlyRate','payout','probability','lossPct','feeMultiplier'];
  for (const key of keys) {
    const value = options[key];
    if (!Object.prototype.hasOwnProperty.call(options, key) || typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${key} must be a finite number`);
    if (value < 0) throw new RangeError(`${key} must be non-negative`);
  }
  if (options.apy > 100) throw new RangeError('apy must be between 0 and 100');
  if (options.probability > 1) throw new RangeError('probability must be between 0 and 1');
  if (options.lossPct > 100) throw new RangeError('lossPct must be between 0 and 100');

  const {capital,fees,days,apy,hours,hourlyRate,payout,probability,lossPct,feeMultiplier} = options;
  const opportunityCost = capital * (apy / 100) * days / 365;
  const timeCost = hours * hourlyRate;
  const principalLoss = capital * lossPct / 100;
  const common = opportunityCost + timeCost + principalLoss;
  const scenario = (label, fm, pm, pr, lp = lossPct) => {
    const loss = capital * lp / 100;
    const cost = fees * fm + opportunityCost + timeCost + loss;
    const reward = payout * pm;
    const net = probability * pr * reward - cost;
    const breakEvenProbability = reward === 0 ? null : cost / reward;
    return {label, feeMultiplier:fm, payoutMultiplier:pm, probabilityMultiplier:pr, lossPct:lp, cost, net, breakEvenProbability};
  };
  const result = {
    opportunityCost, timeCost, principalLoss,
    cost: fees * feeMultiplier + common,
    expectedNet: probability * payout - (fees * feeMultiplier + common),
    breakEvenProbability: payout === 0 ? null : (fees * feeMultiplier + common) / payout,
    requiredPayout: probability === 0 ? null : (fees * feeMultiplier + common) / probability,
    capitalCommitted: capital + fees * feeMultiplier,
    stress: [
      scenario('configured base', feeMultiplier, 1, 1),
      scenario('higher-fees', feeMultiplier * 2, 0.5, 0.5),
      scenario('no-reward', feeMultiplier, 0, 1)
    ]
  };
  const numbers = [result.opportunityCost,result.timeCost,result.principalLoss,result.cost,result.expectedNet,result.capitalCommitted,result.breakEvenProbability,result.requiredPayout,
    ...result.stress.flatMap(s => [s.feeMultiplier,s.cost,s.net,s.breakEvenProbability])].filter(x => x !== null);
  if (numbers.some(x => !Number.isFinite(x))) throw new RangeError('calculation exceeds finite range');
  return result;
}

export {evaluatePlan};
