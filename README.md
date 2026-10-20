# 钽铌矿实时价格计算器

**我的第一个公开程序 · 2026 年 10 月**

从实际采购沟通中的需求出发，把品位、吨数、成本、市场参考价和合同报价放到一个页面上，方便比较和计算。这也是我第一次将一个程序从想法做成可以公开使用的作品。

**[打开在线计算器 →](https://t004-ta-calculator.t004-ta-calculator.workers.dev/)**

同事和朋友可以直接打开上面的链接使用，无需安装或登录；本仓库保存源码、测试和运行说明。

## 可以做什么

- 对比同一个批次的 **我方批次价格、上海有色公示价格、合同价格**。
- 根据 Ta₂O₅ 品位、吨数和税率，计算每品位价、每吨价、吨度价及本批金额。
- 切换美元 / 人民币、不含税 / 含税视图。
- 展示每吨预期毛利和本批预期毛利。
- 自动获取每日市场参考价和汇率，也支持手动覆盖及恢复自动。
- 适配电脑与手机；刷新或重新打开页面后，手动输入清空。

虽然沿用“钽铌矿”名称，当前版本仅按 **Ta₂O₅** 计价，Nb₂O₅ 不参与金额计算。

## 数据与更新机制

| 项目 | 来源和口径 |
|---|---|
| 市场参考价 | [上海有色 SMM](https://hq.smm.cn/other-minor-metals/category/202504100001)：钽矿（Ta≥30%）中国到岸价均价，美元/磅 |
| 汇率 | [中国银行外汇牌价](https://www.boc.cn/sourcedb/whpj/)：美元现汇卖出价，官网每 100 美元牌价除以 100，得到人民币/美元 |
| 自动获取 | 每天北京时间 **12:00** 主检查；失败或尚未取得当天有效报价的来源，在 **13:00** 补试一次 |
| 当天已成功 | 该来源当天不再重复抓取；打开页面和刷新行情只读取服务器缓存 |
| 未发布 / 获取失败 | 保留已有有效值及真实来源日期；失败时标注状态，也可以手动输入 |

这里的“实时”指输入后即时计算，行情采用每日参考价，不是盘中连续报价。请留意页面显示的报价日期和来源时间；未发布新报价时，旧日期会保留。

品位、吨数、我方价和合同价都在浏览器内计算，不上传到行情接口，也不写入浏览器持久存储。服务器只缓存市场参考价和汇率。

## 计算口径

设 `G` 为品位点数（例如 30% 输入 30），`T` 为吨数，`v` 为税率，`R` 为人民币/美元汇率，`X` 为不含税美元/品位单价：

```text
不含税每吨价格（美元） = X × G × 1,000
含税价格 = 不含税价格 × (1 + v)
本批金额 = 每吨价格 × T
人民币金额 = 美元金额 × R
不含税吨度价（人民币/吨度） = X × 1,000 × R

每吨预期毛利（美元） = (合同不含税单价 − 我方不含税单价) × G × 1,000
本批预期毛利（美元） = 每吨预期毛利 × T
```

上海有色美元/磅报价换算为不含税美元/品位：`报价 × 2.2046226218487757 ÷ 100`。

预期毛利始终按 **合同价 − 我方成本** 计算，市场价仅作比较参考；未扣除国内运费等成本及其他费用。汇率用于购汇成本参考，实际以付款银行成交汇率为准，不含汇款费用。

## 本地运行

需要 **Node.js 22 或更新版本**。本地模拟预览和测试不需要 Cloudflare 账号或 API Key。

```bash
git clone https://github.com/Aether-Q/tantalum-niobium-calculator.git
cd tantalum-niobium-calculator
npm ci
npm test
node tools/dev-server.mjs 8787
```

打开 **http://localhost:8787/**。这个预览使用固定的模拟行情，不会访问 SMM 或中行；它不会启动线上定时任务。

- `http://localhost:8787/__demo`：填入模拟计算样例。
- `http://localhost:8787/__mock?mode=failed`：模拟更新失败。
- `http://localhost:8787/__mock?mode=none`：模拟无数据。
- `http://localhost:8787/__mock?mode=down`：模拟接口不可用。
- `http://localhost:8787/__mock?mode=ok`：恢复正常模拟数据。

切换模拟状态后，返回首页并点击“刷新行情”。停止预览按 `Ctrl+C`。

## 在自己的 Cloudflare 账号部署

在线版使用 **Cloudflare Workers + Static Assets + KV + Cron**。

仓库中的 `wrangler.toml` 仅含配置模板，KV ID 为占位值。请先将它复制为 `wrangler.local.toml`，此文件已被 Git 忽略；后续本机部署使用该文件。

```bash
npx wrangler login
npx wrangler kv namespace create MARKET --config wrangler.local.toml
```

将创建结果中的 KV namespace ID 填入 `wrangler.local.toml` 的 `[[kv_namespaces]]` 下 `id` 字段，保留 `binding = "MARKET"`；需要时修改 Worker 的 `name`，然后：

```bash
npx wrangler deploy --config wrangler.local.toml
```

首次部署后，页面在取得有效缓存前会提示手动输入；等待下一次北京时间 12:00 的定时检查。不要将登录令牌、环境变量文件或本机部署配置提交到仓库。

## 文件结构

| 路径 | 用途 |
|---|---|
| `public/` | 页面、样式、交互和纯计算函数 |
| `src/worker.js` | 静态资源入口、只读行情接口、每日取价任务 |
| `test/` | 计算与后端行为测试，使用模拟上游响应 |
| `tools/dev-server.mjs` | 本地静态页面与模拟行情预览 |
| `wrangler.toml` | 不含个人云端资源标识的部署模板 |

`GET /api/market` 返回 `smm` 与 `fx` 两组数据，响应为 JSON，使用 `Cache-Control: no-store`。`status` 为 `ok`、`failed` 或 `none`；`ok` 表示最近检查成功，是否为当日报价还需看来源日期。

汇率记录以 `source: "boc"`、`rateType: "spot_sell"` 标识中国银行美元现汇卖出价。`sourceUpdatedAt` 是银行发布时间，`nextUpdateAt` 是本程序下一次北京时间 12:00 的检查时间，不是银行的发布时间承诺。

## 项目记录

- 2026-10：完成计算页面、Cloudflare 部署、中行汇率接入与电脑 / 手机试用。
- 2026-10-20：首次公开源码，保留最初的开发提交。
- 需求和实际使用验收由 [Aether-Q](https://github.com/Aether-Q) 完成，开发过程中使用 Codex 与 Claude 协作。
- 行情接入调查参考了 [tantalum-calculator](https://github.com/jiangjianli8/tantalum-calculator)。

发现问题或有建议，可以在仓库的 **Issues** 中反馈；请使用模拟数值描述问题，避免附上真实合同或采购数据。
