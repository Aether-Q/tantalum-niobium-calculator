import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {updateSmm, updateFx, refreshMarket} from '../src/worker.js';

const NOW = Date.parse('2026-10-17T04:00:00Z');
const NOW_ISO = new Date(NOW).toISOString();
const OLD_TIME = '2026-10-16T04:00:00.000Z';
const smmRecord = (overrides = {}) => ({value: 210, unit: 'USD/lb', sourceDate: '2026-10-16',
  status: 'ok', lastSuccessAt: OLD_TIME, lastAttemptAt: OLD_TIME, ...overrides});
const fxRecord = (overrides = {}) => ({value: 6.9, base: 'USD', quote: 'CNY', source: 'boc', rateType: 'spot_sell',
  sourceUpdatedAt: OLD_TIME, nextUpdateAt: '2026-10-17T05:00:00.000Z',
  status: 'ok', lastSuccessAt: OLD_TIME, lastAttemptAt: OLD_TIME, ...overrides});

function memoryKv(initial = {}) {
  const records = new Map(Object.entries(structuredClone(initial)));
  const writes = [];
  return {
    writes,
    async get(key, type) {
      assert.equal(type, 'json');
      return structuredClone(records.get(key) ?? null);
    },
    async put(key, value) {
      writes.push(key);
      records.set(key, JSON.parse(value));
    }
  };
}

const json = payload => new Response(JSON.stringify(payload), {headers: {'content-type': 'application/json'}});
const smmResponse = rows => json({code: 0, data: rows});
const fxResponse = () => bocResponse();

// Each stub permits at most one call; unexpected URLs or extra requests fail the test.
function fetchOnce(expectedUrl, response) {
  let calls = 0;
  return {
    get calls() { return calls; },
    fetch: async (url, options) => {
      calls++;
      assert.equal(calls, 1);
      assert.equal(url, expectedUrl);
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'manual');
      assert.ok(options.signal instanceof AbortSignal);
      return response(options);
    }
  };
}

const SMM_URL = 'https://hq.smm.cn/ajax/spot/history/202504100001/2026-10-17/2026-10-17';
const FX_URL = 'https://www.boc.cn/sourcedb/whpj/';
const noFetch = async () => { assert.fail('Unexpected upstream request'); };
const options = (kv, fetch) => ({kv, fetch, now: () => NOW});

const bocHtml = (row = '<td>美元</td><td>667.68</td><td>666.00</td><td>670.49</td><td>671.11</td><td>672.20</td><td class="pjrq">2026/10/17 11:59:00</td><td>11:59:00</td>') =>
  `<table id="priceTable"><tr><th>货币名称</th><th>现汇买入价</th><th>现钞买入价</th><th>现汇卖出价</th><th>现钞卖出价</th><th>中行折算价</th><th>发布日期</th><th>发布时间</th></tr><tr>${row}</tr></table>本汇率表单位为100外币换算人民币`;
const bocResponse = html => new Response(html ?? bocHtml(), {headers: {'content-type': 'text/html; charset=utf-8'}});

test('BOC USD spot selling per 100 USD becomes CNY per USD, with the original Beijing publication time', async () => {
  const kv = memoryKv();
  const stub = fetchOnce('https://www.boc.cn/sourcedb/whpj/', () => bocResponse());
  const record = await updateFx(options(kv, stub.fetch));
  assert.equal(stub.calls, 1);
  assert.deepEqual(record, {value: 6.7049, base: 'USD', quote: 'CNY', source: 'boc', rateType: 'spot_sell',
    sourceUpdatedAt: '2026-10-17T03:59:00.000Z', nextUpdateAt: '2026-10-18T04:00:00.000Z',
    status: 'ok', lastSuccessAt: NOW_ISO, lastAttemptAt: NOW_ISO});
});

test('Legacy non-bank FX is hidden by the API and is replaced even before its old cache expires', async () => {
  const previous = fxRecord({source: undefined, rateType: undefined});
  const kv = memoryKv({fx: previous});
  const response = await worker.fetch(new Request('https://calculator.test/api/market'), {MARKET: kv});
  assert.deepEqual((await response.json()).fx, {value: null, status: 'none'});
  const stub = fetchOnce(FX_URL, () => bocResponse());
  const record = await updateFx(options(kv, stub.fetch));
  assert.equal(record.value, 6.7049);
  assert.equal(record.source, 'boc');
});

test('SMM stores the newest valid quote even when it is not last, with source metadata', async () => {
  const kv = memoryKv();
  const stub = fetchOnce(SMM_URL, headers => {
    assert.equal(headers.headers.Referer, 'https://hq.smm.cn/other-minor-metals/category/202504100001');
    assert.equal(headers.headers['User-Agent'], 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    assert.equal(Object.keys(headers.headers).length, 2);
    return smmResponse([
      {renew_date: '2026-10-17', average: '215.4'},
      {renew_date: '2026-10-18', average: 900},
      {renew_date: '2026-02-30', average: 900},
      {renew_date: '2026-10-17', average: -1},
      {renew_date: '2026-10-17', average: true},
      null,
      {renew_date: '2026-10-16', average: 210}
    ]);
  });
  await updateSmm(options(kv, stub.fetch));
  assert.equal(stub.calls, 1);
  assert.deepEqual(await kv.get('smm', 'json'), {value: 215.4, unit: 'USD/lb', sourceDate: '2026-10-17',
    status: 'ok', lastSuccessAt: NOW_ISO, lastAttemptAt: NOW_ISO});
});

test('SMM skips an existing ok quote on the Beijing date, including the UTC date boundary', async () => {
  const stored = smmRecord({sourceDate: '2026-10-17'});
  const kv = memoryKv({smm: stored});
  await updateSmm({kv, fetch: noFetch, now: () => Date.parse('2026-10-16T16:01:00Z')});
  assert.deepEqual(await kv.get('smm', 'json'), stored);
  assert.deepEqual(kv.writes, []);
});

test('SMM retries a failed same-day record, and clears its error after success', async () => {
  const kv = memoryKv({smm: smmRecord({sourceDate: '2026-10-17', status: 'failed', error: 'timeout'})});
  const stub = fetchOnce(SMM_URL, () => smmResponse([{renew_date: '2026-10-17', average: 210}]));
  await updateSmm(options(kv, stub.fetch));
  const stored = await kv.get('smm', 'json');
  assert.equal(stub.calls, 1);
  assert.equal(stored.status, 'ok');
  assert.equal(stored.lastSuccessAt, NOW_ISO);
  assert.equal('error' in stored, false);
});

const smmFailures = [
  ['timeout', () => { throw new DOMException('Timed out', 'TimeoutError'); }],
  ['http_403', () => new Response('Forbidden', {status: 403})],
  ['http_302', () => new Response(null, {status: 302, headers: {location: '/login'}})],
  ['login_page', () => new Response('<html>Sign in</html>', {headers: {'content-type': 'text/html'}})],
  ['business_error', () => json({code: 1, data: [{renew_date: '2026-10-17', average: 999}]})],
  ['bad_json', () => new Response('{broken', {headers: {'content-type': 'application/json'}})],
  ['no_valid_quote', () => smmResponse([{renew_date: '2026-10-18', average: 100},
    {renew_date: '2026-10-17', average: 0}, {renew_date: 'invalid', average: 100}])]
];
for (const [error, response] of smmFailures) {
  test(`SMM ${error} preserves the previous value and dates without retrying`, async () => {
    const previous = smmRecord();
    const kv = memoryKv({smm: previous});
    const stub = fetchOnce(SMM_URL, response);
    await updateSmm(options(kv, stub.fetch));
    assert.equal(stub.calls, 1);
    assert.deepEqual(await kv.get('smm', 'json'), {...previous, status: 'failed', lastAttemptAt: NOW_ISO, error});
  });
}

test('SMM initial failure stores null, never a default value or fabricated source date', async () => {
  const kv = memoryKv();
  const stub = fetchOnce(SMM_URL, () => smmResponse([]));
  await updateSmm(options(kv, stub.fetch));
  assert.deepEqual(await kv.get('smm', 'json'), {value: null, status: 'failed', lastAttemptAt: NOW_ISO, error: 'no_valid_quote'});
});

test('SMM does not overwrite a cached quote with an older source date', async () => {
  const previous = smmRecord();
  const kv = memoryKv({smm: previous});
  const stub = fetchOnce(SMM_URL, () => smmResponse([{renew_date: '2026-10-15', average: 199}]));
  await updateSmm(options(kv, stub.fetch));
  assert.deepEqual(await kv.get('smm', 'json'), previous);
  assert.deepEqual(kv.writes, []);
});

test('SMM conflicting latest rows retain the previous quote and report conflict', async () => {
  const previous = smmRecord();
  const kv = memoryKv({smm: previous});
  const stub = fetchOnce(SMM_URL, () => smmResponse([
    {renew_date: '2026-10-17', average: 220}, {renew_date: '2026-10-17', average: 221}
  ]));
  await updateSmm(options(kv, stub.fetch));
  assert.deepEqual(await kv.get('smm', 'json'), {...previous, status: 'failed', lastAttemptAt: NOW_ISO, error: 'conflict'});
});

test('SMM conflicts with a cached value for the same date, even with only one returned row', async () => {
  const previous = smmRecord();
  const kv = memoryKv({smm: previous});
  const stub = fetchOnce(SMM_URL, () => smmResponse([{renew_date: '2026-10-16', average: 211}]));
  await updateSmm(options(kv, stub.fetch));
  assert.deepEqual(await kv.get('smm', 'json'), {...previous, status: 'failed', lastAttemptAt: NOW_ISO, error: 'conflict'});
});

test('SMM repeated identical rows are accepted and an old source date remains unchanged', async () => {
  const kv = memoryKv();
  const stub = fetchOnce(SMM_URL, () => smmResponse([
    {renew_date: '2026-10-16', average: 210}, {renew_date: '2026-10-16', average: '210'}
  ]));
  await updateSmm(options(kv, stub.fetch));
  assert.equal((await kv.get('smm', 'json')).sourceDate, '2026-10-16');
  assert.equal((await kv.get('smm', 'json')).status, 'ok');
});

test('FX skips before nextUpdateAt and refreshes at that exact time', async () => {
  const kv = memoryKv({fx: fxRecord({sourceUpdatedAt: '2026-10-17T03:00:00.000Z'})});
  await updateFx(options(kv, noFetch));
  assert.deepEqual(kv.writes, []);
  const stub = fetchOnce(FX_URL, () => fxResponse());
  const at = Date.parse('2026-10-17T05:00:00Z');
  await updateFx({kv, fetch: stub.fetch, now: () => at});
  assert.equal(stub.calls, 1);
  assert.deepEqual(await kv.get('fx', 'json'), {value: 6.7049, base: 'USD', quote: 'CNY', source: 'boc', rateType: 'spot_sell',
    sourceUpdatedAt: '2026-10-17T03:59:00.000Z', nextUpdateAt: '2026-10-18T04:00:00.000Z',
    status: 'ok', lastSuccessAt: new Date(at).toISOString(), lastAttemptAt: new Date(at).toISOString()});
});

test('FX status failed triggers a refresh even before nextUpdateAt', async () => {
  const kv = memoryKv({fx: fxRecord({status: 'failed', error: 'http_500'})});
  const stub = fetchOnce(FX_URL, () => fxResponse());
  await updateFx(options(kv, stub.fetch));
  assert.equal(stub.calls, 1);
  assert.equal((await kv.get('fx', 'json')).status, 'ok');
  assert.equal('error' in await kv.get('fx', 'json'), false);
});

test('BOC future publication times and regressed quotes preserve the last bank quote as failed', async () => {
  const previous = fxRecord({nextUpdateAt: NOW_ISO});
  for (const date of ['2026/10/18', '2026/10/15']) {
    const kv = memoryKv({fx: previous});
    const record = await updateFx(options(kv, async () => bocResponse(bocHtml().replace('2026/10/17', date))));
    assert.equal(record.value, previous.value);
    assert.equal(record.sourceUpdatedAt, previous.sourceUpdatedAt);
    assert.equal(record.status, 'failed');
    assert.equal(record.lastSuccessAt, OLD_TIME);
  }
});

test('A bank quote still dated yesterday is retried at 13:00, while a current-day success is cached', async () => {
  const kv = memoryKv();
  await updateFx(options(kv, async () => bocResponse(bocHtml().replace('2026/10/17', '2026/10/16'))));
  const stub = fetchOnce(FX_URL, () => bocResponse());
  const record = await updateFx({kv, fetch: stub.fetch, now: () => Date.parse('2026-10-17T05:00:00Z')});
  assert.equal(stub.calls, 1);
  assert.equal(record.sourceUpdatedAt, '2026-10-17T03:59:00.000Z');
  await updateFx({kv, fetch: noFetch, now: () => Date.parse('2026-10-17T05:01:00Z')});
});

test('The next Beijing noon fetches a new publication even when its exchange rate is unchanged', async () => {
  const kv = memoryKv();
  await updateFx(options(kv, async () => bocResponse()));
  await updateFx({kv, fetch: noFetch, now: () => Date.parse('2026-10-17T05:00:00Z')});
  const at = Date.parse('2026-10-18T04:00:00Z');
  const record = await updateFx({kv, fetch: async () => bocResponse(bocHtml().replace('2026/10/17', '2026/10/18')), now: () => at});
  assert.equal(record.value, 6.7049);
  assert.equal(record.sourceUpdatedAt, '2026-10-18T03:59:00.000Z');
  assert.equal(record.lastSuccessAt, '2026-10-18T04:00:00.000Z');
  assert.equal(record.nextUpdateAt, '2026-10-19T04:00:00.000Z');
});

test('A failed bank migration exposes no old reference rate and preserves the failed status', async () => {
  const kv = memoryKv({fx: fxRecord({source: undefined, rateType: undefined})});
  await updateFx(options(kv, async () => new Response('Unavailable', {status: 503})));
  const response = await worker.fetch(new Request('https://calculator.test/api/market'), {MARKET: kv});
  assert.deepEqual((await response.json()).fx, {value: null, source: 'boc', rateType: 'spot_sell',
    status: 'failed', lastAttemptAt: NOW_ISO, error: 'http_503'});
});

test('A conflicting bank value at the same publication time keeps the original value', async () => {
  const previous = fxRecord({sourceUpdatedAt: '2026-10-17T03:59:00.000Z', nextUpdateAt: NOW_ISO});
  const record = await updateFx(options(memoryKv({fx: previous}), async () => bocResponse()));
  assert.deepEqual(record, {...previous, status: 'failed', lastAttemptAt: NOW_ISO, error: 'conflict'});
});

const fxFailures = [
  ['timeout', () => { throw new DOMException('Timed out', 'TimeoutError'); }],
  ['http_503', () => new Response('Unavailable', {status: 503})],
  ['bad_response', () => bocResponse('<html>Login or verification required</html>')],
  ['bad_response', () => bocResponse(bocHtml().replace('670.49', 'Infinity'))],
  ['bad_response', () => bocResponse(bocHtml().replace('<td>美元</td>', '<td>欧元</td>'))],
  ['bad_timestamp', () => bocResponse(bocHtml().replace('2026/10/17', '2026/02/30'))],
  ['bad_response', () => bocResponse(bocHtml().replace('<th>现汇卖出价</th>', '<th>其他卖出价</th>'))],
  ['bad_response', () => bocResponse(bocHtml().replace('100外币', '1外币'))],
  ['bad_response', () => bocResponse(bocHtml().replace('670.49', '0'))]
];
for (const [index, [error, response]] of fxFailures.entries()) {
  test(`FX failure ${index + 1} (${error}) retains its original value, source and success times`, async () => {
    const previous = fxRecord({nextUpdateAt: NOW_ISO});
    const kv = memoryKv({fx: previous});
    const stub = fetchOnce(FX_URL, response);
    await updateFx(options(kv, stub.fetch));
    assert.equal(stub.calls, 1);
    assert.deepEqual(await kv.get('fx', 'json'), {...previous, status: 'failed', lastAttemptAt: NOW_ISO, error});
  });
}

test('SMM upstream failure does not stop a successful FX update', async () => {
  const kv = memoryKv();
  const calls = [];
  await refreshMarket(options(kv, async url => {
    calls.push(url);
    if (url === SMM_URL) return new Response('Forbidden', {status: 403});
    assert.equal(url, FX_URL);
    return fxResponse();
  }));
  assert.deepEqual(calls.sort(), [SMM_URL, FX_URL].sort());
  assert.equal((await kv.get('smm', 'json')).value, null);
  assert.equal((await kv.get('smm', 'json')).error, 'http_403');
  assert.equal((await kv.get('fx', 'json')).value, 6.7049);
  assert.equal((await kv.get('fx', 'json')).status, 'ok');
});

test('A KV failure for one source still allows the other update to finish', async () => {
  const kv = memoryKv();
  const read = kv.get;
  kv.get = async (key, type) => {
    if (key === 'smm') throw new Error('Storage unavailable');
    return read(key, type);
  };
  const stub = fetchOnce(FX_URL, () => fxResponse());
  await assert.rejects(refreshMarket(options(kv, stub.fetch)), AggregateError);
  assert.equal((await read('fx', 'json')).status, 'ok');
});

for (const [label, initial] of [
  ['empty', {}], ['populated', {smm: smmRecord(), fx: fxRecord()}],
  ['failed', {smm: smmRecord({status: 'failed', error: 'timeout'})}]
]) {
  test(`GET /api/market returns the exact README contract for ${label} KV`, async () => {
    const kv = memoryKv(initial);
    const response = await worker.fetch(new Request('https://calculator.test/api/market'), {MARKET: kv});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(response.headers.has('set-cookie'), false);
    assert.deepEqual(await response.json(), {
      smm: initial.smm ?? {value: null, status: 'none'},
      fx: initial.fx ?? {value: null, status: 'none'}
    });
    assert.deepEqual(kv.writes, []);
  });
}

test('All other requests are passed unchanged to ASSETS.fetch', async () => {
  for (const [path, method] of [['/', 'GET'], ['/styles.css', 'GET'], ['/api/unknown', 'GET'], ['/api/market', 'POST']]) {
    const request = new Request(`https://calculator.test${path}`, {method});
    const assetResponse = new Response('Asset response', {status: 201});
    const actual = await worker.fetch(request, {ASSETS: {fetch: async received => {
      assert.equal(received, request);
      return assetResponse;
    }}});
    assert.equal(actual, assetResponse);
  }
});
