// mcp.js —— 麦当劳 MCP 适配层（唯一的 MCP 出入口，联调只动这个文件）
//
// 两种模式：
//   MCP_MODE=live  走真实 MCP（需要 MCP_ENDPOINT / MCP_TOKEN 环境变量）
//   MCP_MODE=demo  回放 fixtures（无 Token 时前端联调用，默认）
//
// 拿到 Token 后：export MCP_ENDPOINT=<open.mcd.cn/mcp 给的端点> MCP_TOKEN=<你的token>
// 若真实工具名/参数与猜测不符，只改本文件里的 TOOL 映射即可，其余代码不用动。

const fs = require('fs');
const path = require('path');

const MODE = (process.env.MCP_MODE || 'demo').toLowerCase();
const ENDPOINT = process.env.MCP_ENDPOINT || '';
const TOKEN = process.env.MCP_TOKEN || '';

const fixturesDir = path.join(__dirname, 'fixtures');

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'));
}

// ---------- 通用 JSON-RPC 调用（MCP streamable http 约定，拿 Token 后按实际返回微调） ----------
async function mcpCall(tool, args) {
  if (MODE !== 'live' || !ENDPOINT) return null;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: tool, arguments: args } }),
  });
  if (!res.ok) throw new Error(`MCP ${tool} HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`MCP ${tool}: ${data.error.message}`);
  // MCP 结果通常在 result.content[0].text 里，尝试解析 JSON
  const text = data?.result?.content?.[0]?.text ?? JSON.stringify(data?.result ?? data);
  try { return JSON.parse(text); } catch { return text; }
}

function fallback(mode, fixture) {
  if (MODE === 'live') console.warn(`[mcp] live 调用失败，回退 fixtures/${fixture}`);
  return readFixture(fixture);
}

// ---------- 对外能力 ----------
async function getMenu() {
  // TODO(Token): 改成真实工具名，如 mcpCall('mcd_get_menu', {})
  const live = await mcpCall('get_menu', {}).catch((e) => { console.warn(e.message); return null; });
  return live || fallback('menu', 'menu.json');
}

async function createOrder(items, storeId) {
  // TODO(Token): 改成真实下单工具，如 mcpCall('mcd_create_order', { items, storeId })
  const live = await mcpCall('create_order', { items, storeId }).catch((e) => { console.warn(e.message); return null; });
  if (live) return live;
  // demo：模拟真实单据结构（字段对齐常见取餐单：号码/门店/预计时间）
  const menu = readFixture('menu.json');
  const detail = items.map((q) => {
    const m = menu.find((x) => x.id === q.id) || {};
    return { id: q.id, name: m.name || q.id, price: m.price || 0, qty: q.qty || 1 };
  });
  const total = Math.round(detail.reduce((s, d) => s + d.price * d.qty, 0) * 10) / 10;
  const etaMinutes = 4 + detail.length; // 粗略估计：基础4分钟+每件1分钟
  return {
    mode: 'demo',
    orderId: 'DM' + Date.now().toString(36).toUpperCase(),
    pickupNo: String(Math.floor(100 + Math.random() * 900)),
    store: { id: storeId || 'DEMO01', name: '麦门星球示例餐厅' },
    items: detail,
    total,
    etaMinutes,
    status: 'placed',
    placedAt: new Date().toISOString(),
  };
}

async function getOrderStatus(orderId) {
  // TODO(Token): 改成 mcpCall('get_order_status', { orderId })
  const live = await mcpCall('get_order_status', { orderId }).catch(() => null);
  if (live) return live;
  // demo：按下单时长推进 placed -> preparing -> ready
  const placedAt = Date.parse(orderId.slice(2) ? '' : '') || null; // demo 状态由 server.js 内存表管理，这里直接透传
  return null;
}

async function getCoupons() {
  // TODO(Token): mcpCall('list_coupons', {})
  const live = await mcpCall('list_coupons', {}).catch(() => null);
  return live || fallback('coupons', 'coupons.json');
}

module.exports = { MODE, getMenu, createOrder, getOrderStatus, getCoupons };
