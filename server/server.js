// server.js —— 单端口入口：静态托管 web/ + REST API
// 启动：PORT=3000 node server/server.js
// 环境变量：MCP_MODE=live|demo  MCP_ENDPOINT  MCP_TOKEN

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const mcp = require('./mcp');
const { recommend } = require('./recommend');

const PORT = process.env.PORT || 3000;
const WEB = path.join(__dirname, '..', 'web');

// ---------- 订单内存表（demo 模式的状态推进；live 模式状态以 MCP 查询为准） ----------
const orders = new Map(); // orderId -> { ...order, statusTimeline }
// demo 演示节奏：默认 36 秒出餐（DEMO_READY_SECONDS 可调）。现场录屏够快，又留得住"备餐"过程。
const DEMO_READY_SECONDS = Number(process.env.DEMO_READY_SECONDS || 36);
function tickOrder(o) {
  const age = (Date.now() - Date.parse(o.placedAt)) / 1000;
  const readyAt = o.mode === 'demo' ? DEMO_READY_SECONDS : (o.etaMinutes || 5) * 20;
  if (age > readyAt) o.status = 'ready';
  else if (age > readyAt * 0.25) o.status = 'preparing';
  return o;
}

// ---------- 评价（内存 + 落盘） ----------
const reviewsFile = path.join(__dirname, 'data_reviews.json');
let reviews = [];
try { reviews = JSON.parse(fs.readFileSync(reviewsFile, 'utf8')); } catch { /* 首次为空 */ }

function saveReviews() { fs.writeFile(reviewsFile, JSON.stringify(reviews, null, 2), () => {}); }

// ---------- 工具 ----------
function send(res, code, data, type = 'application/json') {
  const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8`, 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
}
function serveStatic(res, urlPath) {
  let p = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.join(WEB, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(WEB)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'not found' });
    const ext = path.extname(file);
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.mp3': 'audio/mpeg' }[ext] || 'application/octet-stream';
    send(res, 200, buf, mime);
  });
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const route = `${req.method} ${url.pathname}`;

  try {
    if (route === 'GET /api/health') return send(res, 200, { ok: true, mcpMode: mcp.MODE, now: Date.now() });

    if (route === 'GET /api/menu') return send(res, 200, await mcp.getMenu());

    if (route === 'POST /api/recommend') {
      const body = await readBody(req);
      const menu = await mcp.getMenu();
      return send(res, 200, { mode: mcp.MODE, goal: body.goal, people: body.people, plans: recommend(menu, body) });
    }

    if (route === 'POST /api/order') {
      const body = await readBody(req);
      if (!Array.isArray(body.items) || !body.items.length) return send(res, 400, { error: 'items 必填（[{id, qty}]）' });
      const order = await mcp.createOrder(body.items, body.storeId);
      if (order.mode !== 'demo') return send(res, 200, order); // live：直接透传真实单
      orders.set(order.orderId, order);
      return send(res, 200, order);
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/order/')) {
      const id = url.pathname.split('/').pop();
      if (orders.has(id)) return send(res, 200, tickOrder(orders.get(id)));
      // live 单据：查 MCP
      const live = await mcp.getOrderStatus(id).catch(() => null);
      return live ? send(res, 200, live) : send(res, 404, { error: 'order not found' });
    }

    if (route === 'GET /api/reviews') return send(res, 200, reviews);
    if (route === 'POST /api/reviews') {
      const body = await readBody(req);
      const r = { stars: Math.max(1, Math.min(5, +body.stars || 5)), tag: String(body.tag || ''), text: String(body.text || '').slice(0, 140), at: Date.now(), pickupNo: body.pickupNo || '' };
      reviews.unshift(r); reviews = reviews.slice(0, 100); saveReviews();
      return send(res, 200, r);
    }

    if (req.method === 'GET') return serveStatic(res, url.pathname);
    return send(res, 404, { error: 'no route' });
  } catch (e) {
    console.error('[api]', e);
    return send(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`[mcd-pixel-order] http://localhost:${PORT}  (MCP_MODE=${mcp.MODE})`));
