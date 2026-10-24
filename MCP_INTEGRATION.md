# MCP 集成说明

本作品通过麦当劳官方 MCP（open.mcd.cn/mcp 申请）实现点餐全链路。**所有 MCP 调用收敛在 `server/mcp.js` 一个文件**，便于审查与联调。

## 调用点总览

| # | 业务环节 | 代码位置 | MCP 工具（官方工具名） |
|---|---------|---------|---------|
| 1 | 门店解析（收藏餐厅 → 城市搜索） | `server/mcp.js → resolveStore()` | `query-nearby-stores` |
| 2 | 菜单数据（名称/现价/促销价） | `server/mcp.js → getMenu()` | `query-meals` |
| 3 | 餐品热量 | `server/mcp.js → fetchNutrition()` | `list-nutrition-foods` |
| 4 | AI 配餐方案的每个数字 | `server/recommend.js`（输入来自 #2/#3） | 复用 #2/#3 数据 |
| 5 | 下单前核价（取 takeWayCode） | `server/mcp.js → createOrder()` | `calculate-price` |
| 6 | 真实下单 → 真实订单号/支付链接 | `server/mcp.js → createOrder()` | `create-order` |
| 7 | 订单状态 → 后厨备菜动画 | `server/mcp.js → getOrderStatus()` | `query-order` |
| 8 | 优惠券/我的券 | `server/mcp.js → getCoupons()` | `query-my-coupons` / `available-coupons` |

## 配置

```bash
MCP_MODE=live MCP_TOKEN=<在 open.mcd.cn/mcp 用手机号申请的 Token> node server/server.js
# 或把 Token 写进项目根目录 .env.mcp（MCP_TOKEN=xxx，已在 .gitignore）
```

端点与协议按官方文档：`https://mcp.mcd.cn`，Streamable HTTP（JSON-RPC 2.0），
`Authorization: Bearer <token>`，会话走 `initialize` → `notifications/initialized` → `tools/call`，
响应兼容纯 JSON 与 `text/event-stream` 两种返回。

可选环境变量：`MCD_CITY`（门店搜索城市，默认深圳市）、`MCD_STORE_CODE` / `MCD_BE_CODE`（指定门店）。

## 认证方式

HTTP Header 携带 `Authorization: Bearer <MCP_TOKEN>`，请求体为 MCP 标准的 JSON-RPC 2.0 `tools/call`。

## 真实性声明

- `MCP_MODE=demo` 仅用于开发联调，回放的数据结构与 live 模式完全一致（字段对齐真实取餐单：取餐号/门店/预计时间/状态）。
- 演示录屏与评审环境一律使用 `MCP_MODE=live` 真实下单（详见 README 演示视频）。
- 前端页面场景右下角的 `demo`/`live` 角标实时反映当前模式，不作任何伪装。
- live 模式若个别工具调用失败（如热量接口），会明确降级并打印警告，不会拿假数据冒充真实返回值。

## 排障

```bash
curl localhost:3123/api/health   # mcpLive 是否为 true
curl localhost:3123/api/store    # 当前解析到的门店
curl localhost:3123/api/menu | head   # live 菜单条数
```
