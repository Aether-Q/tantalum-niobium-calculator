const SMM_PRODUCT = '202504100001';
const FX_URL = 'https://open.er-api.com/v6/latest/USD';

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

function unixTime(value) {
  const seconds = positiveNumber(value);
  if (seconds === null || !Number.isFinite(new Date(seconds * 1000).getTime())) {
    throw new SourceError('bad_timestamp');
  }
  return new Date(seconds * 1000).toISOString();
}

export async function updateFx({kv, fetch: fetcher = globalThis.fetch, now = Date.now}) {
  const timestamp = now();
  const attemptedAt = new Date(timestamp).toISOString();
  const previous = await kv.get('fx', 'json');
  if (previous?.status === 'ok' && positiveNumber(previous.value) !== null &&
      timestamp < Date.parse(previous.nextUpdateAt)) return previous;

  let record;
  try {
    const payload = await requestJson(fetcher, FX_URL);
    const value = positiveNumber(payload?.rates?.CNY);
    if (payload?.result !== 'success' || value === null ||
        (payload.base_code !== undefined && payload.base_code !== 'USD')) throw new SourceError('bad_response');
    const sourceUpdatedAt = unixTime(payload.time_last_update_unix);
    const nextUpdateAt = unixTime(payload.time_next_update_unix);
    if (nextUpdateAt <= sourceUpdatedAt) throw new SourceError('bad_timestamp');
    record = {value, base: 'USD', quote: 'CNY', sourceUpdatedAt, nextUpdateAt,
      status: 'ok', lastSuccessAt: attemptedAt, lastAttemptAt: attemptedAt};
  } catch (error) {
    record = failedRecord(previous, attemptedAt, error);
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
        fx: fx ?? {value: null, status: 'none'}
      }), {headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(_controller, env) {
    await refreshMarket({kv: env.MARKET});
  }
};
