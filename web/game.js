// game.js —— 游戏机 UI 主流程（状态机）
//
/* ====================== 联调对接点（给场景搭建同学） ======================
 * 1. 场景状态变更：window.dispatchGame('scene:status', { status: 'placed|preparing|ready' })
 * 2. 号码牌展示：本文件已负责（真实取餐号），DOM: #plate / #plate-no / #plate-store
 * 3. 想替换整个上半屏：只改 index.html 的 #scene-wrap 内容，
 *    保持 window.gameState 可读（当前流程态），并继续派发上面的事件即可。
 * ====================================================================== */

const $ = (s) => document.querySelector(s);
const lcdBody = $('#lcd-body');
const lcdChoices = $('#lcd-choices');
const lcdTitle = $('#lcd-title');

const api = {
  get: (u) => fetch(u).then((r) => r.json()),
  post: (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json()),
};

window.gameState = 'title';
function setState(s) {
  window.gameState = s;
  window.dispatchEvent(new CustomEvent('game:state', { detail: { state: s } }));
}

// ---------- LCD 渲染 ----------
let choices = [];       // [{label, value}]
let sel = 0;            // 当前选中项
let onConfirm = null;   // A 键回调 (value) => {}
let onCancel = null;    // B 键回调

function show(bodyHtml, opts) {
  lcdBody.innerHTML = bodyHtml;
  choices = opts || [];
  sel = 0;
  lcdChoices.innerHTML = choices.map((o, i) => `<div class="choice${i === 0 ? ' sel' : ''}" data-i="${i}">${o.label}</div>`).join('');
  lcdChoices.style.display = choices.length ? '' : 'none';
  [...lcdChoices.children].forEach((el) => el.addEventListener('click', () => { sel = +el.dataset.i; paint(); press('a'); }));
}
function paint() {
  [...lcdChoices.children].forEach((el, i) => el.classList.toggle('sel', i === sel));
}
function showChoice(confirm, cancel) { onConfirm = confirm; onCancel = cancel || null; }
function clearActions() { onConfirm = null; onCancel = null; }

// ---------- 输入 ----------
function press(k) {
  if (k === 'up' || k === 'left') { sel = (sel - 1 + choices.length) % Math.max(1, choices.length); paint(); }
  if (k === 'down' || k === 'right') { sel = (sel + 1) % Math.max(1, choices.length); paint(); }
  if (k === 'a' && onConfirm) onConfirm(choices[sel]?.value);
  if (k === 'b' && onCancel) onCancel();
  if (k === 'start') onStart();
}
document.querySelectorAll('[data-k]').forEach((btn) => btn.addEventListener('click', () => press(btn.dataset.k)));

// 键盘映射（电脑上调试用）
addEventListener('keydown', (e) => {
  const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'a', Escape: 'b', ' ': 'start' };
  if (map[e.key]) press(map[e.key]);
});

// ---------- 流程数据 ----------
const profile = { people: 1, goal: '', avoid: [], budget: 0 };
let plans = [];
let currentPlan = null;
let order = null;
let pollTimer = null;

const QUESTIONS = [
  { key: 'people', q: '店员小麦：<br>欢迎光临麦门星球！<br>今天几个人吃呀？', opts: [['1 人', 1], ['2 人', 2], ['3~4 人', 3], ['5 人以上', 5]] },
  {
    key: 'goal', q: '小麦：今天的目标是？', opts: [
      ['🥗 减脂一夏', '减脂'], ['🍔 放纵大吃', '放纵'], ['✨ 尝尝新品', '尝新'], ['☕ 下午茶续命', '下午茶'], ['🧒 带娃吃饭', '带娃']],
  },
  {
    key: 'avoid', q: '小麦：有要避开的吗？<br><span class="dim">（B 键跳过）</span>', multi: ['不吃辣', '不吃牛肉', '不吃猪肉', '不吃海鲜', '都不用'], opts: [
      ['不吃辣', '辣'], ['不吃牛肉', '牛肉'], ['不吃猪肉', '猪肉'], ['不吃海鲜', '海鲜'], ['都没有', '__none']],
  },
  {
    key: 'budget', q: '小麦：预算大概多少？', opts: [
      ['人均 ¥25 内', 25], ['人均 ¥40 内', 40], ['人均 ¥60 内', 60], ['随便花，开心就好', 9999]],
  },
];

// ---------- 各状态 ----------
function renderTitle() {
  setState('title');
  lcdTitle.textContent = 'McDONALD\'S GamePlayer';
  show(`<b style="color:#ffe36e">🍔 麦门星球</b><br>把饭点安排明白。<br><br>按下 A 键开始点单<span class="blink">▌</span>`);
  showChoice((v) => renderQuestion(0), () => {});
}

function renderQuestion(i) {
  setState('chat');
  const step = QUESTIONS[i];
  lcdTitle.textContent = `点单 ${i + 1}/${QUESTIONS.length}`;
  show(step.q, step.opts.map((o) => ({ label: o[0], value: o[1] })));
  showChoice((v) => {
    if (step.key === 'avoid') {
      if (v !== '__none') profile.avoid.push(v);
      // 忌口允许多选：不跳题，直到选「都没有」
      if (v !== '__none') {
        lcdChoices.children[sel].style.opacity = 0.35;
        lcdChoices.children[sel].classList.remove('sel');
        choices = choices.filter((_, idx) => idx !== sel); sel = 0; paint();
        return;
      }
    } else {
      profile[step.key] = v;
    }
    const next = i + 1;
    next < QUESTIONS.length ? renderQuestion(next) : fetchPlans();
  }, () => { i > 0 ? renderQuestion(i - 1) : renderTitle(); });
}

async function fetchPlans() {
  setState('recommend');
  lcdTitle.textContent = 'AI 配餐中…';
  show(`小麦：让我看看今天的菜单…<br><span class="blink">▌</span>`);
  clearActions();
  const res = await api.post('/api/recommend', profile);
  plans = res.plans;
  if (!plans.length) { show('小麦：呜…这个组合配不出来，换个忌口试试？'); showChoice(() => renderQuestion(2), () => renderQuestion(2)); return; }
  browsePlan(0);
}

function browsePlan(idx) {
  lcdTitle.textContent = `方案 ${idx + 1}/${plans.length} · ${plans[idx].label}`;
  const p = plans[idx];
  const lines = p.items.map((it) => `${it.qty}× ${it.name} <span class="price">¥${it.price}</span>${it.isNew ? ' <small>新</small>' : ''}`).join('<br>');
  show(
    `${lines}<br>──────<br>总价 <span class="price">¥${p.total}</span> · 人均 ¥${p.perPerson} · ${p.kcalPerPerson} kcal/人` +
    (p.discount ? `<br><span class="dim">已按套餐组合省 ¥${p.discount}</span>` : '') +
    `<br><span class="dim">💡 ${p.reason}</span><br><br>A 认准这单 · ▲▼ 换方案`,
  );
  showChoice(() => { currentPlan = p; placeOrder(); }, () => {
    idx > 0 ? browsePlan(idx - 1) : renderQuestion(0);
  });
}

async function placeOrder() {
  setState('ordering');
  lcdTitle.textContent = '下单中…';
  show(`小麦：马上给你下单！<br><span class="blink">▌</span>`);
  clearActions();
  order = await api.post('/api/order', {
    items: currentPlan.items.map((i) => ({ id: i.id, qty: i.qty })),
    storeId: 'STORE01',
  });
  window.dispatchGame?.('scene:status', { status: 'placed', order });
  $('#plate-store').textContent = order.store.name;
  $('#mode-tag').textContent = order.mode === 'demo' ? 'demo' : 'live';
  $('#mode-tag').classList.toggle('live', order.mode === 'live');
  lcdTitle.textContent = `已下单 · 单号 ${order.orderId}`;
  show(`小麦：后厨开火了！<br>看上面备餐画面，做好就给你号码牌～<br>预计 ${order.etaMinutes} 分钟`);
  clearActions();
  pollStatus();
}

function pollStatus() {
  setState('kitchen');
  window.dispatchGame?.('scene:status', { status: 'preparing', order });
  pollTimer = setInterval(async () => {
    const o = await api.get(`/api/order/${order.orderId}`);
    order = { ...order, ...o };
    if (o.status === 'ready') { clearInterval(pollTimer); showPlate(); }
  }, 2500);
}

function showPlate() {
  setState('ready');
  window.dispatchGame?.('scene:status', { status: 'ready', order });
  $('#plate-no').textContent = `No.${order.pickupNo}`;
  $('#plate').classList.remove('hidden');
  setTimeout(() => $('#plate').classList.add('hidden'), 6000);
  lcdTitle.textContent = '出餐啦！';
  show(`🔔 号码牌 <b style="color:#ffe36e">No.${order.pickupNo}</b><br>${order.store.name}<br><br>去真实门店取餐，吃完回来评价～<br><span class="dim">A 键：我取到餐了</span>`);
  showChoice(() => renderReview(), () => {});
}

function renderReview() {
  setState('review');
  window.dispatchGame?.('scene:status', { status: 'dining', order });
  lcdTitle.textContent = '用餐评价';
  show(`这顿打几分？<br><span class="dim">▲▼ 选星级 · A 确认</span>`, [[1], [2], [3], [4], [5]].map((s, i) => ({ label: '⭐'.repeat(5 - i), value: 5 - i })));
  showChoice(async (stars) => {
    await api.post('/api/reviews', { stars, tag: profile.goal, text: `${profile.people}人·${profile.goal}`, pickupNo: order?.pickupNo || "" });
    renderWall();
  }, () => renderWall());
}

async function renderWall() {
  setState('wall');
  lcdTitle.textContent = '麦门评价墙';
  const list = await api.get('/api/reviews');
  const lines = list.slice(0, 5).map((r) => `${'⭐'.repeat(r.stars)} <span class="dim">${r.tag}</span> ${r.text || ''}`).join('<br>') || '<span class="dim">还没有人评价，你是最早的麦门信徒</span>';
  show(`${lines}<br><br><span class="dim">A 键：再来一单</span>`);
  showChoice(() => { profile.avoid = []; renderTitle(); }, () => {});
}

// START 键：任何时候可一键下单（浏览方案时=确认当前方案）
function onStart() {
  if (window.gameState === 'recommend' && plans.length) { currentPlan = plans[sel % plans.length] || plans[0]; placeOrder(); }
}

// 场景事件桥（场景侧可监听）
window.dispatchGame = (type, detail) => window.dispatchEvent(new CustomEvent(type, { detail }));

renderTitle();
