"""The original maps as a library of ready-made pieces (rule: never build from scratch what the game
already has). Every original map is analysed into structures (editor/dxmaps.reference): brushes that
touch, with the lamps and props on them. This lists and searches them.

    python tools\\mapkit\\library.py index 06_HongKong_WanChai_Market 02_NYC_Warehouse ...
    python tools\\mapkit\\library.py find vent fan aircon --maps 06_HongKong_WanChai_Market
    python tools\\mapkit\\library.py show 06_HongKong_WanChai_Market s_Brush123

A map script then takes a piece with Scene.paste(map, structure, at, yaw).
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'editor'))
sys.path.insert(0, str(HERE))
CATALOG = HERE / 'catalog' / 'library.json'


def index(maps, log=print):
    import dxmaps
    import data
    lib = json.loads(CATALOG.read_text(encoding='utf-8')) if CATALOG.exists() else {}
    for m in maps:
        key, folder, structs = dxmaps.reference(m, log=lambda *a: None)
        info = json.loads((dxmaps.OUT / (key + '.dxinfo.json')).read_text(encoding='utf-8'))['structures']
        brushes = {b['name']: b for b in json.loads((folder / 'brushes.json').read_text(encoding='utf-8'))}
        acts = {a['name']: a for a in data.actors(key)}
        entries = {}
        for name, s in info.items():
            tex = {}
            for b in s['brush_names']:
                for t, c in brushes.get(b, {}).get('tex', {}).items():
                    tex[t] = tex.get(t, 0) + c
            size = [round(s['hi'][i] - s['lo'][i]) for i in range(3)]
            entries[name] = dict(label=s['label'], pieces=len(s['brush_names']), size=size, pivot=s['pivot'],
                                 tex=sorted(tex, key=tex.get, reverse=True)[:6],
                                 objects=sorted({acts[a]['cls'] for a in s['actors'] if a in acts}))
        lib[m] = entries
        log('%s: %d pieces' % (m, len(entries)))
    CATALOG.write_text(json.dumps(lib, indent=0), encoding='utf-8')
    return lib


def load():
    return json.loads(CATALOG.read_text(encoding='utf-8')) if CATALOG.exists() else {}


def find(words, maps=None, max_size=None):
    """Pieces whose textures, label or objects contain one of the words."""
    out = []
    for m, entries in load().items():
        if maps and m not in maps:
            continue
        for name, e in entries.items():
            hay = ' '.join([m, name, e['label']] + e['tex'] + e['objects']).lower()
            if any(w.lower() in hay for w in words):
                if max_size and max(e['size']) > max_size:
                    continue
                out.append((m, name, e))
    return out


if __name__ == '__main__':
    a = sys.argv[1:]
    if a and a[0] == 'index':
        index(a[1:])
    elif a and a[0] == 'find':
        maps = None
        if '--maps' in a:
            i = a.index('--maps')
            maps, a = a[i + 1:], a[:i]
        for m, name, e in find(a[1:], maps):
            print('%-28s %-14s %3d pz %-16s %s | %s' % (m, name, e['pieces'], 'x'.join(map(str, e['size'])),
                                                      ', '.join(e['tex'][:4]), ', '.join(e['objects'][:5])))
