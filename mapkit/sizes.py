"""Collision radius / half-height of actor classes, read from the real packages.

    python tools/mapkit/sizes.py BoxLarge BoxMedium Barrel1 ...

A prop rests on a surface at Z = surface + CollisionHeight. Results are cached in
tools/mapkit/catalog/sizes.json and used by scene.Scene.rest().
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import kit  # noqa: E402
import settings  # noqa: E402

CACHE = HERE / 'catalog' / 'sizes.json'


def load():
    return json.loads(CACHE.read_text()) if CACHE.exists() else {}


def query(classes, packages=(settings.PACKAGE + '.u',) + settings.GAME_LOADS):
    cache = load()
    todo = [c for c in classes if c not in cache]
    if todo:
        folder = kit.new_run([], 'sizes')
        body = ''.join('Begin Actor Class=%s Name=S%d\n    Location=(X=%d,Y=0,Z=0)\nEnd Actor\n' % (c, i, i * 200)
                       for i, c in enumerate(todo))
        (folder / 'T3D' / 'sizes.t3d').write_text('Begin Map\n' + body + 'End Map\n', encoding='ascii')
        cmds = ['MAP NEW'] + ['OBJ LOAD FILE="%s"' % p for p in packages]
        cmds += ['MAP IMPORTADD FILE="..\\T3D\\sizes.t3d"', 'UC_SIZES']
        text, _ = kit.execute(folder, cmds, 'sizes.log', timeout=600)
        for m in re.finditer(r'UCMapKit\|size\|(\w+)\|([\d.]+)\|([\d.]+)', text):
            cache[m[1]] = [float(m[2]), float(m[3])]
        CACHE.write_text(json.dumps(cache, indent=1, sort_keys=True))
    short = {c.split('.')[-1]: c for c in classes}
    return {c: cache.get(c.split('.')[-1], cache.get(c)) for c in short.values()}


if __name__ == '__main__':
    for c, v in query(sys.argv[1:]).items():
        print(c, v)
