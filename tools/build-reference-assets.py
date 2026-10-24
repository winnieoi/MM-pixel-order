"""Extract the supplied reference artwork without resampling its pixels."""
from pathlib import Path
import argparse
import runpy

ROOT = Path(__file__).resolve().parents[1]
codec = runpy.run_path(str(ROOT / 'tools/pngtool.py'))
read_png, write_png = codec['read_png'], codec['write_png']
parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
args = parser.parse_args()
w, h, pixels = read_png(args.source)
assert (w, h) == (940, 1672), 'Expected the original 940 × 1672 reference'
out = ROOT / 'web/assets/reference'
out.mkdir(parents=True, exist_ok=True)


def crop(name, box, patches=()):
    left, top, right, bottom = box
    width, height = right - left, bottom - top
    result = bytearray()
    for y in range(top, bottom):
        result.extend(pixels[(y * w + left) * 4:(y * w + right) * 4])
    # Copy an unlettered vertical strip across the changing text surface.
    for x1, y1, x2, y2, sample_x in patches:
        for y in range(y1, y2):
            color = pixels[(y * w + sample_x) * 4:(y * w + sample_x) * 4 + 4]
            for x in range(x1, x2):
                i = ((y - top) * width + x - left) * 4
                result[i:i + 4] = color
    if name.startswith('action'):
        pending = [(0, height - 1), (width - 1, height - 1)]
        seen = set()
        while pending:
            x, y = pending.pop()
            if (x, y) in seen or not (0 <= x < width and 0 <= y < height):
                continue
            seen.add((x, y))
            if 58 <= x < width - 58:
                continue
            i = (y * width + x) * 4
            r, g, b = result[i:i + 3]
            if max(r, g, b) > 35 or max(r, g, b) - min(r, g, b) > 13:
                continue
            result[i + 3] = 0
            pending.extend(((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))
    write_png(out / name, width, height, result)


# Continuous bands preserve all overlaps, shadows and original proportions.
crop('restaurant.png', (112, 170, 828, 1090))
crop('dialog.png', (112, 1090, 828, 1268))
crop('dialog-blank.png', (112, 1090, 828, 1268), [(330, 1180, 711, 1232, 722)])
crop('choices.png', (112, 1268, 828, 1448))
crop('action.png', (112, 1448, 828, 1578))
crop('action-blank.png', (112, 1448, 828, 1578), [(360, 1485, 606, 1537, 348), (765, 1468, 790, 1499, 763)])
crop('guide.png', (112, 1090, 330, 1268))
crop('name-tag.png', (303, 1106, 422, 1162))
crop('coin-blank.png', (195, 228, 260, 266), [(195, 228, 260, 266, 263)])
crop('badge-blank.png', (765, 1468, 790, 1499), [(765, 1468, 790, 1499, 763)])
print(f'Extracted reference artwork to {out}')
