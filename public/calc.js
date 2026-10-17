// 钽铌矿价格计算：纯函数，无 DOM 依赖（页面与测试共用）
// 单位约定见 PRD 第 3—5 节：X 为不含税美元/品位（美元/公斤矿石/1 个 Ta2O5 品位点）

export const LB_PER_KG = 2.2046226218487757;

const isPos = (n) => Number.isFinite(n) && n > 0;

// 输入校验：返回 { value, error }，空值 value 为 null 且无错误
export function parseInput(raw, { min = 0, max = Infinity, allowZero = false, decimals = Infinity } = {}) {
  const text = String(raw ?? '').trim().replace(/,/g, '');
  if (text === '') return { value: null, error: null };
  if (!/^\d*\.?\d+$/.test(text)) return { value: null, error: '请输入数字' };
  if ((text.split('.')[1] || '').length > decimals) return { value: null, error: `最多 ${decimals} 位小数` };
  const n = Number(text);
  if (!Number.isFinite(n)) return { value: null, error: '请输入数字' };
  if (allowZero ? n < 0 : n <= 0) return { value: null, error: allowZero ? '不能为负数' : '必须大于 0' };
  if (n < min || n > max) return { value: null, error: `范围 ${min}–${max}` };
  return { value: n, error: null };
}

// SMM 美元/磅 → 不含税美元/品位
export function smmPerGrade(P) {
  return isPos(P) ? (P * LB_PER_KG) / 100 : null;
}

// 单组价格。X 不含税美元/品位；G 品位点数；T 吨；v 税率（0.13）；R 汇率
export function groupPrices(X, { G, T, v, R }) {
  if (!isPos(X)) return null;
  const k = 1 + v;
  const okG = isPos(G), okT = isPos(T), okR = isPos(R);
  const perTonEx = okG ? X * G * 1000 : null;
  const perTonInc = okG ? perTonEx * k : null;
  return {
    perGradeEx: X,
    perGradeInc: X * k,
    perTonUsdEx: perTonEx,
    perTonUsdInc: perTonInc,
    perTonCnyEx: okG && okR ? perTonEx * R : null,
    perTonCnyInc: okG && okR ? perTonInc * R : null,
    tonDegreeEx: okR ? X * 1000 * R : null,
    tonDegreeInc: okR ? X * 1000 * R * k : null,
    batchUsdEx: okG && okT ? perTonEx * T : null,
    batchUsdInc: okG && okT ? perTonInc * T : null,
    batchCnyEx: okG && okT && okR ? perTonEx * T * R : null,
    batchCnyInc: okG && okT && okR ? perTonInc * T * R : null,
  };
}

// 预期毛利：合同价 − 我方价（均为不含税）
export function margin(A, C, { G, T, R }) {
  if (!isPos(A) || !isPos(C) || !isPos(G)) return null;
  const perTonUsd = (A - C) * G * 1000;
  const okT = isPos(T), okR = isPos(R);
  return {
    perTonUsd,
    perTonCny: okR ? perTonUsd * R : null,
    batchUsd: okT ? perTonUsd * T : null,
    batchCny: okT && okR ? perTonUsd * T * R : null,
  };
}

// 一次性计算全部结果
export function computeAll({ P, A, C, G, T, v, R }) {
  const ctx = { G, T, v, R };
  const S = smmPerGrade(P);
  return {
    smm: groupPrices(S, ctx),
    contract: groupPrices(A, ctx),
    ours: groupPrices(C, ctx),
    margin: margin(A, C, ctx),
  };
}
