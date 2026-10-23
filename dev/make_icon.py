"""DeusEdix's icon (launcher\\deusedix.ico) and the installer's small picture, drawn from the DE mark
(mapkit\\editor\\static\\deusedix-mark.svg: straight lines only, so no SVG renderer is needed)."""
import re
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parents[1]
SVG = HERE / 'mapkit' / 'editor' / 'static' / 'deusedix-mark.svg'
BG, FG = (13, 20, 32, 255), (137, 185, 232, 255)


def shapes(d):
    """Polygons of a path made of M/m H/h V/v L/l Z/z only (absolute and relative)."""
    out, pts, x, y = [], [], 0.0, 0.0
    for cmd, args in re.findall(r'([MmHhVvLlZz])([^MmHhVvLlZz]*)', d):
        nums = [float(n) for n in re.findall(r'-?\d*\.?\d+', args)]
        if cmd in 'Zz':
            if pts:
                out.append(pts)
            pts = []
            continue
        if cmd in 'Mm':
            if pts:
                out.append(pts)
            x, y = (x + nums[0], y + nums[1]) if cmd == 'm' else (nums[0], nums[1])
            pts = [(x, y)]
            nums = nums[2:]
            cmd = 'l' if cmd == 'm' else 'L'
        if cmd in 'Hh':
            for n in nums:
                x = x + n if cmd == 'h' else n
                pts.append((x, y))
        elif cmd in 'Vv':
            for n in nums:
                y = y + n if cmd == 'v' else n
                pts.append((x, y))
        elif cmd in 'Ll':
            for i in range(0, len(nums), 2):
                x, y = (x + nums[i], y + nums[i + 1]) if cmd == 'l' else (nums[i], nums[i + 1])
                pts.append((x, y))
    if pts:
        out.append(pts)
    return out


def draw(size, background=True):
    s = 8                                    # supersampling
    big = size * s
    im = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    g = ImageDraw.Draw(im)
    if background:
        g.rounded_rectangle([0, 0, big - 1, big - 1], radius=big // 6, fill=BG)
    pad = 0.12 * big
    k = (big - 2 * pad) / 48.0
    paths = re.findall(r'<path[^>]*\sd="([^"]+)"', SVG.read_text(encoding='utf-8'))
    for d in paths:
        polys = shapes(d)
        for i, poly in enumerate(polys):
            pts = [(pad + px * k, pad + py * k) for px, py in poly]
            # evenodd: the first shape of the D is the letter, the second its hole
            hole = len(polys) == 2 and i == 1 and d is paths[0]
            g.polygon(pts, fill=BG if hole and background else ((0, 0, 0, 0) if hole else FG))
    return im.resize((size, size), Image.LANCZOS)


def main():
    out = HERE / 'launcher'
    out.mkdir(exist_ok=True)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    draw(256).save(out / 'deusedix.ico', sizes=[(n, n) for n in sizes])
    draw(256).save(out / 'deusedix-256.png')
    # Inno Setup's small wizard picture (55x58 at 100%: given larger, it scales it down)
    small = Image.new('RGB', (110, 116), BG[:3])
    small.paste(draw(100), (5, 8), draw(100))
    small.save(out / 'wizard-small.bmp')
    print('icon and pictures in', out)


if __name__ == '__main__':
    main()
