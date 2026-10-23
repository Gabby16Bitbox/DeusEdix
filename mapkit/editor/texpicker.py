"""The texture picker of the editor (static/texture-picker.js): every texture of the game by package, each
with a small picture made from the player's own packages the first time its package is opened.

    index()      -> {packages: [{name, textures: [[short, full, w, h], ...]}]}   (catalog\\<pkg>.txt)
    thumbs(pkg)  -> {pkg, thumbs: {short: url}}                                  (cache\\_texthumbs\\<pkg>\\)

Nothing of the game is shipped: the indexes and the pictures are made on the player's PC (texcat.ensure_index
reads the .utx, the SDK host's UC_TEXDUMP draws the pictures), as for the Texture Editor (textures.source).
"""
import json
import re
from pathlib import Path

import data
import settings

THUMBS = data.GAME_CACHE / '_texthumbs'
SIZE = 96                       # the longest side of a picture
_PKG = re.compile(r'[A-Za-z0-9_\-]{1,64}')
_index = None


def _packages():
    """The texture packages the targeted game reads, in its order (Revision's first, then the original's)."""
    seen = {}
    for folder in settings.TEXTURE_DIRS:
        folder = Path(folder)
        if not folder.is_dir():
            continue
        for p in sorted(folder.glob('*.utx')):
            if _PKG.fullmatch(p.stem) and p.stem.lower() not in seen:
                seen[p.stem.lower()] = p.stem
    return list(seen.values())


def _read_index(pkg):
    """[(short, full, w, h)] from catalog\\<pkg>.txt ('  3  Group.Name  256x128')."""
    import texcat
    path = texcat.CATALOG / (pkg + '.txt')
    out = []
    try:
        lines = path.read_text(encoding='utf-8', errors='replace').splitlines()
    except OSError:
        return out
    for line in lines:
        parts = line.split()
        if len(parts) < 3 or 'x' not in parts[2]:
            continue
        group_name = parts[1]
        group, _, name = group_name.rpartition('.')
        if not name or not re.fullmatch(r'\w+', name):
            continue
        try:
            w, h = (int(float(v)) for v in parts[2].split('x')[:2])
        except ValueError:
            continue
        full = '%s.%s.%s' % (pkg, group, name) if group else '%s.%s' % (pkg, name)
        out.append((name, full, w, h))
    return out


def index():
    global _index
    if _index is None:
        import texcat
        names = _packages()
        texcat.ensure_index(names)           # the packages with no index yet (read from the .utx, no host)
        _index = [dict(name=n, textures=[list(t) for t in _read_index(n)]) for n in names]
        _index = [p for p in _index if p['textures']]
    return dict(packages=_index)


def thumbs(pkg):
    """The pictures of a package's textures (made once, in one SDK session for the missing ones)."""
    if not isinstance(pkg, str) or not _PKG.fullmatch(pkg):
        raise ValueError('Invalid texture package.')
    entry = next((p for p in index()['packages'] if p['name'].lower() == pkg.lower()), None)
    if entry is None:
        raise ValueError('The game has no texture package %s.' % pkg)
    pkg = entry['name']
    folder = THUMBS / pkg
    folder.mkdir(parents=True, exist_ok=True)
    failed_file = folder / '_unreadable.json'
    try:
        failed = set(json.loads(failed_file.read_text(encoding='utf-8')))
    except (OSError, ValueError):
        failed = set()
    todo = [(short, full) for short, full, _w, _h in entry['textures']
            if not (folder / (short + '.png')).exists() and short not in failed]
    if todo:
        _make(todo, folder, failed)
        failed_file.write_text(json.dumps(sorted(failed)), encoding='utf-8')
    out = {}
    for short, _full, _w, _h in entry['textures']:
        f = folder / (short + '.png')
        if f.exists():
            out[short] = '/cache/_texthumbs/%s/%s?v=%d' % (pkg, f.name, f.stat().st_mtime_ns)
    return dict(pkg=pkg, thumbs=out)


def _make(todo, folder, failed):
    import kit
    from PIL import Image
    s = kit.Session([], 'editor-texthumbs')
    try:
        out = s.folder / 'Output'
        for start in range(0, len(todo), 40):           # a texture that cannot be read fails only its batch's line
            chunk = todo[start:start + 40]
            cmds = [r'UC_TEXDUMP %s ..\Output\th%d.raw 128' % (full, start + i) for i, (_s, full) in enumerate(chunk)]
            try:
                s.batch(cmds, timeout=600)
            except RuntimeError:
                pass
        for i, (short, _full) in enumerate(todo):
            raw = out / ('th%d.raw' % i)
            try:
                head, _, pix = raw.read_bytes().partition(b'\n')
                f = head.split()
                w, h = int(f[1]), int(f[2])
                im = Image.frombytes('RGBA', (w, h), pix[:w * h * 4])
                im.thumbnail((SIZE, SIZE), Image.LANCZOS)
                im.save(folder / (short + '.png'))
            except (OSError, ValueError, IndexError):
                failed.add(short)
    finally:
        s.close()
