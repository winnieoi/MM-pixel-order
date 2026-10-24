// 参考场景桥接：保留 scene:status 事件协议；画面由参考图切片承载，热气泡等局部动作画在透明 canvas 上。
const scene = document.getElementById('scene');
const sceneWrap = document.getElementById('scene-wrap');
const sceneStatus = document.getElementById('scene-status');
const canvas = document.getElementById('scene-motion');
const ctx = canvas?.getContext('2d');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const W = 716, H = 920;

let raf = 0;
let last = 0;
let elapsed = 0;
let status = 'idle';

function updateSceneStatus(nextStatus, order) {
  status = nextStatus || 'idle';
  sceneWrap.dataset.status = status;
  sceneStatus.textContent = status === 'idle'
    ? '餐厅首页场景'
    : `餐厅场景状态：${status}${order?.orderId ? `，订单 ${order.orderId}` : ''}`;
}

// 像素热气：阶梯状像素块，接单/备餐时更旺。
function drawSteam() {
  const cooking = status === 'placed' || status === 'preparing';
  const speed = cooking ? 1.45 : 0.82;
  const opacity = cooking ? 0.94 : 0.64;
  const vents = [
    { x: 246, y: 514, phase: 0.1 },
    { x: 289, y: 500, phase: 1.8 },
    { x: 333, y: 516, phase: 3.2 },
    { x: 378, y: 503, phase: 4.5 },
  ];
  vents.forEach((vent) => {
    const cycle = (elapsed * speed + vent.phase) % 1;
    const rise = cycle * 42;
    const alpha = Math.max(0.28, Math.sin(cycle * Math.PI) * opacity);
    const drift = Math.round(Math.sin(cycle * Math.PI * 2 + vent.phase) * 7);
    const x = vent.x + drift;
    const y = vent.y - rise;
    ctx.fillStyle = `rgba(255, 248, 222, ${alpha})`;
    ctx.fillRect(x, y, 9, 6);
    ctx.fillRect(x + 6, y - 7, 8, 7);
    ctx.fillRect(x - 3, y - 14, 7, 6);
    ctx.fillStyle = `rgba(255, 255, 242, ${alpha * 0.72})`;
    ctx.fillRect(x + 2, y - 20, 6, 5);
  });
}

// 收银员手部/POS 的像素反馈。
function drawCashierTyping() {
  const active = status === 'placed' || status === 'preparing';
  const pulse = Math.sin(elapsed * (active ? 8 : 3.2));
  if (pulse < 0.18) return;
  const shift = pulse > 0.75 ? 5 : 0;
  ctx.fillStyle = '#ffe36a';
  ctx.fillRect(331 + shift, 574, 7, 4);
  ctx.fillStyle = '#f04a2e';
  ctx.fillRect(340 + shift, 578, 5, 4);
  ctx.fillStyle = '#fff3b0';
  ctx.fillRect(326 + shift, 568, 3, 3);
}

// 顾客小幅头肩/餐品动作。
function drawTableMotion() {
  const guests = [
    { x: 111, y: 694, phase: 0.4 },
    { x: 469, y: 724, phase: 1.9 },
    { x: 622, y: 676, phase: 3.2 },
  ];
  guests.forEach((guest) => {
    const pulse = Math.sin(elapsed * 2.2 + guest.phase);
    if (pulse < 0.25) return;
    const lift = pulse > 0.8 ? -2 : 0;
    ctx.fillStyle = 'rgba(255, 228, 164, .92)';
    ctx.fillRect(guest.x, guest.y + lift, 5, 3);
    ctx.fillStyle = 'rgba(109, 46, 30, .9)';
    ctx.fillRect(guest.x + 7, guest.y + lift + 2, 3, 3);
  });
}

function draw(now) {
  if (!ctx) return;
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000 || 0));
  last = now;
  elapsed += dt;
  ctx.clearRect(0, 0, W, H);
  if (!reduceMotion.matches) {
    drawSteam();
    drawCashierTyping();
    drawTableMotion();
  }
  raf = requestAnimationFrame(draw);
}

function start() {
  if (!ctx || reduceMotion.matches || raf) return;
  last = performance.now();
  raf = requestAnimationFrame(draw);
}
function stop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  last = 0;
}
function handleVisibility() { if (document.hidden) stop(); else start(); }
function handleMotionPreference() { if (reduceMotion.matches) stop(); else start(); }

addEventListener('scene:status', (event) => {
  updateSceneStatus(event.detail?.status, event.detail?.order);
});

scene.addEventListener('error', () => {
  sceneStatus.textContent = '餐厅场景素材加载失败';
});
updateSceneStatus('idle');

// 启动动效层（无 Canvas 或 reduced-motion 时静默跳过，不阻塞气泡等 DOM 交互）。
if (ctx) {
  canvas.setAttribute('aria-hidden', 'true');
  document.addEventListener('visibilitychange', handleVisibility);
  reduceMotion.addEventListener?.('change', handleMotionPreference);
  start();
}

// 邻桌顾客对话框：默认隐藏；两个小人各自随机自动冒一句（固定台词池循环取），约 5 秒后消失；
// 点击小人/气泡则立即弹出一句并重置该小人的自动计时，二者互不冲突。纯 DOM + setTimeout，无 Canvas 依赖。
function initCustomerDialogue() {
  const dialogue = document.getElementById('customer-dialogue');
  if (!dialogue) return;
  const dialogueStatus = document.getElementById('customer-dialogue-status');
  const SHOW_MS = 5000;
  const AUTO_MIN = 4000, AUTO_MAX = 9000;
  const lines = {
    blue: ['我也觉得！', '再来一口！', '必须的！'],
    front: ['这个新品夯爆了！', '薯条也好香！', '下次还来！'],
  };
  const cursor = { blue: 0, front: 0 };
  const timers = {};
  const autos = {};
  const bubbles = {};
  const hotspots = {};
  dialogue.querySelectorAll('.customer-bubble').forEach((btn) => { bubbles[btn.dataset.guest] = btn; });
  dialogue.querySelectorAll('.customer-hotspot').forEach((btn) => { hotspots[btn.dataset.guest] = btn; });

  function pickLine(guest) {
    const list = lines[guest];
    if (!list) return '';
    cursor[guest] = (cursor[guest] + 1) % list.length;
    return list[cursor[guest]];
  }
  function hide(guest) {
    const bubble = bubbles[guest];
    if (!bubble || bubble.classList.contains('hidden')) return;
    bubble.classList.add('hidden');
    clearTimeout(timers[guest]);
    timers[guest] = null;
    if (dialogueStatus) dialogueStatus.textContent = '顾客不说话了，稍等或点击小人再聊';
    if (bubble.contains(document.activeElement)) hotspots[guest]?.focus({ preventScroll: true });
    scheduleAuto(guest);
  }
  function show(guest, focusBubble) {
    const bubble = bubbles[guest];
    const hotspot = hotspots[guest];
    if (!bubble || !hotspot) return;
    bubble.classList.remove('hidden');
    clearTimeout(timers[guest]);
    timers[guest] = setTimeout(() => hide(guest), SHOW_MS);
    if (dialogueStatus) dialogueStatus.textContent = `顾客说：${bubble.querySelector('.line')?.textContent || ''}（约 5 秒后消失）`;
    if (focusBubble) bubble.focus({ preventScroll: true });
  }
  function scheduleAuto(guest) {
    clearTimeout(autos[guest]);
    autos[guest] = setTimeout(() => {
      autos[guest] = null;
      const bubble = bubbles[guest];
      if (!bubble) return;
      if (!bubble.classList.contains('hidden')) { scheduleAuto(guest); return; }
      const lineEl = bubble.querySelector('.line');
      if (lineEl) lineEl.textContent = pickLine(guest);
      show(guest, false);
    }, AUTO_MIN + Math.random() * (AUTO_MAX - AUTO_MIN));
  }
  Object.keys(hotspots).forEach((guest) => {
    if (!lines[guest]) return;
    hotspots[guest].addEventListener('click', () => {
      const lineEl = bubbles[guest]?.querySelector('.line');
      if (lineEl) lineEl.textContent = pickLine(guest);
      show(guest, true);
      scheduleAuto(guest);
    });
  });
  Object.keys(bubbles).forEach((guest) => {
    if (!lines[guest]) return;
    const lineEl = bubbles[guest].querySelector('.line');
    bubbles[guest].addEventListener('click', () => {
      lineEl.textContent = pickLine(guest);
      show(guest, false);
      scheduleAuto(guest);
    });
  });
  Object.keys(bubbles).forEach((guest) => { if (lines[guest]) scheduleAuto(guest); });

  const plate = document.getElementById('plate');
  if (!plate) return;
  const syncInert = () => {
    const covered = !plate.classList.contains('hidden');
    if (covered) dialogue.setAttribute('inert', '');
    else dialogue.removeAttribute('inert');
  };
  syncInert();
  new MutationObserver(syncInert).observe(plate, { attributes: true, attributeFilter: ['class'] });
}
initCustomerDialogue();
