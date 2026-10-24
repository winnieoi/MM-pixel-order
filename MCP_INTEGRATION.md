# MCP 集成说明

本作品通过麦当劳 MCP（open.mcd.cn/mcp 申请）实现点餐全链路。**所有 MCP 调用收敛在 `server/mcp.js` 一个文件**，便于审查与联调。

## 调用点总览

| # | 业务环节 | 代码位置 | MCP 能力 |
|---|---------|---------|---------|
| 1 | 菜单数据（价格/热量/新品） | `server/mcp.js → getMenu()` | 菜单查询 |
| 2 | AI 配餐方案的每个数字 | `server/recommend.js`（输入来自 #1） | 菜单查询（同上） |
| 3 | 真实下单 → 真实取餐号 | `server/mcp.js → createOrder()` | 智能点餐/下单 |
| 4 | 订单状态 → 备菜动画 | `server/mcp.js → getOrderStatus()` | 订单状态查询 |
| 5 | 优惠券/活动（麦麦日历） | `server/mcp.js → getCoupons()` | 优惠券周周领 / 麦麦日历 |

## 配置

```bash
export MCP_MODE=live            # 默认 demo（回放缓存的真实结构数据）
export MCP_ENDPOINT=<MCP 服务端点>
export MCP_TOKEN=<在 open.mcd.cn/mcp 用手机号申请的 Token>
```

## 认证方式

HTTP Header 携带 `Authorization: Bearer <MCP_TOKEN>`，请求体为 MCP 标准的 JSON-RPC 2.0 `tools/call`。

## 真实性声明

- `MCP_MODE=demo` 仅用于开发联调，回放的数据结构与 live 模式完全一致（字段对齐真实取餐单：取餐号/门店/预计时间/状态）。
- 演示录屏与评审环境一律使用 `MCP_MODE=live` 真实下单（详见 README 演示视频）。
- 前端页面场景右下角的 `demo`/`live` 角标实时反映当前模式，不作任何伪装。

## 待 Token 到位后的适配清单

- [ ] 用真实工具名替换 `mcp.js` 中三处 TODO 工具名映射
- [ ] 校验订单字段映射（取餐号 / 门店名 / 预计时间）
- [ ] 若 MCP 提供门店列表，把「选择门店」接入问答第 5 步
