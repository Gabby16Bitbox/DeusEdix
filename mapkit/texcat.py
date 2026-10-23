"""Texture catalog: export the textures of game packages and build labelled contact sheets.

    python tools\\mapkit\\texcat.py HK_BuildingExt CoreTexMetal RevTexHK ...

Packages are taken as the game loads them: Revision\\Textures, then Revision\\NewVision\\Textures
(HD versions), then the base Deus Ex\\Textures. Sheets land in tools\\mapkit\\catalog\\<pkg>-N.jpg
and an index tools\\mapkit\\catalog\\<pkg>.txt (number, group.name, size).
"""
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent)]
import kit  # noqa: E402
import settings  # noqa: E402
from ue1pkg import Pkg  # noqa: E402

GAME = settings.GAME
SEARCH = list(settings.TEXTURE_DIRS)      # the targeted game's: Revision's first, or only the original game's
CATALOG = HERE / 'catalog'
FF = shutil.which('ffmpeg') or r'C:\Program Files (x86)\ffmpeg\bin\ffmpeg.exe'
FONT = 'C\\:/Windows/Fonts/arial.ttf'
SKIP = {'FractalTexture', 'FireTexture', 'WaterTexture', 'WaveTexture', 'WetTexture', 'IceTexture',
        'ScriptedTexture', 'Palette', 'Package', 'Font', 'TrueTypeFontFactory'}


def find_package(name):
    for folder in SEARCH:
        p = folder / (name + '.utx')
        if p.exists():
            return p
    raise SystemExit('package not found: ' + name)


def textures(path):
    p = Pkg(str(path))
    out = []
    for i, e in enumerate(p.exports):
        cls = p.classname(e)
        if cls != 'Texture':
            continue
        group = p.refname(e['pkg']) if e['pkg'] > 0 else ''
        props = {n: p.pval(v) for (n, t, a, v) in p.props(i + 1)}
        out.append(dict(name=e['name'], group=group, usize=props.get('USize'), vsize=props.get('VSize'),
                        scale=props.get('DrawScale')))
    return out


def ensure_index(names):
    """The index of each package (catalog\\<pkg>.txt: group.name and size of every texture) where it is
    missing: read straight from the user's own .utx, no host, no pictures. A fresh install of DeusEdix
    has no catalog (it is made from the game, never shipped), and a scripted map needs the sizes.
    Returns the packages indexed now."""
    made = []
    for n in names:
        out = CATALOG / (n + '.txt')
        if out.exists():
            continue
        try:
            path = find_package(n)
        except SystemExit:
            continue                        # not installed: the build says which textures are missing
        CATALOG.mkdir(exist_ok=True)
        index = ['%3d  %s.%s  %sx%s%s' % (i, t['group'], t['name'], t['usize'], t['vsize'], '  scale=%s' % t['scale'] if t['scale'] else '')
                 for i, t in enumerate(x for x in textures(path) if x['usize'] and x['vsize'])]
        out.write_text('\n'.join(index) + '\n', encoding='utf-8')
        made.append(n)
    return made


def catalog(names, per_sheet=48, thumb=160):
    CATALOG.mkdir(exist_ok=True)
    paths = [find_package(n) for n in names]
    folder = kit.new_run(paths, 'texcat')
    (folder / 't').mkdir()
    cmds = []
    lists = {}
    k = 0
    for n, path in zip(names, paths):
        texs = textures(path)
        lists[n] = texs
        cmds.append('OBJ LOAD FILE="..\\Input\\%s"' % path.name)
        for t in texs:
            t['file'] = folder / 't' / ('%d.bmp' % k)
            cmds.append('OBJ EXPORT TYPE=Texture NAME=%s FILE="..\\t\\%d.bmp"' % (t['name'], k))
            k += 1
    kit.execute(folder, cmds, 'texcat.log', timeout=3600)
    for n in names:
        texs = [t for t in lists[n] if t['file'].exists()]
        index = []
        for i, t in enumerate(texs):
            index.append('%3d  %s.%s  %sx%s%s' % (i, t['group'], t['name'], t['usize'], t['vsize'],
                                                  '  scale=%s' % t['scale'] if t['scale'] else ''))
            label = ('%d %s' % (i, t['name'])).replace(':', ' ').replace("'", '')
            t['thumb'] = folder / 't' / ('%s_%d.png' % (n, i))
            subprocess.run([FF, '-v', 'error', '-y', '-i', str(t['file']), '-vf',
                            "scale=%d:%d,pad=%d:%d+18:0:0:color=0x202020,drawtext=fontfile='%s':text='%s':"
                            'fontcolor=white:fontsize=12:x=3:y=%d+3' % (thumb, thumb, thumb, thumb, FONT, label, thumb),
                            str(t['thumb'])], check=False, stderr=subprocess.DEVNULL)
        (CATALOG / (n + '.txt')).write_text('\n'.join(index) + '\n', encoding='utf-8')
        thumbs = [t['thumb'] for t in texs if t['thumb'].exists()]
        for s in range(0, len(thumbs), per_sheet):
            chunk = thumbs[s:s + per_sheet]
            lst = folder / 't' / ('%s_%d.txt' % (n, s))
            lst.write_text(''.join("file '%s'\n" % str(c).replace('\\', '/') for c in chunk), encoding='utf-8')
            cols = 8
            rows = (len(chunk) + cols - 1) // cols
            out = CATALOG / ('%s-%d.jpg' % (n, s // per_sheet + 1))
            subprocess.run([FF, '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(lst), '-vf',
                            'tile=%dx%d:padding=4:color=0x101010' % (cols, rows), '-frames:v', '1', '-q:v', '3',
                            str(out)], check=False)
            print(out)
    return folder


if __name__ == '__main__':
    catalog(sys.argv[1:])
