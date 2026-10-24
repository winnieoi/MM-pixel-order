// static-api.js —— GitHub Pages 静态演示版专用：把 /api/* 请求全部在浏览器本地处理
// 数据来自 assets/menu.json（与本地 fixtures 相同），推荐逻辑为 server/recommend.js 的逐行移植，
// 订单状态推进、评价墙与 Node 版行为一致（demo 模式，无真实支付）。
(function () {
  const MENU_URL = 'assets/menu.json';
  const DEMO_READY_SECONDS = 36; // 与 server.js DEMO_READY_SECONDS 一致
  const REVIEWS_KEY = 'mcd-pixel-reviews-v1';

  let menuCache = null;
  const orders = new Map(); // orderId -> order（含 placedAt）
  const origFetch = window.fetch.bind(window);

  function loadMenu() {
    if (menuCache) return menuCache;
    menuCache = origFetch(MENU_URL).then((r) => r.json());
    return menuCache;
  }
  function jsonRes(data, code = 200) {
    return new Response(JSON.stringify(data), {
      status: code,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ---------- 推荐引擎（recommend.js 移植，逻辑逐行一致） ----------
  function score(item, goal) {
    const k = item.kcal || 0;
    const tags = item.tags || [];
    switch (goal) {
      case '减脂':   return 1000 - k / 2 + (item.cat === 'salad' ? 300 : 0) + (item.cat === 'drink' && k > 0 && k <= 100 ? 150 : 0);
      case '放纵':   return k / 3 + (item.cat === 'burger' ? 200 : 0) + (item.cat === 'snack' ? 60 : 0);
      case '尝新':   return (item.isNew ? 500 : 0) + k / 10;
      case '下午茶': return (item.cat === 'snack' ? 300 : 0) + (item.cat === 'drink' ? 250 : 0) + (k > 400 ? -300 : 0);
      case '带娃':   return (tags.includes('鸡肉') ? 150 : 0) + (item.cat === 'snack' && k < 350 ? 150 : 0) - (tags.includes('辣') ? 999 : 0);
      default:       return k / 10;
    }
  }
  function pick(menu, goal, avoid, perItemBudget) {
    const bad = new Set(avoid || []);
    return menu
      .filter((m) => !(m.tags || []).some((t) => bad.has(t)) && m.price <= perItemBudget)
      .sort((a, b) => score(b, goal) - score(a, goal));
  }
  function assemble(menu, n, goal, budget, avoid, style) {
    const per = budget / n;
    const pool = pick(menu, goal, avoid, style === 'save' ? per * 0.5 : per);
    if (pool.length < 3) return null;

    const chosen = new Map();
    const take = (cat, count) => {
      const inCat = pool.filter((i) => i.cat === cat);
      if (!inCat.length) return;
      let idx = 0;
      for (let k = 0; k < count; k++) {
        const it = inCat[idx % inCat.length];
        idx++;
        if (chosen.has(it.id)) chosen.get(it.id).qty++;
        else chosen.set(it.id, { ...it, qty: 1 });
      }
    };
    const mains = goal === '减脂' ? Math.max(1, Math.ceil(n / 2)) : n;
    take('burger', style === 'rich' ? Math.min(n, 3) : mains);
    take('salad', goal === '减脂' ? Math.max(1, Math.floor(n / 2)) : 0);
    take('snack', style === 'rich' ? Math.max(1, n - 1) : Math.max(1, Math.floor(n / 2)));
    take('drink', n);
    if (style === 'rich') take('snack', 1);

    const plan = [...chosen.values()];
    let total = plan.reduce((s, i) => s + i.price * i.qty, 0);
    const hasCombo = plan.some((i) => i.cat === 'burger') && plan.some((i) => i.id.startsWith('fries')) && plan.some((i) => i.cat === 'drink');
    const discount = hasCombo ? 6 : 0;
    total = Math.round((total - discount) * 10) / 10;
    const kcal = plan.reduce((s, i) => s + (i.kcal || 0) * i.qty, 0);
    const kcalKnown = plan.some((i) => i.kcal != null);
    if (budget && total > budget) return null;

    const top = plan.filter((i) => i.cat === 'burger' || i.cat === 'salad')[0] || plan[0];
    const kcalLine = kcalKnown ? `人均约 ${Math.round(kcal / n)} kcal` : '热量以门店公示为准';
    const reason = {
      '减脂': `主推${top.name}${kcalKnown ? `（${top.kcal} kcal）` : ''}，搭配低卡饮品，${kcalLine}`,
      '放纵': `以${top.name}${kcalKnown ? `（${top.kcal} kcal）` : ''}打底，配足小食，${kcalLine}，今天不设限`,
      '尝新': `${plan.filter((i) => i.isNew).map((i) => i.name).join('、') || top.name} 是当季新品，先替你试过毒`,
      '下午茶': `小食 + 饮品轻组合，${kcalLine}，扛住下午不犯困`,
      '带娃': `避开辣味，${top.name} + 小食 + 饮品，小朋友能吃全`,
    }[goal] || `按你的口味和预算凑的，人均 ¥${Math.round(total / n)}`;

    return { items: plan, total, discount, kcal: kcalKnown ? kcal : null, perPerson: Math.round((total / n) * 10) / 10, kcalPerPerson: kcalKnown ? Math.round(kcal / n) : null, reason };
  }
  function recommend(menu, { people = 1, goal = '放纵', budget = 0, avoid = [] } = {}) {
    const n = Math.max(1, Math.min(20, parseInt(people, 10) || 1));
    const plans = [];
    for (const style of ['normal', 'save', 'rich']) {
      const p = assemble(menu, n, goal, budget || 99999, avoid, style);
      if (p) plans.push({ style, label: { normal: '主推', save: '省钱版', rich: '丰盛版' }[style], ...p });
    }
    if (!plans.length) {
      const p = assemble(menu, n, goal, 99999, avoid, 'save');
      if (p) plans.push({ style: 'save', label: '量力而行版', ...p, note: '预算偏紧，先按这个来' });
    }
    return plans;
  }

  // ---------- demo 订单（与 mcp.js demoOrder 一致） ----------
  function demoOrder(items, storeId, menu) {
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
  // 与 server tickOrder 一致：36 秒出餐，25% 进度转 preparing
  function tickOrder(o) {
    const age = (Date.now() - Date.parse(o.placedAt)) / 1000;
    if (age > DEMO_READY_SECONDS) o.status = 'ready';
    else if (age > DEMO_READY_SECONDS * 0.25) o.status = 'preparing';
    return o;
  }

  // ---------- 评价墙（localStorage，刷新不丢） ----------
  function readReviews() {
    try { return JSON.parse(localStorage.getItem(REVIEWS_KEY) || '[]'); } catch { return []; }
  }
  function writeReviews(list) {
    try { localStorage.setItem(REVIEWS_KEY, JSON.stringify(list)); } catch { /* 隐私模式忽略 */ }
  }

  // ---------- fetch 垫片 ----------
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!url.startsWith('/api/')) return origFetch(input, init);

    const method = (init?.method || 'GET').toUpperCase();

    if (url === '/api/health') {
      return jsonRes({ ok: true, mcpMode: 'demo', mcpLive: false, now: Date.now() });
    }
    if (url === '/api/menu') {
      return jsonRes(await loadMenu());
    }
    if (url === '/api/store') {
      return jsonRes({ storeCode: 'DEMO01', storeName: '麦门星球示例餐厅', beCode: '' });
    }
    if (url === '/api/recommend' && method === 'POST') {
      const body = JSON.parse(init?.body || '{}');
      const menu = await loadMenu();
      return jsonRes({ mode: 'demo', goal: body.goal, people: body.people, plans: recommend(menu, body) });
    }
    if (url === '/api/order' && method === 'POST') {
      const body = JSON.parse(init?.body || '{}');
      if (!Array.isArray(body.items) || !body.items.length) return jsonRes({ error: 'items 必填' }, 400);
      const menu = await loadMenu();
      const order = demoOrder(body.items, body.storeId, menu);
      orders.set(order.orderId, order);
      return jsonRes(order);
    }
    const m = url.match(/^\/api\/order\/(.+)$/);
    if (m && method === 'GET') {
      const o = orders.get(m[1]);
      return o ? jsonRes(tickOrder(o)) : jsonRes({ error: 'order not found' }, 404);
    }
    if (url === '/api/reviews' && method === 'GET') {
      return jsonRes(readReviews());
    }
    if (url === '/api/reviews' && method === 'POST') {
      const body = JSON.parse(init?.body || '{}');
      const r = {
        stars: Math.max(1, Math.min(5, +body.stars || 5)),
        tag: String(body.tag || ''),
        text: String(body.text || '').slice(0, 140),
        at: Date.now(),
        pickupNo: body.pickupNo || '',
      };
      const list = readReviews();
      list.unshift(r);
      writeReviews(list.slice(0, 100));
      return jsonRes(r);
    }
    return jsonRes({ error: 'no route' }, 404);
  };

  console.log('[static-api] GitHub Pages 演示模式已启用（推荐/下单/评价均为本地模拟，无真实支付）');
})();
