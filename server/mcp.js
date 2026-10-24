// mcp.js —— 麦当劳 MCP 适配层（唯一的 MCP 出入口，联调只动这个文件）
//
// 两种模式：
//   MCP_MODE=live  走真实麦当劳 MCP（https://mcp.mcd.cn，Streamable HTTP）
//   MCP_MODE=demo  回放 fixtures（无 Token 时前端联调用，默认）
//
// live 启动方式：
//   MCP_MODE=live MCP_TOKEN=<你的token> node server/server.js
// 可选：MCD_CITY=深圳市 MCD_STORE_CODE=<门店编码> MCD_BE_CODE=<BE编码>
// Token 也可放在项目根目录 .env.mcp（MCP_TOKEN=xxx），启动时自动读取。
//
// 工具名以官方文档为准：query-nearby-stores / query-meals / calculate-price /
// create-order / query-order / list-nutrition-foods / query-my-coupons

const fs = require('fs');
const path = require('path');

const MODE = (process.env.MCP_MODE || 'demo').toLowerCase();
const ENDPOINT = process.env.MCP_ENDPOINT || 'https://mcp.mcd.cn';

// .env.mcp（不入库）里读 Token，省得每次 export
function loadTokenFromFile() {
  if (process.env.MCP_TOKEN) return process.env.MCP_TOKEN;
  const f = path.join(__dirname, '..', '.env.mcp');
  try {
    const line = fs.readFileSync(f, 'utf8').split('\n').find((l) => l.trim().startsWith('MCP_TOKEN='));
    if (line) return line.split('=').slice(1).join('=').trim();
  } catch { /* 没有就算了 */ }
  return '';
}
const TOKEN = loadTokenFromFile();

const fixturesDir = path.join(__dirname, 'fixtures');
function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'));
}

// ---------- MCP 会话（Streamable HTTP：initialize 握手 → tools/call） ----------
let sessionId = null;
let rpcId = 0;
let initing = null;

async function rpc(method, params, isNotify = false) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${TOKEN}`,
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const body = { jsonrpc: '2.0', method, params: params || {} };
  if (!isNotify) body.id = ++rpcId;
  const res = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) });
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  const text = await res.text();
  if (!res.ok) throw new Error(`MCP ${method} HTTP ${res.status}: ${text.slice(0, 160)}`);

  // 响应可能是纯 JSON，也可能是 text/event-stream（取最后一条 data:）
  let json = null;
  if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
    const datas = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
    for (const d of datas.reverse()) { try { json = JSON.parse(d); break; } catch { /* 继续找 */ } }
  }
  if (!json) { try { json = JSON.parse(text); } catch { /* 可能为空 body（通知） */ } }
  if (isNotify) return null;
  if (json?.error) throw new Error(`MCP ${method}: ${json.error.message || JSON.stringify(json.error)}`);
  return json?.result ?? null;
}

async function ensureSession() {
  if (sessionId) return;
  if (!initing) {
    initing = rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'mcd-pixel-order', version: '1.0.0' },
    }).then(async () => {
      await rpc('notifications/initialized', {}, true).catch(() => {});
    }).finally(() => { initing = null; });
  }
  return initing;
}

// 调一个工具，返回解析后的 data（MCP 约定：result.content[].text 里是 JSON 字符串）
async function callTool(name, args) {
  await ensureSession();
  const result = await rpc('tools/call', { name, arguments: args || {} });
  const text = (result?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (result?.isError) throw new Error(`MCP ${name} 工具报错: ${text.slice(0, 200)}`);
  // 官方服务把机器可读结果放在 structuredContent，同时在 text 中附带展示说明。
  // 优先 structuredContent，避免 text 前后的 Markdown 说明导致 JSON.parse 失败。
  let parsed = result?.structuredContent || null;
  if (!parsed) {
    try { parsed = JSON.parse(text); } catch { /* 有些工具返回 Markdown/TOON 文本 */ }
  }
  return { data: parsed, text };
}

// ---------- 门店解析 ----------
let cachedStore = null;
async function resolveStore() {
  if (cachedStore) return cachedStore;
  if (process.env.MCD_STORE_CODE) {
    cachedStore = { storeCode: process.env.MCD_STORE_CODE, storeName: process.env.MCD_STORE_NAME || '指定门店', beCode: process.env.MCD_BE_CODE || '' };
    return cachedStore;
  }
  // 1) 收藏餐厅（只有用户没有指定城市/关键词时才优先，避免误选其它城市）
  if (!process.env.MCD_CITY && !process.env.MCD_KEYWORD && !process.env.MCD_STORE_NAME) try {
    const { data } = await callTool('query-nearby-stores', { searchType: 1, beType: 1 });
    const list = data?.data || data;
    if (Array.isArray(list) && list.length) {
      cachedStore = { storeCode: String(list[0].storeCode), storeName: list[0].storeName || '附近门店', beCode: list[0].beCode || '' };
      return cachedStore;
    }
  } catch (e) { console.warn('[mcp] 收藏餐厅查询失败：', e.message); }
  // 2) 按城市关键词搜
  const city = process.env.MCD_CITY || '深圳市';
  try {
    const keyword = process.env.MCD_KEYWORD || '麦当劳';
    const { data } = await callTool('query-nearby-stores', { searchType: 2, beType: 1, city, keyword });
    const list = data?.data || data;
    if (Array.isArray(list) && list.length) {
      const wanted = process.env.MCD_STORE_NAME || keyword;
      const matches = list.filter((s) => `${s.storeName || ''}${s.address || ''}`.includes(wanted));
      if (matches.length !== 1) throw new Error('门店不唯一，请确认具体门店并设置 MCD_STORE_CODE');
      const hit = matches[0];
      cachedStore = { storeCode: String(hit.storeCode), storeName: hit.storeName || `${city}门店`, beCode: hit.beCode || '' };
      return cachedStore;
    }
  } catch (e) { console.warn('[mcp] 城市门店查询失败：', e.message); }
  throw new Error('拿不到门店：请设置 MCD_CITY（你的城市）或 MCD_STORE_CODE（门店编码）');
}

// ---------- 菜单归一化（MCP 结构 → 前端/推荐引擎结构） ----------
function classify(name, category) {
  const s = `${category || ''}${name || ''}`;
  if (/沙拉|蔬|碗/.test(s)) return 'salad';
  if (/可乐|咖啡|柠檬|茶|饮料|饮品|果汁|水|奶|雪冰|摇摇/.test(s)) return 'drink';
  if (/汉堡|堡|牛堡|鸡腿|安格斯|鱼肉|猪排/.test(s)) return 'burger';
  return 'snack';
}
function guessTags(name) {
  const t = [];
  if (/辣/.test(name)) t.push('辣');
  if (/牛/.test(name)) t.push('牛肉');
  if (/鸡|翅/.test(name)) t.push('鸡肉');
  if (/猪|丸/.test(name)) t.push('猪肉');
  if (/鱼|虾|海|蟹/.test(name)) t.push('海鲜');
  return t;
}

let menuCache = { at: 0, items: null };
async function getMenu() {
  if (MODE !== 'live') return readFixture('menu.json');
  if (menuCache.items && Date.now() - menuCache.at < 60000) return menuCache.items;
  const store = await resolveStore();
  const { data } = await callTool('query-meals', {
    storeCode: store.storeCode,
    beCode: store.beCode || undefined,
    orderType: 1,   // 到店
    beType: 1,      // 到店取餐
  });
  const payload = data?.data || data;
  if (!payload?.meals) throw new Error('query-meals 没返回 meals');
  const catOf = {};
  for (const c of payload.categories || []) for (const m of c.meals || []) catOf[m.code] = c.name;

  // 热量：尝试 list-nutrition-foods（可能是 TOON 文本，尽力解析）
  const kcalOf = await fetchNutrition();

  const items = Object.entries(payload.meals).map(([code, m]) => {
    const name = m.name || code;
    return {
      id: String(code),
      name,
      price: Number(m.currentPrice ?? m.price ?? 0),
      kcal: kcalOf[name] ?? null,
      cat: classify(name, catOf[code]),
      tags: guessTags(name),
      isNew: /新|限定|季节/.test(`${name}${m.discountType || ''}`) || false,
      category: catOf[code] || '',
    };
  }).filter((i) => i.price > 0);
  if (!items.length) throw new Error('菜单为空');
  menuCache = { at: Date.now(), items };
  return items;
}

async function fetchNutrition() {
  try {
    const { data, text } = await callTool('list-nutrition-foods', {});
    if (data) {
      // 结构未公开：尽量在 JSON 里找 name→能量 的映射
      const map = {};
      const walk = (o) => {
        if (Array.isArray(o)) o.forEach(walk);
        else if (o && typeof o === 'object') {
          const name = o.name || o.foodName || o.mealName;
          const kcal = o.energy ?? o.kcal ?? o.能量 ?? o.calorie;
          if (name && kcal != null) map[name] = Number(kcal);
          Object.values(o).forEach(walk);
        }
      };
      walk(data);
      if (Object.keys(map).length) return map;
    }
    // TOON 文本兜底：按行抓「名称 ... 数字」对
    const map = {};
    for (const line of (text || '').split('\n')) {
      const m = line.match(/^\s*([^\d,|]{2,20}?)[\s,|]+(\d{2,4})\s*(?:kcal|千卡|大卡)?/i);
      if (m) map[m[1].trim()] = Number(m[2]);
    }
    return map;
  } catch (e) {
    console.warn('[mcp] 营养信息获取失败（热量将显示为空）：', e.message);
    return {};
  }
}

// ---------- 下单 ----------
function pickTakeWay(priceData) {
  const p = priceData?.data || priceData || {};
  const cand = [p.takeWayCode, p.takeWay?.takeWayCode, ...(p.takeWayList || p.takeWays || []).map((t) => t.takeWayCode || t.code)];
  return cand.find(Boolean) || '';
}
function pickAmount(p, keys, fallback) {
  const src = p?.data || p || {};
  for (const k of keys) if (src[k] != null) return Number(src[k]);
  return fallback;
}

async function createOrder(items, storeId) {
  if (MODE !== 'live') return demoOrder(items, storeId);
  if (process.env.MCD_ALLOW_ORDER !== 'true') throw new Error('真实下单尚未启用：请先确认门店与商品，当前仅开放查询');
  const store = await resolveStore();
  const products = items.map((i) => ({ productCode: String(i.id), quantity: Number(i.qty) || 1 }));

  // 1) 先算价（拿 takeWayCode）
  const price = await callTool('calculate-price', {
    storeCode: store.storeCode, beCode: store.beCode || undefined, beType: 1, orderType: 1, items: products,
  });
  const takeWayCode = pickTakeWay(price);
  if (!takeWayCode) console.warn('[mcp] calculate-price 没给出 takeWayCode，尝试直接下单');

  // 2) 真实下单
  const { data } = await callTool('create-order', {
    storeCode: store.storeCode,
    beCode: store.beCode || undefined,
    beType: 1,
    takeWayCode: takeWayCode || undefined,
    items: products,
  });
  const o = data?.data || data;
  if (!o?.orderId) throw new Error('create-order 没返回 orderId');
  const detail = o.orderDetail || {};
  const pickupNo = detail.pickupNo || detail.takeNumber || detail.orderNumber || String(o.orderId).slice(-4);
  return {
    mode: 'live',
    orderId: String(o.orderId),
    pickupNo: String(pickupNo),
    pickupIsOrderTail: !(detail.pickupNo || detail.takeNumber || detail.orderNumber),
    payUrl: o.payH5Url || detail.payH5Url || '',
    store: { id: store.storeCode, name: detail.storeName || store.storeName },
    items: (detail.orderProductList || items).map((p) => ({ id: p.productCode || p.id, name: p.productName || p.name, price: Number(p.price || 0), qty: Number(p.quantity || p.qty || 1) })),
    total: pickAmount(o, ['realTotalAmount', 'totalAmount'], detail.realTotalAmount || 0),
    etaMinutes: 5,
    status: 'placed',
    mcpStatus: detail.orderStatus || '',
    placedAt: new Date().toISOString(),
  };
}

function demoOrder(items, storeId) {
  const menu = readFixture('menu.json');
  const detail = items.map((q) => {
    const m = menu.find((x) => x.id === q.id) || {};
    return { id: q.id, name: m.name || q.id, price: m.price || 0, qty: q.qty || 1 };
  });
  const total = Math.round(detail.reduce((s, d) => s + d.price * d.qty, 0) * 10) / 10;
  return {
    mode: 'demo',
    orderId: 'DM' + Date.now().toString(36).toUpperCase(),
    pickupNo: String(Math.floor(100 + Math.random() * 900)),
    pickupIsOrderTail: false,
    store: { id: storeId || 'DEMO01', name: '麦门星球示例餐厅' },
    items: detail,
    total,
    etaMinutes: 4 + detail.length,
    status: 'placed',
    placedAt: new Date().toISOString(),
  };
}

// ---------- 查单 ----------
const STATUS_MAP = [
  [/待支付|未支付/, 'placed'],
  [/制作|准备|加工/, 'preparing'],
  [/待取餐|待取|可取餐|已好|完成制作/, 'ready'],
  [/已完成|已取餐|已送达|交易完成/, 'dining'],
  [/取消/, 'cancelled'],
];
async function getOrderStatus(orderId) {
  if (MODE !== 'live') return null; // demo 状态由 server.js 内存表推进
  const { data } = await callTool('query-order', { orderId: String(orderId) });
  const o = data?.data || data;
  if (!o) return null;
  const raw = o.orderStatus || '';
  const status = (STATUS_MAP.find(([re]) => re.test(raw)) || [])[1] || 'placed';
  return {
    orderId: String(o.orderId || orderId),
    status,
    mcpStatus: raw,
    store: { name: o.storeName || '' },
    items: (o.orderProductList || []).map((p) => ({ id: p.productCode || p.id, name: p.productName || p.name, price: Number(p.price || 0), qty: Number(p.quantity || p.qty || 1) })),
    total: Number(o.realTotalAmount || o.totalAmount || 0),
  };
}

async function getCoupons() {
  if (MODE !== 'live') return readFixture('coupons.json');
  const { data, text } = await callTool('query-my-coupons', {});
  return data || text || [];
}

function isLive() { return MODE === 'live' && !!TOKEN; }
module.exports = { MODE, isLive, getMenu, createOrder, getOrderStatus, getCoupons, resolveStore };
