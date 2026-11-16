import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {evaluatePlan} from '../lib/decision.js';

const base = {
  capital: 1000,
  fees: 20,
  days: 30,
  apy: 12,
  hours: 4,
  hourlyRate: 25,
  payout: 500,
  probability: 0.4,
  lossPct: 10,
  feeMultiplier: 1
};
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} !== ${expected}`);

test('calculates the configured budget and expected net exactly', () => {
  const result = evaluatePlan(base);
  close(result.opportunityCost, 1000 * 0.12 * 30 / 365);
  close(result.timeCost, 100);
  close(result.principalLoss, 100);
  close(result.cost, 229.86301369863014);
  close(result.expectedNet, -29.86301369863014);
  close(result.breakEvenProbability, result.cost / 500);
  close(result.requiredPayout, result.cost / 0.4);
  close(result.capitalCommitted, 1020);
});

test('keeps zero assumptions exact and handles probability endpoints', () => {
  const zero = evaluatePlan({...base, capital: 0, fees: 0, days: 0, apy: 0, hours: 0,
    hourlyRate: 0, payout: 0, probability: 0, lossPct: 0, feeMultiplier: 0});
  assert.deepEqual(zero, {
    opportunityCost: 0, timeCost: 0, principalLoss: 0, cost: 0,
    expectedNet: 0, breakEvenProbability: null, requiredPayout: null,
    capitalCommitted: 0,
    stress: [
      {label: 'configured base', feeMultiplier: 0, payoutMultiplier: 1, probabilityMultiplier: 1, lossPct: 0, cost: 0, net: 0, breakEvenProbability: null},
      {label: 'higher-fees', feeMultiplier: 0, payoutMultiplier: 0.5, probabilityMultiplier: 0.5, lossPct: 0, cost: 0, net: 0, breakEvenProbability: null},
      {label: 'no-reward', feeMultiplier: 0, payoutMultiplier: 0, probabilityMultiplier: 1, lossPct: 0, cost: 0, net: 0, breakEvenProbability: null}
    ]
  });
  assert.equal(evaluatePlan({...base, probability: 0}).expectedNet, -evaluatePlan({...base, probability: 0}).cost);
  assert.equal(evaluatePlan({...base, probability: 0}).requiredPayout, null);
  assert.equal(evaluatePlan({...base, probability: 1}).expectedNet, base.payout - evaluatePlan(base).cost);
  assert.equal(evaluatePlan({...base, probability: 1, payout: 0}).breakEvenProbability, null);
});

test('stress presets are explicit and reflect fee, payout, and probability shocks', () => {
  const {stress} = evaluatePlan(base);
  assert.deepEqual(stress.map(({label, feeMultiplier, payoutMultiplier, probabilityMultiplier, lossPct}) =>
    ({label, feeMultiplier, payoutMultiplier, probabilityMultiplier, lossPct})), [
      {label: 'configured base', feeMultiplier: 1, payoutMultiplier: 1, probabilityMultiplier: 1, lossPct: 10},
      {label: 'higher-fees', feeMultiplier: 2, payoutMultiplier: 0.5, probabilityMultiplier: 0.5, lossPct: 10},
      {label: 'no-reward', feeMultiplier: 1, payoutMultiplier: 0, probabilityMultiplier: 1, lossPct: 10}
    ]);
  close(stress[1].cost, 249.86301369863014);
  close(stress[1].net, -199.86301369863014);
  close(stress[2].net, -229.86301369863014);
  close(stress[2].breakEvenProbability, null);
});

test('principal loss is included independently and higher fees or lower payout worsen net', () => {
  const noLoss = evaluatePlan({...base, lossPct: 0});
  const withLoss = evaluatePlan(base);
  close(withLoss.cost - noLoss.cost, 100);
  const higherFees = evaluatePlan({...base, fees: 40});
  const lowerPayout = evaluatePlan({...base, payout: 250});
  assert.ok(higherFees.cost > withLoss.cost);
  assert.ok(higherFees.expectedNet < withLoss.expectedNet);
  assert.ok(lowerPayout.expectedNet < withLoss.expectedNet);
});

test('rejects missing, malformed, negative, non-finite, or out-of-range assumptions', () => {
  for (const key of Object.keys(base)) {
    const missing = {...base}; delete missing[key];
    assert.throws(() => evaluatePlan(missing), /options|number|finite|missing/i, key);
  }
  for (const key of Object.keys(base)) {
    assert.throws(() => evaluatePlan({...base, [key]: NaN}), /finite|number/i, key);
    assert.throws(() => evaluatePlan({...base, [key]: -1}), /non-negative|range|invalid/i, key);
  }
  for (const [key, value] of [['probability', 1.01], ['lossPct', 100.01], ['apy', 100.01]]) {
    assert.throws(() => evaluatePlan({...base, [key]: value}), /range|between|invalid/i, key);
  }
  assert.throws(() => evaluatePlan(null), /options|object/i);
});

test('runs as a classic browser script when only the export line is stripped', () => {
  const source = readFileSync(new URL('../lib/decision.js', import.meta.url), 'utf8')
    .replace(/\nexport \{evaluatePlan\};\s*$/, '');
  const context = {};
  vm.runInNewContext(source, context);
  assert.equal(typeof context.evaluatePlan, 'function');
  assert.equal(context.evaluatePlan({...base, payout: 0}).expectedNet, -context.evaluatePlan({...base, payout: 0}).cost);
});
