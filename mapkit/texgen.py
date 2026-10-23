"""Procedural textures for maps (8-bit PCX, imported into the map package at build time).

Night facades for the city: dark walls with stains and slab lines, framed windows (mullions,
transoms), lit interiors with gradients, curtains, blinds and furniture shadows, AC units,
balcony rails. Meant for Unlit surfaces: the texture is the light.
Colour quantisation to 256 colours goes through ffmpeg (palettegen/paletteuse).
"""
import random
import shutil
import subprocess
from pathlib import Path

OUT = Path(__file__).resolve().parent / 'gen'
FF = shutil.which('ffmpeg') or r'C:\Program Files (x86)\ffmpeg\bin\ffmpeg.exe'


def clamp(v):
    return 0 if v < 0 else 255 if v > 255 else int(v)


class Img:
    def __init__(self, w, h, colour=(0, 0, 0)):
        self.w, self.h = w, h
        self.px = [bytearray(bytes(colour) * w) for _ in range(h)]

    def get(self, x, y):
        r = self.px[y]
        return r[x * 3], r[x * 3 + 1], r[x * 3 + 2]

    def set(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            r = self.px[y]
            r[x * 3], r[x * 3 + 1], r[x * 3 + 2] = clamp(c[0]), clamp(c[1]), clamp(c[2])

    def rect(self, x0, y0, x1, y1, c):
        x0, y0, x1, y1 = max(0, int(x0)), max(0, int(y0)), min(self.w, int(x1)), min(self.h, int(y1))
        if x1 <= x0:
            return
        seg = bytes((clamp(c[0]), clamp(c[1]), clamp(c[2]))) * (x1 - x0)
        for y in range(y0, y1):
            self.px[y][x0 * 3:x1 * 3] = seg

    def shade(self, x0, y0, x1, y1, k, add=(0, 0, 0)):
        for y in range(max(0, int(y0)), min(self.h, int(y1))):
            r = self.px[y]
            for x in range(max(0, int(x0)), min(self.w, int(x1))):
                i = x * 3
                r[i] = clamp(r[i] * k + add[0])
                r[i + 1] = clamp(r[i + 1] * k + add[1])
                r[i + 2] = clamp(r[i + 2] * k + add[2])

    def noise(self, amount, rnd):
        for y in range(self.h):
            r = self.px[y]
            for i in range(0, self.w * 3, 3):
                j = rnd.randint(-amount, amount)
                r[i] = clamp(r[i] + j)
                r[i + 1] = clamp(r[i + 1] + j)
                r[i + 2] = clamp(r[i + 2] + j)

    def save_pcx(self, path, dither='bayer:bayer_scale=3'):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        raw = path.with_suffix('.rgb')
        raw.write_bytes(b''.join(bytes(r) for r in self.px))
        subprocess.run([FF, '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '%dx%d' % (self.w, self.h),
                        '-i', str(raw), '-filter_complex',
                        '[0]split[a][b];[a]palettegen=max_colors=256:reserve_transparent=0[p];[b][p]paletteuse=dither=%s'
                        % dither, '-c:v', 'pcx', '-pix_fmt', 'pal8', str(path)], check=True)
        raw.unlink()
        return path


WARM = [(255, 196, 120), (250, 180, 100), (255, 214, 150), (238, 160, 92), (255, 228, 178), (255, 200, 140)]
COOL = [(186, 214, 250), (206, 228, 255), (160, 196, 236), (228, 240, 255)]
FLUO = [(214, 236, 230), (200, 226, 236), (232, 244, 236)]
TV = [(110, 140, 230), (90, 170, 210), (150, 120, 220)]
CURTAIN = [(180, 70, 60), (90, 120, 80), (200, 170, 120), (80, 90, 150), (170, 150, 160)]


def facade(name, w=512, h=1024, cols=8, floors=12, wall=(30, 30, 36), lit=0.3, warm=0.8, seed=1,
           style='residential', ac=0.35, balcony=0.2):
    """A night facade module of `floors` storeys x `cols` windows (seamless tile)."""
    rnd = random.Random(seed)
    img = Img(w, h, wall)
    img.noise(5, rnd)
    fh = h / floors
    cw = w / cols
    # rain streaks
    for _ in range(int(w * 0.6)):
        x = rnd.randrange(w)
        y0 = rnd.randrange(h)
        ln = rnd.randint(8, int(fh * 1.5))
        k = rnd.uniform(0.82, 0.94)
        img.shade(x, y0, x + 1, y0 + ln, k)
    for f in range(floors):
        y = f * fh
        # slab: a lighter band with a shadow below
        img.shade(0, y, w, y + max(3, fh * 0.06), 1.25, (6, 6, 7))
        img.shade(0, y + max(3, fh * 0.06), w, y + max(5, fh * 0.09), 0.7)
        for c in range(cols):
            x0 = c * cw
            if style == 'office':
                wx0, wx1, wy0, wy1 = x0 + cw * 0.04, x0 + cw * 0.96, y + fh * 0.16, y + fh * 0.9
            elif style == 'tower':
                wx0, wx1, wy0, wy1 = x0 + cw * 0.08, x0 + cw * 0.92, y + fh * 0.14, y + fh * 0.88
            else:
                wx0, wx1, wy0, wy1 = x0 + cw * 0.2, x0 + cw * 0.8, y + fh * 0.24, y + fh * 0.8
            frame = (12, 12, 15)
            img.rect(wx0 - 2, wy0 - 2, wx1 + 2, wy1 + 2, frame)
            on = rnd.random() < lit
            if on:
                pool = WARM if rnd.random() < warm else (FLUO if style == 'office' else COOL)
                base = rnd.choice(pool)
                if rnd.random() < 0.06:
                    base = rnd.choice(TV)
                k = rnd.uniform(0.45, 0.95)
                base = tuple(v * k for v in base)
                for yy in range(int(wy0), int(wy1)):
                    t = (yy - wy0) / max(1.0, wy1 - wy0)
                    g = 1.12 - 0.42 * t
                    img.rect(wx0, yy, wx1, yy + 1, tuple(v * g for v in base))
                # furniture / people shadows in the lower part
                for _ in range(rnd.randint(0, 2)):
                    fx = rnd.uniform(wx0, wx1 - 6)
                    fw = rnd.uniform(4, (wx1 - wx0) * 0.4)
                    fy = rnd.uniform(wy0 + (wy1 - wy0) * 0.45, wy1 - 4)
                    img.shade(fx, fy, fx + fw, wy1, 0.35)
                r = rnd.random()
                if style == 'residential' and r < 0.45:
                    cc = rnd.choice(CURTAIN)
                    cut = rnd.uniform(0.15, 0.4) * (wx1 - wx0)
                    side = rnd.random() < 0.5
                    cx0, cx1 = (wx0, wx0 + cut) if side else (wx1 - cut, wx1)
                    img.rect(cx0, wy0, cx1, wy1, tuple(cc[i] * k * 0.55 for i in range(3)))
                elif r < (0.75 if style == 'office' else 0.6):
                    for yy in range(int(wy0), int(wy1), 3):
                        img.shade(wx0, yy, wx1, yy + 1, 0.6)
            else:
                g = rnd.randint(8, 16)
                for yy in range(int(wy0), int(wy1)):
                    t = (yy - wy0) / max(1.0, wy1 - wy0)
                    img.rect(wx0, yy, wx1, yy + 1, (g + 10 * (1 - t), g + 12 * (1 - t), g + 20 * (1 - t)))
                if style in ('office', 'tower') and rnd.random() < 0.3:
                    img.rect(wx0, wy1 - (wy1 - wy0) * 0.25, wx1, wy1, (34, 40, 52))
            # mullions and transom
            if style == 'residential':
                img.rect((wx0 + wx1) / 2 - 1, wy0, (wx0 + wx1) / 2 + 1, wy1, frame)
                img.rect(wx0, wy0 + (wy1 - wy0) * 0.32, wx1, wy0 + (wy1 - wy0) * 0.32 + 2, frame)
            else:
                for m in range(1, 3):
                    mx = wx0 + (wx1 - wx0) * m / 3
                    img.rect(mx - 1, wy0, mx + 1, wy1, frame)
            # sill
            img.shade(wx0 - 2, wy1 + 2, wx1 + 2, wy1 + 4, 1.5, (10, 10, 10))
            if style == 'residential' and rnd.random() < ac:
                aw = cw * rnd.uniform(0.22, 0.3)
                ax = rnd.uniform(x0 + cw * 0.05, x0 + cw * 0.95 - aw)
                ay = wy1 + 6
                img.rect(ax, ay, ax + aw, ay + fh * 0.12, (64, 66, 70))
                for yy in range(int(ay + 2), int(ay + fh * 0.12 - 1), 2):
                    img.rect(ax + 2, yy, ax + aw - 2, yy + 1, (40, 42, 46))
                img.shade(ax, ay + fh * 0.12, ax + aw, ay + fh * 0.12 + 4, 0.6)
            if style == 'residential' and rnd.random() < balcony:
                by = wy1 + 3
                img.rect(x0 + 2, by - 10, x0 + cw - 2, by - 9, (55, 56, 60))
                for bx in range(int(x0 + 4), int(x0 + cw - 2), 5):
                    img.rect(bx, by - 10, bx + 1, by, (48, 49, 52))
    return img.save_pcx(OUT / (name + '.pcx'))


def solid(name, colour, w=16, h=16):
    return Img(w, h, colour).save_pcx(OUT / (name + '.pcx'), dither='none')


def gradient(name, stops, w=8, h=256):
    """Vertical gradient; stops = [(pos 0..1 from top, (r, g, b)), ...]."""
    img = Img(w, h)
    for y in range(h):
        t = y / (h - 1)
        c = stops[-1][1]
        for i in range(len(stops) - 1):
            p0, c0 = stops[i]
            p1, c1 = stops[i + 1]
            if p0 <= t <= p1:
                k = (t - p0) / (p1 - p0) if p1 > p0 else 0
                c = tuple(c0[j] + (c1[j] - c0[j]) * k for j in range(3))
                break
        img.rect(0, y, w, y + 1, c)
    return img.save_pcx(OUT / (name + '.pcx'), dither='none')


def clouds(name, w=256, h=256, seed=3, colour=(70, 60, 80)):
    """Soft, tileable cloud wisps on black (for a translucent layer)."""
    rnd = random.Random(seed)
    img = Img(w, h)
    grid = 8
    vals = [[rnd.random() for _ in range(grid)] for _ in range(grid)]

    def smooth(x, y):
        gx, gy = x * grid / w, y * grid / h
        x0, y0 = int(gx) % grid, int(gy) % grid
        x1, y1 = (x0 + 1) % grid, (y0 + 1) % grid
        fx, fy = gx - int(gx), gy - int(gy)
        fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
        a = vals[y0][x0] * (1 - fx) + vals[y0][x1] * fx
        b = vals[y1][x0] * (1 - fx) + vals[y1][x1] * fx
        return a * (1 - fy) + b * fy
    for y in range(h):
        for x in range(w):
            v = smooth(x, y) * 0.7 + smooth((x * 2) % w, (y * 2) % h) * 0.3
            v = max(0.0, (v - 0.45) / 0.55)
            img.set(x, y, tuple(c * v for c in colour))
    return img.save_pcx(OUT / (name + '.pcx'))
