// PRD 第 5、9 节验收样例（AC01–AC07）。运行：node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
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


// 人民币吨度价输入；保留原有验收测试。
import { perGradeFromTonDegree, groupPrices } from '../public/calc.js';

test('含税吨度价换算及反算', () => {
  const ctx = { ...base, R: 6.7049 };
  const X = perGradeFromTonDegree(40150, { ...ctx, taxIncluded: true });
  assert.ok(Math.abs(X - 5.29925) < 0.00001);
  assert.equal(r4(X), 5.2993);
  assert.ok(Math.abs(groupPrices(X, ctx).tonDegreeInc - 40150) < 1e-6);
});

test('不含税吨度价换算及反算', () => {
  const ctx = { ...base, R: 6.7049 };
  const X = perGradeFromTonDegree(40150, { ...ctx, taxIncluded: false });
  assert.ok(Math.abs(X - 40150 / 6704.9) < 1e-12);
  assert.ok(Math.abs(groupPrices(X, ctx).tonDegreeEx - 40150) < 1e-6);
});

test('零税率下两种吨度价口径一致', () => {
  const ctx = { R: 6.7049, v: 0 };
  assert.equal(perGradeFromTonDegree(40150, { ...ctx, taxIncluded: true }), perGradeFromTonDegree(40150, { ...ctx, taxIncluded: false }));
});

test('吨度价缺值及无效参数不参与计算', () => {
  for (const taxIncluded of [true, false]) {
    const ctx = { R: 6.7049, v: 0.13, taxIncluded };
    for (const Q of [null, undefined, 0, -1, NaN, Infinity, '40150']) assert.equal(perGradeFromTonDegree(Q, ctx), null);
    for (const R of [null, undefined, 0, -1, NaN, Infinity]) assert.equal(perGradeFromTonDegree(40150, { ...ctx, R }), null);
    for (const v of [null, undefined, -0.1, 1.01, NaN, Infinity]) assert.equal(perGradeFromTonDegree(40150, { ...ctx, v }), null);
  }
  assert.equal(perGradeFromTonDegree(40150), null);
});

test('用户样例：人民币合同与美元成本的毛利', () => {
  const ctx = { ...base, R: 6.7049, G: 30, T: 2.3, C: 4.8 };
  const A = perGradeFromTonDegree(40150, { ...ctx, taxIncluded: true });
  const result = computeAll({ ...ctx, A }).margin;
  const expectedUsd = (40150 / 1.13 / 6.7049 * 30) - 4.8 * 30000;
  assert.ok(Math.abs(result.perTonUsd - expectedUsd) < 1e-6);
  assert.ok(Math.abs(result.batchUsd - expectedUsd * 2.3) < 1e-6);
  assert.ok(Math.abs(result.perTonCny - expectedUsd * 6.7049) < 1e-6);
  assert.ok(Math.abs(result.batchCny - expectedUsd * 2.3 * 6.7049) < 1e-6);
});

test('吨度价锚点随汇率和税率重新换算', () => {
  const convert = (R, v) => perGradeFromTonDegree(40150, { R, v, taxIncluded: true });
  assert.ok(convert(7, 0.13) < convert(6.7049, 0.13));
  assert.ok(convert(6.7049, 0.09) > convert(6.7049, 0.13));
  const missing = computeAll({ ...base, A: convert(null, 0.13) });
  assert.equal(missing.contract, null);
  assert.equal(missing.margin, null);
});

test('价格输入事件：税口径保留数字、单位往返恢复原文、编辑重设锚点及提示', () => {
  // 执行实际页面函数及事件绑定；仅替代 DOM 和页面启动时的网络请求。
  const nodes = new Map();
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: '', textContent: '', listeners: {}, dataset: {},
      querySelector: (s) => node(`${selector} ${s}`), querySelectorAll: () => [],
      closest: (s) => node(`${selector} ${s}`),
      addEventListener(type, fn) { this.listeners[type] = fn; },
      setAttribute() {}, append() {},
    });
    return nodes.get(selector);
  };
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/, '').split('\nbind();')[0];
  const context = {
    document: { querySelector: node, createElement: () => node('button'), addEventListener() {} },
    window: { matchMedia: () => ({ matches: true }), addEventListener() {} },
    setInterval() {}, parseInput, perGradeFromTonDegree,
  };
  const ui = runInNewContext(`${source}
    let params = { R: 6.7049, v: 0.13 };
    readInputs = () => {
      const inp = { ...params };
      for (const key of ['a', 'c']) {
        const price = state.prices[key];
        const raw = parseInput($('#in-' + key).value).value;
        inp[key.toUpperCase()] = price.mode === 'usd' ? raw
          : perGradeFromTonDegree(raw, { ...inp, taxIncluded: price.taxIncluded });
      }
      return inp;
    };
    recalc = () => {};
    bind();
    ({ switchPriceInput, readInputs, renderPriceInput, state,
       setParams: (p) => Object.assign(params, p) });
  `, context);
  const edit = (key, text) => {
    const input = node(`#in-${key}`);
    input.id = `in-${key}`;
    input.value = text;
    node('#calc').listeners.input({ target: input });
  };
  for (const key of ['a', 'c']) {
    const input = node(`#in-${key}`);
    ui.switchPriceInput(key, 'cny', true);
    edit(key, '40150');
    ui.switchPriceInput(key, 'cny', false);
    assert.equal(input.value, '40150');
    assert.equal(r4(ui.readInputs()[key.toUpperCase()]), 5.9882);
    ui.switchPriceInput(key, 'cny', true);
    assert.equal(input.value, '40150');
    assert.equal(r4(ui.readInputs()[key.toUpperCase()]), 5.2993);
    for (let i = 0; i < 3; i++) {
      ui.switchPriceInput(key, 'usd', true);
      assert.equal(input.value, '5.2993');
      ui.switchPriceInput(key, 'cny', true);
      assert.equal(input.value, '40150');
    }
    ui.switchPriceInput(key, 'usd', true);
    edit(key, '5.3');
    ui.switchPriceInput(key, 'cny', true);
    assert.equal(input.value, (5.3 * 1000 * 6.7049 * 1.13).toFixed(2));
    ui.switchPriceInput(key, 'usd', true);
    assert.equal(input.value, '5.3');
    ui.switchPriceInput(key, 'cny', true);
    const row = input.closest('.row-input');
    const hint = row.querySelector('[data-k="perGradeInc"]');
    const label = row.querySelector('label.label');
    const render = () => ui.renderPriceInput(key, ui.readInputs());
    ui.setParams({ R: null });
    edit(key, ''); render();
    assert.equal(hint.textContent, '');
    edit(key, '40150'); render();
    assert.equal(hint.textContent, '需要汇率才能换算');
    assert.equal(label.textContent, '吨度价');
    ui.setParams({ R: 6.7049, v: null }); render();
    assert.equal(hint.textContent, '需要有效税率才能换算');
    ui.setParams({ v: 0.13 });
    ui.switchPriceInput(key, 'usd', true); render();
    assert.equal(label.textContent, '每品位单价');
  }
});


test('ton-degree input survives tax change and unit round trip', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const switchSource = source.slice(source.indexOf('function switchPriceInput('), source.indexOf('function renderGroup('));
  for (const key of ['a', 'c']) {
    const input = { value: '40150' };
    const price = { mode: 'cny', taxIncluded: true,
      original: { text: '40150', mode: 'cny', taxIncluded: true } };
    const switchPriceInput = runInNewContext(`${switchSource}; switchPriceInput`, {
      state: { prices: { [key]: price } },
      $: () => input, recalc() {}, perGradeFromTonDegree,
      readInputs: () => ({ R: 6.7049, v: 0.13,
        [key.toUpperCase()]: price.mode === 'usd' ? Number(input.value)
          : perGradeFromTonDegree(Number(input.value), { R: 6.7049, v: 0.13, taxIncluded: price.taxIncluded }),
      }),
    });
    switchPriceInput(key, 'cny', false);
    assert.equal(input.value, '40150');
    switchPriceInput(key, 'usd', false);
    assert.equal(input.value, '5.9882');
    switchPriceInput(key, 'cny', false);
    assert.equal(input.value, '40150');
  }
});

test('batch profit weight prompt and animation recovery', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const nodes = new Map();
  const pending = new Map();
  let id = 0;
  const schedule = fn => { pending.set(++id, fn); return id; };
  const cancel = key => pending.delete(key);
  const $ = key => {
    if (!nodes.has(key)) {
      const classes = new Set();
      nodes.set(key, { textContent: '', hidden: false,
        hasAttribute: () => true,
        classList: { add: c => classes.add(c), remove: c => classes.delete(c),
          toggle: (c, on) => on ? classes.add(c) : classes.delete(c), contains: c => classes.has(c) },
      });
    }
    return nodes.get(key);
  };
  const render = runInNewContext(
    source.slice(source.indexOf('const fmtCache'), source.indexOf('// ----------', source.indexOf('const fmtCache'))) +
    source.slice(source.indexOf('function renderProfit('), source.indexOf('function renderKg(')) + '; renderProfit',
    { $, Intl, reduceMotion: { matches: false }, performance: { now: () => 0 },
      requestAnimationFrame: schedule, cancelAnimationFrame: cancel, setTimeout: schedule, clearTimeout: cancel });
  const draw = inp => render(computeAll(inp).margin, inp);
  const batch = $('#pf-batch');
  for (const text of ['', 'abc', '0', '-1']) {
    draw({ ...base, T: parseInput(text, {}).value });
    assert.equal(batch.textContent, '\u8bf7\u8f93\u5165\u51c0\u91cd');
    assert.equal(batch.classList.contains('needs-weight'), true);
    assert.equal($('#pf-batch-unit').hidden, true);
    assert.equal($('#pf-batch-cny').textContent, '');
  }
  draw(base);
  assert.equal(batch.textContent, '82,800.00');
  assert.equal(batch.classList.contains('needs-weight'), false);
  assert.equal($('#pf-batch-unit').hidden, false);
  draw({ ...base, T: 3 });
  assert.ok(pending.size > 0);
  draw({ ...base, T: null });
  assert.equal(pending.size, 0);
  draw(base);
  assert.equal(batch.textContent, '82,800.00');
  for (const key of ['A', 'C', 'G']) {
    draw({ ...base, [key]: null, T: null });
    assert.equal(batch.textContent, '\u2014');
    assert.equal(batch.classList.contains('needs-weight'), false);
    assert.equal($('#pf-batch-unit').hidden, false);
    assert.ok($('#pf-hint').textContent.startsWith('\u5f85\u8f93\u5165\uff1a'));
  }
});
