// scene.js —— 备餐厅占位场景（可整体替换）
// 监听：scene:status {status: placed|preparing|ready|dining}
// 画布逻辑分辨率 240x200，CSS 放大 pixelated。你搭场景时保持这两个约定即可。

const cv = document.getElementById('scene');
const ctx = cv.getContext('2d');

let status = 'idle'; // idle | placed | preparing | ready | dining
let t = 0;
addEventListener('scene:status', (e) => { status = e.detail.status; });

// 星露谷式暖色小厨房：地面木纹 + 柜台 + 煎炉 + 三个员工小人
const WORKERS = [
  { x: 60, y: 120, phase: 0, role: 'grill' },
  { x: 120, y: 128, phase: 2, role: 'fryer' },
  { x: 180, y: 122, phase: 4, role: 'pass' },
];

function draw() {
  t += 0.05;
  // 背景墙
  ctx.fillStyle = '#7a4a2b'; ctx.fillRect(0, 0, 240, 90);
  ctx.fillStyle = '#8a5a33'; for (let x = 0; x < 240; x += 24) ctx.fillRect(x, 0, 12, 90);
  // 墙面装饰：金色M
  ctx.fillStyle = '#f7c531'; ctx.fillRect(104, 14, 6, 34); ctx.fillRect(130, 14, 6, 34);
  ctx.fillStyle = '#f7c531'; ctx.beginPath(); ctx.arc(120, 34, 13, 0, Math.PI); ctx.fill();
  // 地板
  ctx.fillStyle = '#c9a06a'; ctx.fillRect(0, 90, 240, 110);
  ctx.fillStyle = '#b8894f'; for (let y = 90; y < 200; y += 14) ctx.fillRect(0, y, 240, 2);
  // 柜台
  ctx.fillStyle = '#5b3a29'; ctx.fillRect(0, 78, 240, 14);
  ctx.fillStyle = '#e8b04b'; ctx.fillRect(0, 76, 240, 3);
  // 煎炉（后厨台面）
  ctx.fillStyle = '#3a3a3a'; ctx.fillRect(30, 100, 70, 16);
  ctx.fillStyle = '#222'; ctx.fillRect(34, 102, 28, 12);
  // 薯条炸炉
  ctx.fillStyle = '#4a4a4a'; ctx.fillRect(110, 100, 46, 16);
  ctx.fillStyle = '#f7c531'; ctx.fillRect(116, 104, 8, 8); ctx.fillRect(132, 104, 8, 8);
  // 出餐口
  ctx.fillStyle = '#5b3a29'; ctx.fillRect(168, 96, 52, 20);
  ctx.fillStyle = '#f3e5c3'; ctx.fillRect(172, 100, 44, 12);

  // 煎炉上的汉堡
  const grillGlow = status === 'preparing' ? 1 : (status === 'ready' ? 0.4 : 0.15);
  ctx.fillStyle = `rgba(255,${120 + 60 * Math.sin(t * 6) * grillGlow},60,${0.5 + 0.5 * grillGlow})`;
  ctx.fillRect(38, 104, 20, 8);
  // 烟雾
  if (status === 'preparing') {
    for (let i = 0; i < 3; i++) {
      const sy = 100 - ((t * 20 + i * 22) % 40);
      ctx.fillStyle = `rgba(240,240,240,${0.5 - sy / 260})`;
      ctx.fillRect(42 + i * 8 + Math.sin(t + i) * 3, sy, 4, 4);
    }
  }

  // 员工小人（8x10 像素小人 + 帽子，2帧摆动）
  const busy = status === 'preparing' || status === 'placed';
  for (const w of WORKERS) {
    const bob = busy ? Math.round(Math.sin(t * 4 + w.phase) * 2) : Math.round(Math.sin(t + w.phase) * 1);
    const x = w.x, y = w.y + bob;
    ctx.fillStyle = '#f7c531'; ctx.fillRect(x, y - 4, 8, 3);            // 帽
    ctx.fillStyle = '#e8b48a'; ctx.fillRect(x, y - 1, 8, 5);            // 脸
    ctx.fillStyle = '#da291c'; ctx.fillRect(x, y + 4, 8, 6);            // 工服
    ctx.fillStyle = '#33231a'; ctx.fillRect(x + 1, y + 10, 2, 3); ctx.fillRect(x + 5, y + 10, 2, 3); // 腿
    // 手里的食物
    if (status === 'ready' && w.role === 'pass') {
      ctx.fillStyle = '#f7c531'; ctx.fillRect(x + 9, y + 2, 5, 5);
      ctx.fillStyle = '#7ec850'; ctx.fillRect(x + 10, y + 1, 3, 2);
    }
  }

  // 状态横幅
  const banner = { idle: '…营业准备中', placed: '已下单 · 后厨接单！', preparing: '制作中…', ready: '✅ 请取餐', dining: '用餐愉快!' }[status] || '…营业准备中';
  ctx.fillStyle = 'rgba(43,43,35,0.85)'; ctx.fillRect(0, 186, 240, 14);
  ctx.fillStyle = '#d8f089'; ctx.font = '8px monospace'; ctx.fillText(banner, 6, 196);

  requestAnimationFrame(draw);
}
draw();
