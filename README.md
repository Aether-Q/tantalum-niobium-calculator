# T004 钽铌矿实时价格计算器 — 应用

需求见 [执行指令](../Codex执行指令_v1_2026-10-17.md)（覆盖 PRD 冲突项）与 [PRD](../制作方案_v0.2.md)。视觉定稿：`../visual/UI-v2-*.png`。

## 目录

| 路径 | 内容 | 负责 |
|---|---|---|
| `public/` | 页面、样式、计算模块（浏览器内计算，不上传、不保存输入） | Claude |
| `src/worker.js` | Cloudflare Worker：`/api/market` 只读接口 + 每日定时取价 | Codex |
| `wrangler.toml` | Workers + Static Assets + KV + Cron 配置 | Codex |
| `test/` | `calc.test.mjs` 计算验收（AC01–AC07）；`worker.test.mjs` 取数验收 | 各自 |
| `tools/dev-server.mjs` | 本地预览，模拟 `/api/market`（`/__mock?mode=ok\|failed\|none\|down`，`/__demo` 自动填样例） | Claude |

## `/api/market` 接口约定（前后端共同遵守）

`GET /api/market` → `200 application/json`，`cache-control: no-store`

```json
{
  "smm": {
    "value": 242.5,              // 美元/磅；无有效数据时为 null
    "unit": "USD/lb",
    "sourceDate": "2026-10-13",  // SMM 的真实报价日期（renew_date）
    "status": "ok",              // ok = 最近一次检查成功；failed = 最近一次失败（value 为上次有效值）；none = 从未取得
    "lastSuccessAt": "ISO 时间",
    "lastAttemptAt": "ISO 时间",
    "error": "可选，简短失败类型"
  },
  "fx": {
    "value": 7.0,                // 1 美元兑人民币；无有效数据时为 null
    "base": "USD", "quote": "CNY",
    "sourceUpdatedAt": "ISO 时间",   // 来源 time_last_update
    "nextUpdateAt": "ISO 时间",      // 来源 time_next_update
    "status": "ok", "lastSuccessAt": "…", "lastAttemptAt": "…", "error": "可选"
  }
}
```

## 常用命令

```bash
node --test test/calc.test.mjs   # 计算验收
node tools/dev-server.mjs 8787   # 本地预览（模拟接口）
```
