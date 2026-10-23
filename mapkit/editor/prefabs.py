"""Copy and paste between maps: a structure of any map (a fence, a shelf, a kiosk...) saved as a
prefab and pasted into another map.

copy(map, structure) reads the editor cache of the map as it is shown (scene.t3d, brushes.json,
geometry.json, textures.json) and writes tools\\mapkit\\prefabs\\<id>\\:
    prefab.json   the T3D blocks of its brushes and objects (references to the source level removed),
                  the texture packages they need, its pivot, a label
    display.json  its polygons with UVs for the editor's preview, textures in tex\\
A paste is an entry of edits['prefabs'] = {pid, prefab, offset, yaw}: the build imports the blocks
(brushes renamed, placed with geom.XForm) before the BSP rebuild, so they become part of the map.
"""
import json
import re
import shutil
import time
from functools import lru_cache
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
ROOT = KIT / 'prefabs'
import sys  # noqa: E402
sys.path.insert(0, str(KIT))
import settings  # noqa: E402
GAME_TEXTURES = settings.TEXTURE_DIRS[0]          # Revision\Textures, or the original game's Textures
GAME_TEXTURES_DX = settings.GAME / 'Textures'


# objects that go with a copied piece only if they are scenery: lights and decorations; never what
# carries the story or the gameplay of the map it comes from
STORY = re.compile(r'Computer|DataCube|Book|Newspaper|Keypad|Button|Alarm|Camera|Turret|Collectable|InventorySpot|'
                   r'Ammo|Weapon|Credits|MedKit|Multitool|Lockpick|Biocell|Bioelectric|Trigger|Event|Dispatcher|'
                   r'Teleporter|MapExit|PathNode|PatrolPoint|HidePoint|Pawn|Troop|Guard|Carcass|Info|Spawn|Vision|'
                   r'Goggles|Rebreather|Armor|Augmentation|Upgrade|Nano|Key|Flare|Pickup|Grenade|Shuriken|'
                   r'Soda|Candy|Food|Liquor|Wine|Cigarette|Mug|Sound|Generator', re.I)


def _clean_block(raw):
    """A T3D actor block without references to objects of the level it comes from."""
    out = []
    for line in raw.splitlines():
        s = line.strip()
        if "'MyLevel." in s and not s.startswith('Brush=Model'):
            continue
        if re.match(r'(bSelected|Name)=', s):
            continue
        out.append(line)
    return '\n'.join(out) + '\n'


def library_piece(map_name, structure, log=print):
    """A piece of an ORIGINAL map as a prefab with a fixed id (lib_<map>_<structure>), made the first
    time it is used (map scripts: Scene.paste)."""
    pid = 'lib_%s_%s' % (map_name, structure)
    if (ROOT / pid / 'prefab.json').exists():
        return load(pid)
    import dxmaps
    key, folder, structs = dxmaps.reference(map_name, log=log)
    if structure not in structs:
        raise KeyError('%s has no piece %s' % (map_name, structure))
    copy(map_name, structure, folder, structs, pid=pid)
    return load(pid)


def region_piece(map_name, spec, log=print):
    """A whole area of an ORIGINAL map (a shop with its back room...) as a prefab: the brushes listed by
    ordinal (spec['ords'], the order of the level, kept: rooms first, then what stands in them), the
    scenery inside spec['lo']..spec['hi'] (lights, decorations; never story objects) except the names
    in spec['skip']; its pivot is spec['pivot'] (a point of the original map). Cached by its spec."""
    import hashlib
    key = json.dumps(dict(map=map_name, spec=spec), sort_keys=True)
    pid = 'reg_%s_%s' % (map_name, hashlib.sha1(key.encode()).hexdigest()[:10])
    if (ROOT / pid / 'prefab.json').exists():
        return load(pid)
    import dxmaps
    import t3d
    _, folder, _ = dxmaps.reference(map_name, log=log)
    brushes = json.loads((Path(folder) / 'brushes.json').read_text(encoding='utf-8'))
    by_ord = {b['ord']: b['name'] for b in brushes}
    names = [by_ord[o] for o in spec['ords'] if o in by_ord]
    lo, hi, skip = spec.get('lo'), spec.get('hi'), set(spec.get('skip') or [])
    actors = []
    if lo and hi:
        text = (Path(folder) / 'scene.t3d').read_text(encoding='latin1', errors='replace')
        for a in t3d.actors(text):
            if a['cls'] == 'Brush' or a['name'] in skip or a['cls'] in (spec.get('skip_cls') or []):
                continue
            p = t3d.vec(a['props'].get('Location'))
            if all(lo[k] <= p[k] <= hi[k] for k in range(3)):
                actors.append(a['name'])
    st = dict(label=spec.get('label') or 'area of %s' % map_name, brush_names=names, actors=actors,
              pivot=list(spec['pivot']), placement=dict(offset=[0, 0, 0], yaw=0), rotatable=True)
    copy(map_name, '__region__', folder, {'__region__': st}, pid=pid)
    return load(pid)


def _original(map_name, name, log=print):
    import dxmaps
    import t3d
    _, folder, _ = dxmaps.reference(map_name, log=log)
    text = (Path(folder) / 'scene.t3d').read_text(encoding='latin1', errors='replace')
    for a in t3d.actors(text):
        if a['name'] == name:
            return a
    raise KeyError('%s has no %s' % (map_name, name))


def original_center(map_name, name, log=print):
    """Where an object of an ORIGINAL map really is: the centre of its brush (a hinged door's Location is
    its hinge), and its Location."""
    import t3d
    a = _original(map_name, name, log)
    lo, hi = t3d.bounds(a)
    return tuple((lo[k] + hi[k]) / 2 for k in range(3)), t3d.vec(a['props'].get('Location'))


PF_UNLIT_FLAG = 0x400000


def original_actor(map_name, name, new_name, at, props=None, unlit=False, log=print):
    """One object of an ORIGINAL map (a door, a roll-up grille: movers are left out of pieces) as a T3D block
    named new_name, moved so that its location is `at`, with some properties changed. unlit: its faces
    ignore lighting (a mover added to an original map that cannot be relit would be black)."""
    import geom
    import t3d
    a = _original(map_name, name, log)
    raw = _clean_block(a['raw'])
    if unlit:
        def flag(m):
            line = m.group(0)
            f = re.search(r'Flags=(\d+)', line)
            if f:
                return line.replace(f.group(0), 'Flags=%d' % (int(f.group(1)) | PF_UNLIT_FLAG))
            return line.replace('Begin Polygon', 'Begin Polygon Flags=%d' % PF_UNLIT_FLAG, 1)
        raw = re.sub(r'Begin Polygon[^\n]*', flag, raw)
    model = re.search(r"Brush=Model'MyLevel\.(\w+)'", raw)
    if model:
        raw = raw.replace("Model'MyLevel.%s'" % model.group(1), "Model'MyLevel.%sM'" % new_name)
        raw = re.sub(r'Begin Brush Name=\w+', 'Begin Brush Name=%sM' % new_name, raw, count=1)
    raw = re.sub(r'^Begin Actor Class=(\S+) Name=\S+', r'Begin Actor Class=\1 Name=%s' % new_name, raw, count=1)
    src = t3d.vec(a['props'].get('Location'))
    xf = geom.XForm(src, tuple(at[k] - src[k] for k in range(3)), 0)
    raw = xf_block(raw, xf)
    for key in ('BasePos', 'OldLocation', 'SavedPos'):     # movers keep where they were built
        raw = re.sub(r'(?m)^\s*%s=.*\n' % key, '', raw)
    for k, v in (props or {}).items():
        raw, n = re.subn(r'(?m)^(\s*)%s=.*$' % re.escape(k), lambda m: '%s%s=%s' % (m.group(1), k, v), raw, count=1)
        if not n:
            raw = re.sub(r'(?m)^(\s*Location=.*)$', lambda m: m.group(1) + '\n    %s=%s' % (k, v), raw, count=1)
    return raw


def copy(map_name, structure, cache_folder, structures, pid=None):
    import t3d
    st = structures[structure]
    folder = Path(cache_folder)
    brushes = json.loads((folder / 'brushes.json').read_text(encoding='utf-8'))
    names = set(st.get('brush_names') or [])
    for i in st.get('brushes') or []:
        if 0 <= i < len(brushes):
            names.add(brushes[i]['name'])
    actor_names = set(st.get('actors') or [])
    text = (folder / 'scene.t3d').read_text(encoding='latin1', errors='replace')
    blocks, used_tex = [], set()
    for a in t3d.actors(text):
        if a['name'] in names or a['name'] in actor_names:
            if 'Mover' in a['cls']:
                continue
            if a['name'] not in names and STORY.search(a['cls']):
                continue        # computers, data cubes, pickups...: they belong to the story of their own map
            if a['name'] not in names and t3d.vec(a['props'].get('Location'))[2] < st['pivot'][2] - 4:
                continue        # below the piece (a light of the room under it): it would end up in the floor
            blocks.append(dict(name=a['name'], cls=a['cls'], brush=a['name'] in names, raw=_clean_block(a['raw'])))
            if a['name'] in names:
                for p in t3d.polys(a['body']):
                    if p['texture']:
                        used_tex.add(p['texture'].split('.')[-1].lower())
    if not blocks:
        raise ValueError('nothing to copy in %s' % structure)
    _hide_unseen_faces(blocks, folder, brushes, text)
    tex_info = json.loads((folder / 'textures.json').read_text(encoding='utf-8'))
    packages = sorted({full.split('.')[0] for full in tex_info if full.split('.')[-1].lower() in used_tex})
    pivot = [st['pivot'][k] + st['placement']['offset'][k] for k in range(3)]
    pid = pid or time.strftime('%Y%m%d-%H%M%S') + '-' + re.sub(r'\W', '', structure)[:20]
    dst = ROOT / pid
    (dst / 'tex').mkdir(parents=True, exist_ok=True)
    # preview: the structure's polygons as the editor shows them, with their textures
    geo = json.loads((folder / 'geometry.json').read_text(encoding='utf-8'))
    groups, textures = [], {}
    for g in geo['groups']:
        if g.get('structure') != structure:
            continue
        groups.append(dict(tex=g['tex'], flags=g['flags'], pos=g['pos'], uv=g['uv'], uvFrames=g.get('uvFrames', [])))
        info = geo['textures'].get(g['tex']) or {}
        if info.get('png') and (folder / info['png']).exists():
            shutil.copy2(folder / info['png'], dst / info['png'])
        textures[g['tex']] = dict(png=info.get('png'))
    (dst / 'display.json').write_text(json.dumps(dict(groups=groups, textures=textures)), encoding='utf-8')
    prefab = dict(id=pid, label=st['label'], source=map_name, structure=structure, pivot=pivot,
                  blocks=blocks, packages=packages, rotatable=st.get('rotatable', True),
                  facing=_facing(folder, brushes, names))
    (dst / 'prefab.json').write_text(json.dumps(prefab, indent=1), encoding='utf-8')
    return dict(kind='prefab', id=pid, label=st['label'], source=map_name, pivot=pivot,
                rotatable=prefab['rotatable'], display='/prefabs/%s/display.json' % pid)


def _plane(pts):
    a = [pts[1][k] - pts[0][k] for k in range(3)]
    b = [pts[2][k] - pts[0][k] for k in range(3)]
    n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    ln = sum(c * c for c in n) ** 0.5
    if ln < 1e-6:
        return None
    n = [c / ln for c in n]
    return n, sum(n[k] * pts[0][k] for k in range(3))


def _facing(folder, brushes, names):
    """Which way the piece looks in its map (yaw, Unreal units): the side its visible upright faces
    turn to, weighted by area (a sign, a neon, a wall lamp). None when it has no clear front."""
    import math
    polys = json.loads((folder / 'polys.json').read_text(encoding='utf-8'))
    ords = {b['ord'] for b in brushes if b['name'] in names}
    sx = sy = tot = 0.0
    for tex, flags, nums, verts, brush in polys:
        if brush not in ords:
            continue
        pts = [verts[i:i + 3] for i in range(0, len(verts), 3)]
        a = [pts[1][k] - pts[0][k] for k in range(3)]
        b = [pts[2][k] - pts[0][k] for k in range(3)]
        n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
        area = sum(c * c for c in n) ** 0.5 / 2
        if area < 1e-6 or abs(n[2]) / (2 * area) > 0.3:
            continue
        sx += n[0] / 2
        sy += n[1] / 2
        tot += area
    if tot < 1e-6 or math.hypot(sx, sy) < 0.5 * tot:
        return None
    return int(round(math.atan2(sy, sx) * 32768 / math.pi)) % 65536


def _hide_unseen_faces(blocks, folder, brushes, text):
    """Faces nobody saw in the original map (a sign is often a box with one face out of the wall and
    leftover textures on the others) become invisible in the copy: seen from a new angle they would
    show those leftovers. Visible = matches a polygon the original BSP draws for that brush."""
    import t3d
    polys = json.loads((folder / 'polys.json').read_text(encoding='utf-8'))
    ordinal = {b['name']: b['ord'] for b in brushes}
    seen = {}
    for tex, flags, nums, verts, brush in polys:
        pts = [verts[i:i + 3] for i in range(0, len(verts), 3)]
        pl = _plane(pts)
        if pl:
            seen.setdefault(brush, []).append(pl)
    actors = {a['name']: a for a in t3d.actors(text)}
    for blk in blocks:
        if not blk['brush'] or blk['name'] not in actors:
            continue
        visible = seen.get(ordinal.get(blk['name']), [])
        flags_out, seen_tex = [], {}
        for poly, wv in t3d.world_verts(actors[blk['name']]):
            pl = _plane(wv) if len(wv) >= 3 else None
            ok = pl is not None and any(abs(sum(pl[0][k] * v[0][k] for k in range(3))) > 0.995 and
                                        (abs(pl[1] - v[1]) < 2 or abs(pl[1] + v[1]) < 2) for v in visible)
            flags_out.append(ok)
            if ok and poly['texture']:
                seen_tex[poly['texture']] = seen_tex.get(poly['texture'], 0) + 1
        if not flags_out or all(flags_out) or not seen_tex:
            continue
        # a face that was never seen takes the texture the piece shows most (its edges, its back):
        # invisible faces would open holes where a hidden side becomes exposed (a pad set into a floor)
        main = max(seen_tex, key=seen_tex.get)
        it = iter(flags_out)

        def retexture(m):
            if next(it, True):
                return m.group(0)
            return re.sub(r'Texture=\S+', 'Texture=' + main, m.group(0), count=1)

        blk['raw'] = re.sub(r'Begin Polygon[^\n]*', retexture, blk['raw'])
        blk['hidden_faces'] = flags_out.count(False)


def load(pid):
    return json.loads((ROOT / pid / 'prefab.json').read_text(encoding='utf-8'))


def display(pid):
    """Upgrade legacy preview texture frames without writing a map or running the SDK."""
    import data
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,240}', pid):
        raise ValueError('Invalid prefab preview identity.')
    path = ROOT / pid / 'display.json'
    source = load(pid).get('source', '')
    paths = []
    if re.fullmatch(r'[\w.-]+', source):
        for folder in (data.map_folder('ref_' + source), data.map_folder(source)):
            p = folder / 'polys.json'
            if p.is_file():
                stat = p.stat()
                paths.append((str(p), stat.st_mtime_ns, stat.st_size))
    stat = path.stat()
    return _display_cached(str(path), stat.st_mtime_ns, stat.st_size, tuple(paths))


@lru_cache(maxsize=4)
def _polys_cached(path, mtime, size):
    return json.loads(Path(path).read_text(encoding='utf-8'))


@lru_cache(maxsize=32)
def _display_cached(path, mtime, size, sources):
    from texture_mapping import enrich
    result = json.loads(Path(path).read_text(encoding='utf-8'))
    groups = result.get('groups', [])
    if all(len(g.get('uvFrames', [])) == len(g['pos']) // 9 and all(g['uvFrames']) for g in groups):
        return result
    for source in sources:
        enrich(groups, _polys_cached(*source))
        if all(all(g.get('uvFrames', [])) for g in groups):
            break
    return result


def package_commands(packages):
    """OBJ LOAD for the texture packages a prefab needs (those that exist in the game)."""
    cmds = []
    for p in packages:
        if p.startswith('sound:'):
            package = p[6:]
            if not re.fullmatch(r'[A-Za-z_]\w*', package):
                raise ValueError('Invalid moving-piece sound package.')
            roots = [settings.GAME / 'Sounds', settings.GAME_ROOT / 'Sounds', *settings.SYSTEM_DIRS]
            filename = next((package+ext for ext in ('.uax', '.u') for root in roots if (root / (package+ext)).is_file()), None)
            if filename is None:
                raise ValueError('This moving piece needs the installed sound package '+package+'.')
            cmds.append('OBJ LOAD FILE="%s"' % filename)
            continue
        if any((d / (p + '.utx')).exists() for d in (GAME_TEXTURES, GAME_TEXTURES_DX)):
            cmds.append('OBJ LOAD FILE="%s.utx"' % p)
    return cmds


def xf_block(raw, xf):
    """Move and turn one exported actor block (exported vectors may leave out zero components)."""
    import t3d

    def loc(m):
        p = xf.point(t3d.vec(m.group(2)))
        return '%s(X=%.3f,Y=%.3f,Z=%.3f)' % (m.group(1), p[0], p[1], p[2])
    raw, n = re.subn(r'(?m)^(\s*Location=)(\([^)]*\))', loc, raw, count=1)
    if not n:                                   # at the origin: the export leaves the line out
        p = xf.point((0.0, 0.0, 0.0))
        raw = re.sub(r'^(Begin Actor[^\n]*\n)', lambda mm: mm.group(1) + '    Location=(X=%.3f,Y=%.3f,Z=%.3f)\n' % p, raw, count=1)
    if xf.scaled and 'Begin Brush' in raw:
        raw = _scale_brush_block(raw, xf)
    if xf.rotated:
        m = re.search(r'(?m)^(\s*Rotation=)(\([^)]*\))', raw)
        if m:
            p, y, r = t3d.rot(m.group(2))
            raw = raw.replace(m.group(0), '%s(Pitch=%d,Yaw=%d,Roll=%d)' % ((m.group(1),) + xf.rot((p, y, r))), 1)
        else:
            raw = re.sub(r'(?m)^(\s*Location=.*)$', lambda mm: mm.group(1) + '\n    Rotation=(Pitch=%d,Yaw=%d,Roll=%d)' % xf.rotation,
                         raw, count=1)
    return raw


def _scale_brush_block(raw, xf):
    """A brush of a stretched structure: its polygons scaled in its own frame (its yaw in quarter turns
    swaps the axes), so that its Location (moved by xf.point) and its faces stretch together."""
    import t3d
    m = re.search(r'(?m)^\s*Rotation=(\([^)]*\))', raw)
    yaw = t3d.rot(m.group(1))[1] if m else 0
    sx, sy, sz = xf.scale
    if round(yaw / 16384) % 2:
        sx, sy = sy, sx
    s = (sx, sy, sz)

    def nums(text):
        return [float(v) for v in re.findall(r'[-+]?\d+(?:\.\d+)?', text)]

    def fmt(v):
        return ','.join('%+013.6f' % c for c in v)

    def line(mm):
        key, rest = mm.group(1), mm.group(2)
        v = nums(rest)[:3]
        if len(v) < 3:
            return mm.group(0)
        if key in ('Vertex', 'Origin'):
            v = [v[k] * s[k] for k in range(3)]
        elif key == 'Normal':
            v = [v[k] / s[k] for k in range(3)]
            ln = sum(c * c for c in v) ** 0.5 or 1.0
            v = [c / ln for c in v]
        elif xf.stretch:                              # TextureU / TextureV
            v = [v[k] / s[k] for k in range(3)]
        return '%s%s' % (mm.group(0)[:mm.start(2) - mm.start(0)], fmt(v))
    raw = re.sub(r'(?m)^\s*(Vertex|Origin|Normal|TextureU|TextureV)\s+(.*)$', line, raw)
    pm = re.search(r'(?m)^(\s*PrePivot=)(\([^)]*\))', raw)
    if pm:
        pv = t3d.vec(pm.group(2))
        raw = raw.replace(pm.group(0), '%s(X=%.3f,Y=%.3f,Z=%.3f)' % (pm.group(1), pv[0] * s[0], pv[1] * s[1], pv[2] * s[2]), 1)
    return raw


def entry_xform(pivot, e):
    """The placement of a structure edit (offset, yaw, scale, stretch) as an XForm."""
    import geom
    return geom.XForm(pivot, e.get('offset') or (0, 0, 0), int(e.get('yaw') or 0), e.get('scale') or (1, 1, 1),
                      bool(e.get('stretch')), pitch=e.get('pitch') or 0, roll=e.get('roll') or 0)


def place(entry):
    """The T3D blocks of one paste, renamed (unique in the map) and placed. Returns (blocks, brush
    names, actor names)."""
    pf = entry.get('_prefab') or load(entry['prefab'])
    tag = re.sub(r'\W', '', str(entry['pid']))
    xf = entry_xform(pf['pivot'], entry)
    out, brushes, actors = [], [], []
    for i, b in enumerate(pf['blocks']):
        raw = b['raw']
        original_raw = raw
        new = 'UCPf%s%s%d' % (tag, 'B' if b['brush'] else 'A', i)
        model = re.search(r"Brush=Model'MyLevel\.(\w+)'", raw)
        if model:
            raw = raw.replace("Model'MyLevel.%s'" % model.group(1), "Model'MyLevel.UCPf%sM%d'" % (tag, i))
            raw = re.sub(r'Begin Brush Name=\w+', 'Begin Brush Name=UCPf%sM%d' % (tag, i), raw, count=1)
        if b['brush']:
            brushes.append(new)
        else:
            actors.append(new)
        raw = re.sub(r'^Begin Actor Class=(\S+) Name=\S+', r'Begin Actor Class=\1 Name=%s' % new, raw, count=1)
        raw = xf_block(raw, xf) if (any(xf.offset) or xf.rotated or xf.scaled) else raw
        if b.get('mover'):
            import moving_pieces
            raw = moving_pieces.apply_settings(raw, entry.get('moverSettings'))
            raw = moving_pieces.placed(raw, xf, new, original_raw)
        out.append(raw)
    return out, brushes, actors
