"""Signs drawn the way the original game's are (CoreTexMisc stopscrtyarea, DangerHighVolt, DangerNOsmoke_A,
RestRoomSign_A; HK_Signs): real-world sign layouts (an ANSI header band, a red STOP plate, yellow caution),
a condensed grotesque in capitals (the game's Helvetica: Arial Narrow Bold / Franklin Gothic here), enamel
or painted metal that has lived a little (grain, grime toward the bottom, chipped edges, worn ink) and
screws in the corners. Hong Kong's signs are bilingual, with the Chinese under the English.

    plate(path, (256, 128), 'notice', [Line('FREIGHT LIFT', .34), Line('ROOF ACCESS', .16)], header='caution')

The picture is drawn 4 times bigger and scaled down (clean edges at 64-512 pixels), then saved as a
256-colour .pcx. Fonts missing on a PC fall back to Arial Bold, then to PIL's own."""
import os
import random
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

FONT_DIR = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts'
FONTS = {
    'narrow': ['ARIALNB.TTF', 'FRADMCN.TTF', 'arialbd.ttf'],      # the game's condensed capitals
    'bold': ['arialbd.ttf'],                                      # STOP, DANGER, header words
    'demi': ['FRADMCN.TTF', 'ARIALNB.TTF', 'arialbd.ttf'],        # Franklin Gothic Demi Condensed
    'heavy': ['FRAHV.TTF', 'arialbd.ttf'],                        # labels, numbers
    'stencil': ['STENCIL.TTF', 'FRAHV.TTF', 'arialbd.ttf'],       # painted on containers and crates
    'cjk': ['msjhbd.ttc', 'msyhbd.ttc', 'mingliub.ttc'],          # traditional Chinese (Hong Kong)
}
SS = 4                                                            # drawn at 4x, scaled down at the end

# plate colours: (background, ink, rule); the rule is the thin line inset from the edge
STYLES = {
    'notice': ((222, 220, 210), (22, 22, 24), (40, 40, 42)),      # white enamel, black capitals
    'unatco': ((28, 47, 84), (236, 238, 240), (200, 206, 214)),   # UNATCO blue
    'stop': ((168, 24, 28), (240, 236, 232), (236, 228, 224)),    # stopscrtyarea
    'caution': ((222, 178, 32), (18, 18, 18), (18, 18, 18)),      # DangerHighVolt's yellow
    'metal': ((112, 116, 116), (230, 226, 210), (60, 62, 62)),    # painted grey steel
    'paper': ((228, 222, 202), (24, 24, 26), None),               # a shipping label
}
HEADERS = {                       # ANSI-like bands: (band colour, word colour, word, oval colour or None)
    'danger': ((16, 16, 16), (244, 244, 244), 'DANGER', (178, 26, 30)),
    'caution': ((222, 178, 32), (16, 16, 16), 'CAUTION', None),
    'notice': ((26, 66, 140), (244, 244, 244), 'NOTICE', None),
    'restricted': ((168, 24, 28), (244, 240, 236), 'RESTRICTED AREA', None),
    'unatco': ((28, 47, 84), (236, 238, 240), 'UNATCO', None),
}


@dataclass
class Line:
    text: str
    height: float = .25            # share of the body's height (the text is made smaller to fit the width)
    font: str = 'narrow'
    colour: tuple = None           # the style's ink when None


def font(kind, px):
    for name in FONTS.get(kind, []) + ['arialbd.ttf']:
        p = FONT_DIR / name
        if p.exists():
            return ImageFont.truetype(str(p), max(4, int(px)))
    return ImageFont.load_default()


def _fit(d, text, kind, px, width):
    """The font at px, made smaller until the text is no wider than width."""
    f = font(kind, px)
    while px > 6 and d.textlength(text, font=f) > width:
        px -= max(1, px // 24)
        f = font(kind, px)
    return f


def _grain(size, rnd, amount):
    """Fine grain and broad blotches of grime, 128 = no change (for ImageChops)."""
    w, h = size
    fine = Image.effect_noise((w, h), 9 * amount + 1).point(lambda v: 128 + (v - 128) * .35)
    small = Image.effect_noise((max(2, w // 48), max(2, h // 48)), 40 * amount + 1)
    broad = small.resize((w, h), Image.BICUBIC).filter(ImageFilter.GaussianBlur(w / 90)).point(lambda v: 128 + (v - 128) * .6)
    return Image.blend(fine, broad, .5)


def _wear(im, rnd, amount):
    """The plate after some years: grain, grime gathering low and at the edges, scratches, chips."""
    w, h = im.size
    g = _grain(im.size, rnd, amount).convert('RGB')
    im = ImageChops.overlay(im, g)
    # darker toward the bottom and the rim (dust, hands, rain)
    shade = Image.new('L', (w, h), 255)
    sd = ImageDraw.Draw(shade)
    for i in range(24):
        k = i / 24
        sd.rectangle((k * w * .04, k * h * .08, w - k * w * .04, h - k * h * .08), fill=int(200 + 55 * k ** .5))
    low = Image.linear_gradient('L').resize((w, h)).point(lambda v: 255 - int(v * .16 * amount))
    shade = ImageChops.multiply(shade.filter(ImageFilter.GaussianBlur(w / 60)), low)
    im = ImageChops.multiply(im, Image.merge('RGB', [shade] * 3))
    marks = im.copy()
    d = ImageDraw.Draw(marks)
    for _ in range(int(6 * amount)):                          # a few faint scratches
        x, y = rnd.uniform(0, w), rnd.uniform(0, h)
        a, length = rnd.uniform(-.25, .25), rnd.uniform(.03, .1) * w
        d.line((x, y, x + length, y + a * length), fill=(205, 205, 198), width=max(1, SS // 2))
    for _ in range(int(5 * amount)):                          # small chips at the very edge, darker paint
        side = rnd.choice('tblr')
        x = rnd.uniform(0, w) if side in 'tb' else (0 if side == 'l' else w)
        y = rnd.uniform(0, h) if side in 'lr' else (0 if side == 't' else h)
        r = rnd.uniform(.5, 1.2) * SS * 1.5
        c = im.getpixel((min(w - 1, int(x)), min(h - 1, int(y))))
        d.ellipse((x - r * 1.5, y - r, x + r * 1.5, y + r), fill=tuple(int(v * .55) for v in c))
    return Image.blend(im, marks, .45)


def _ink(im, mask, colour, rnd, amount):
    """Paint colour through mask, the ink a little worn (speckles where it has flaked)."""
    if amount > 0:                 # flakes in small clumps, not a sandy speckle
        w, h = mask.size
        small = Image.effect_noise((max(2, w // (SS * 2)), max(2, h // (SS * 2))), 60)
        holes = small.resize((w, h), Image.BICUBIC).point(lambda v: 0 if v > 255 - 20 * amount else 255)
        mask = ImageChops.multiply(mask, holes.filter(ImageFilter.GaussianBlur(SS * .6)))
    im.paste(Image.new('RGB', im.size, colour), (0, 0), mask)


def _screws(d, w, h, r):
    for x, y in ((r * 2.2, r * 2.2), (w - r * 2.2, r * 2.2), (r * 2.2, h - r * 2.2), (w - r * 2.2, h - r * 2.2)):
        d.ellipse((x - r * 1.25, y - r * 1.25, x + r * 1.25, y + r * 1.25), fill=(40, 40, 40))
        d.ellipse((x - r, y - r, x + r, y + r), fill=(150, 150, 146))
        d.ellipse((x - r * .55, y - r * .7, x + r * .25, y - r * .1), fill=(196, 196, 190))
        d.line((x - r * .8, y + r * .3, x + r * .8, y - r * .3), fill=(54, 54, 54), width=max(1, int(r / 3)))


def _header(im, kind, box, rnd, wear):
    band, word_colour, word, oval = HEADERS[kind]
    x0, y0, x1, y1 = box
    d = ImageDraw.Draw(im)
    d.rectangle(box, fill=band)
    bh = y1 - y0
    mask = Image.new('L', im.size, 0)
    md = ImageDraw.Draw(mask)
    if oval:                       # DANGER: a red oval with a thin white ring, the word in it
        f = _fit(md, word, 'bold', bh * .62, (x1 - x0) * .5)
        tw = md.textlength(word, font=f)
        ow, oh = tw * 1.32, bh * .8
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        d.ellipse((cx - ow / 2 - SS * 2, cy - oh / 2 - SS * 2, cx + ow / 2 + SS * 2, cy + oh / 2 + SS * 2), fill=(236, 236, 236))
        d.ellipse((cx - ow / 2, cy - oh / 2, cx + ow / 2, cy + oh / 2), fill=oval)
        md.text((cx, cy), word, font=f, fill=255, anchor='mm')
    else:
        f = _fit(md, word, 'bold', bh * .66, (x1 - x0) * .86)
        md.text(((x0 + x1) / 2, (y0 + y1) / 2), word, font=f, fill=255, anchor='mm')
    _ink(im, mask, word_colour, rnd, wear * .6)


def plate(path, size, style, lines, header=None, header_size=.3, screws=True, rule=True, wear=.6, seed=0,
          align='center', barcode=False, picture=None):
    """A sign texture: size (w, h) in texture pixels, style from STYLES, lines = [Line], header = a key of
    HEADERS. picture = an image to paint on instead of a plain plate (a container's end). Returns path."""
    rnd = random.Random(f'{Path(path).stem}{seed}')
    w, h = size[0] * SS, size[1] * SS
    bg, ink, rule_colour = STYLES[style]
    im = picture.convert('RGB').resize((w, h), Image.BICUBIC) if picture is not None else Image.new('RGB', (w, h), bg)
    margin = min(w, h) * .07
    top, bottom = 0, h
    if header:
        hb = (0, 0, w, h * header_size)
        _header(im, header, hb, rnd, wear)
        top = hb[3]
    d = ImageDraw.Draw(im)
    sr = max(SS * 1.6, min(w, h) * .035)          # the screws' radius: the rule runs inside them
    if rule and rule_colour and not header:      # a header band is the frame of an ANSI sign
        lw = max(SS, int(min(w, h) * .018))
        m = sr * (4.6 if screws and style != 'paper' else 1.8)
        d.rectangle((m, max(m, top + m * .6), w - m, h - m), outline=rule_colour, width=lw)
        margin += m * .7
    if barcode:                    # a shipping label's code along the bottom
        bx, by, bw = margin + w * .02, h - margin - h * .16, w * .42
        x = bx
        while x < bx + bw:
            t = rnd.choice((1, 1, 2, 3)) * SS
            d.rectangle((x, by, x + t, by + h * .13), fill=ink)
            x += t + rnd.choice((1, 2, 2, 3)) * SS
        bottom = by - h * .02
    # the lines: their heights shared out over the body, each made to fit the width
    mask = Image.new('L', (w, h), 0)
    md = ImageDraw.Draw(mask)
    if header and screws and style != 'paper':
        margin = sr * 3.2                    # the text stays clear of the lower screws
    body_top = top + (h * .06 if header else margin)
    body_h = bottom - body_top - (margin if not barcode else 0)
    total = sum(l.height for l in lines) or 1
    scale = min(1, 1 / total)
    used = sum(l.height * scale for l in lines) * body_h
    y = body_top + (body_h - used) / 2
    width = w - 2 * margin - w * .03
    colours = []
    for l in lines:
        lh = l.height * scale * body_h
        f = _fit(md, l.text, l.font, lh * (.86 if l.font != 'cjk' else .78), width)
        x = {'center': w / 2, 'left': margin + w * .02, 'right': w - margin - w * .02}[align]
        anchor = {'center': 'mm', 'left': 'lm', 'right': 'rm'}[align]
        if l.colour and l.colour != ink:
            colours.append((l, f, x, y + lh / 2, anchor))
        else:
            md.text((x, y + lh / 2), l.text, font=f, fill=255, anchor=anchor)
        y += lh
    _ink(im, mask, ink, rnd, wear)
    for l, f, x, cy, anchor in colours:
        m2 = Image.new('L', (w, h), 0)
        ImageDraw.Draw(m2).text((x, cy), l.text, font=f, fill=255, anchor=anchor)
        _ink(im, m2, l.colour, rnd, wear)
    if wear and style != 'paper':
        im = _wear(im, rnd, wear)
    elif wear:                     # paper: grain and a little foxing, no scratches
        im = ImageChops.overlay(im, _grain(im.size, rnd, wear * .6).convert('RGB'))
    if screws and style != 'paper':
        _screws(ImageDraw.Draw(im), w, h, sr)
    out = im.resize(size, Image.LANCZOS)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    out.convert('P', palette=Image.Palette.ADAPTIVE, colors=256).save(path)
    return Path(path)
