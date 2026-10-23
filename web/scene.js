// scene.js —— 麦门星球像素门店（后厨台 + 取餐口 + 餐桌）
// 约定（别删）：
//   1. 监听 scene:status {status: placed|preparing|ready|dining, order}
//   2. 画布宽度固定 240 逻辑像素，高度按容器比例自适应（不变形、pixelated 放大）
//   3. 号码牌由 #plate 负责，这里只把号同步到墙上出餐屏
// 角色图集：web/assets/staff.png（4 列角色 × 4 行朝向，tools/build-sprites.py 生成）

const cv = document.getElementById('scene');
const ctx = cv.getContext('2d');

const W = 240;
let H = 200;
const CELL_W = 37, CELL_H = 51;         // 图集单格；角色本体约 33x46
const DIR = { down: 0, left: 1, up: 2, right: 3 };

// ---- 版式（墙面与后厨台固定，餐厅区吃掉剩余高度）----
const WALL_H = 46;
const BAR_TOP = 64;        // 后厨台台面
const BAR_BASE = 94;       // 台面立面底部
const BANNER_H = 14;
const PASS_H = 16;
let diningH = 56;
let PASS_TOP = 180;
let DINING_TOP = 196;
const STATION_Y = 108;     // 员工在台前站位（脚底）

let status = new URLSearchParams(location.search).get('state') || 'idle';
let ticket = null;   // 订单信息（只用来显示取餐号，避免和 game.js 的全局名冲突）
let T = 0;
const timers = [];

addEventListener('scene:status', (e) => {
  status = e.detail.status;
  if (e.detail.order) ticket = e.detail.order;
  onStatus(status);
});

// ---------- 图集 ----------
const atlas = new Image();
let atlasReady = false;
atlas.onload = () => { atlasReady = true; };
atlas.src = 'assets/staff.png';

function drawChar(charIdx, dirIdx, x, yBottom, bob = 0) {
  if (!atlasReady) return;
  const sx = charIdx * CELL_W;      // 列 = 角色
  const sy = dirIdx * CELL_H;       // 行 = 朝向
  ctx.drawImage(atlas, sx, sy, CELL_W, CELL_H,
    Math.round(x - CELL_W / 2), Math.round(yBottom - CELL_H + bob), CELL_W, CELL_H);
}

// ---------- 员工 ----------
class Staff {
  constructor(name, char, home, station) {
    this.name = name; this.char = char;
    this.home = home; this.station = station;
    this.x = home.x; this.y = home.y;
    this.dir = DIR.down;
    this.target = null;
    this.working = false;
    this.wanderT = 1 + Math.random() * 2;
    this.step = 0;
  }
  walkTo(x, y, face) { this.target = { x, y, face }; }
  backHome() { this.walkTo(this.home.x, this.home.y, DIR.down); }
  update(dt) {
    if (this.target) {
      const dx = this.target.x - this.x, dy = this.target.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 1.5) {
        this.x = this.target.x; this.y = this.target.y;
        if (this.target.face != null) this.dir = this.target.face;
        this.target = null;
      } else {
        const sp = Math.min(d, 36 * dt);
        this.x += (dx / d) * sp; this.y += (dy / d) * sp;
        this.step += dt * 9;
        this.dir = Math.abs(dx) > Math.abs(dy) * 0.7 ? (dx > 0 ? DIR.right : DIR.left) : (dy > 0 ? DIR.down : DIR.up);
      }
    } else if (status === 'idle' || status === 'dining') {
      // 待机时在岗位附近挪两步，别像雕像
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        this.wanderT = 2.6 + Math.random() * 3;
        this.walkTo(this.home.x + (Math.random() * 20 - 10), this.home.y + (Math.random() * 8 - 4), DIR.down);
      }
    }
  }
  get bob() {
    if (this.target) return Math.sin(this.step * 2) > 0 ? -1 : 0;
    if (this.working) return Math.sin(T * 7 + this.char) > 0 ? -1 : 0;
    return Math.sin(T * 1.6 + this.char) > 0.9 ? -1 : 0;
  }
}

// 后厨排班：小堡(煎区) 小薯(炸区) 小冰(饮料) 小麦(打包出餐)
let staff = [];
function placeStaff() {
  const homeY = Math.min(PASS_TOP - 18, STATION_Y + 30);
  staff = [
    new Staff('小堡', 2, { x: 30, y: homeY }, { x: 30, y: STATION_Y - 1 }),
    new Staff('小薯', 1, { x: 84, y: homeY + 3 }, { x: 84, y: STATION_Y + 2 }),
    new Staff('小冰', 3, { x: 132, y: homeY }, { x: 132, y: STATION_Y }),
    new Staff('小麦', 0, { x: 182, y: homeY + 3 }, { x: 182, y: STATION_Y + 3 }),
  ];
}

function schedule(delay, fn) { timers.push({ at: T + delay, fn }); }

function onStatus(s) {
  if (s === 'placed') {
    staff.forEach((st, i) => schedule(i * 0.22, () => { st.working = false; st.walkTo(st.station.x, st.station.y, DIR.up); }));
    schedule(1.15, () => staff.forEach((st) => { st.working = true; }));
  } else if (s === 'preparing') {
    staff.forEach((st) => { st.working = true; if (!st.target) st.walkTo(st.station.x, st.station.y, DIR.up); });
  } else if (s === 'ready') {
    staff[3].working = false;
    staff[3].walkTo(198, PASS_TOP - 8, DIR.down);      // 经理端餐到取餐口
    staff.slice(0, 3).forEach((st) => { st.working = false; st.backHome(); });
  } else {
    staff.forEach((st) => { st.working = false; st.backHome(); });
  }
}

// ---------- 调色板 ----------
const P = {
  beam: '#6b4326', beamDark: '#4a2c17',
  tile: '#f2e4c6', grout: '#dcc7a1',
  wood: '#8a5a33', woodDark: '#5b3a29', woodLite: '#a97445',
  red: '#da291c', redDark: '#9e1b12', yellow: '#f7c531',
  steel: '#b9c2c7', steelDark: '#8b969c', steelLite: '#d6dde0',
  floorA: '#d8b184', floorB: '#c69b6d', floorLine: '#bd8f5f',
  ink: '#2a1c12',
};
const px = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };

// ---------- 墙 ----------
function drawWall() {
  px(0, 0, W, WALL_H, P.tile);
  for (let y = 0; y < WALL_H; y += 8) {
    px(0, y, W, 1, P.grout);
    const off = ((y / 8) | 0) % 2 ? 6 : 0;
    for (let x = off; x < W; x += 12) px(x, y, 1, 8, P.grout);
  }
  px(0, 0, W, 5, P.beam);
  px(0, 4, W, 1, P.beamDark);

  // 左侧金色拱门招牌
  px(12, 7, 34, 31, P.ink);
  px(14, 9, 30, 27, '#3a2415');
  ctx.fillStyle = P.yellow;
  for (const ax of [22, 34]) {
    ctx.beginPath();
    ctx.arc(ax, 25, 6, Math.PI, 0);
    ctx.lineTo(ax + 6, 33);
    ctx.lineTo(ax + 2, 33);
    ctx.lineTo(ax + 2, 25);
    ctx.lineTo(ax - 2, 25);
    ctx.lineTo(ax - 2, 33);
    ctx.lineTo(ax - 6, 33);
    ctx.closePath();
    ctx.fill();
  }
  px(20, 19, 8, 6, '#3a2415');

  // 中间菜单板
  px(54, 6, 92, 33, P.ink);
  px(56, 7, 88, 31, '#2a1c12');
  px(56, 7, 88, 7, P.red);
  px(60, 9, 3, 3, P.yellow); px(65, 9, 3, 3, P.yellow); px(70, 9, 3, 3, P.yellow);
  px(116, 9, 24, 3, '#f0d9a8');
  for (let i = 0; i < 4; i++) {
    const y = 17 + i * 5;
    px(60, y, 28 + (i % 3) * 7, 2, '#e8d6ae');
    px(130, y, 10, 2, P.yellow);
  }

  // 右侧出餐屏
  px(156, 6, 70, 27, P.ink);
  px(158, 7, 66, 25, '#1a1a14');
  ctx.fillStyle = '#8fae4e'; ctx.font = '5px monospace';
  ctx.fillText('ORDER · PICKUP', 162, 14);
  const ready = status === 'ready' || status === 'dining';
  const busy = status === 'placed' || status === 'preparing';
  const no = ready ? `No.${ticket?.pickupNo || 'A88'}` : (busy ? 'PREP...' : '- - -');
  ctx.fillStyle = ready ? '#d8f089' : (busy ? '#c9d67a' : '#5f6b3a');
  ctx.font = 'bold 9px monospace';
  ctx.fillText(no, 162, 26);
  if (busy) px(208, 20, 5, 5, Math.sin(T * 6) > 0 ? P.yellow : '#6b5a22');
}

// ---------- 地面 ----------
function drawFloor() {
  // 后厨地砖
  px(0, WALL_H, W, DINING_TOP - WALL_H, P.floorA);
  for (let y = WALL_H, r = 0; y < DINING_TOP; y += 11, r++) {
    for (let x = (r % 2 ? 12 : 0); x < W; x += 24) px(x, y, 12, 11, P.floorB);
    px(0, y, W, 1, P.floorLine);
  }
  // 餐厅地面
  const dh = H - BANNER_H - DINING_TOP;
  px(0, DINING_TOP, W, dh, '#e9cfa4');
  for (let y = DINING_TOP, r = 0; y < H - BANNER_H; y += 9, r++) {
    for (let x = (r % 2 ? 10 : 0); x < W; x += 20) px(x, y, 10, 9, '#e0c295');
    px(0, y, W, 1, '#d5b384');
  }
  px(0, DINING_TOP, W, 2, P.woodDark);
  px(0, DINING_TOP + 2, W, 1, P.woodLite);
}

// ---------- 后厨台（台面 + 设备 + 食品） ----------
function drawBar() {
  const hot = status === 'preparing' || status === 'placed';
  const B = BAR_TOP;
  // 台面
  px(0, B, W, 9, P.steelLite);
  px(0, B, W, 2, '#eef2f3');
  px(0, B + 8, W, 2, P.steel);
  // 立面
  px(0, B + 10, W, BAR_BASE - B - 16, P.steelDark);
  for (let x = 6; x < W; x += 40) px(x, B + 12, 1, BAR_BASE - B - 20, '#7b868b');
  // 红色腰线 + 踢脚
  px(0, BAR_BASE - 6, W, 5, P.red);
  px(0, BAR_BASE - 2, W, 2, '#6e7679');

  // 煎区：铁板 + 肉饼
  px(6, B - 4, 50, 5, '#3a3f41');
  for (let i = 0; i < 3; i++) {
    px(10 + i * 15, B - 5, 11, 3, hot ? '#c9552e' : '#7a4a34');
    if (hot && Math.sin(T * 6 + i) > 0) px(12 + i * 15, B - 6, 6, 1, '#ffd88a');
  }
  // 炸区：两个炸篮 + 薯条
  px(60, B - 10, 20, 7, '#4a4a4a'); px(84, B - 10, 20, 7, '#4a4a4a');
  for (let i = 0; i < 2; i++) {
    for (let k = 0; k < 4; k++) {
      const j = hot ? Math.round(Math.abs(Math.sin(T * 5 + k + i)) * 2) : 0;
      px(62 + i * 24 + k * 4, B - 12 + j, 2, 7, '#f2c94c');
    }
  }
  // 饮料机（立在台面上）
  px(108, B - 24, 40, 24, P.red);
  px(109, B - 25, 38, 3, '#e8564a');
  px(111, B - 21, 34, 8, '#f6e7cf');
  for (let i = 0; i < 3; i++) px(114 + i * 11, B - 19, 7, 5, '#cbb08a');
  px(111, B - 12, 34, 9, P.redDark);
  if (hot) px(114 + (Math.floor(T * 2) % 3) * 11, B - 13, 2, 3 + ((T * 14) % 5 | 0), '#fff');
  // 打包台：纸袋 + 托盘
  px(152, B - 10, 12, 10, '#e7d3a8');
  px(153, B - 11, 10, 3, P.yellow);
  ctx.fillStyle = P.red; ctx.font = 'bold 6px monospace'; ctx.fillText('M', 155, B - 3);
  px(168, B - 4, 26, 4, '#3a3f41');
  px(170, B - 7, 8, 3, '#c98a3c');
  px(180, B - 8, 4, 4, P.red);
  // 出餐托盘位
  px(204, B - 2, 30, 4, '#3a3f41');
  px(208, B - 5, 6, 3, '#c98a3c');
  if (status === 'ready') {
    px(212, B - 8, 8, 6, '#fff6df');
    px(213, B - 9, 6, 2, P.yellow);
    if (Math.sin(T * 5) > 0) { px(211, B - 12, 2, 2, '#fff'); px(220, B - 14, 2, 2, '#fff'); }
  }
}

// ---------- 取餐台 ----------
function drawPass() {
  px(0, PASS_TOP, W, PASS_H, P.wood);
  px(0, PASS_TOP, W, 2, P.woodLite);
  px(0, PASS_TOP + 5, W, 6, P.red);
  px(0, PASS_TOP + 11, W, 1, P.redDark);
  px(0, PASS_TOP + 14, W, 2, P.woodDark);
  for (let x = 4; x < W; x += 22) px(x, PASS_TOP + 12, 1, 3, '#7a4a26');

  // 取餐号牌座
  const ready = status === 'ready' || status === 'dining';
  px(186, PASS_TOP - 9, 34, 9, P.ink);
  px(188, PASS_TOP - 8, 30, 7, '#2a1c12');
  ctx.fillStyle = ready ? '#d8f089' : '#6f7b46';
  ctx.font = 'bold 6px monospace';
  ctx.fillText(ready ? `No.${ticket?.pickupNo || 'A88'}` : '取 餐 口', 189, PASS_TOP - 1);
}

// ---------- 餐桌 ----------
function drawProps() {
  // 绿植、垃圾桶：餐厅区的两个锚点
  const base = Math.min(H - BANNER_H - 8, DINING_TOP + 34);
  const plantX = 14;
  px(plantX - 5, base - 10, 12, 10, '#b5764a');
  px(plantX - 6, base - 11, 14, 3, '#c98a5e');
  px(plantX - 3, base - 22, 8, 12, '#4f8a3d');
  px(plantX - 6, base - 18, 6, 7, '#5f9c48');
  px(plantX + 1, base - 16, 6, 6, '#3f7531');
  const binX = 224;
  px(binX - 6, base - 10, 13, 11, '#6e7679');
  px(binX - 7, base - 12, 15, 4, '#8b969c');
  px(binX - 3, base - 5, 7, 4, '#3a3f41');

  // 取餐排队线 + 脚印
  const qy = PASS_TOP - 20;
  for (let x = 8; x < 232; x += 12) px(x, qy, 7, 2, 'rgba(247,197,49,.55)');
  for (let i = 0; i < 3; i++) {
    const ax = 96 + i * 26;
    px(ax, qy + 5, 6, 3, 'rgba(255,255,255,.35)');
    px(ax + 1, qy + 9, 4, 3, 'rgba(255,255,255,.25)');
  }
  // 后厨杂物：叠箱 + 拖把桶（靠边放，别压在员工脚下）
  px(206, qy - 15, 13, 11, '#c9a06a');
  px(208, qy - 19, 11, 5, '#d8b184');
  px(207, qy - 7, 11, 1, '#a97c46');
  px(6, qy - 11, 9, 8, '#9aa5aa');
  px(7, qy - 13, 7, 2, '#b9c2c7');
  px(9, qy - 19, 2, 7, '#7a4a26');
  px(7, qy - 21, 6, 3, '#5f9c48');
}

function drawDining() {
  if (diningH < 46) return;
  const areaTop = DINING_TOP + 3;
  const areaBot = H - BANNER_H - 3;
  const cy = Math.min(Math.round((areaTop + areaBot) / 2) + 3, H - BANNER_H - 12);

  const tables = [{ x: 62, y: cy }, { x: 160, y: cy }];
  if (areaBot - areaTop > 80) tables.push({ x: 188, y: cy - 32 });

  tables.forEach((tb, i) => {
    // 椅子（左右各一）
    px(tb.x - 30, tb.y - 7, 11, 9, '#8a5a33');
    px(tb.x - 30, tb.y - 9, 11, 3, '#a97445');
    px(tb.x + 19, tb.y - 7, 11, 9, '#8a5a33');
    px(tb.x + 19, tb.y - 9, 11, 3, '#a97445');
    // 桌面（上边收窄一点，做出圆桌感）
    px(tb.x - 20, tb.y - 11, 40, 3, '#f2cea1');
    px(tb.x - 23, tb.y - 8, 46, 7, '#e8bd85');
    px(tb.x - 19, tb.y - 1, 38, 2, '#b1845a');
    // 桌腿 + 影子
    px(tb.x - 3, tb.y + 1, 6, 7, '#7a4a26');
    px(tb.x - 13, tb.y + 8, 26, 2, 'rgba(60,36,18,.16)');
    // 桌牌
    px(tb.x + 4, tb.y - 14, 5, 3, P.yellow);

    if (status === 'dining') {
      px(tb.x - 14, tb.y - 14, 28, 4, '#3a3f41');            // 托盘
      px(tb.x - 12, tb.y - 18, 8, 4, '#c98a3c');             // 汉堡
      px(tb.x - 11, tb.y - 20, 6, 2, P.yellow);
      px(tb.x + 0, tb.y - 19, 4, 5, P.red);                  // 可乐
      px(tb.x + 7, tb.y - 17, 5, 4, '#f9df8a');              // 薯条
      if (Math.sin(T * 3 + i) > 0.2) { px(tb.x - 10, tb.y - 24, 2, 2, '#fff6df'); px(tb.x - 3, tb.y - 26, 2, 2, '#fff6df'); }
    }
  });
}

// ---------- 蒸汽 / 横幅 ----------
function drawSteam() {
  if (status !== 'preparing' && status !== 'placed') return;
  for (let i = 0; i < 4; i++) {
    const life = ((T * 0.4 + i * 0.25) % 1);
    const x = 12 + i * 12 + Math.sin(T * 2 + i) * 2;
    const y = BAR_TOP - 6 - life * 18;
    ctx.fillStyle = `rgba(255,255,255,${0.4 * (1 - life)})`;
    ctx.fillRect(Math.round(x), Math.round(y), 3, 3);
  }
}

function drawBanner() {
  const text = {
    idle: '…门店营业中 · 按 A 开始点单', placed: '已下单 · 后厨接单！',
    preparing: '制作中… 员工都在忙', ready: '✅ 出餐完毕 · 请凭号取餐',
    dining: '用餐愉快 · 吃完记得评价',
  }[status] || '…门店营业中';
  const y = H - BANNER_H;
  px(0, y, W, BANNER_H, 'rgba(43,43,35,0.9)');
  px(0, y, 3, BANNER_H, P.yellow);
  ctx.fillStyle = '#d8f089'; ctx.font = '7px monospace';
  ctx.fillText(text, 8, y + 10);
  px(228, y + 5, 4, 4, status === 'ready' || status === 'dining' ? P.yellow : '#5f6b3a');
}

// ---------- 自适应尺寸 ----------
function layout() {
  const wrap = cv.parentElement;
  const wpx = wrap.clientWidth || 240;
  const hpx = wrap.clientHeight || 200;
  H = Math.max(190, Math.min(340, Math.round(W * (hpx / wpx))));
  cv.width = W; cv.height = H;
  ctx.imageSmoothingEnabled = false;
  // 取餐台固定在后厨台下方；高屏把多余高度按 35% 分给后厨、其余给餐厅
  PASS_TOP = 148 + Math.max(0, Math.round((H - 280) * 0.4));
  DINING_TOP = PASS_TOP + PASS_H;
  diningH = H - BANNER_H - DINING_TOP;
  placeStaff();
  if (status !== 'idle') onStatus(status);
}

// ---------- 主循环 ----------
function frame(nowMs) {
  const now = (nowMs || 0) / 1000;
  const dt = Math.min(0.05, now - (frame.last || now));
  frame.last = now;
  T += dt;

  for (let i = timers.length - 1; i >= 0; i--) {
    if (T >= timers[i].at) { timers[i].fn(); timers.splice(i, 1); }
  }
  staff.forEach((s) => s.update(dt));

  ctx.clearRect(0, 0, W, H);
  drawWall();
  drawFloor();
  drawDining();
  drawProps();

  // 统一按脚底 y 排序：人站到台前(y=108)在设备(84)之后画，自然遮挡
  const items = staff.map((s) => ({ y: s.y, draw: () => {
    ctx.fillStyle = 'rgba(60,36,18,0.2)';
    ctx.fillRect(Math.round(s.x) - 7, Math.round(s.y) - 2, 14, 2);
    ctx.fillRect(Math.round(s.x) - 4, Math.round(s.y), 8, 1);
    drawChar(s.char, s.dir, s.x, s.y, s.bob);
  }}));
  items.push({ y: BAR_BASE, draw: drawBar });
  items.push({ y: PASS_TOP + PASS_H, draw: drawPass });
  items.push({ y: H - BANNER_H - 1, draw: drawSteam });
  items.push({ y: H, draw: drawBanner });
  items.sort((a, b) => a.y - b.y).forEach((it) => it.draw());

  requestAnimationFrame(frame);
}

layout();
addEventListener('resize', () => { layout(); });
requestAnimationFrame(frame);
