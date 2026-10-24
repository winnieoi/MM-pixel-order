// scene.js —— 麦门星球像素门店（菜单板墙 + 开放式后厨 + 柜台 + 客座餐厅）
// 约定（别删）：
//   1. 监听 scene:status {status: placed|preparing|ready|dining, order}
//   2. 逻辑宽固定 240，高度按容器比例自适应；#plate 负责号码牌弹层
//   3. 四个小人每次刷新随机分配「店员 / 顾客」，各有自己的任务节律，不会同时干活
// 角色图集：web/assets/staff.png（4 列角色 × 4 行朝向，tools/build-sprites.py 生成）

const cv = document.getElementById('scene');
const ctx = cv.getContext('2d');

const W = 240;
let H = 280;
const CELL_W = 37, CELL_H = 51;
const DIR = { down: 0, left: 1, up: 2, right: 3 };

// ---------- 版式 ----------
const MENU = { x: 40, y: 34, w: 160, h: 34 };   // 菜单板
const KIT_TOP = 70;                             // 后厨（开放式）
const KIT_BOT = 184;                            // 后厨/柜台比例贴近设计稿
const CNT_TOP = 184;                            // 柜台
const CNT_BASE = 216;
let DINING_TOP = CNT_BASE;
let tableY = 210;

let status = new URLSearchParams(location.search).get('state') || 'idle';
let ticket = null;
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
  ctx.drawImage(atlas, charIdx * CELL_W, dirIdx * CELL_H, CELL_W, CELL_H,
    Math.round(x - CELL_W / 2), Math.round(yBottom - CELL_H + bob), CELL_W, CELL_H);
}

// ---------- 小人：店员 / 顾客随机分配 ----------
const CREW_NAMES = ['小麦', '阿麦', '麦姐', '麦师傅'];
const GUEST_NAMES = ['小明', '小红', '阿宅', '大胃王'];

class Person {
  constructor(name, char, role) {
    this.name = name; this.char = char; this.role = role;
    this.x = 0; this.y = 0; this.dir = DIR.down;
    this.target = null; this.work = false; this.seated = false;
    this.step = 0; this.phase = Math.random() * 10;
    this.idleT = 0.6 + Math.random() * 2.4;
    this.state = 'idle'; this.timer = 0; this.seat = null;
  }
  walkTo(x, y, face) { this.target = { x, y, face }; }
  move(dt) {
    if (!this.target) return false;
    const dx = this.target.x - this.x, dy = this.target.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 1.2) {
      this.x = this.target.x; this.y = this.target.y;
      if (this.target.face != null) this.dir = this.target.face;
      this.target = null; return true;
    }
    const sp = Math.min(d, 42 * dt);
    this.x += (dx / d) * sp; this.y += (dy / d) * sp;
    this.step += dt * 9;
    this.dir = Math.abs(dx) > Math.abs(dy) * 0.7 ? (dx > 0 ? DIR.right : DIR.left) : (dy > 0 ? DIR.down : DIR.up);
    return false;
  }
  get bob() {
    if (this.target) return Math.sin(this.step * 2) > 0 ? -1 : 0;
    if (this.work) return Math.sin(T * 7 + this.phase) > 0 ? -1 : 0;
    if (this.seated) return Math.sin(T * 2.4 + this.phase) > 0.92 ? -1 : 0;
    return Math.sin(T * 1.5 + this.phase) > 0.92 ? -1 : 0;
  }
}

let people = [];
let crew = [], guests = [];

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// 随机分配：0 号固定是店员小麦（对话头像要能对上人），其余 3 个里再随机抽 1 名店员 + 2 名顾客
function assignPeople() {
  const rest = shuffle([1, 2, 3]);
  const cNames = shuffle(CREW_NAMES.slice());
  const gNames = shuffle(GUEST_NAMES.slice());
  crew = [
    new Person(cNames[0], 0, 'crew'),
    new Person(cNames[1], rest[0], 'crew'),
  ];
  guests = rest.slice(1).map((c, i) => new Person(gNames[i], c, 'guest'));
  people = [...crew, ...guests];
  crew.forEach((p, i) => {
    p.x = 44 + i * 130 + Math.random() * 60;
    p.y = KIT_BOT - 8 - (i % 2) * 12;
    p.dir = DIR.down;
  });
  guests.forEach((p) => respawnGuest(p, true));
  onStatus(status);
}

function seatOf(g) {
  const idx = guests.indexOf(g);
  const tb = tables()[idx % tables().length];
  return { x: tb.x + (idx % 2 ? 26 : -26), y: tableY + 10, tb };
}
function tables() {
  if (H - DINING_TOP < 58) return [];
  const t = [{ x: 68, y: tableY, big: true }, { x: 172, y: tableY, big: true }];
  if (H - DINING_TOP > 112) t.push({ x: 68, y: tableY + 56, big: false }, { x: 172, y: tableY + 56, big: false });
  return t;
}

function respawnGuest(g, initial) {
  const s = seatOf(g);
  g.seat = s; g.seated = false; g.work = false;
  g.dir = Math.random() < 0.5 ? DIR.right : DIR.left;
  if (initial) {
    g.state = 'enter'; g.x = -18; g.y = s.y - 2; g.timer = 0;
    g.walkTo(s.x, s.y, g.dir);
  } else {
    g.state = 'out'; g.x = -18; g.y = s.y - 2; g.target = null;
    g.timer = 2.5 + Math.random() * 4;
  }
}
function enterTable(g) {
  g.state = 'enter'; g.x = -18; g.y = g.seat.y - 2;
  g.walkTo(g.seat.x, g.seat.y, g.dir);
}

function schedule(delay, fn) { timers.push({ at: T + delay, fn }); }

// ---------- 订单事件 → 排班 ----------
function onStatus(s) {
  timers.length = 0;
  if (s === 'placed' || s === 'preparing') {
    // 随机点名：一名厨师、一名打包，其余该干嘛干嘛（不会全员一起忙）
    const c = shuffle(crew.slice());
    const cook = c[0], packer = c[1] || c[0];
    cook.work = true; cook.state = 'cook';
    cook.walkTo(58, KIT_BOT - 8, DIR.up);
    packer.work = false; packer.state = 'pack';
    packer.walkTo(190, KIT_BOT - 8, DIR.up);
    // 安排一位顾客去取餐口拿号
    const g = guests.find((p) => p.state === 'sit' || p.state === 'eat');
    if (g) { g.seated = false; g.state = 'topass'; g.walkTo(214, CNT_TOP - 10, DIR.up); }
  } else if (s === 'ready') {
    crew.forEach((p) => { p.work = false; if (p.state === 'cook') p.state = 'idle'; });
    const packer = crew.find((p) => p.state === 'pack');
    if (packer) { packer.state = 'topass'; packer.walkTo(214, CNT_TOP - 10, DIR.down); }
  } else {
    crew.forEach((p) => { p.work = false; p.state = 'idle'; });
  }
}

// ---------- 更新 ----------
function updateCrew(dt) {
  crew.forEach((p) => {
    if (p.move(dt)) {
      if (p.state === 'topass') { p.state = 'wait'; p.timer = 1.8; p.dir = p.dir; }
      else if (p.state === 'cook' || p.state === 'pack') { p.work = true; }
    }
    if (p.state === 'wait') { p.timer -= dt; if (p.timer <= 0) { p.state = 'idle'; p.work = false; } }
    else if (p.state === 'idle') {
      // 没活的店员在后厨溜达，不会一直站桩
      p.idleT -= dt;
      if (p.idleT <= 0 && !p.target) {
        p.idleT = 2.2 + Math.random() * 3.4;
        p.walkTo(30 + Math.random() * 182, KIT_BOT - 10 - Math.random() * 22, DIR.down);
      }
    }
  });
}

function updateGuests(dt) {
  guests.forEach((g) => {
    if (g.state === 'out') {
      g.timer -= dt;
      if (g.timer <= 0) enterTable(g);
      return;
    }
    const arrived = g.move(dt);
    g.timer -= dt;
    switch (g.state) {
      case 'enter':
        if (arrived) { g.state = 'sit'; g.seated = true; g.timer = 5 + Math.random() * 7; g.dir = Math.random() < 0.5 ? DIR.right : DIR.left; }
        break;
      case 'sit':
        if (g.timer <= 0) {
          if (Math.random() < 0.65) { g.state = 'eat'; g.timer = 7 + Math.random() * 9; }
          else { leaveTable(g); }
        }
        break;
      case 'eat':
        if (g.timer <= 0) leaveTable(g);
        break;
      case 'topass':
        if (arrived) { g.state = 'wait'; g.timer = 1.6; g.dir = DIR.up; }
        break;
      case 'wait':
        if (g.timer <= 0) { g.state = 'toback'; g.walkTo(g.seat.x, g.seat.y, g.seat.x < 120 ? DIR.right : DIR.left); }
        break;
      case 'toback':
        if (arrived) { g.state = 'eat'; g.seated = true; g.timer = 6 + Math.random() * 8; }
        break;
    }
  });
}
function leaveTable(g) {
  g.seated = false; g.state = 'leave';
  g.walkTo(-20, g.seat.y - 2, DIR.left);
  if (!g.target) { g.state = 'out'; g.timer = 2 + Math.random() * 4; g.x = -18; }
}

// ---------- 调色板 ----------
const P = {
  wall: '#f0dcb4', wallDark: '#e2c795', wallLine: '#d9bb8b',
  red: '#da291c', redDark: '#9e1b12', blue: '#2b6fd6', yellow: '#f7c531',
  steel: '#b9c2c7', steelDark: '#8b969c', steelLite: '#d6dde0',
  ink: '#2a1c12', wood: '#8a5a33', woodDark: '#5b3a29', woodLite: '#a97445',
  kitFloor: '#3d2a20', kitFloorLite: '#4a342a',
  checkA: '#f0d9a8', checkB: '#dca96f',
  green: '#4f8a3d',
};
const px = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };

// ---------- 墙面：菜单板 + 招牌 + 取餐台指示 ----------
function drawWall() {
  px(0, 0, W, KIT_TOP, P.wall);
  for (let x = 0; x < W; x += 16) px(x, 0, 1, KIT_TOP, 'rgba(160,120,70,.18)');
  px(0, 0, W, 3, P.wallDark);

  // 左右彩色墙板
  px(0, 3, 7, KIT_TOP - 3, P.red);
  px(0, 3, 7, 6, P.redDark);
  px(233, 3, 7, KIT_TOP - 3, P.blue);
  px(233, 3, 7, 6, '#1d4f9e');

  // 吊灯两盏
  for (const lx of [50, 188]) {
    px(lx - 1, 6, 2, 8, '#6b5a3e');
    px(lx - 6, 14, 12, 7, '#3a3f41');
    px(lx - 4, 15, 8, 4, '#ffd98a');
    px(lx - 2, 21, 4, 3, 'rgba(255,220,140,.35)');
  }

  // 左：金色拱门 LOGO 牌
  px(8, 34, 26, 32, P.ink);
  px(10, 36, 22, 28, '#3a2415');
  ctx.fillStyle = P.yellow;
  for (const ax of [16, 25]) {
    ctx.beginPath();
    ctx.arc(ax, 51, 5.5, Math.PI, 0);
    ctx.lineTo(ax + 5.5, 59); ctx.lineTo(ax + 2, 59); ctx.lineTo(ax + 2, 51);
    ctx.lineTo(ax - 2, 51); ctx.lineTo(ax - 2, 59); ctx.lineTo(ax - 5.5, 59);
    ctx.closePath(); ctx.fill();
  }

  // 右：取餐台指示红牌
  px(206, 36, 28, 16, P.red);
  px(207, 37, 26, 14, '#e8564a');
  ctx.fillStyle = '#fff'; ctx.font = 'bold 7px sans-serif';
  ctx.fillText('取餐台', 210, 46);
  ctx.fillText('→', 222, 46);

  // 中：菜单板（四个商品卡）
  const m = MENU;
  px(m.x - 2, m.y - 2, m.w + 4, m.h + 4, P.ink);
  px(m.x, m.y, m.w, m.h, '#fff6e6');
  px(m.x, m.y, m.w, 5, P.red);
  px(m.x + 3, m.y + 1, 2, 2, P.yellow); px(m.x + 7, m.y + 1, 2, 2, P.yellow); px(m.x + 11, m.y + 1, 2, 2, P.yellow);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 4px sans-serif';
  ctx.fillText("MCDONALD'S MENU", m.x + m.w - 52, m.y + 4);
  const cards = [
    { label: '汉堡', color: '#e8564a' }, { label: '薯条', color: '#f0a71c' },
    { label: '饮料', color: '#4aa8f0' }, { label: '甜品', color: '#b882f8' },
  ];
  cards.forEach((c, i) => {
    const cx = m.x + 2 + i * (m.w - 4) / 4, cw = (m.w - 4) / 4 - 2;
    px(cx, m.y + 6, cw, m.h - 8, '#fffdf3');
    px(cx, m.y + 6, cw, 3, c.color);
    drawFoodIcon(i, cx + cw / 2, m.y + 18);
    ctx.fillStyle = '#5a3a1a'; ctx.font = 'bold 5px sans-serif';
    ctx.fillText(c.label, cx + cw / 2 - 5, m.y + 29);
  });

  // 后厨挡板（开放式后厨的上沿）
  px(0, KIT_TOP, W, 3, P.steelDark);
  px(0, KIT_TOP + 3, W, 1, '#6e7679');
}

// 四枚像素小食图标
function drawFoodIcon(i, cx, cy) {
  if (i === 0) { // 汉堡
    px(cx - 7, cy - 3, 14, 3, '#f0a71c');
    px(cx - 8, cy, 16, 2, '#4f8a3d');
    px(cx - 7, cy + 2, 14, 3, '#8a5a33');
    px(cx - 8, cy + 5, 16, 2, '#f0a71c');
  } else if (i === 1) { // 薯条
    px(cx - 5, cy + 1, 10, 6, '#e8564a');
    for (let k = 0; k < 4; k++) px(cx - 4 + k * 2.6, cy - 4, 2, 5, '#ffd867');
  } else if (i === 2) { // 可乐
    px(cx - 4, cy - 4, 8, 11, '#e02b20');
    px(cx - 3, cy - 2, 6, 3, '#fff');
    px(cx + 1, cy - 7, 2, 4, '#fff');
    px(cx - 4, cy + 7, 8, 2, '#b96f00');
  } else { // 甜筒
    px(cx - 3, cy + 1, 6, 6, '#d8a35c');
    px(cx - 4, cy - 3, 8, 5, '#fff6e6');
    px(cx - 3, cy - 5, 6, 2, '#e8564a');
  }
}

// ---------- 后厨：设备背景 ----------
function drawKitchen() {
  // 地面 + 墙
  px(0, KIT_TOP + 4, W, KIT_BOT - KIT_TOP - 4, P.kitFloor);
  for (let y = KIT_TOP + 10; y < KIT_BOT; y += 10) px(0, y, W, 1, P.kitFloorLite);
  // 抽油烟机
  px(14, KIT_TOP + 4, 60, 14, P.steelDark);
  px(16, KIT_TOP + 6, 56, 3, P.steelLite);
  px(18, KIT_TOP + 12, 52, 5, '#6e7679');
  for (let x = 20; x < 70; x += 8) px(x, KIT_TOP + 13, 5, 3, '#9aa5aa');
  // 右：保温柜 + 饮料机
  px(96, KIT_TOP + 4, 34, 26, P.steel);
  px(98, KIT_TOP + 6, 30, 10, '#f6e7cf');
  for (let i = 0; i < 3; i++) px(100 + i * 10, KIT_TOP + 7, 8, 8, '#e8d6ae');
  px(98, KIT_TOP + 18, 30, 8, '#cbb08a');
  px(140, KIT_TOP + 4, 30, 30, P.red);
  px(142, KIT_TOP + 6, 26, 8, '#f6e7cf');
  for (let i = 0; i < 3; i++) px(145 + i * 8, KIT_TOP + 7, 6, 6, '#cbb08a');
  px(142, KIT_TOP + 16, 26, 14, P.redDark);
  // 煎台（左）
  px(6, KIT_BOT - 16, 46, 6, '#3a3f41');
  px(8, KIT_BOT - 18, 42, 2, '#565c5f');
  const hot = status === 'placed' || status === 'preparing';
  for (let i = 0; i < 3; i++) {
    px(10 + i * 13, KIT_BOT - 17, 10, 2, hot ? '#c9552e' : '#7a4a34');
    if (hot && Math.sin(T * 6 + i) > 0) px(12 + i * 13, KIT_BOT - 19, 6, 1, '#ffd88a');
  }
  // 炸炉（中）
  px(60, KIT_BOT - 12, 26, 5, '#4a4a4a');
  for (let k = 0; k < 4; k++) {
    const j = hot ? Math.round(Math.abs(Math.sin(T * 5 + k)) * 2) : 0;
    px(62 + k * 6, KIT_BOT - 15 + j, 4, 4, '#f2c94c');
  }
  // 出餐屏（取餐号）
  px(180, KIT_TOP + 6, 34, 12, P.ink);
  px(182, KIT_TOP + 8, 30, 8, '#1a1a14');
  const ready = status === 'ready' || status === 'dining';
  ctx.fillStyle = ready ? '#d8f089' : (hot ? '#c9d67a' : '#5f6b3a');
  ctx.font = 'bold 6px monospace';
  ctx.fillText(ready ? `No.${ticket?.pickupNo || '888'}` : (hot ? 'PREP..' : '- - -'), 186, KIT_TOP + 15);
}

// ---------- 柜台 ----------
function drawCounter() {
  // 台面
  px(0, CNT_TOP, W, 5, P.steelLite);
  px(0, CNT_TOP, W, 2, '#eef2f3');
  px(0, CNT_TOP + 4, W, 1, P.steel);
  // 台面小食
  for (let i = 0; i < 3; i++) {
    const bx = 26 + i * 22;
    px(bx, CNT_TOP - 4, 9, 4, '#e8564a');
    px(bx + 1, CNT_TOP - 6, 7, 2, '#ffd867');
  }
  px(120, CNT_TOP - 5, 8, 5, '#fff');
  px(122, CNT_TOP - 7, 4, 2, '#e02b20');
  px(134, CNT_TOP - 4, 12, 4, '#8b969c'); // 收银机
  px(136, CNT_TOP - 7, 8, 3, '#3a3f41');
  // 柜台正面：奶白面板 + 红腰线 + 金色拱门
  px(0, CNT_TOP + 5, W, CNT_BASE - CNT_TOP - 5, '#f6e7cf');
  px(0, CNT_TOP + 5, W, 2, '#fffdf3');
  px(0, CNT_TOP + 12, W, 12, P.red);
  ctx.fillStyle = P.yellow;
  for (const ax of [108, 128]) {
    ctx.beginPath();
    ctx.arc(ax, CNT_TOP + 16, 4.5, Math.PI, 0);
    ctx.lineTo(ax + 4.5, CNT_TOP + 22); ctx.lineTo(ax + 1.5, CNT_TOP + 22); ctx.lineTo(ax + 1.5, CNT_TOP + 16);
    ctx.lineTo(ax - 1.5, CNT_TOP + 16); ctx.lineTo(ax - 1.5, CNT_TOP + 22); ctx.lineTo(ax - 4.5, CNT_TOP + 22);
    ctx.closePath(); ctx.fill();
  }
  px(0, CNT_TOP + 24, W, 3, '#e8d6ae');
  px(0, CNT_BASE - 2, W, 2, P.woodDark);
  // 取餐口示意（右侧台面立牌）
  const ready = status === 'ready';
  px(206, CNT_TOP - 12, 26, 12, ready ? P.yellow : '#e8d6ae');
  px(208, CNT_TOP - 10, 22, 8, ready ? '#fff3c4' : '#d8c08a');
  ctx.fillStyle = '#5a2600'; ctx.font = 'bold 6px sans-serif';
  ctx.fillText(ready ? '取餐!' : '等餐', 212, CNT_TOP - 4);
}

// ---------- 餐厅区 ----------
function drawDiningFloor() {
  const y0 = DINING_TOP, y1 = H;
  if (y1 - y0 < 8) return;
  px(0, y0, W, y1 - y0, P.checkA);
  const cell = 9;
  for (let y = y0, r = 0; y < y1; y += cell, r++) {
    for (let x = (r % 2 ? 0 : cell); x < W; x += cell * 2) px(x, y, cell, cell, P.checkB);
  }
  px(0, y0, W, 2, P.woodDark);
  px(0, y0 + 2, W, 1, P.woodLite);
  // 底部踢脚线，收住地板
  px(0, y1 - 7, W, 7, '#8a5a33');
  px(0, y1 - 7, W, 2, '#a97445');
  px(0, y1 - 2, W, 2, '#5b3a29');
}

function drawTable(tb, i) {
  const s = tb.big ? 1 : 0.68;                 // 小一号的后排桌
  const hw = Math.round(23 * s);               // 桌半宽
  px(tb.x - hw - 4, tb.y - 8 * s, 10 * s, 11 * s, P.wood);
  px(tb.x - hw - 4, tb.y - 10 * s, 10 * s, 3 * s, P.woodLite);
  px(tb.x + hw - 6, tb.y - 8 * s, 10 * s, 11 * s, P.wood);
  px(tb.x + hw - 6, tb.y - 10 * s, 10 * s, 3 * s, P.woodLite);
  // 桌面
  px(tb.x - hw, tb.y - 10 * s, hw * 2, 3 * s, '#f2cea1');
  px(tb.x - hw - 3, tb.y - 7 * s, hw * 2 + 6, 7 * s, '#e8bd85');
  px(tb.x - hw + 4, tb.y, (hw - 4) * 2, 2 * s, '#b1845a');
  px(tb.x - 3, tb.y + 1, 6, 7 * s, P.woodDark);
  px(tb.x - 13, tb.y + 8 * s, 26 * s, 2, 'rgba(60,36,18,.16)');
  if (tb.big) px(tb.x + 4, tb.y - 13, 5, 3, P.yellow);
  // 桌上的餐
  if ((status === 'dining' || status === 'ready') && tb.big) {
    px(tb.x - 13, tb.y - 12, 26, 3, '#3a3f41');
    px(tb.x - 11, tb.y - 16, 8, 4, '#c98a3c');
    px(tb.x - 10, tb.y - 18, 6, 2, P.yellow);
    px(tb.x + 1, tb.y - 15, 4, 5, P.red);
    px(tb.x + 8, tb.y - 13, 5, 4, '#f9df8a');
    if (Math.sin(T * 3 + i) > 0.2) { px(tb.x - 9, tb.y - 22, 2, 2, '#fff6df'); px(tb.x - 2, tb.y - 24, 2, 2, '#fff6df'); }
  }
}

function drawProps() {
  const base = H - 8;
  // 绿植
  px(8, base - 10, 12, 10, '#b5764a');
  px(7, base - 11, 14, 3, '#c98a5e');
  px(11, base - 22, 8, 12, P.green);
  px(8, base - 18, 6, 7, '#5f9c48');
  px(15, base - 16, 6, 6, '#3f7531');
  // 垃圾桶
  px(222, base - 10, 13, 11, '#6e7679');
  px(221, base - 12, 15, 4, '#8b969c');
  px(225, base - 5, 7, 4, '#3a3f41');
}

// ---------- 蒸汽 ----------
function drawSteam() {
  if (status !== 'preparing' && status !== 'placed') return;
  for (let i = 0; i < 4; i++) {
    const life = (T * 0.4 + i * 0.25) % 1;
    const x = 16 + i * 14 + Math.sin(T * 2 + i) * 2;
    const y = KIT_BOT - 22 - life * 16;
    ctx.fillStyle = `rgba(255,255,255,${0.4 * (1 - life)})`;
    ctx.fillRect(Math.round(x), Math.round(y), 3, 3);
  }
}

// ---------- 自适应 ----------
function layout() {
  const wrap = cv.parentElement;
  const wpx = wrap.clientWidth || 240;
  const hpx = wrap.clientHeight || 280;
  H = Math.max(240, Math.min(430, Math.round(W * (hpx / wpx))));
  cv.width = W; cv.height = H;
  ctx.imageSmoothingEnabled = false;
  DINING_TOP = CNT_BASE;
  tableY = Math.min(DINING_TOP + 44, H - 16);
  const had = people.length > 0;
  if (!had) assignPeople();
  else {
    guests.forEach((g) => { if (g.seat) g.seat.y = tableY + 10; });
    onStatus(status);
  }
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
  updateCrew(dt);
  updateGuests(dt);

  ctx.clearRect(0, 0, W, H);
  drawWall();
  drawKitchen();

  // 店员（后厨内，按 y 排序）
  [...crew].sort((a, b) => a.y - b.y).forEach((p) => {
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.fillRect(Math.round(p.x) - 7, Math.round(p.y) - 2, 14, 2);
    drawChar(p.char, p.dir, p.x, p.y, p.bob);
  });

  drawCounter();
  drawDiningFloor();

  // 顾客先画，桌椅家具盖上大腿，像坐着
  guests.forEach((g) => {
    if (g.state === 'out') return;
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.fillRect(Math.round(g.x) - 7, Math.round(g.y) - 2, 14, 2);
    drawChar(g.char, g.dir, g.x, g.y, g.bob);
  });
  tables().forEach(drawTable);
  drawProps();
  drawSteam();

  requestAnimationFrame(frame);
}

layout();
addEventListener('resize', () => layout());
requestAnimationFrame(frame);
