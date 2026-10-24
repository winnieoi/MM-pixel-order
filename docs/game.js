// game.js —— 麦门星球底部交互层（小麦对话气泡 + 选项卡片 + 金色主按钮）
//
/* ====================== 联调对接点（给场景搭建同学） ======================
 * 1. 场景状态变更：window.dispatchGame('scene:status', { status: 'placed|preparing|ready|dining', order })
 * 2. 号码牌：本文件负责（真实取餐号），DOM: #plate / #plate-no / #plate-store
 * 3. 想替换整个场景层：只改 index.html 的 #scene-wrap 内容，
 *    保持 window.gameState 可读，并继续派发上面的事件即可。
 * ====================================================================== */

const $ = (s) => document.querySelector(s);

const speechEl = $('#speech');
const optionsEl = $('#options');
const cardEl = $('#card');
const primaryBtn = $('#primary');
const primaryLabel = $('#primary-label');
const coinsEl = $('#coins');
const modeTag = $('#mode-tag');
const plateEl = $('#plate');

async function readResponse(response) {
  if (!response.ok) throw new Error(`请求失败（${response.status}）`);
  return response.json();
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>\"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;',
  }[ch]));
}
function safeHttpHref(value) {
  try {
    const url = new URL(String(value ?? ''));
    return url.protocol === 'http:' || url.protocol === 'https:' ? escapeHtml(url.href) : '';
  } catch { return ''; }
}
function safeStars(value) {
  const stars = Number(value);
  return Number.isFinite(stars) ? Math.min(5, Math.max(1, Math.round(stars))) : 1;
}
function starsLabel(value) { return `${safeStars(value)} 星`; }
const api = {
  get: (u) => fetch(u).then(readResponse),
  post: (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(readResponse),
};

// ---------- 全局状态 ----------
window.gameState = 'title';
let scrollFrame = null;
function setState(s) {
  window.gameState = s;
  $('#app').dataset.state = s;
  window.dispatchEvent(new CustomEvent('game:state', { detail: { state: s } }));
  cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = null;
    if (window.gameState !== s) return;
    if (s === 'title') {
      $('#app').scrollIntoView({ block: 'start', behavior: 'auto' });
      return;
    }
    const panel = $('#panel');
    const rect = panel.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    if (rect.top < 0 || rect.top >= viewportHeight || rect.bottom <= 0) {
      panel.scrollIntoView({ block: 'start', behavior: 'auto' });
    }
  });
}
function dispatchGame(type, detail) { window.dispatchEvent(new CustomEvent(type, { detail })); }
window.dispatchGame = dispatchGame;

const profile = { people: 1, goal: '', avoid: [], budget: 0, preset: '' };
let plans = [], currentPlan = null, order = null;
let pollTimer = null, plateTimer = null;
let pollInFlight = false;
let flowVersion = 0;
let options = [], sel = 0;
let wallet = 888;

// ---------- 渲染原语 ----------
function say(html) { speechEl.innerHTML = html; }
function setCard(html) {
  if (!html) { cardEl.classList.add('hidden'); cardEl.innerHTML = ''; }
  else { cardEl.innerHTML = html; cardEl.classList.remove('hidden'); }
}
function setOptions(list, cols) {
  options = list || [];
  const isTitle = window.gameState === 'title';
  const focusedIndex = document.activeElement?.parentElement === optionsEl
    ? Number(document.activeElement.dataset.i) : -1;
  sel = isTitle ? -1 : 0;
  optionsEl.className = cols ? `cols${cols}` : '';
  optionsEl.innerHTML = options.map((o, i) => `
    <button type="button" class="opt${isTitle ? ' home-option' : ''} tone-${escapeHtml(o.tone || ['green', 'blue', 'purple'][i % 3])}" data-i="${i}"${isTitle ? ` data-art="${escapeHtml(o.art)}"` : ''}${typeof o.on === 'boolean' ? ` aria-pressed="${o.on}"` : ''}>
      ${o.badge ? `<span class="new">${escapeHtml(o.badge)}</span>` : ''}
      ${o.on ? '<span class="check">✓</span>' : ''}
      <span class="oi">${escapeHtml(o.icon || '')}</span>
      <span class="ol">${escapeHtml(o.label)}</span>
      ${o.sub ? `<span class="os">${escapeHtml(o.sub)}</span>` : ''}
    </button>`).join('');
  optionsEl.style.removeProperty('display');
  [...optionsEl.children].forEach((el, i) => {
    if (isTitle) el.setAttribute('aria-label', options[i].label);
    el.addEventListener('focus', () => { sel = i; paint(); });
    el.addEventListener('click', () => { sel = i; paint(); options[i].act(); });
  });
  if (focusedIndex >= 0 && focusedIndex < optionsEl.children.length) {
    sel = focusedIndex;
    optionsEl.children[focusedIndex].focus({ preventScroll: true });
  }
  paint();
}
function paint() {
  [...optionsEl.children].forEach((el, i) => {
    const selected = i === sel;
    el.classList.toggle('sel', selected);
  });
}
function setPrimary(label, fn, disabled, cartCount) {
  primaryLabel.textContent = label;
  primaryBtn.disabled = !!disabled;
  primaryBtn.onclick = fn || null;
  primaryBtn.querySelectorAll('.badge-cart').forEach((n) => n.remove());
  if (cartCount !== undefined) $('#bag-count').textContent = cartCount;
}
function setWallet(n) {
  wallet = Math.max(0, Math.round(n));
  coinsEl.textContent = wallet;
  delete coinsEl.dataset.initial;
}

// ---------- 键盘（桌面调试用） ----------
addEventListener('keydown', (e) => {
  const interactive = 'button, a, input, select, textarea, summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';
  if (e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey ||
      e.target?.closest?.(interactive) || document.activeElement?.closest?.(interactive)) return;
  const map = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 };
  if (map[e.key] && options.length) {
    e.preventDefault();
    sel = sel < 0 ? (map[e.key] > 0 ? 0 : options.length - 1) : (sel + map[e.key] + options.length) % options.length;
    paint();
  } else if (e.key === 'Enter' && (options.length || !primaryBtn.disabled)) {
    e.preventDefault();
    if (e.repeat) return;
    if (options.length) options[Math.max(0, sel)].act();
    else primaryBtn.click();
  }
});

// ---------- 流程 ----------
function renderTitle() {
  flowVersion++;
  clearInterval(pollTimer);
  clearTimeout(plateTimer);
  pollTimer = plateTimer = null;
  plans = []; currentPlan = null; order = null;
  Object.assign(profile, { people: 1, goal: '', avoid: [], budget: 0, preset: '', perPerson: 0 });
  plateEl.classList.add('hidden');
  $('#plate-no').textContent = '';
  $('#plate-store').textContent = '';
  modeTag.textContent = 'demo';
  modeTag.classList.remove('live');
  setWallet(888);
  setState('title');
  dispatchGame('scene:status', { status: 'idle', order: null });
  say('今天想吃点什么？');
  setCard(null);
  setOptions([
    { label: '省钱套餐', art: 'save', tone: 'green', act: () => preset('省钱套餐', '放纵', 25) },
    { label: '轻松吃', art: 'light', tone: 'blue', act: () => preset('轻松吃', '减脂', 35) },
    { label: '尝新品', art: 'new', tone: 'purple', act: () => preset('尝新品', '尝新', 50) },
  ]);
  setPrimary('开始点餐 →', askPeople, false, 0);
}

function preset(name, goal, perPerson) {
  profile.preset = name; profile.goal = goal; profile.perPerson = perPerson;
  askPeople();
}

function askPeople() {
  setState('chat');
  say(profile.preset ? `${profile.preset}，好选择！<br>几位一起吃呀？` : '几位一起吃呀？');
  setCard(null);
  setOptions([
    { label: '1 人', icon: '1', tone: 'green', act: () => { profile.people = 1; next('avoid'); } },
    { label: '2 人', icon: '2', tone: 'blue', act: () => { profile.people = 2; next('avoid'); } },
    { label: '3~4 人', icon: '3', tone: 'purple', act: () => { profile.people = 4; next('avoid'); } },
    { label: '5 人以上', icon: '5+', tone: 'red', act: () => { profile.people = 6; next('avoid'); } },
  ], 2);
  setPrimary('上一步 →', renderTitle);
}

function askAvoid() {
  setState('chat');
  setCard(null);
  say('有要忌口的吗？<br><small>可多选，选完点下面按钮</small>');
  const avoidList = [['不吃辣', '辣'], ['不吃牛肉', '牛肉'], ['不吃猪肉', '猪肉'], ['不吃海鲜', '海鲜']];
  setOptions(avoidList.map(([label, v]) => ({
    label, icon: '🚫', tone: 'yellow',
    on: profile.avoid.includes(v),
    act: () => {
      const i = profile.avoid.indexOf(v);
      i >= 0 ? profile.avoid.splice(i, 1) : profile.avoid.push(v);
      askAvoid();
    },
  })), 2);
  setPrimary('去推荐 →', () => {
    profile.budget = profile.perPerson ? profile.perPerson * profile.people : 40 * profile.people;
    fetchPlans();
  });
}

function next() { askAvoid(); }

async function fetchPlans() {
  const version = ++flowVersion;
  setState('recommend');
  say('小麦：让我翻翻今天的菜单…');
  setOptions([]);
  setPrimary('推荐中…', null, true);
  try {
    const res = await api.post('/api/recommend', profile);
    if (version !== flowVersion) return;
    plans = res.plans || [];
    if (!plans.length) {
      say('小麦：呜…这个组合配不出来，<br>换个忌口再试试？');
      setOptions([{ label: '重新忌口', icon: '🔄', tone: 'blue', act: askAvoid }], 1);
      setPrimary('上一步 →', renderTitle);
      return;
    }
    browsePlan(0);
  } catch (e) {
    if (version !== flowVersion) return;
    say('小麦：网络打了个喷嚏，<br>再点一次试试～');
    setPrimary('重试 →', () => fetchPlans());
  }
}

function browsePlan(idx) {
  const p = plans[idx];
  if (!p) return;
  setState('recommend');
  say(`帮你配好了 · 第 ${idx + 1}/${plans.length} 套<br><small>${p.label}</small>`);
  setCard(`
    ${p.items.map((it) => `<div class="c-row"><span>${it.qty}× ${it.name}</span><span>¥${it.price}</span></div>`).join('')}
    <div class="c-sum"><span>总价 ¥${p.total}</span><span>人均 ¥${p.perPerson} · ${p.kcalPerPerson} kcal</span></div>
    <div class="c-reason">💡 ${p.reason}</div>
  `);
  setOptions([
    { label: '换一套', icon: '🔄', tone: 'blue', act: () => browsePlan((idx + 1) % plans.length) },
    { label: '就这单', icon: '✅', tone: 'green', act: () => { currentPlan = p; placeOrder(); } },
  ], 2);
  setPrimary('下单 →', () => { currentPlan = p; placeOrder(); }, false, p.items.reduce((s, i) => s + i.qty, 0));
}

async function placeOrder() {
  if (!currentPlan || (window.gameState === 'ordering' && primaryBtn.disabled)) return;
  const version = ++flowVersion;
  setState('ordering');
  say('小麦：马上给你下单！<br>后厨要开火了…');
  setOptions([]);
  setPrimary('下单中…', null, true);
  try {
    const result = await api.post('/api/order', {
      items: currentPlan.items.map((i) => ({ id: i.id, qty: i.qty })),
      storeId: 'STORE01',
    });
    if (version !== flowVersion) return;
    order = result;
  } catch (e) {
    if (version !== flowVersion) return;
    say('小麦：下单失败了，<br>再试一次？');
    setPrimary('重试 →', placeOrder);
    return;
  }
  dispatchGame('scene:status', { status: 'placed', order });
  $('#plate-store').textContent = order.store?.name || '麦门星球示例餐厅';
  modeTag.textContent = order.mode === 'demo' ? 'demo' : 'live';
  modeTag.classList.toggle('live', order.mode === 'live');
  setWallet(wallet - order.total);
  startKitchen();
}

function startKitchen() {
  setState('kitchen');
  dispatchGame('scene:status', { status: 'preparing', order });
  const t0 = Date.now();
  const total = order.mode === 'demo' ? 36000 : (order.etaMinutes || 5) * 60000;
  setCard(`
    <div class="c-hdr"><span>${order.store?.name || ''}</span><span>单号 ${order.orderId}</span></div>
    <div class="c-row"><span>共 ${currentPlan.items.reduce((s, i) => s + i.qty, 0)} 件 · ¥${order.total}</span><span>预计 ${order.etaMinutes} 分钟</span></div>
    ${order.payUrl ? `<div class="c-reason">💳 真实订单待支付：<a href="${order.payUrl}" target="_blank" rel="noopener">点此支付</a>${order.mcpStatus ? `（当前：${order.mcpStatus}）` : ''}</div>` : ''}
    <div class="bar"><i style="width:4%"></i></div>
    <div class="c-reason">上方场景为静态备餐示意，将按预计时间更新进度</div>
  `);
  clearInterval(pollTimer);
  const version = flowVersion;
  pollTimer = setInterval(async () => {
    if (version !== flowVersion || !order) return;
    let o = order;
    try { o = await api.get(`/api/order/${order.orderId}`); order = { ...order, ...o }; } catch { /* 轮询失败静默重试 */ }
    const pct = Math.min(99, Math.max(4, Math.round(((Date.now() - t0) / total) * 100)));
    const bar = cardEl.querySelector('.bar i');
    if (bar) bar.style.width = `${pct}%`;
    setPrimary(`预计制作进度 ${pct}%`, null, true);
    if (pct > 22) dispatchGame('scene:status', { status: 'preparing', order });
    if (o.status === 'ready') { clearInterval(pollTimer); showPlate(); }
  }, 1000);
}

function showPlate() {
  setState('ready');
  dispatchGame('scene:status', { status: 'ready', order });
  const noLabel = order.pickupIsOrderTail ? '订单号' : '号码牌';
  $('#plate-no').textContent = `No.${order.pickupNo}`;
  plateEl.classList.remove('hidden');
  setTimeout(() => plateEl.classList.add('hidden'), 6000);
  const payHint = order.payUrl ? '，支付后门店开始制作' : '';
  say(`🔔 ${noLabel} <b style="color:#c1271b">No.${order.pickupNo}</b><br><small>${order.store?.name || ''} · 拿上${noLabel}去门店取餐${payHint}，吃完回来评价～</small>`);
  setCard(null);
  setOptions([]);
  setPrimary('我取到餐了 →', () => renderReview());
}

function renderReview() {
  setState('review');
  dispatchGame('scene:status', { status: 'dining', order });
  say('这顿打几分？');
  setCard(null);
  setOptions([1, 2, 3, 4, 5].map((n) => ({
    label: '⭐'.repeat(n), tone: 'yellow',
    act: async () => {
      await api.post('/api/reviews', { stars: n, tag: profile.goal || profile.preset, text: `${profile.people}人·${profile.goal || profile.preset}`, pickupNo: order?.pickupNo || '' });
      renderWall();
    },
  })), 5);
  setPrimary('跳过评价 →', () => renderWall());
}

async function renderWall() {
  setState('wall');
  say('谢谢麦门信徒！<br>你的评价上墙了');
  try {
    const list = await api.get('/api/reviews');
    setCard(list.slice(0, 6).map((r) => `<div class="c-row"><span>${'⭐'.repeat(r.stars)}</span><span class="c-reason">${r.tag || ''} ${r.text || ''}</span></div>`).join('') || '<div class="c-reason">还没有人评价，你是最早的麦门信徒</div>');
  } catch { setCard(null); }
  setOptions([]);
  setPrimary('再来一单 →', () => {
    profile.avoid = []; profile.goal = ''; profile.perPerson = 0; profile.preset = '';
    setWallet(888);
    renderTitle();
  });
}

// ---------- 启动 ----------
renderTitle();
