// 静态参考场景桥接：保留原有 scene:status 事件协议，画面由参考图切片承载。
const scene = document.getElementById('scene');
const sceneWrap = document.getElementById('scene-wrap');
const sceneStatus = document.getElementById('scene-status');

function updateSceneStatus(status, order) {
  const next = status || 'idle';
  sceneWrap.dataset.status = next;
  sceneStatus.textContent = next === 'idle'
    ? '餐厅首页静态场景'
    : `餐厅场景状态：${next}${order?.orderId ? `，订单 ${order.orderId}` : ''}`;
}

addEventListener('scene:status', (event) => {
  updateSceneStatus(event.detail?.status, event.detail?.order);
});

scene.addEventListener('error', () => {
  sceneStatus.textContent = '餐厅场景素材加载失败';
});
updateSceneStatus('idle');

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
