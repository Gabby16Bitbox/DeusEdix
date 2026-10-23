"""Existing maps in the map editor: the mod's copies in maps\\ (made in UnrealEd or by Codex: the
Hotel, the Helibase, Tong's base...) and the original Revision maps.

No map script and no markup: the editor shows the .dx itself, its objects are edited by name and
its structures are found automatically (brushes that touch, or the UnrealEd groups of the level
designer, with the lamps and props standing on them).

The source is never changed by a build: edits (maps\\<map>.edits.json next to the map scripts) are
applied to a private copy (tools\\mapkit\\out\\<map>.dx) by the headless SDK editor: UC_SET / UC_DEL,
imported actors and blocks, then BSP, lighting and paths only when geometry or lights changed.
Installing puts the result in maps\\ (UnatcoMaps in the game: the original stays as it is), after
checking that nobody (Codex) changed the mod's copy in the meantime; the edits are then part of the
map and the edits file starts again empty.
"""
import hashlib
import json
import re
import shutil
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
PROJECT = KIT.parents[1]
sys.path.insert(0, str(KIT))
import geom  # noqa: E402
import kit  # noqa: E402
import settings  # noqa: E402
import prefabs  # noqa: E402
import textures  # noqa: E402
import props  # noqa: E402
import comptexts  # noqa: E402
import documents  # noqa: E402
import anims  # noqa: E402
import behaviours  # noqa: E402
import mapsettings  # noqa: E402
import sounds  # noqa: E402
import links  # noqa: E402
import models  # noqa: E402
import zones  # noqa: E402
import blocks  # noqa: E402
import cutscenes  # noqa: E402
import navbake  # noqa: E402
import motions  # noqa: E402
import surfaces  # noqa: E402
import t3d  # noqa: E402
import activation  # noqa: E402
import rebuild  # noqa: E402
from scene import Scene, PF_SEMISOLID  # noqa: E402

OUT = KIT / 'out'
MOD_MAPS = PROJECT / 'maps'
GAME_MAPS = settings.REVISION_MAPS
PREFIX = 'dx:'


def isolated_project():
    """Independent campaigns never fall through to the installed campaign's maps."""
    return getattr(settings, 'PROJECT_KIND', 'legacy') in ('custom', 'tutorial')


def script_maps():
    names = set()
    for p in (KIT / 'maps').glob('*.py'):
        m = re.search(r"^MAP\s*=\s*'([^']+)'", p.read_text(encoding='utf-8'), re.M)
        if m:
            names.add(m.group(1))
    return names


def listing():
    """Maps the editor can open without a script: the mod's copies first, then the originals."""
    made = script_maps()
    mod = sorted(p.stem for p in MOD_MAPS.glob('*.dx') if p.stem not in made)
    game = sorted(p.stem for p in GAME_MAPS.glob('*.dx') if p.stem not in made and p.stem not in mod
                  and re.match(r'^\d\d_', p.stem)) if not isolated_project() and GAME_MAPS.exists() else []
    out = [dict(script=PREFIX + m, map=m, kind='mod', built=(OUT / (m + '.dx')).exists()) for m in mod]
    out += [dict(script=PREFIX + m, map=m, kind='game', built=(OUT / (m + '.dx')).exists()) for m in game]
    return out


def source(map_name):
    """The map as it is now: the mod's copy if there is one, otherwise the original."""
    info_path = _info_path(map_name)
    info = json.loads(info_path.read_text(encoding='utf-8')) if info_path.exists() else {}
    authoring = _authoring(map_name) or info.get('authoring')
    if authoring:
        private = _authoring_path(map_name)
        installed = MOD_MAPS / (map_name + '.dx')
        if not private.exists() or stamp(private)['sha1'] != authoring['source']['sha1']:
            raise ValueError('The editable source of %s changed or is missing; restore it before rebuilding.' % map_name)
        if not installed.exists() or stamp(installed)['sha1'] != authoring['installed']['sha1']:
            raise ValueError('The installed copy of %s changed outside DeusEdix. Import that copy as a new map before merging.' % map_name)
        return private
    p = MOD_MAPS / (map_name + '.dx')
    if p.exists():
        return p
    if not isolated_project():
        p = GAME_MAPS / (map_name + '.dx')
        if p.exists():
            return p
    raise FileNotFoundError(map_name)


def _authoring_path(map_name):
    # Project data, not out/ (which the uninstaller and cache cleanup remove).
    return MOD_MAPS / '.authoring' / (map_name + '.dx')


def _authoring(map_name):
    path = _authoring_path(map_name).with_suffix('.json')
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else None


def stamp(path):
    path = Path(path)
    h = hashlib.sha1(path.read_bytes()).hexdigest()
    return dict(path=str(path), size=path.stat().st_size, sha1=h)


def edits_path(map_name):
    return KIT / 'maps' / (map_name + '.edits.json')


def load_edits(map_name):
    p = edits_path(map_name)
    if p.exists():
        return json.loads(p.read_text(encoding='utf-8'))
    return dict(moved={}, deleted={}, added=[], boxes=[], groups={}, copies=[])


def _edits_fingerprint(edits):
    """The exact saved authoring state consumed by a build, ignoring JSON formatting."""
    import player_profiles
    dependency = player_profiles.build_dependency(edits)
    state = edits if dependency is None else dict(edits=edits, player=dependency)
    return hashlib.sha256(json.dumps(state, sort_keys=True, separators=(',', ':')).encode('utf-8')).hexdigest()


def _info_path(map_name):
    return OUT / (map_name + '.dxinfo.json')


def built_current(map_name):
    """The private build exists and was made from the source as it is now."""
    info = _info_path(map_name)
    out = OUT / (map_name + '.dx')
    if not (info.exists() and out.exists()):
        return False
    d = json.loads(info.read_text(encoding='utf-8'))
    b = d.get('built')
    if not b:
        return False
    src = source(map_name)
    return b['source']['path'] == str(src) and b['source']['size'] == src.stat().st_size and \
        b['source']['sha1'] == stamp(src)['sha1']


def shown(map_name):
    """What the editor shows: the private build when it is current, otherwise the source."""
    return OUT / (map_name + '.dx') if built_current(map_name) else source(map_name)


# ------------------------------------------------------------------------------------------ structures
SMALL = 1024     # a brush wider or taller than this is architecture (walls, floors), not a structure
WIDE = 2048      # a group of touching brushes wider than this is part of the building
SECTION = 1024   # long chains of touching pieces are cut in sections of about this size
PROP_KINDS = ('prop', 'light')
ANALYSIS = 4     # version of analyze(): maps analysed by an older one are analysed again
                 # 4: each brush's box and main texture (its pieces, for the editor's Un-nest)


def analyze(map_name, cache_folder, actors):
    """Automatic structures of an existing map from the editor cache of its SOURCE (brushes.json with
    the box of every brush, the actors): the level designer's UnrealEd groups when there are any,
    otherwise brushes that touch each other; lamps and props standing on them go with them."""
    brushes = json.loads((Path(cache_folder) / 'brushes.json').read_text(encoding='utf-8'))
    cand = []
    for b in brushes:
        if b['csg'] != 1 or not b.get('lo'):
            continue
        ext = [b['hi'][i] - b['lo'][i] for i in range(3)]
        if max(ext[0], ext[1]) > SMALL or ext[2] > SMALL:
            continue
        cand.append(b)
    parent = list(range(len(cand)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        a, b = find(i), find(j)
        if a != b:
            parent[b] = a

    by_group = {}
    for i, b in enumerate(cand):
        if b['group'] not in ('None', ''):
            by_group.setdefault(b['group'], []).append(i)
    for idx in by_group.values():
        for j in idx[1:]:
            union(idx[0], j)
    # touching brushes (a coarse grid keeps it fast on big maps)
    cell = 256
    grid = {}
    for i, b in enumerate(cand):
        for gx in range(int(b['lo'][0] // cell), int(b['hi'][0] // cell) + 1):
            for gy in range(int(b['lo'][1] // cell), int(b['hi'][1] // cell) + 1):
                grid.setdefault((gx, gy), []).append(i)
    for idx in grid.values():
        for a in range(len(idx)):
            ba = cand[idx[a]]
            if ba['group'] not in ('None', ''):
                continue
            for c in range(a + 1, len(idx)):
                bc = cand[idx[c]]
                if bc['group'] not in ('None', ''):
                    continue
                if all(ba['lo'][k] <= bc['hi'][k] + 1 and bc['lo'][k] <= ba['hi'][k] + 1 for k in range(3)):
                    union(idx[a], idx[c])
    clusters = {}
    for i in range(len(cand)):
        clusters.setdefault(find(i), []).append(cand[i])
    # a chain too long to be one piece (a fence along a street, a row of shelves) is cut in sections
    pieces = []
    for members in clusters.values():
        lo = [min(b['lo'][k] for b in members) for k in range(3)]
        hi = [max(b['hi'][k] for b in members) for k in range(3)]
        if max(hi[0] - lo[0], hi[1] - lo[1]) <= WIDE:
            pieces.append(members)
            continue
        cells = {}
        for b in members:
            c = (int(((b['lo'][0] + b['hi'][0]) / 2) // SECTION), int(((b['lo'][1] + b['hi'][1]) / 2) // SECTION))
            cells.setdefault(c, []).append(b)
        pieces += list(cells.values())
    out = {}
    n = 0
    for members in sorted(pieces, key=lambda m: (m[0]['lo'][2], m[0]['lo'][0], m[0]['lo'][1])):
        lo = [min(b['lo'][k] for b in members) for k in range(3)]
        hi = [max(b['hi'][k] for b in members) for k in range(3)]
        if max(hi[0] - lo[0], hi[1] - lo[1]) > WIDE:
            continue
        n += 1
        tex = {}
        for b in members:
            for t, c in b.get('tex', {}).items():
                tex[t] = tex.get(t, 0) + c
        main = ' + '.join(sorted(tex, key=tex.get, reverse=True)[:3]) if tex else 'piece'   # searchable: chain, fence...
        group = members[0]['group'] if members[0]['group'] not in ('None', '') else None
        name = 's_' + min(b['name'] for b in members)      # stable: the edits keep pointing at it
        out[name] = dict(label=(group or main) + (' · %d pieces' % len(members) if len(members) > 1 else ''),
                         category='UnrealEd groups' if group else 'Map pieces',
                         pivot=[round((lo[0] + hi[0]) / 2, 1), round((lo[1] + hi[1]) / 2, 1), round(lo[2], 1)],
                         lo=lo, hi=hi, brush_names=[b['name'] for b in members],
                         brush_info={b['name']: dict(loc=b['loc'], rot=b['rot'], lo=b['lo'], hi=b['hi'],
                                                     tex=max(b.get('tex') or {'': 0}, key=(b.get('tex') or {'': 0}).get))
                                     for b in members},
                         actors=[], actor_info={}, copy_of=None, copyable=False, rotatable=True, gameplay=False,
                         deleted=False, placement=dict(offset=[0, 0, 0], yaw=0))
    # lamps and props standing on (or hanging from) a structure go with it: the smallest one around them
    for a in actors:
        if a['kind'] not in PROP_KINDS:
            continue
        x, y, z = a['loc']
        best, vol = None, None
        for name, st in out.items():
            lo, hi = st['lo'], st['hi']
            if lo[0] - 16 <= x <= hi[0] + 16 and lo[1] - 16 <= y <= hi[1] + 16 and lo[2] - 32 <= z <= hi[2] + 96:
                v = (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1)
                if vol is None or v < vol:
                    best, vol = name, v
        if best:
            out[best]['actors'].append(a['name'])
            out[best]['actor_info'][a['name']] = dict(loc=list(a['loc']), rot=list(a['rot']), cls=a['cls'])
    return out


def _piece_pivot(bi):
    lo, hi = bi.get('lo'), bi.get('hi')
    if not lo or not hi:
        return [round(float(v), 1) for v in bi['loc']]
    return [round((lo[0] + hi[0]) / 2, 1), round((lo[1] + hi[1]) / 2, 1), round(lo[2], 1)]


def _piece_label(s, b, bi):
    return '%s · %s' % (bi.get('tex') or 'brush', b) if len(s['brush_names']) > 1 else s['label']


def unnested(structs, unnest):
    """Structures taken apart in the editor (edits['unnest']): 'S' (all of it: each brush a structure
    of its own, its objects free), 'S/<brush>' (one brush), 'a:<actor>' (one object out of it)."""
    want = set(unnest or [])
    if not want:
        return structs
    out = {}
    for name, s in structs.items():
        whole = name in want
        take = [b for b in s['brush_names'] if whole or '%s/%s' % (name, b) in want]
        free = [a for a in s['actors'] if whole or 'a:' + a in want]
        if not take and not free:
            out[name] = s
            continue
        rest = dict(s, brush_names=[b for b in s['brush_names'] if b not in take],
                    actors=[a for a in s['actors'] if a not in free])
        if rest['brush_names'] or rest['actors']:
            out[name] = rest
        for b in take:
            bi = s['brush_info'][b]
            out['%s/%s' % (name, b)] = dict(
                label=_piece_label(s, b, bi), category=s['category'], pivot=_piece_pivot(bi), lo=bi.get('lo'), hi=bi.get('hi'),
                brush_names=[b], brush_info={b: bi}, actors=[], actor_info={}, copy_of=None, copyable=False,
                rotatable=True, gameplay=False, deleted=False, placement=dict(offset=[0, 0, 0], yaw=0), piece_of=name)
    return out


def reference(map_name, log=print):
    """An ORIGINAL game map (never the mod's copy) as a library of pieces: its automatic structures,
    cached as the editor map 'ref_<map>'. Returns (cache name, cache folder, structures)."""
    import data
    key = 'ref_' + map_name
    src = GAME_MAPS / (map_name + '.dx')
    folder = data.prepare(key, src=src, log=log, lite=True,
                          analyse=lambda f: structures(key, f, data.actors(key), src=src))
    return key, folder, data.structures(key)


def structures(map_name, cache_folder=None, actors=None, src=None):
    """Automatic structures of map_name, with the placements of the last build (out\\<map>.groups.json
    for the editor). Analysed again when the source changed. src: the .dx (default: source())."""
    info_p = _info_path(map_name)
    info = json.loads(info_p.read_text(encoding='utf-8')) if info_p.exists() else {}
    src = src or source(map_name)
    st = stamp(src)
    if info.get('source', {}).get('sha1') != st['sha1'] or 'structures' not in info or info.get('analysis') != ANALYSIS:
        if cache_folder is None:
            return {}
        built = info.get('built')       # a build made before the first analysis stays valid for the same source
        if not (built and built.get('source', {}).get('sha1') == st['sha1']):
            built = None
        info = dict(source=st, structures=analyze(map_name, cache_folder, actors or []), built=built, analysis=ANALYSIS,
                    **({'authoring': info['authoring']} if info.get('authoring') else {}))
        info_p.parent.mkdir(parents=True, exist_ok=True)
        info_p.write_text(json.dumps(info), encoding='utf-8')
    structs = info['structures']
    current = built_current(map_name)
    placed = (info.get('built') or {}).get('groups', {}) if current else {}
    if current:                         # taken apart at the last build (the editor shows the rest as pending)
        structs = unnested(structs, (info.get('built') or {}).get('unnest'))
    shown_ = {}
    for name, s in structs.items():
        e = placed.get(name) or {}
        bi = s.get('brush_info') or {}
        # its pieces (each brush), for the editor's Un-nest
        pieces = [dict(id='%s/%s' % (name, b), label=_piece_label(s, b, bi[b]), pivot=_piece_pivot(bi[b]),
                       brush_names=[b], actors=[]) for b in s['brush_names'] if b in bi] if not name.startswith('paste~') else []
        s = dict(s, placement=dict(offset=e.get('offset', [0, 0, 0]), yaw=e.get('yaw', 0), pitch=e.get('pitch', 0), roll=e.get('roll', 0), scale=e.get('scale', [1, 1, 1]),
                                   stretch=bool(e.get('stretch'))), deleted=bool(e.get('deleted')), pieces=pieces)
        for k in ('brush_info', 'actor_info', 'lo', 'hi'):
            s.pop(k, None)
        shown_[name] = s
    if built_current(map_name):
        shown_.update((info.get('built') or {}).get('pastes') or {})
    gp = OUT / (map_name + '.groups.json')
    text = json.dumps(shown_)
    if not gp.exists() or gp.read_text(encoding='utf-8') != text:
        gp.write_text(text, encoding='utf-8')
    return shown_


# ------------------------------------------------------------------------------------------ build
NAV = ('PathNode', 'PatrolPoint', 'HidePoint', 'AmbushPoint', 'PlayerStart', 'Teleporter', 'MapExit')
# PATHS DEFINE with every walking point rested on the floor for it (host UC_NAVDROP temp / UC_NAVLIFT)
NAV_DEFINE = ['UC_NAVDROP temp', 'PATHS DEFINE', 'UC_NAVLIFT']


def _cmdname(n):
    return re.sub(r'[^\w]', '', n)


BSP_OPTIMAL = 'BSP REBUILD OPTIMAL BALANCE=15'      # UnrealEd's rebuild options the maps were built with
MAX_NODES = 65536                                   # UModel's limit (Engine UnModel.h), asserted by Revision's renderer


def build(map_name, log=print, options=None):
    """Apply the edits to a private copy of the source. Returns (ok, lines)."""
    options = rebuild.normalize(options)
    src = source(map_name)
    OUT.mkdir(parents=True, exist_ok=True)
    edits = load_edits(map_name)
    edits_fingerprint = _edits_fingerprint(edits)
    disabled = activation.names(edits)
    surface_cmds = surfaces.commands(edits)
    info = json.loads(_info_path(map_name).read_text(encoding='utf-8')) if _info_path(map_name).exists() else {}
    structs = unnested(info.get('structures', {}), edits.get('unnest'))     # taken apart in the editor (Un-nest)
    lines = rebuild.report(options)
    folder = kit.new_run([src], 'dxedit-' + map_name)
    # the mod's package too: objects of its classes (UCTextBlock, UCCustom* characters) are imported later
    cmds = [r'MAP LOAD FILE="..\Input\%s"' % src.name, 'OBJ LOAD FILE="%s.u"' % settings.PACKAGE]
    if any(b.get('sign') for b in edits.get('boxes') or []):
        cmds.append('OBJ LOAD FILE="CoreTexMetal.utx"')     # the iron frame of the signs (textures.SIGN_FRAME)
    # pictures imported in the editor: into the map, then on the faces (no rebuild) and on the objects
    cmds += textures.import_commands(edits, folder)
    cmds += textures.surface_commands(edits, structs)
    for r in edits.get('retexture') or []:
        lines.append('  EDIT texture %s on %s' % (r.get('tex'), r.get('name') or 'the whole map'))
    geometry = lights = nav = False
    import mover_transform
    cached_scene = Path(__file__).resolve().parent / 'cache' / map_name / 'scene.t3d'
    mover_poses = {a['name']: a['props'] for a in t3d.actors(cached_scene.read_text(encoding='latin1', errors='replace'))
                   if 'Mover' in a['cls']} if cached_scene.exists() else {}
    def move_keys(name, location, rotation, cls):
        if 'Mover' not in cls:
            return
        if name not in mover_poses:
            raise ValueError('Reopen this map before moving its doors or elevators: their motion keys are not cached.')
        props = mover_poses[name]
        xf_mover = mover_transform.relocation(props, location, rotation)
        for key, value in mover_transform.properties(props, xf_mover).items():
            cmds.append('UC_PROP %s %s %s' % (_cmdname(name), key, value))
    individually = set(edits.get('moved', {})) | set(edits.get('deleted', {}))
    # structures: their brushes and their objects, turned around the pivot and moved
    for name, e in (edits.get('groups') or {}).items():
        s = structs.get(name)
        if not s:
            lines.append('  EDIT skipped structure %s (not found in the map any more)' % name)
            continue
        if e.get('deleted'):
            for b in s['brush_names']:
                cmds.append('UC_DEL %s' % b)
            for a in s['actors']:
                if a not in individually:
                    cmds.append('UC_DEL %s' % a)
            geometry = lights = nav = True
            lines.append('  EDIT deleted structure %s (%s)' % (name, s['label']))
            continue
        off, yaw = e.get('offset') or [0, 0, 0], int(e.get('yaw') or 0) % 65536
        xf = prefabs.entry_xform(s['pivot'], e)
        if not any(off) and not xf.rotated and not xf.scaled:
            continue
        for b in s['brush_names']:
            bi = s['brush_info'][b]
            p = xf.point(bi['loc'])
            r = bi['rot']
            cmds.append('UC_SET %s %.3f %.3f %.3f %d %d %d' % ((b, p[0], p[1], p[2]) + xf.rot(r)))
            if xf.scaled:               # its faces stretch in its own frame (quarter turns swap the axes)
                sx, sy, sz = xf.scale
                if round(r[1] / 16384) % 2:
                    sx, sy = sy, sx
                cmds.append('UC_PROP %s MainScale (Scale=(X=%.4f,Y=%.4f,Z=%.4f),SheerAxis=SHEER_None)' % (b, sx, sy, sz))
        for a in s['actors']:
            if a in individually:
                continue
            ai = s['actor_info'][a]
            p = xf.point(ai['loc'])
            r = ai['rot']
            cmds.append('UC_SET %s %.3f %.3f %.3f %d %d %d' % ((a, p[0], p[1], p[2]) + xf.rot(r)))
            move_keys(a, p, xf.rot(r), ai['cls'])
            lights = lights or 'Light' in ai['cls']
        geometry = lights = nav = True
        lines.append('  EDIT moved structure %s (%s) by (%g, %g, %g)%s%s' % (
            name, s['label'], off[0], off[1], off[2], ', turned %d deg' % round(yaw * 360 / 65536) if yaw else '',
            ', stretched %s' % '/'.join('%g' % k for k in xf.scale) if xf.scaled else ''))
    for n, m in (edits.get('moved') or {}).items():
        x, y, z = m['loc']
        r = m.get('rot') or [0, 0, 0]
        cmds.append('UC_SET %s %.3f %.3f %.3f %d %d %d' % (_cmdname(n), x, y, z, int(r[0]), int(r[1]), int(r[2])))
        if m.get('scale') and abs(float(m['scale']) - 1) > 1e-3:
            cmds.append('UC_SCALE %s %.4f' % (_cmdname(n), float(m['scale'])))
        cls = (m.get('cls') or '').split('.')[-1]
        move_keys(n, (x, y, z), r, cls)
        lights = lights or 'Light' in cls
        nav = nav or cls in NAV
        lines.append('  EDIT moved %s' % n)
    for n, d in (edits.get('deleted') or {}).items():
        cmds.append('UC_DEL %s' % _cmdname(n))
        cls = (d.get('cls') or '').split('.')[-1]
        lights = lights or 'Light' in cls
        nav = nav or cls in NAV
        lines.append('  EDIT deleted %s' % n)
    blocks, pastes = [], {}
    for e in edits.get('prefabs') or []:            # structures copied from other maps
        if e.get('deleted'):
            continue
        try:
            pf = prefabs.load(e['prefab'])
            pb, brushes, actors = prefabs.place(e)
        except (OSError, KeyError, ValueError) as err:
            lines.append('  EDIT skipped paste %s (%s)' % (e.get('pid'), err))
            continue
        for c in prefabs.package_commands(pf['packages']):
            if c not in cmds:
                cmds.insert(1, c)
        blocks += pb
        pastes['paste~%s' % e['pid']] = dict(label='%s (from %s)' % (pf['label'], pf['source']), category='Pasted',
                                              pivot=pf['pivot'], brush_names=brushes, actors=actors, copy_of=None,
                                              copyable=False, rotatable=pf.get('rotatable', True), gameplay=False,
                                              deleted=False, placement=dict(offset=list(e.get('offset') or [0, 0, 0]),
                                                                            yaw=int(e.get('yaw') or 0),
                                                                            pitch=int(e.get('pitch') or 0), roll=int(e.get('roll') or 0),
                                                                            scale=list(e.get('scale') or [1, 1, 1]),
                                                                            stretch=bool(e.get('stretch'))))
        geometry = lights = nav = True
        lines.append('  EDIT pasted %s from %s' % (pf['label'], pf['source']))
    movers = re.findall(r'Begin Actor Class=DeusExMover Name=(\w+)', '\n'.join(blocks))
    for a in edits.get('added') or []:
        if a.get('raw'):            # a whole T3D block (a mover copied from an original map: prefabs.original_actor)
            blocks.append(a['raw'] if a['raw'].endswith('\n') else a['raw'] + '\n')
            if 'Mover' in a['cls']:
                movers.append(a['name'])
        else:
            props_a = dict(a.get('props', {}))
            if str(a['cls']).endswith('UCCutscene'):     # its keys, lines and options (editor/cutscenes.py)
                props_a.update(cutscenes.props(edits, a['name']))
            blocks.append(Scene._block(a['cls'], tuple(a['loc']), a['name'], tuple(int(v) for v in a.get('rot', (0, 0, 0))), '',
                                       props_a))
        lights = lights or a['cls'] in ('Light', 'Spotlight')
        nav = nav or a['cls'].split('.')[-1] in NAV        # patrol points of a route: the AI needs paths to them
        lines.append('  EDIT added %s %s' % (a['cls'], a['name']))
    # the emails and bulletins of the computers: hidden UCTextBlock actors (comptexts.py)
    # Replace a previously baked document block by its stable name before importing the new one.
    cmds += ['UC_DEL ' + documents.tag(map_name, name) for name in documents.validate(edits)]
    for a in comptexts.blocks(edits, map_name) + documents.blocks(edits, map_name):
        blocks.append(Scene._block(a['cls'], tuple(a['loc']), a['name'], (0, 0, 0), '', a['props']))
    lines += comptexts.report(edits)
    lines += documents.report(edits)
    # what the characters do when not busy, their models with new animations: UCAnimSet actors (anims.py)
    for a in anims.blocks(edits):
        blocks.append(Scene._block(a['cls'], tuple(a['loc']), a['name'], (0, 0, 0), '', a['props']))
    lines += anims.report(edits)
    # the characters' behaviours and JC's movement: UCBehave, UCPlayerMove actors (behaviours.py)
    for a in behaviours.blocks(edits):
        blocks.append(Scene._block(a['cls'], tuple(a['loc']), a['name'], (0, 0, 0), '', a['props']))
    lines += behaviours.report(edits)
    # the interactions (when this happens, do that): UCLink actors of the mod (links.py)
    for a in links.blocks(edits):
        blocks.append(Scene._block(a['cls'], tuple(a['loc']), a['name'], (0, 0, 0), '', a['props']))
    lines += links.report(edits)
    lines += cutscenes.report(edits)
    # zones: the WaterZone of every pool, a sky box (and its SkyZoneInfo) for sky surfaces in a map without a sky
    scene_t3d = Path(__file__).resolve().parent / 'cache' / map_name / 'scene.t3d'
    has_sky = scene_t3d.exists() and 'Class=SkyZoneInfo ' in scene_t3d.read_text(encoding='latin1', errors='replace')
    sky_ops, sky_actors = zones.skybox(edits, has_sky)
    for a in zones.actors(edits) + sky_actors:
        blocks.append(Scene._block(a['cls'], tuple(a['loc']), a['name'], (0, 0, 0), '', a['props']))
    # animations (editor/motions.py): moving blocks (movers), a UCMotion per animated object
    scene_text = scene_t3d.read_text(encoding='latin1', errors='replace') if scene_t3d.exists() else ''
    # the walkable area in the game (navbake.py): the editor's polygons, made again before every Rebuild
    cmds.append('UC_DEL UCNavMesh0')
    for a in navbake.blocks(edits, map_name):
        blocks.append(Scene._block(a['cls'], tuple(a['loc']), a['name'], (0, 0, 0), '', a['props']))
    lines += navbake.report(edits, map_name)
    map_movers = set(re.findall(r'Begin Actor Class=\w*Mover\w* Name=(\w+)', scene_text))
    map_lights = set(re.findall(r'Begin Actor Class=(?:Light|Spotlight|TriggerLight)\w* Name=(\w+)', scene_text))
    map_lights |= {a['name'] for a in edits.get('added') or [] if a['cls'] in ('Light', 'Spotlight')}
    if settings.STANDALONE and not re.search(r'Begin Actor Class=(?:\w+\.)?UCBoot ', scene_text):
        # DeusEdix: the actor that starts the editor's story, texts and characters' fates in the game
        blocks.append(Scene._block('UCBoot', (0, 0, 0), 'UCBoot0', (0, 0, 0), '', {}))
    for b in edits.get('boxes') or []:
        if b.get('mover') and all(b['hi'][k] > b['lo'][k] for k in range(3)):
            blocks.append(motions.mover_block_t3d(b))
            movers.append(b['name'])
            lights = True
            lines.append('  EDIT moving block %s' % b['name'])
    for a in motions.blocks(edits, map_movers):
        blocks.append(Scene._block(a['cls'], tuple(a['loc']), a['name'], (0, 0, 0), '', a['props']))
    lines += motions.report(edits, map_movers)
    # the map's settings (music, information, ambient light): UC_PROP on its own actors, a music actor if none
    level_cmds, level_blocks, level_loads = mapsettings.commands(edits, map_name)
    # Replace our previous cooked choice before importing its replacement.
    if level_blocks and any(a['cls'] == 'UCPlayerMap' for a in level_blocks):
        cmds.append('UC_DEL UCPlayerMap0')
    for a in level_blocks:
        blocks.append(Scene._block(a['cls'], tuple(a['loc']), a['name'], (0, 0, 0), '', a['props']))
    for c in level_loads + sounds.load_commands(edits) + models.load_commands(edits) + zones.packages(edits):
        if c not in cmds:
            cmds.insert(1, c)
    lines += mapsettings.report(edits)
    if (edits.get('level') or {}).get('ambient'):
        lights = True
    cmds += ['UC_DEL UCTag_' + name for name in links.object_tags.entries(edits)]
    if blocks:
        (folder / 'T3D' / 'added.t3d').write_text(t3d.import_text(blocks), encoding='latin1')
        cmds.append(r'MAP IMPORTADD FILE="..\T3D\added.t3d"')
        cmds += ['UC_MOVER prep %s 1 1 1' % m for m in movers]
        cmds += ['UC_SCALE %s %.4f' % (a['name'], float(a['scale'])) for a in edits.get('added') or []
                 if a.get('scale') and abs(float(a['scale']) - 1) > 1e-3]
    for i, b in enumerate(edits.get('boxes') or []):
        lo, hi = b['lo'], b['hi']
        if not all(hi[k] > lo[k] for k in range(3)):
            continue
        if b.get('mover'):                       # a moving block: a mover, imported with the actors
            continue
        if zones.is_zone_box(b):                 # water (pool, surface = zone portal) or a zone portal
            for j, (op, br, fl) in enumerate(zones.brush_ops(b)):
                f = 'box%d_%d.t3d' % (i, j)
                br = geom.rotate_brush(br, [(lo[k]+hi[k])/2 for k in range(3)], b.get('rot'), op == 'sub')
                (folder / 'T3D' / f).write_text(br.t3d(), encoding='ascii')
                cmds += ['BRUSH RESET', r'BRUSH IMPORT FILE="..\T3D\%s"' % f,
                         'BRUSH SUBTRACT' if op == 'sub' else 'BRUSH ADD FLAGS=%d' % fl]
            geometry = lights = nav = True
            lines.append('  EDIT %s %s' % ('water' if b.get('water') else 'zone portal', b.get('name')))
            continue
        mats = zones.hole_mats(b) if b.get('hole') and b.get('sky') else textures.sign_mats(b, edits)
        # a cube, a wedge, a cylinder, a cone, a sphere, a dome; a hollow one: its convex pieces
        for j, brush in enumerate(blocks.brushes(b, mats, 'EditBox%d' % i)):
            brush = geom.rotate_brush(brush, [(lo[k]+hi[k])/2 for k in range(3)], b.get('rot'), bool(b.get('hole')))
            f = 'box%d.t3d' % i if j == 0 else 'box%d_p%d.t3d' % (i, j)
            (folder / 'T3D' / f).write_text(brush.t3d(), encoding='ascii')
            cmds += ['BRUSH RESET', r'BRUSH IMPORT FILE="..\T3D\%s"' % f,
                     'BRUSH SUBTRACT' if b.get('hole') else 'BRUSH ADD' if b.get('solid') else 'BRUSH ADD FLAGS=%d' % PF_SEMISOLID]
        geometry = lights = nav = True
        lines.append('  EDIT %s %s' % ('hole' if b.get('hole') else 'block', b.get('name')))
    import drawn                                # walls, roads, floors and roofs drawn in the editor (Map > Draw ...)
    built, drawn_report = drawn.all_brushes(edits)
    for pkg in drawn.packages(edits):           # their textures' packages, and the blocks' (the map may not have them)
        c = 'OBJ LOAD FILE="%s.utx"' % pkg
        if (built or edits.get('boxes')) and c not in cmds:
            cmds.insert(1, c)
    for j, (pname, br) in enumerate(built):
        (folder / 'T3D' / ('drawn%d.t3d' % j)).write_text(br.t3d(), encoding='ascii')
        cmds += ['BRUSH RESET', r'BRUSH IMPORT FILE="..\T3D\drawn%d.t3d"' % j, 'BRUSH ADD FLAGS=%d' % PF_SEMISOLID]
        geometry = lights = nav = True
    if built:
        lines.append('  EDIT drawn: %d pieces (%s)' % (len(built), ', '.join(sorted({n for n, _b in built}))))
    lines += drawn_report
    for j, (op, br, fl) in enumerate(motions.wall_ops(edits)):     # invisible walls (solid collision boxes)
        (folder / 'T3D' / ('wall%d.t3d' % j)).write_text(br.t3d(), encoding='ascii')
        cmds += ['BRUSH RESET', r'BRUSH IMPORT FILE="..\T3D\wall%d.t3d"' % j, 'BRUSH ADD FLAGS=%d' % fl]
        geometry = lights = nav = True
    for j, (op, br, fl) in enumerate(sky_ops):    # the sky box: a closed room far away
        (folder / 'T3D' / ('sky%d.t3d' % j)).write_text(br.t3d(), encoding='ascii')
        cmds += ['BRUSH RESET', r'BRUSH IMPORT FILE="..\T3D\sky%d.t3d"' % j,
                 'BRUSH SUBTRACT' if op == 'sub' else 'BRUSH ADD FLAGS=%d' % fl if fl else 'BRUSH ADD']
        geometry = lights = True
        lines.append('  EDIT sky box (%s)' % (edits.get('level') or {}).get('sky', 'hongkong'))
    cmds += textures.actor_commands(edits, map_name)
    cmds += props.commands(edits)              # the Properties panel (no rebuild needed)
    cmds += documents.commands(edits, map_name)
    cmds += links.commands(links.object_tags.with_baked(edits,scene_text), {a['name']:a for a in list(t3d.actors(scene_text))+list(edits.get('added') or []) if a['name'] in map_lights})              # lights the interactions turn on and off
    cmds += motions.commands(edits, map_movers, map_lights)   # the keys of animated movers, moving lights
    cmds += level_cmds
    import player_profiles
    cmds += player_profiles.prepare_commands(edits, folder, log=log)
    cmds += activation.commands(edits)
    if disabled:
        lights = nav = True             # inactive lights and collision must not survive in baked data
        lines += ['  EDIT disabled in game: ' + name for name in sorted(disabled)]
    if any(re.match(r'(Light|Volume|bSpecialLit)', k) for p in (edits.get('props') or {}).values() for k in p):
        lights = True                          # a light changed in the Properties panel: the lighting is made again
    lines += props.report(edits)
    stages = rebuild.plan(options, geometry=geometry, lights=lights, paths=nav,
                          keep_paths=edits.get('paths') is False, inactive=bool(disabled))
    if nav and not stages['paths']:
        lines.append('  paths kept as they are (edits: paths = false)')
    geometry, lights, nav = stages['geometry'], stages['lights'], stages['paths']
    if geometry:
        # MAP REBUILD alone leaves the BSP as the brushes cut it (Revision's 04_NYC_Street: 67758 nodes, over the
        # engine's 65536: LIGHT APPLY and the game crash); UnrealEd's optimal rebuild, as the maps were built,
        # gives it back its size (54348, the original 52421) and its zones
        cmds += ['MAP REBUILD', BSP_OPTIMAL, 'UC_WORLD finish']
    if surface_cmds:
        cmds += surfaces.load_commands(edits, local_package=src.stem) + ['UC_LIGHTSTATS'] + surface_cmds
        lights = lights or surfaces.needs_lighting(edits)
    if nav:
        # the path points placed or moved in the editor rest on the floor (no reach spec from a floating one)
        mine = [_cmdname(a['name']) for a in edits.get('added') or [] if a['cls'].split('.')[-1] in NAV and a['name'] not in disabled]
        mine += [_cmdname(n) for n, m in (edits.get('moved') or {}).items() if (m.get('cls') or '').split('.')[-1] in NAV and n not in disabled]
        if mine:
            cmds.append('UC_NAVDROP ' + ' '.join(mine))
        # the map's own points (11-44 units over the floor in the original maps) are linked on the floor and put
        # back where they were: PATHS DEFINE alone kept 302 of Battery Park's 1409 reach specs (17 Oct 2026).
        # The map's own links it still does not make (Battery Park's subway stairs) come back when their points
        # are where they were and nothing was built across them (host UC_KEEPPATHS, saved right after MAP LOAD)
        cmds.insert(1, 'UC_KEEPPATHS save')
        cmds += NAV_DEFINE + ['UC_KEEPPATHS restore']
    if lights:
        cmds += ['LIGHT APPLY', 'UC_CAMERAS clear']
    if surface_cmds:
        cmds.append('UC_LIGHTSTATS')
    cmds += [r'MAP SAVE FILE="..\Output\%s.dx"' % map_name, r'MAP EXPORT FILE="..\Output\%s.t3d"' % map_name]
    t0 = time.time()
    try:
        text, _ = kit.execute(folder, cmds, 'build.log', timeout=3600)
        player_profiles.verify_build(folder)
    except RuntimeError as e:
        log_text = (folder / 'build.log').read_text(encoding='utf-8', errors='replace') if (folder / 'build.log').exists() else ''
        nodes = re.findall(r'UCMapKit\|world\|(\d+) nodes', log_text)
        if 'MAX_NODES' in log_text:
            return False, lines + ['The rebuilt map has %s BSP nodes, more than the %d the engine allows: it cannot be lit '
                                   'or played. Fewer or simpler blocks and holes, or build this area as a map of its own.'
                                   % (nodes[-1] if nodes else 'too many', MAX_NODES)]
        return False, lines + ['The rebuild failed: %s' % str(e)[:300]]
    out = folder / 'Output' / (map_name + '.dx')
    if not out.exists():
        return False, lines + ['The rebuild did not produce the map (see %s)' % (folder / 'build.log')]
    if surface_cmds and lights:
        lines += surfaces.report(text)
    for m in re.finditer(r'UCMapKit\|(?:set|del)\|missing\|(\S+)', text):
        if m.group(1) in {documents.tag(map_name, name) for name in documents.validate(edits)} | {'UCNavMesh0'}:
            continue  # replacing a document block (or the walkable area) that did not exist in the base map yet
        lines.append('  EDIT skipped %s (not in the map any more)' % m.group(1))
    shutil.copy2(out, OUT / (map_name + '.dx'))
    shutil.copy2(folder / 'Output' / (map_name + '.t3d'), OUT / (map_name + '.t3d'))
    activation.save(OUT / (map_name + '.dx'), folder, edits)
    lines += zones.report((OUT / (map_name + '.t3d')).read_text(encoding='latin1', errors='replace'), edits)
    info['built'] = dict(source=stamp(src), groups=edits.get('groups') or {}, at=time.time(),
                         geometry=geometry, lights=lights, paths=nav, pastes=pastes, unnest=list(edits.get('unnest') or []),
                         disabled=sorted(disabled), rebuild_mode=options['mode'], edits=edits_fingerprint)
    _info_path(map_name).write_text(json.dumps(info), encoding='utf-8')
    what = [w for w, f in (('geometry', geometry), ('lighting', lights), ('paths', nav)) if f]
    lines.append('built %s in %.1fs%s' % (map_name, time.time() - t0,
                                          ('  (rebuilt: %s)' % ', '.join(what)) if what else '  (objects only: original lighting and geometry)'))
    return True, lines


def install(map_name):
    """Put the private build in maps\\ (the game reads it from UnatcoMaps): refused when the mod's copy
    changed after the build (somebody else edited it). The previous copy goes to maps\\backup and the
    edits, now part of the map, are archived."""
    import player_profiles
    if not built_current(map_name):
        return False, ['The map changed after the last rebuild (another tool?): rebuild before installing.']
    dst = MOD_MAPS / (map_name + '.dx')
    lines = []
    info = json.loads(_info_path(map_name).read_text(encoding='utf-8'))
    edits = load_edits(map_name)
    if (info.get('built') or {}).get('edits') != _edits_fingerprint(edits):
        return False, ['Saved changes are newer than the last verified build: rebuild before installing. Your edits have been kept.']
    if _authoring(map_name):
        info['authoring'] = _authoring(map_name)
    preserve = bool(activation.names(edits) or info.get('authoring')
                    or (info.get('built') or {}).get('disabled') or player_profiles.blocks(edits))
    if preserve and not info.get('authoring'):
        # Retain overlays for inactive actors AND player choices. Baking a profile
        # into the source and archiving its setting would lose the map override.
        private = _authoring_path(map_name)
        private.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source(map_name), private)
        info['authoring'] = dict(source=stamp(private))
    if dst.exists():
        bdir = MOD_MAPS / 'backup'
        bdir.mkdir(exist_ok=True)
        keep = bdir / ('%s.prima_editor_%s.dx' % (map_name, time.strftime('%Y%m%d-%H%M%S')))
        shutil.copy2(dst, keep)
        lines.append('Previous copy saved in maps\\backup\\%s' % keep.name)
    shutil.copy2(OUT / (map_name + '.dx'), dst)
    if preserve:
        info['authoring']['installed'] = stamp(dst)
        info['built']['source'] = info['authoring']['source']
        _authoring_path(map_name).with_suffix('.json').write_text(json.dumps(info['authoring']), encoding='utf-8')
        _info_path(map_name).write_text(json.dumps(info), encoding='utf-8')
        return True, lines + ['Installed the playable map. Editable source and map settings retained for later changes.']
    e = edits_path(map_name)
    if e.exists():
        done = e.with_name('%s.edits.installato_%s.json' % (map_name, time.strftime('%Y%m%d-%H%M%S')))
        e.rename(done)
        lines.append('The changes are now part of the map (archived in %s)' % done.name)
    return True, lines
