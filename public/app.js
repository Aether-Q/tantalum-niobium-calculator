import { computeAll, parseInput } from './calc.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const GRADE = { min: 1, max: 50, decimals: 2 };
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// 页面状态只存在内存中，刷新或重开即清空
const state = {
  tax: 'ex',
  cur: 'usd',
  market: {
    smm: { mode: 'auto', auto: null },
    fx: { mode: 'auto', auto: null },
  },
};

// ---------- 数字格式与滚动动效 ----------
const fmtCache = new Map();
function fmt(n, d = 2) {
  if (!fmtCache.has(d)) fmtCache.set(d, new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const s = fmtCache.get(d).format(Math.abs(n));
  return n < 0 && Number(s.replace(/,/g, '')) !== 0 ? '−' + s : s;
}

function setNum(el, value, d = 2, placeholder = '—') {
  if (el._raf) cancelAnimationFrame(el._raf);
  const prev = el._v;
  el._v = value;
  if (value == null) { el.textContent = placeholder; el.classList.add('pending'); return; }
  el.classList.remove('pending');
  const animate = el.hasAttribute('data-anim') && typeof prev === 'number' && prev !== value && !reduceMotion.matches;
  if (!animate) { el.textContent = fmt(value, d); return; }
  const start = performance.now(), dur = 400;
  const step = (t) => {
    const p = Math.min(1, (t - start) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    if (p < 1) {
      el.textContent = fmt(prev + (value - prev) * e, d);
      el._raf = requestAnimationFrame(step);
    } else {
      el.textContent = fmt(value, d); // 结束值精确等于计算结果
      el._raf = null;
    }
  };
  el._raf = requestAnimationFrame(step);
}

// ---------- 输入读取 ----------
function readField(input, errEl, opts) {
  const { value, error } = parseInput(input.value, opts);
  const field = input.closest('.field');
  if (field) field.classList.toggle('invalid', !!error);
  if (errEl) { errEl.textContent = error || ''; errEl.hidden = !error; }
  return value;
}

function quoteValue(key) {
  const q = state.market[key];
  const box = $(key === 'smm' ? '#q-smm' : '#q-fx');
  const input = $('[data-role="manual-input"]', box);
  const err = $('[data-role="error"]', box);
  if (q.mode === 'manual') return readField(input, err, {});
  err.hidden = true;
  return q.auto && q.auto.value > 0 ? q.auto.value : null;
}

function readInputs() {
  const v = readField($('#in-tax'), $('#err-tax'), { allowZero: true, max: 100, min: 0 });
  return {
    P: quoteValue('smm'),
    R: quoteValue('fx'),
    v: v == null ? null : v / 100,
    G: readField($('#in-grade'), $('#err-grade'), GRADE),
    T: readField($('#in-ton'), $('#err-ton'), {}),
    A: readField($('#in-a'), $('#err-a'), {}),
    C: readField($('#in-c'), $('#err-c'), {}),
  };
}

// ---------- 渲染 ----------
function renderGroup(root, g, inp) {
  const inc = state.tax === 'inc', cny = state.cur === 'cny';
  const taxLabel = inc ? '含税' : '不含税';
  const pick = (ex, incV) => (g ? (inc ? g[incV] : g[ex]) : null);

  const perTon = cny ? pick('perTonCnyEx', 'perTonCnyInc') : pick('perTonUsdEx', 'perTonUsdInc');
  setNum($('[data-k="perTon"]', root), g && inp.v != null ? perTon : null);
  $('[data-u="perTon"]', root).textContent = `${cny ? '人民币' : '美元'}/吨 · ${taxLabel}`;

  const pg = $('[data-k="perGrade"]', root);
  if (pg) setNum(pg, g && inp.v != null ? pick('perGradeEx', 'perGradeInc') : null, 4);

  const pgi = $('[data-k="perGradeInc"]', root);
  if (pgi) pgi.textContent = g && inc && inp.v != null ? `含税 ${fmt(g.perGradeInc, 4)} 美元/品位` : '';

  setNum($('[data-k="tonDegree"]', root), g && inp.v != null ? pick('tonDegreeEx', 'tonDegreeInc') : null);
  const batch = cny ? pick('batchCnyEx', 'batchCnyInc') : pick('batchUsdEx', 'batchUsdInc');
  setNum($('[data-k="batch"]', root), g && inp.v != null ? batch : null);
  $('[data-u="batch"]', root).textContent = `${cny ? '人民币' : '美元'} · ${taxLabel}`;

}

function renderProfit(m, inp) {
  setNum($('#pf-batch'), m ? m.batchUsd : null);
  setNum($('#pf-ton'), m ? m.perTonUsd : null);
  $('#pf-batch-cny').textContent = m && m.batchCny != null ? `≈ ${fmt(m.batchCny)} 人民币` : '';
  $('#pf-ton-cny').textContent = m && m.perTonCny != null ? `≈ ${fmt(m.perTonCny)} 人民币/吨` : '';

  const missing = [];
  if (inp.A == null) missing.push('合同单价');
  if (inp.C == null) missing.push('我方单价');
  if (inp.G == null) missing.push('品位');
  if (m && inp.T == null) missing.push('吨数（本批毛利）');
  if (m && inp.R == null) missing.push('汇率（人民币换算）');
  $('#pf-hint').textContent = missing.length ? `待输入：${missing.join('、')}` : '';
}

function renderKg(T) {
  $('#kg').textContent = T == null ? '折合 — 公斤' : `折合 ${fmt(T * 1000, T * 1000 % 1 ? 1 : 0)} 公斤`;
}

function syncGradeUI(G) {
  const range = $('#in-grade-range');
  if (G != null) range.value = Math.round(G);
  range.parentElement.classList.toggle('empty', G == null);
  range.style.setProperty('--pct', G == null ? '0%' : `${((range.value - 1) / 49) * 100}%`);
  $$('#chips button').forEach((b) => b.setAttribute('aria-pressed', String(G === Number(b.dataset.g))));
}

function recalc() {
  const inp = readInputs();
  const r = computeAll(inp);
  const ctx = (g) => (inp.v == null ? null : g);
  renderGroup($('#g-smm'), ctx(r.smm), inp);
  renderGroup($('#g-contract'), ctx(r.contract), inp);
  renderGroup($('#g-ours'), ctx(r.ours), inp);
  renderProfit(r.margin, inp);
  renderKg(inp.T);
  syncGradeUI(inp.G);
}

// ---------- 行情与汇率 ----------
const bjToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const bjTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
};

function renderQuote(key) {
  const q = state.market[key];
  const box = $(key === 'smm' ? '#q-smm' : '#q-fx');
  const a = q.auto;
  const manual = q.mode === 'manual';
  $$('.seg button', box).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === q.mode)));
  $('[data-role="auto-value"]', box).hidden = manual;
  $('[data-role="manual-field"]', box).hidden = !manual;

  const valEl = $('[data-role="auto-value"]', box);
  const has = a && a.value > 0;
  valEl.textContent = has ? fmt(a.value, key === 'smm' ? 2 : 4) : '—';

  let meta;
  if (manual) {
    meta = '手动输入 · 自动更新不会覆盖此值';
  } else if (a === null) {
    meta = '正在读取…';
  } else if (!has) {
    meta = key === 'smm' ? '未获取到报价，请切换“手动”输入今日 SMM 价格' : '未获取到汇率，请切换“手动”输入';
  } else {
    const date = key === 'smm' ? a.sourceDate : (a.sourceUpdatedAt || '').slice(0, 10);
    const label = key === 'smm' ? '报价日期' : '数据时间';
    const shown = key === 'smm' ? date : bjTime(a.sourceUpdatedAt) + '（北京时间）';
    meta = `${label} ${shown || '—'}`;
    if (a.status === 'failed') meta += ' · 更新失败，显示最近有效值';
    else if (key === 'smm' && date && date !== bjToday()) meta += ' · 最新已发布报价';
  }
  $('[data-role="meta"]', box).textContent = meta;
}

function renderExplainSources() {
  const s = state.market.smm.auto, f = state.market.fx.auto;
  $('#ex-smm').textContent = s && s.lastSuccessAt ? ` 最近成功获取：${bjTime(s.lastSuccessAt)}（北京时间）。` : '';
  $('#ex-fx').textContent = f && f.lastSuccessAt ? `；最近成功获取：${bjTime(f.lastSuccessAt)}（北京时间）。` : '';
}

async function loadMarket() {
  let data = null;
  try {
    const res = await fetch('/api/market', { cache: 'no-store' });
    if (res.ok) data = await res.json();
  } catch { /* 网络失败按无数据处理 */ }
  for (const key of ['smm', 'fx']) {
    const rec = data && data[key];
    const prev = state.market[key].auto;
    // 只接受有效正数；同一已打开页面不回退到更早的数据
    const value = rec && Number(rec.value);
    if (rec && value > 0) {
      const next = { ...rec, value };
      const older = prev && prev.value > 0 && key === 'smm' && next.sourceDate && prev.sourceDate && next.sourceDate < prev.sourceDate;
      state.market[key].auto = older ? prev : next;
    } else if (!prev || !(prev.value > 0)) {
      state.market[key].auto = { value: null, status: rec ? rec.status : 'failed' };
    } else if (rec) {
      state.market[key].auto = { ...prev, status: rec.status || 'failed' };
    } else {
      state.market[key].auto = { ...prev, status: 'failed' };
    }
    renderQuote(key);
  }
  renderExplainSources();
  recalc();
}

// ---------- 事件绑定 ----------
function bind() {
  const form = $('#calc');
  form.addEventListener('input', (e) => {
    if (e.target.id === 'in-grade-range') $('#in-grade').value = Number(e.target.value).toFixed(2);
    recalc();
  });

  const chips = $('#chips');
  for (let g = 5; g <= 50; g += 5) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.g = g; b.textContent = `${g}%`; b.setAttribute('aria-pressed', 'false');
    chips.append(b);
  }
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $('#in-grade').value = Number(b.dataset.g).toFixed(2);
    recalc();
  });

  for (const key of ['smm', 'fx']) {
    const box = $(key === 'smm' ? '#q-smm' : '#q-fx');
    $('.seg', box).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const q = state.market[key];
      q.mode = b.dataset.mode;
      const input = $('[data-role="manual-input"]', box);
      if (q.mode === 'manual') {
        if (!input.value && q.auto && q.auto.value > 0) input.value = q.auto.value;
        renderQuote(key);
        input.focus(); input.select();
      } else {
        input.value = '';
        renderQuote(key);
      }
      recalc();
    });
  }

  const seg = (id, prop) => $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state[prop] = b.dataset.v;
    $$(`${id} button`).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    recalc();
  });
  seg('#seg-tax', 'tax');
  seg('#seg-cur', 'cur');

  // 品位按第三方化验报告习惯显示两位小数
  $('#in-grade').addEventListener('blur', (e) => {
    const { value } = parseInput(e.target.value, GRADE);
    if (value != null) e.target.value = value.toFixed(2);
  });

  $('#btn-refresh').addEventListener('click', loadMarket);

  const ex = $('.explain');
  ex.addEventListener('toggle', () => { $('.explain summary .meta').textContent = ex.open ? '收起' : '展开'; });

  // 页面可见时每 5 分钟读取一次本站缓存（不增加上游请求）
  setInterval(() => { if (document.visibilityState === 'visible') loadMarket(); }, 5 * 60e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadMarket(); });
  // 浏览器“返回”恢复页面时也清空输入
  window.addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
}

bind();
resetForm();
renderQuote('smm');
renderQuote('fx');
recalc();
loadMarket();

function resetForm() {
  // 防止浏览器自动回填上次的输入
  $('#calc').reset();
  $('#in-tax').value = '13';
}
