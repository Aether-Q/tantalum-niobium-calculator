// PRD 第 5、9 节验收样例（AC01–AC07）。运行：node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAll, parseInput } from '../public/calc.js';

const base = { P: 242.5, A: 6.0, C: 4.8, G: 30, T: 2.3, v: 0.13, R: 7.0 };
const r2 = (n) => Math.round(n * 100) / 100;
const r4 = (n) => Math.round(n * 10000) / 10000;

test('AC01 完整样例', () => {
  const r = computeAll(base);
  assert.equal(r4(r.smm.perGradeEx), 5.3462);
  assert.equal(r4(r.smm.perGradeInc), 6.0412);
  assert.equal(r2(r.smm.perTonUsdEx), 160386.3);
  assert.equal(r2(r.smm.perTonUsdInc), 181236.51);
  assert.equal(r2(r.smm.batchUsdEx), 368888.48);
  assert.equal(r2(r.smm.batchUsdInc), 416843.98);
  assert.equal(r2(r.smm.tonDegreeEx), 37423.47);
  assert.equal(r2(r.smm.tonDegreeInc), 42288.52);
  assert.equal(r2(r.ours.perTonUsdInc), 162720);
  assert.equal(r2(r.ours.batchUsdInc), 374256);
  assert.equal(r2(r.ours.tonDegreeEx), 33600);
  assert.equal(r2(r.ours.tonDegreeInc), 37968);
  assert.equal(r2(r.contract.perTonUsdInc), 203400);
  assert.equal(r2(r.contract.batchUsdEx), 414000);
  assert.equal(r2(r.contract.batchUsdInc), 467820);
  assert.equal(r2(r.contract.tonDegreeInc), 47460);
  assert.equal(r2(r.margin.perTonUsd), 36000);
  assert.equal(r2(r.margin.perTonCny), 252000);
  assert.equal(r2(r.margin.batchUsd), 82800);
  assert.equal(r2(r.margin.batchCny), 579600);
});

test('AC02 吨数翻倍只影响本批金额', () => {
  const a = computeAll(base), b = computeAll({ ...base, T: 4.6 });
  assert.equal(r2(b.margin.batchUsd), 165600);
  assert.equal(b.margin.perTonUsd, a.margin.perTonUsd);
  assert.equal(b.smm.perTonUsdEx, a.smm.perTonUsdEx);
  assert.equal(b.smm.tonDegreeEx, a.smm.tonDegreeEx);
  assert.equal(r2(b.contract.batchUsdEx), r2(a.contract.batchUsdEx * 2));
});

test('AC03 品位联动，吨度价不变且 = 人民币每吨价 ÷ G', () => {
  const td = computeAll(base).ours.tonDegreeEx;
  for (const G of [5, 30, 50]) {
    const r = computeAll({ ...base, G });
    assert.equal(r.ours.tonDegreeEx, td);
    assert.ok(Math.abs(r.ours.perTonCnyEx / G - r.ours.tonDegreeEx) < 1e-6);
    assert.ok(Math.abs(r.ours.perTonUsdEx - 4.8 * G * 1000) < 1e-6);
  }
});

test('AC04 税率 0 时含税=不含税，毛利不变；汇率只影响人民币', () => {
  const a = computeAll(base), z = computeAll({ ...base, v: 0 });
  assert.equal(z.smm.perTonUsdInc, z.smm.perTonUsdEx);
  assert.equal(z.margin.batchUsd, a.margin.batchUsd);
  const f = computeAll({ ...base, R: 7.2 });
  assert.equal(f.smm.perTonUsdEx, a.smm.perTonUsdEx);
  assert.notEqual(f.smm.perTonCnyEx, a.smm.perTonCnyEx);
  assert.equal(f.margin.batchUsd, a.margin.batchUsd);
});

test('AC05 零与负毛利如实计算', () => {
  assert.equal(computeAll({ ...base, A: 4.8 }).margin.perTonUsd, 0);
  const n = computeAll({ ...base, A: 4.0 }).margin;
  assert.equal(r2(n.perTonUsd), -24000);
  assert.equal(r2(n.batchUsd), -55200);
});

test('AC06 缺失输入只停算依赖项', () => {
  const noT = computeAll({ ...base, T: null });
  assert.equal(noT.smm.batchUsdEx, null);
  assert.equal(noT.margin.batchUsd, null);
  assert.ok(noT.margin.perTonUsd > 0 && noT.smm.perTonUsdEx > 0);
  const noR = computeAll({ ...base, R: null });
  assert.equal(noR.smm.perTonCnyEx, null);
  assert.equal(noR.smm.tonDegreeEx, null);
  assert.ok(noR.smm.batchUsdEx > 0 && noR.margin.batchUsd > 0);
  assert.equal(computeAll({ ...base, P: null }).smm, null);
  const noC = computeAll({ ...base, C: null });
  assert.equal(noC.ours, null);
  assert.equal(noC.margin, null);
  assert.ok(noC.contract.perTonUsdEx > 0);
  assert.equal(computeAll({ ...base, A: null }).margin, null);
});

test('AC07 非法输入给出提示，边界值可用', () => {
  const g = { min: 1, max: 50 };
  assert.ok(parseInput('0', g).error);
  assert.ok(parseInput('51', g).error);
  assert.equal(parseInput('1', g).value, 1);
  assert.equal(parseInput('50', g).value, 50);
  assert.equal(parseInput('-2').error, '必须大于 0');
  assert.equal(parseInput('-1', { allowZero: true }).error, '不能为负数');
  assert.ok(parseInput('0').error);
  assert.ok(parseInput('abc').error);
  assert.equal(parseInput('2.35').value, 2.35);
  assert.equal(parseInput('0', { allowZero: true }).value, 0);
  const g2 = { min: 1, max: 50, decimals: 2 };
  assert.equal(parseInput('30.25', g2).value, 30.25);
  assert.ok(parseInput('30.255', g2).error);
  assert.equal(parseInput('').value, null);
  assert.equal(parseInput('').error, null);
});
