#!/usr/bin/env python3
"""把 AI 出的 4x4 角色大图（4 角色 × 4 朝向）压成游戏用像素图集。

输入: tools/staff-source.png  1170x1114，白底，四个象限各一个角色，象限内 2x2 朝向
输出: web/assets/staff.png    4 列(角色) × 4 行(朝向) 的 RGBA 图集，格子间 1px 透明边
      tools/sprites.json      图集元信息（格子尺寸、角色名、朝向顺序）

做法: 从边缘洪水填充去掉白底（保护角色身上的米白色帽子）→ 连通域切出 16 个精灵
     → 每格按整数倍缩小到 ~44px 高（块内取最接近质心的真实像素色，保留锐利色板）
     → 底部对齐写进统一格子。
"""
import json
import os
import sys
from collections import deque

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pngtool import read_png, write_png  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools', 'staff-source.png')
OUT = os.path.join(ROOT, 'web', 'assets', 'staff.png')
META = os.path.join(ROOT, 'tools', 'sprites.json')

TARGET_H = 44      # 每格角色目标高度（原生像素）
COVERAGE = 0.45    # 块内前景占比阈值，低于则视为透明
WHITE = 244        # 背景白阈值

w, h, px = read_png(SRC)


def is_bg(i):
    o = i * 4
    return px[o] > WHITE and px[o + 1] > WHITE and px[o + 2] > WHITE


# 1) 从画布四边洪水填充白底，只吃掉与边缘连通的白色，角色身上的米白不受影响
bg = bytearray(w * h)
q = deque()
for x in range(w):
    for y in (0, h - 1):
        i = y * w + x
        if not bg[i] and is_bg(i):
            bg[i] = 1
            q.append(i)
for y in range(h):
    for x in (0, w - 1):
        i = y * w + x
        if not bg[i] and is_bg(i):
            bg[i] = 1
            q.append(i)
while q:
    i = q.popleft()
    x, y = i % w, i // w
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < w and 0 <= ny < h:
            j = ny * w + nx
            if not bg[j] and is_bg(j):
                bg[j] = 1
                q.append(j)

# 2) 连通域 = 一个角色姿势
seen = bytearray(w * h)
comps = []
for i in range(w * h):
    if bg[i] or seen[i]:
        continue
    st = [i]
    seen[i] = 1
    x0 = x1 = i % w
    y0 = y1 = i // w
    n = 0
    while st:
        c = st.pop()
        x, y = c % w, c // w
        n += 1
        x0, x1 = min(x0, x), max(x1, x)
        y0, y1 = min(y0, y), max(y1, y)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h:
                j = ny * w + nx
                if not bg[j] and not seen[j]:
                    seen[j] = 1
                    st.append(j)
    if n > 3000:
        comps.append({'x0': x0, 'y0': y0, 'x1': x1, 'y1': y1})

# 3) 定位：四大格 = 角色，格内 (行, 列) = 朝向
for c in comps:
    cx, cy = (c['x0'] + c['x1']) / 2, (c['y0'] + c['y1']) / 2
    c['char'] = (0 if cx < w / 2 else 1) + (0 if cy < h / 2 else 2)
char_order = [0, 1, 2, 3]      # 左上 / 右上 / 左下 / 右下
cards = {}
for c in comps:
    cards.setdefault(c['char'], []).append(c)
for k, g in cards.items():
    g.sort(key=lambda c: (c['y0'], c['x0']))
    if len(g) != 4:
        raise SystemExit('角色 %s 切出 %d 个姿势，应为 4' % (k, len(g)))


def downsample(c):
    x0, y0, x1, y1 = c['x0'], c['y0'], c['x1'], c['y1']
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    f = max(1, round(bh / TARGET_H))
    ow, oh = max(1, bw // f), max(1, bh // f)
    out = bytearray(ow * oh * 4)
    for oy in range(oh):
        for ox in range(ow):
            cols = []
            for yy in range(y0 + oy * f, min(y0 + (oy + 1) * f, y1 + 1)):
                for xx in range(x0 + ox * f, min(x0 + (ox + 1) * f, x1 + 1)):
                    i = yy * w + xx
                    if bg[i]:
                        continue
                    o = i * 4
                    cols.append((px[o], px[o + 1], px[o + 2]))
            need = f * f * COVERAGE
            if len(cols) < need:
                continue
            core = [k for k in cols if not (k[0] > 235 and k[1] > 235 and k[2] > 235)]
            use = core if len(core) >= need * 0.6 else cols
            mr = sum(k[0] for k in use) / len(use)
            mg = sum(k[1] for k in use) / len(use)
            mb = sum(k[2] for k in use) / len(use)
            r, g, b = min(use, key=lambda k: (k[0] - mr) ** 2 + (k[1] - mg) ** 2 + (k[2] - mb) ** 2)
            o = (oy * ow + ox) * 4
            out[o], out[o + 1], out[o + 2], out[o + 3] = r, g, b, 255
    return ow, oh, out


spr = {}
for ci, key in enumerate(char_order):
    for di, c in enumerate(cards[key]):
        spr[(ci, di)] = downsample(c)

CW = max(s[0] for s in spr.values()) + 2
CH = max(s[1] for s in spr.values()) + 2
AW, AH = CW * 4, CH * 4
atlas = bytearray(AW * AH * 4)
for (ci, di), (ow, oh, sp) in spr.items():
    ox = ci * CW + (CW - ow) // 2
    oy = di * CH + (CH - 1 - oh)      # 底部对齐
    for y in range(oh):
        for x in range(ow):
            o = (y * ow + x) * 4
            if not sp[o + 3]:
                continue
            d = ((oy + y) * AW + ox + x) * 4
            atlas[d:d + 4] = sp[o:o + 4]

write_png(OUT, AW, AH, atlas)
json.dump({
    'cell': {'w': CW, 'h': CH},
    'atlas': {'w': AW, 'h': AH},
    'dirs': ['down', 'left', 'up', 'right'],
    'chars': ['xiaomai', 'xiaoshu', 'xiaobao', 'xiaobing'],
    'source': 'tools/staff-source.png',
}, open(META, 'w'), ensure_ascii=False, indent=1)
print('atlas %dx%d cell %dx%d -> %s' % (AW, AH, CW, CH, OUT))
