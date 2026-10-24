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
function itemCount(items) {
  return items.reduce((count, item) => {
    const qty = Number(item.qty);
    return count + (Number.isFinite(qty) && qty > 0 ? qty : 0);
  }, 0);
}
async function request(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    return await readResponse(await fetch(url, { ...init, signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}
const api = {
  get: (u) => request(u),
  post: (u, b) => request(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }),
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
  sel = isTitle ? (focusedIndex >= 0 ? focusedIndex : 0) : 0;
  optionsEl.className = cols ? `cols${cols}` : '';
  optionsEl.innerHTML = options.map((o, i) => `
    <button type="button" class="opt${isTitle ? ' home-option' : ''} tone-${escapeHtml(o.tone || ['green', 'blue', 'purple'][i % 3])}" data-i="${i}"${isTitle ? ` data-art="${escapeHtml(o.art)}"` : ''}${typeof o.on === 'boolean' ? ` aria-pressed="${o.on}"` : ''}>
      ${o.badge ? `<span class="new">${escapeHtml(o.badge)}</span>` : ''}
      ${o.on ? '<span class="check">✓</span>' : ''}
      <span class="oi">${escapeHtml(o.icon || '')}</span>
      <span class="ol">${escapeHtml(o.label)}</span>
      ${o.sub ? `<span class="os">${escapeHtml(o.sub)}</span>` : ''}
    </button>`).join('');
  // Let CSS choose the homepage layout; only force-hide an empty option list.
  optionsEl.style.display = options.length ? '' : 'none';
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
  wallet = Number.isFinite(Number(n)) ? Math.max(0, Math.round(Number(n))) : wallet;
  coinsEl.textContent = wallet;
  delete coinsEl.dataset.initial;
}

// ---------- 键盘（桌面调试用） ----------
addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
  const active = document.activeElement;
  const optionButton = active?.closest?.('#options button');
  const ownButton = optionButton || (active === primaryBtn ? primaryBtn : null);
  // Handle our buttons once; prevent the browser's extra native Enter click.
  if (e.key === 'Enter' && ownButton) {
    e.preventDefault();
    if (!e.repeat && !ownButton.disabled) ownButton.click();
    return;
  }
  const interactive = 'button, a, input, select, textarea, summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';
  if (!optionButton && (e.target?.closest?.(interactive) || active?.closest?.(interactive))) return;
  const map = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 };
  if (map[e.key] && options.length) {
    e.preventDefault();
    sel = sel < 0 ? (map[e.key] > 0 ? 0 : options.length - 1) : (sel + map[e.key] + options.length) % options.length;
    paint();
    optionsEl.children[sel]?.focus({ preventScroll: true });
  } else if (e.key === 'Enter' && (options.length || !primaryBtn.disabled)) {
    e.preventDefault();
    if (e.repeat) return;
    if (options.length) optionsEl.children[Math.max(0, sel)]?.click();
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
    { label: '省钱套餐', art: 'save', tone: 'green', sub: '人均¥25', act: () => preset('省钱套餐', '放纵', 25) },
    { label: '轻松吃', art: 'light', tone: 'blue', sub: '人均¥35', act: () => preset('轻松吃', '减脂', 35) },
    { label: '尝新品', art: 'new', tone: 'purple', sub: '人均¥50', act: () => preset('尝新品', '尝新', 50) },
  ]);
  setPrimary('开始点餐 →', askPeople, false, 0);
}

function preset(name, goal, perPerson) {
  profile.preset = name; profile.goal = goal; profile.perPerson = perPerson;
  askPeople();
}

function askPeople() {
  setState('chat');
  say(profile.preset ? `${escapeHtml(profile.preset)}，好选择！<br>几位一起吃呀？` : '几位一起吃呀？');
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
    label, icon: '', tone: 'yellow',
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
  setCard(null);
  setPrimary('推荐中…', null, true, 0);
  try {
    const res = await api.post('/api/recommend', profile);
    if (version !== flowVersion) return;
    plans = res.plans || [];
    if (!plans.length) {
      say('小麦：呜…这个组合配不出来，<br>换个忌口再试试？');
      setOptions([{ label: '重新忌口', icon: '', tone: 'blue', act: askAvoid }], 1);
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
  say(`帮你配好了 · 第 ${idx + 1}/${plans.length} 套<br><small>${escapeHtml(p.label)}</small>`);
  setCard(`
    ${p.items.map((it) => `<div class="c-row"><span>${escapeHtml(it.qty)}× ${escapeHtml(it.name)}</span><span>¥${escapeHtml(it.price)}</span></div>`).join('')}
    <div class="c-sum"><span>总价 ¥${escapeHtml(p.total)}</span><span>人均 ¥${escapeHtml(p.perPerson)} · ${escapeHtml(p.kcalPerPerson)} kcal</span></div>
    <div class="c-reason">${escapeHtml(p.reason)}</div>
  `);
  setOptions([
    { label: '换一套', icon: '', tone: 'blue', act: () => browsePlan((idx + 1) % plans.length) },
    { label: '就这单', icon: '', tone: 'green', act: () => { currentPlan = p; placeOrder(); } },
  ], 2);
  setPrimary('下单 →', () => { currentPlan = p; placeOrder(); }, false, itemCount(p.items));
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
  clearInterval(pollTimer);
  clearTimeout(plateTimer);
  pollTimer = plateTimer = null;
  setState('kitchen');
  setOptions([]);
  if (order.status === 'ready') { showPlate(); return; }
  dispatchGame('scene:status', { status: 'preparing', order });
  const t0 = Date.now();
  const eta = Number(order.etaMinutes);
  const total = order.mode === 'demo' ? 36000 : (Number.isFinite(eta) && eta > 0 ? eta : 5) * 60000;
  const payHref = safeHttpHref(order.payUrl);
  say('订单已收到。<br><small>制作进度仅为时间估算，取餐以门店返回的状态为准。</small>');
  setCard(`
    <div class="c-hdr"><span>${escapeHtml(order.store?.name)}</span><span>单号 ${escapeHtml(order.orderId)}</span></div>
    <div class="c-row"><span>共 ${itemCount(currentPlan.items)} 件 · ¥${escapeHtml(order.total)}</span><span>预计 ${escapeHtml(order.etaMinutes ?? '待确认')} 分钟</span></div>
    ${order.payUrl ? `<div class="c-reason">订单支付：${payHref ? `<a href="${payHref}" target="_blank" rel="noopener noreferrer">查看支付页面</a>` : '支付链接暂不可用，请向门店确认'}${order.mcpStatus ? `（当前：${escapeHtml(order.mcpStatus)}）` : ''}</div>` : ''}
    <div class="bar" role="img" aria-label="时间估算进度，非门店实际制作进度"><i style="width:0%"></i></div>
    <div class="c-reason kitchen-status" role="status">正在查询门店状态；动画与百分比仅为时间估算。</div>
  `);
  setPrimary('预计制作进度 0%', null, true);
  const version = flowVersion;
  const orderId = order.orderId;
  const isCurrent = () => version === flowVersion && window.gameState === 'kitchen' && order?.orderId === orderId;
  const poll = async () => {
    if (!isCurrent() || pollInFlight) return;
    pollInFlight = true;
    try {
      const result = await api.get(`/api/order/${encodeURIComponent(orderId)}`);
      if (!isCurrent()) return;
      order = { ...order, ...result };
      if (order.status === 'ready') { showPlate(); return; }
      const elapsed = Date.now() - t0;
      const pct = Math.min(99, Math.max(0, Math.round(elapsed / total * 100)));
      const bar = cardEl.querySelector('.bar i');
      if (bar) bar.style.width = `${pct}%`;
      const status = cardEl.querySelector('.kitchen-status');
      if (status) status.textContent = elapsed >= total
        ? '已超过预计时间，仍在等待门店确认可取餐。'
        : `门店状态：${order.mcpStatus || order.status || '等待确认'}。百分比仅为时间估算。`;
      setPrimary(elapsed >= total ? '等待门店确认可取餐…' : `预计制作进度 ${pct}%`, null, true);
    } catch {
      if (!isCurrent()) return;
      const status = cardEl.querySelector('.kitchen-status');
      if (status) status.textContent = '暂时无法查询门店状态，将自动重试；请勿重复下单。';
      setPrimary('状态连接中，正在重试…', null, true);
    } finally {
      pollInFlight = false;
    }
  };
  pollTimer = setInterval(poll, 1000);
  poll();
}

function showPlate() {
  if (!order || order.status !== 'ready') return;
  clearInterval(pollTimer);
  clearTimeout(plateTimer);
  pollTimer = plateTimer = null;
  setState('ready');
  dispatchGame('scene:status', { status: 'ready', order });
  const noLabel = order.pickupIsOrderTail ? '订单号' : '号码牌';
  $('#plate-no').textContent = `No.${order.pickupNo ?? '待确认'}`;
  plateEl.classList.remove('hidden');
  const version = flowVersion;
  plateTimer = setTimeout(() => {
    plateTimer = null;
    if (version === flowVersion) plateEl.classList.add('hidden');
  }, 6000);
  say(`${noLabel} <b style="color:#c1271b">No.${escapeHtml(order.pickupNo ?? '待确认')}</b><br><small>${escapeHtml(order.store?.name)} · 门店已确认可取餐，拿上${noLabel}去门店，吃完回来评价～</small>`);
  setCard(null);
  setOptions([]);
  setPrimary('我取到餐了 →', () => renderReview());
}

function renderReview() {
  const version = ++flowVersion;
  clearInterval(pollTimer);
  clearTimeout(plateTimer);
  pollTimer = plateTimer = null;
  plateEl.classList.add('hidden');
  setState('review');
  dispatchGame('scene:status', { status: 'dining', order });
  say('这顿打几分？');
  setCard(null);
  let submitting = false;
  const submit = async (n) => {
    if (submitting || version !== flowVersion || window.gameState !== 'review') return;
    submitting = true;
    setOptions([]);
    say(`正在提交 ${starsLabel(n)} 评价…`);
    setPrimary('提交中…', null, true);
    try {
      await api.post('/api/reviews', { stars: n, tag: profile.goal || profile.preset, text: `${profile.people}人·${profile.goal || profile.preset}`, pickupNo: order?.pickupNo || '' });
      if (version !== flowVersion) return;
      renderWall(true);
    } catch {
      if (version !== flowVersion) return;
      submitting = false;
      say('暂时无法确认评价是否提交。<br><small>可以重试，或先看看大家的评价。</small>');
      setOptions([{ label: `重试 ${starsLabel(n)}`, tone: 'yellow', act: () => submit(n) }], 1);
      setPrimary('先看评价 →', () => renderWall(false));
    }
  };
  setOptions([1, 2, 3, 4, 5].map((n) => ({
    label: starsLabel(n), tone: 'yellow', act: () => submit(n),
  })), 5);
  setPrimary('跳过评价 →', () => renderWall(false));
}

async function renderWall(submitted = false) {
  const version = ++flowVersion;
  clearInterval(pollTimer);
  clearTimeout(plateTimer);
  pollTimer = plateTimer = null;
  plateEl.classList.add('hidden');
  setState('wall');
  setOptions([]);
  setCard(null);
  say(submitted ? '谢谢麦门信徒！<br>评价已提交，正在加载评价墙…' : '来看看大家怎么说。<br><small>正在加载评价墙…</small>');
  setPrimary('加载评价中…', null, true);
  try {
    const list = await api.get('/api/reviews');
    if (version !== flowVersion) return;
    if (!Array.isArray(list)) throw new Error('评价数据无效');
    say(submitted ? '谢谢麦门信徒！<br>你的评价已提交' : '来看看大家怎么说。');
    setCard(list.slice(0, 6).map((r) => `<div class="c-row"><span>${starsLabel(r.stars)}</span><span class="c-reason">${escapeHtml(r.tag)} ${escapeHtml(r.text)}</span></div>`).join('') || '<div class="c-reason">还没有人评价，你是最早的麦门信徒</div>');
  } catch {
    if (version !== flowVersion) return;
    say(submitted ? '评价已提交，但评价墙暂时没加载出来。' : '评价墙暂时没加载出来。');
    setOptions([{ label: '重试加载', tone: 'blue', act: () => renderWall(submitted) }], 1);
  }
  if (version !== flowVersion) return;
  setPrimary('再来一单 →', renderTitle);
}

// ---------- 启动 ----------
renderTitle();
