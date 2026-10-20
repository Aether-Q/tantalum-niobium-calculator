const SMM_PRODUCT = '202504100001';
const FX_URL = 'https://www.boc.cn/sourcedb/whpj/';

class SourceError extends Error {
  constructor(type) {
    super(type);
    this.type = type;
  }
}

function positiveNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function validDate(value) {
  return typeof value === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function failedRecord(previous, attemptedAt, error) {
  const type = error instanceof SourceError ? error.type
    : ['TimeoutError', 'AbortError'].includes(error?.name) ? 'timeout' : 'network_error';
  return {...(previous ?? {value: null}), status: 'failed', lastAttemptAt: attemptedAt, error: type};
}

async function requestJson(fetcher, url, headers) {
  const response = await fetcher(url, {
    method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000),
    ...(headers ? {headers} : {})
  });
  if (!response.ok) throw new SourceError(`http_${response.status}`);
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (contentType.includes('text/html')) throw new SourceError('login_page');
  if (!contentType.includes('json')) throw new SourceError('bad_json');
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new SourceError('bad_json');
    throw error;
  }
}

/** now returns Unix milliseconds; kv implements Workers KV get(key, 'json')/put. */
export async function updateSmm({kv, fetch: fetcher = globalThis.fetch, now = Date.now}) {
  const timestamp = now();
  const attemptedAt = new Date(timestamp).toISOString();
  const today = new Date(timestamp + 8 * 3_600_000).toISOString().slice(0, 10);
  const previous = await kv.get('smm', 'json');
  if (previous?.status === 'ok' && previous.sourceDate === today && positiveNumber(previous.value) !== null) {
    return previous;
  }

  let record;
  try {
    const payload = await requestJson(fetcher,
      `https://hq.smm.cn/ajax/spot/history/${SMM_PRODUCT}/${today}/${today}`, {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: `https://hq.smm.cn/other-minor-metals/category/${SMM_PRODUCT}`
      });
    if (payload?.code !== 0) throw new SourceError('business_error');
    if (!Array.isArray(payload.data)) throw new SourceError('bad_response');
    const rows = payload.data
      .filter(row => row && validDate(row.renew_date) && row.renew_date <= today && positiveNumber(row.average) !== null)
      .map(row => ({sourceDate: row.renew_date, value: Number(row.average)}))
      .sort((a, b) => b.sourceDate.localeCompare(a.sourceDate));
    if (!rows.length) throw new SourceError('no_valid_quote');
    const latest = rows[0];
    if (rows.some(row => row.sourceDate === latest.sourceDate && row.value !== latest.value)) {
      throw new SourceError('conflict');
    }
    if (validDate(previous?.sourceDate) && latest.sourceDate < previous.sourceDate) return previous;
    if (previous?.sourceDate === latest.sourceDate && positiveNumber(previous.value) !== null &&
        Number(previous.value) !== latest.value) throw new SourceError('conflict');
    record = {...latest, unit: 'USD/lb', status: 'ok', lastSuccessAt: attemptedAt, lastAttemptAt: attemptedAt};
  } catch (error) {
    record = failedRecord(previous, attemptedAt, error);
  }
  await kv.put('smm', JSON.stringify(record));
  return record;
}

function bocQuote(html) {
  // This source has one current USD row. Reject a changed table instead of guessing a column.
  const table = html.match(/<table\b[^>]*\bid=["']priceTable["'][^>]*>([\s\S]*?)<\/table>/i)?.[1];
  const cells = (row, tag) => [...row.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'))]
    .map(match => match[1].replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ' ').trim());
  const expected = ['货币名称', '现汇买入价', '现钞买入价', '现汇卖出价', '现钞卖出价', '中行折算价', '发布日期', '发布时间'];
  if (!table || cells(table, 'th').join('|') !== expected.join('|') || !html.includes('100外币换算人民币')) {
    throw new SourceError('bad_response');
  }
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(match => cells(match[1], 'td')).filter(row => row[0] === '美元');
  if (rows.length !== 1 || rows[0].length !== 8) throw new SourceError('bad_response');
  const row = rows[0];
  const value = /^\d+(?:\.\d+)?$/.test(row[3]) ? positiveNumber(row[3]) : null;
  if (value === null) throw new SourceError('bad_response');
  const date = row[6].match(/^(\d{4})[/-](\d{2})[/-](\d{2})(?:\s+(\d{2}:\d{2}:\d{2}))?$/);
  if (!date || !validDate(`${date[1]}-${date[2]}-${date[3]}`) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(row[7]) || (date[4] && date[4] !== row[7])) {
    throw new SourceError('bad_timestamp');
  }
  return {value: value / 100,
    sourceUpdatedAt: new Date(`${date[1]}-${date[2]}-${date[3]}T${row[7]}+08:00`).toISOString()};
}

const isBocFx = record => record?.source === 'boc' && record.rateType === 'spot_sell';

export async function updateFx({kv, fetch: fetcher = globalThis.fetch, now = Date.now}) {
  const timestamp = now();
  const attemptedAt = new Date(timestamp).toISOString();
  const stored = await kv.get('fx', 'json');
  const previous = isBocFx(stored) ? stored : null;
  const today = new Date(timestamp + 8 * 3_600_000).toISOString().slice(0, 10);
  const sourceTime = Date.parse(previous?.sourceUpdatedAt);
  if (previous?.status === 'ok' && positiveNumber(previous.value) !== null &&
      Number.isFinite(sourceTime) && new Date(sourceTime + 8 * 3_600_000).toISOString().slice(0, 10) === today &&
      timestamp < Date.parse(previous.nextUpdateAt)) return previous;

  let record;
  try {
    const response = await fetcher(FX_URL, {method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(25_000),
      headers: {'User-Agent': 'Mozilla/5.0', Accept: 'text/html'}});
    if (!response.ok) throw new SourceError(`http_${response.status}`);
    if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) throw new SourceError('bad_response');
    const {value, sourceUpdatedAt} = bocQuote(await response.text());
    if (Date.parse(sourceUpdatedAt) > now() ||
        (previous?.sourceUpdatedAt && sourceUpdatedAt < previous.sourceUpdatedAt)) throw new SourceError('bad_timestamp');
    if (previous?.sourceUpdatedAt === sourceUpdatedAt && positiveNumber(previous.value) !== null &&
        previous.value !== value) throw new SourceError('conflict');
    // Our next daily check (Beijing 12:00), not a promised bank publication time.
    const noon = Date.parse(`${today}T12:00:00+08:00`);
    const nextUpdateAt = new Date(noon > timestamp ? noon : noon + 86_400_000).toISOString();
    record = {value, base: 'USD', quote: 'CNY', source: 'boc', rateType: 'spot_sell', sourceUpdatedAt, nextUpdateAt,
      status: 'ok', lastSuccessAt: attemptedAt, lastAttemptAt: attemptedAt};
  } catch (error) {
    record = {...failedRecord(previous, attemptedAt, error), source: 'boc', rateType: 'spot_sell'};
  }
  await kv.put('fx', JSON.stringify(record));
  return record;
}

export async function refreshMarket(options) {
  // Wait for both sources even if a KV operation for one of them fails.
  const results = await Promise.allSettled([updateSmm(options), updateFx(options)]);
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (errors.length) throw new AggregateError(errors, 'Market storage update failed');
}

export default {
  async fetch(request, env) {
    if (request.method === 'GET' && new URL(request.url).pathname === '/api/market') {
      const [smm, fx] = await Promise.all([env.MARKET.get('smm', 'json'), env.MARKET.get('fx', 'json')]);
      return new Response(JSON.stringify({
        smm: smm ?? {value: null, status: 'none'},
        fx: isBocFx(fx) ? fx : {value: null, status: 'none'}
      }), {headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(_controller, env) {
    await refreshMarket({kv: env.MARKET});
  }
};
