"""The browser's "Pieces": the objects of the original levels made of brushes, each one whole and listed
once: fences, railings, grates, pipes, vents, signs, lamps, shelves, awnings...

In UnrealEd these are the brushes the level designers made semisolid or non-solid (detail brushes: they
do not cut the level's BSP), so a cluster of detail brushes touching each other is one object. They are
read from the editor cache of the original maps (cache/ref_<map>: brushes.json, polys.json); the same
object repeated in many places or maps is listed once. Nothing assembled by hand is in it.

    catalog/objects.json          every object: id, map, label, category, size, brushes, how often it is used
    cache/_objects/<map>.json     their polygons (with UVs) for the 3D previews

Placing one: prefab(id) makes a prefab of its brushes (prefabs.copy, tools/mapkit/prefabs/obj_<id>),
pasted like any copied structure (edits['prefabs']).
"""
import json
import re
import shutil
from collections import defaultdict
from pathlib import Path

import data
import atomicfile
import moving_pieces

HERE = Path(__file__).resolve().parent
CATALOG = HERE.parent / 'catalog' / 'objects.json'
CACHE = data.GAME_CACHE / '_objects'
VERSION = 3                 # independently usable game doors and two-stop lifts
PF_INVISIBLE, PF_MASKED, PF_NOTSOLID, PF_SEMISOLID, PF_FAKE = 1, 2, 8, 32, 128
# the flags a texture has by itself (fences, grates and leaves masked, glass translucent, screens unlit): the
# engine adds them to the surface's (data.texture_flags), and so must the previews, or the see-through parts
# of a grate show the colour behind them in the picture (purple, black)
TEX_BITS = 0x2 | 0x4 | 0x40 | 0x400000
MAX_SIZE, MIN_SIZE = 1600, 12

# category: words of its textures (the first that matches)
CATEGORIES = [
    ('Fences, grates and railings', r'fence|chain|grat|grill|rail|bars?\b|cage|mesh|gate|net\b|barb|lattice|wire_?fence|banister'),
    ('Pipes, vents and cables', r'pipe|vent|duct|fan|cable|wire|conduit|tube|hose|valve'),
    ('Signs and neon', r'sign|neon|poster|ban+er|advert|\bad\b|logo|letter|kanji|chinese|exit|graffiti|billboard'),
    ('Lamps and lights', r'light|lamp|bulb|lantern|glow|flare'),
    ('Windows and glass', r'window|glass|pane|blind'),
    ('Doors and frames', r'door|frame|shutter'),
    ('Stairs and ladders', r'stair|step|ladd?e?r|rung'),
    ('Beams, columns and supports', r'beam|girder|column|pillar|support|truss|strut|\bpost|scaffold|brace'),
    ('Awnings, roofs and canopies', r'awning|canopy|roof|tarp|tent|umbrella|corrug'),
    ('Shelves, counters and furniture', r'shelf|shelv|counter|table|desk|cabinet|bench|bed|seat|locker|drawer|rack|stall|kiosk'),
    ('Machines and panels', r'machine|panel|computer|console|generator|engine|tank|boiler|meter|screen|monitor|switch'),
]


def _maps():
    return sorted(p.name[4:] for p in data.GAME_CACHE.glob('ref_*') if (p / 'brushes.json').exists() and (p / 'polys.json').exists())


def own_flags(folder):
    """{texture: its own flags} of the textures of a reference map (cache/ref_<map>/texflags.json)."""
    try:
        flags = json.loads((Path(folder) / 'texflags.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}
    return flags if isinstance(flags, dict) else {}


def _touch(a, b, tol=2.0):
    return all(a['lo'][k] - tol <= b['hi'][k] and b['lo'][k] - tol <= a['hi'][k] for k in range(3))


def _words(name):
    s = re.sub(r'([a-z])([A-Z])', r'\1 \2', name.split('.')[-1])
    return re.sub(r'[_\d]+', ' ', s).strip()


SHAPES = ['Beams, columns and supports', 'Wall and floor panels']


def _category(tex, flags, size):
    """(category, the texture that tells it): the words of its textures first, then its shape."""
    for name, rx in CATEGORIES:
        for t in tex:
            if re.search(rx, t.lower()):
                return name, t
    main = tex[0] if tex else ''
    x, y, z = size
    if flags & PF_MASKED and min(size) <= 16:
        return CATEGORIES[0][0], main
    if (z >= 128 and z >= 3 * max(x, y)) or max(x, y) >= 4 * max(min(x, y), z, 1) and max(x, y) >= 128:
        return SHAPES[0], main              # tall and thin, or long and thin: a column, a beam
    if z <= 8 and min(x, y) >= 24 or min(x, y) <= 2 and z >= 16:
        return SHAPES[1], main              # flat: a floor tile, a wall panel, a trim
    return 'Other details', main


def _clusters(folder):
    """Detail brushes (semisolid / non-solid, added, visible) that touch -> lists of brushes."""
    brushes = json.loads((folder / 'brushes.json').read_text(encoding='utf-8'))
    polys = json.loads((folder / 'polys.json').read_text(encoding='utf-8'))
    seen = defaultdict(int)
    for tex, flags, nums, verts, brush in polys:
        if not flags & PF_FAKE:
            seen[brush] += 1
    det = [b for b in brushes if b.get('csg') == 1 and b.get('lo') and b['flags'] & (PF_NOTSOLID | PF_SEMISOLID)
           and not b['flags'] & PF_FAKE and max(b['hi'][k] - b['lo'][k] for k in range(3)) <= MAX_SIZE]
    parent = list(range(len(det)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    order = sorted(range(len(det)), key=lambda i: det[i]['lo'][0])
    for n, i in enumerate(order):           # sweep along X: only neighbours can touch
        for j in order[n + 1:]:
            if det[j]['lo'][0] - 2 > det[i]['hi'][0]:
                break
            if _touch(det[i], det[j]):
                parent[find(j)] = find(i)
    groups = defaultdict(list)
    for i, b in enumerate(det):
        groups[find(i)].append(b)
    out = []
    for members in groups.values():
        if not any(seen[b['ord']] and not b['flags'] & PF_INVISIBLE for b in members):
            continue                        # only collision boxes, or nothing the BSP draws
        lo = [min(b['lo'][k] for b in members) for k in range(3)]
        hi = [max(b['hi'][k] for b in members) for k in range(3)]
        size = [round(hi[k] - lo[k]) for k in range(3)]
        if max(size) > MAX_SIZE or max(size) < MIN_SIZE:
            continue
        tex = defaultdict(int)
        flags = 0
        for b in members:
            flags |= b['flags']
            for t, c in (b.get('tex') or {}).items():
                tex[t] += c
        out.append(dict(brushes=sorted(b['name'] for b in members), ords=sorted(b['ord'] for b in members), lo=lo, hi=hi,
                        size=size, tex=sorted(tex, key=tex.get, reverse=True)[:6], flags=flags))
    return out, polys


def build(maps=None, log=print, metadata=None):
    """Index the original maps in the cache (cache/ref_<map>) into catalog/objects.json."""
    maps = _maps() if maps is None else maps
    CACHE.mkdir(parents=True, exist_ok=True)
    items, by_sig = [], {}
    for m in maps:
        folder = data.map_folder('ref_' + m)
        clusters, polys = _clusters(folder)
        tex_info = json.loads((folder / 'textures.json').read_text(encoding='utf-8'))
        own = own_flags(folder)
        by_ord = defaultdict(list)
        for p in polys:
            by_ord[p[4]].append(p)
        shapes, textures, n_new = {}, {}, 0
        for c in clusters:
            sig = (tuple(sorted(c['size'][:2])) + (c['size'][2],), tuple(sorted(c['tex'][:3])), len(c['brushes']))
            sig = (tuple(round(v / 8) for v in sig[0]),) + sig[1:]
            if sig in by_sig:               # the same object elsewhere: counted, not listed again
                it = by_sig[sig]
                it['count'] += 1
                if m not in it['maps']:
                    it['maps'].append(m)
                continue
            oid = '%s~%d' % (m, c['ords'][0])
            cat, key_tex = _category(c['tex'], c['flags'], c['size'])
            label = _words(key_tex) if key_tex else 'Object'
            label = label[:1].upper() + label[1:] if label else 'Object'
            it = dict(id=oid, map=m, label=label, cat=cat, size=c['size'],
                      brushes=c['brushes'], lo=[round(v, 1) for v in c['lo']], hi=[round(v, 1) for v in c['hi']],
                      tex=c['tex'], count=1, maps=[m])
            by_sig[sig] = it
            items.append(it)
            n_new += 1
            # its polygons for the preview, around its pivot (centre, bottom)
            pv = [(c['lo'][0] + c['hi'][0]) / 2, (c['lo'][1] + c['hi'][1]) / 2, c['lo'][2]]
            groups = {}
            for o in c['ords']:
                for tex, flags, nums, verts, brush in by_ord.get(o, []):
                    if flags & PF_FAKE:
                        continue
                    flags |= (own.get(tex) or 0) & TEX_BITS
                    b, u, v = nums[0:3], nums[3:6], nums[6:9]
                    pu, pv_, tw, th = nums[9], nums[10], nums[11] or 128, nums[12] or 128
                    g = groups.setdefault((tex, flags & 0x40004E), dict(tex=tex, flags=flags, pos=[], uv=[]))
                    pts = [verts[i:i + 3] for i in range(0, len(verts), 3)]
                    uvs = []
                    for p in pts:
                        d = (p[0] - b[0], p[1] - b[1], p[2] - b[2])
                        uvs.append(((d[0] * u[0] + d[1] * u[1] + d[2] * u[2] + pu) / tw, (d[0] * v[0] + d[1] * v[1] + d[2] * v[2] + pv_) / th))
                    for k in range(1, len(pts) - 1):
                        for j in (0, k, k + 1):
                            g['pos'] += [round(pts[j][q] - pv[q], 1) for q in range(3)]
                            g['uv'] += [round(uvs[j][0], 4), round(uvs[j][1], 4)]
                    info = tex_info.get(tex) or {}
                    if info.get('png'):
                        textures[tex] = '/cache/ref_%s/%s' % (m, info['png'])
            shapes[oid] = list(groups.values())
        for item, groups, signature in moving_pieces.entries(folder, m):
            sig = ('mover', signature)
            if sig in by_sig:
                previous = by_sig[sig]
                previous['count'] += 1
                if m not in previous['maps']:
                    previous['maps'].append(m)
                continue
            by_sig[sig] = item
            items.append(item)
            n_new += 1
            shapes[item['id']] = groups
            for g in groups:
                textures[g['tex']] = '/cache/ref_%s/%s' % (m, tex_info[g['tex']]['png'])
        atomicfile.write_json(CACHE / (m + '.json'), dict(textures=textures, objects=shapes))
        log('%s: %d objects (%d new)' % (m, len(clusters), n_new))
    order = list(dict.fromkeys(moving_pieces.CATEGORIES + [c[0] for c in CATEGORIES] + SHAPES + ['Other details']))
    items.sort(key=lambda it: (order.index(it['cat']), -it['count'], it['label']))
    CATALOG.parent.mkdir(parents=True, exist_ok=True)
    atomicfile.write_json(CATALOG, dict(version=VERSION, categories=order, items=items, **(metadata or {})))
    log('pieces: %d objects of the game' % len(items))
    return items


def load(log=print):
    if CATALOG.exists():
        c = json.loads(CATALOG.read_text(encoding='utf-8'))
        if c.get('version') == VERSION:
            return c
    build(log=log)
    return json.loads(CATALOG.read_text(encoding='utf-8'))


def prefab(oid, log=print, pid=None):
    """The object as a prefab (made the first time): its brushes, no other actor."""
    import prefabs
    if not isinstance(oid, str) or not re.fullmatch(moving_pieces.IDENTITY, oid):
        raise ValueError('Invalid Pieces object identity.')
    pid = pid or 'obj_' + re.sub(r'\W', '_', oid)
    if not isinstance(pid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,240}', pid):
        raise ValueError('Invalid Pieces prefab identity.')
    if (prefabs.ROOT / pid / 'prefab.json').exists():
        p = prefabs.load(pid)
        return dict(kind='prefab', id=pid, label=p['label'], source=p['source'], pivot=p['pivot'], facing=p.get('facing'),
                    rotatable=p.get('rotatable', True), mover=moving_pieces.description(p), display='/prefabs/%s/display.json' % pid)
    it = next((x for x in load(log)['items'] if x['id'] == oid), None)
    if not it:
        raise KeyError('no object %s' % oid)
    folder = data.map_folder('ref_' + it['map'])
    pivot = [(it['lo'][0] + it['hi'][0]) / 2, (it['lo'][1] + it['hi'][1]) / 2, it['lo'][2]]
    st = dict(label=it['label'], brush_names=it['brushes'], actors=[], pivot=pivot,
              placement=dict(offset=[0, 0, 0], yaw=0), rotatable=True)
    if it.get('kind') in ('door', 'elevator'):
        import t3d
        actor = next(a for a in t3d.actors((folder / 'scene.t3d').read_text(encoding='latin1')) if a['name'] == it['actors'][0])
        raw = moving_pieces.template(actor, it['kind'], it['tex'])
        block = dict(name=actor['name'], cls='DeusExMover', brush=False, mover=True, raw=raw)
        dst = prefabs.ROOT / pid
        dst.mkdir(parents=True, exist_ok=True)
        pf = dict(id=pid, label=it['label'], source=it['map'], structure='__object__', pivot=pivot,
                  blocks=[block], packages=sorted({t.split('.')[0] for t in it['tex']} |
                      {'sound:'+p for p in re.findall(r"Sound'([A-Za-z_]\w*)\.", raw)}), rotatable=True, facing=None)
        atomicfile.write_json(dst / 'prefab.json', pf)
        clip = dict(kind='prefab', id=pid, label=it['label'], source=it['map'], pivot=pivot,
                    rotatable=True, display='/prefabs/%s/display.json' % pid)
    else:
        clip = prefabs.copy(it['map'], '__object__', folder, {'__object__': st}, pid=pid)
    # its preview: the polygons of the catalog (copy() takes them from the map's structures)
    shapes = json.loads((CACHE / (it['map'] + '.json')).read_text(encoding='utf-8'))
    dst = prefabs.ROOT / pid
    groups, textures, own = [], {}, own_flags(folder)
    for g in shapes['objects'].get(oid, []):
        groups.append(dict(tex=g['tex'], flags=g['flags'] | ((own.get(g['tex']) or 0) & TEX_BITS), pos=[v + pivot[i % 3] for i, v in enumerate(g['pos'])], uv=g['uv']))
        url = shapes['textures'].get(g['tex'])
        if url:
            src = data.cache_file(url[len('/cache/'):].split('?')[0])
            rel = 'tex/' + src.name
            (dst / 'tex').mkdir(parents=True, exist_ok=True)
            if src.exists():
                shutil.copy2(src, dst / rel)
            textures[g['tex']] = dict(png=rel)
    (dst / 'display.json').write_text(json.dumps(dict(groups=groups, textures=textures)), encoding='utf-8')
    stored = prefabs.load(pid)
    clip['facing'] = stored.get('facing')
    clip['mover'] = moving_pieces.description(stored)
    return clip


if __name__ == '__main__':
    import sys
    build(sys.argv[1:] or None)
