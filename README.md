# 麦门星球 · 像素麦当劳点单游戏机

> 1024 超能 Coding 周末 · 用餐赛道 × 麦当劳程序员创意开发大赛

在一家像素风麦当劳里，跟 AI 店员「小麦」聊两句，它帮你点好最合适的一单——
**推荐有依据（真实菜单价格/热量），下单是真的（MCP 真实取餐号），备菜动画是真的跟着订单状态走。**

## 玩法（手机竖版，单手）

上半屏是备餐厅像素场景（星露谷风），下半屏是游戏机：LCD 屏显示对话，D-pad 选选项，A 确认，B 返回，START 一键下单。

1. **问答点单**：几个人 / 减脂还是放纵 / 尝新还是下午茶 / 忌口 / 预算
2. **AI 配餐**：主推 + 省钱版 + 丰盛版三套方案，每套有真实总价、人均、热量和推荐理由
3. **真实下单**：MCP 下单，拿到真实取餐号
4. **像素后厨**：三个员工小人接单、煎制（冒烟动画）、出餐，递给你**真实号码牌**
5. **用餐评价**：星级 + 标签 → 进入麦门评价墙

## 本地运行

```bash
node server/server.js          # 默认 3000 端口，demo 模式（无需 Token）
# 浏览器打开 http://localhost:3000
```

接真实麦当劳 MCP：

```bash
MCP_MODE=live MCP_ENDPOINT=<MCP端点> MCP_TOKEN=<你的token> node server/server.js
```

## 技术栈

- 纯 Node.js 后端（零依赖），单端口托管静态页面 + REST API
- MCP 适配层收敛在 `server/mcp.js` 一个文件，demo/live 双模式无缝切换
- 前端 Canvas 像素场景 + 状态机流程，无需任何前端框架

详见 [MCP_INTEGRATION.md](MCP_INTEGRATION.md) 与 [docs/PRODUCT.md](docs/PRODUCT.md)。
