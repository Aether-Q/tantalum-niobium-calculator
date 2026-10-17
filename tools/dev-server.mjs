// 本地预览：静态页面 + 模拟 /api/market。用法：node tools/dev-server.mjs [端口]
// 切换模拟状态：访问 /__mock?mode=ok|failed|none|down
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const port = Number(process.argv[2] || 8787);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
let mode = 'ok';

const ok = {
  smm: { value: 242.5, unit: 'USD/lb', sourceDate: '2026-10-13', status: 'ok', lastSuccessAt: '2026-10-13T04:00:12Z', lastAttemptAt: '2026-10-13T04:00:12Z' },
  fx: { value: 7.0, base: 'USD', quote: 'CNY', sourceUpdatedAt: '2026-10-12T23:57:31Z', status: 'ok', lastSuccessAt: '2026-10-13T04:00:13Z', lastAttemptAt: '2026-10-13T04:00:13Z' },
};
const mocks = {
  ok,
  failed: { smm: { ...ok.smm, status: 'failed', lastAttemptAt: '2026-10-14T05:00:10Z' }, fx: { ...ok.fx, status: 'failed' } },
  none: { smm: { value: null, status: 'none' }, fx: { value: null, status: 'none' } },
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__mock') {
    mode = url.searchParams.get('mode') || 'ok';
    res.end(`mock mode = ${mode}`);
    return;
  }
  if (url.pathname === '/api/market') {
    if (mode === 'down') { res.writeHead(503).end(); return; }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(mocks[mode] || ok));
    return;
  }
  if (url.pathname === '/__demo') {
    // 仅本地预览：自动填入 PRD 第 5 节样例，便于截图检查
    const html = await readFile(join(root, 'index.html'), 'utf8');
    const fill = `<script type="module">setTimeout(()=>{const s=(id,v)=>{const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))};s('in-grade','30.00');s('in-ton','2.3');s('in-a','6');s('in-c','4.8');${url.searchParams.get('tax') === 'inc' ? "document.querySelector('#seg-tax [data-v=inc]').click();" : ''}${url.searchParams.get('cur') === 'cny' ? "document.querySelector('#seg-cur [data-v=cny]').click();" : ''}},300)</script>`;
    res.writeHead(200, { 'content-type': types['.html'], 'cache-control': 'no-store' });
    res.end(html.replace('</body>', fill + '</body>'));
    return;
  }
  const path = normalize(join(root, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!path.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`preview: http://localhost:${port}`));
