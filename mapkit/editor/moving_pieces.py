"""Reusable, two-position game doors/lifts. Generated locally, never shipped assets.

Only the stock DeusExMover is accepted: script-specific movers and multi-floor
controllers cannot be copied as independent objects without their mission logic.
"""
import hashlib
import functools
import json
import re
from pathlib import Path

import atomicfile
import data
import kit
import t3d

VERSION = 1
CATEGORIES = ['Doors · moving', 'Elevators · two stops']
IDENTITY = r'[0-9]{2}_[A-Za-z0-9_-]+~(?:[0-9]+|m[A-Za-z_][A-Za-z0-9_]*)'
ASSETS = 'moving-pieces.json'


def _stamp(folder):
    p = Path(folder) / 'scene.t3d'
    s = p.stat()
    return [VERSION, s.st_mtime_ns, s.st_size]


def cached(folder):
    try:
        value = json.loads((Path(folder) / ASSETS).read_text(encoding='utf-8'))
        return value if value.get('stamp') == _stamp(folder) else None
    except (OSError, ValueError, AttributeError):
        return None


@functools.lru_cache(maxsize=256)
def _ready(path, stamp, mtime, size):
    return cached(Path(path).parent) is not None


def ready(folder):
    try:
        path = Path(folder) / ASSETS
        s = path.stat()
        return _ready(str(path), tuple(_stamp(folder)), s.st_mtime_ns, s.st_size)
    except OSError:
        return False


def kind(actor):
    """Conservative independent movers; reject special scripts and non-closed exports."""
    if actor['cls'].lower() not in ('deusexmover', 'deusex.deusexmover'):
        return None
    p = actor['props']
    if int(p.get('NumKeys', 2)) != 2 or int(p.get('KeyNum', 0)) != 0:
        return None
    if any(t3d.vec(p.get('KeyPos(0)'))) or any(t3d.rot(p.get('KeyRot(0)'))):
        return None
    if any(re.search(r'SheerRate=(?!0\.0+(?:[,)]|$))', p.get(k, '')) for k in ('MainScale', 'PostScale')):
        return None
    move, turn = t3d.vec(p.get('KeyPos(1)')), t3d.rot(p.get('KeyRot(1)'))
    if any(t3d.rot(p.get('Rotation'))[i] or turn[i] for i in (0, 2)):
        return None                 # tilted hinges need a full 3-axis rotation remap
    bounds = t3d.bounds(actor)
    if not bounds or (not any(move) and not any(turn)) or str(p.get('bHidden', '')).lower() == 'true':
        return None
    size = [bounds[1][i] - bounds[0][i] for i in range(3)]
    # Tall vertically opening shutters must not be mistaken for lifts.
    lift = (not any(turn) and abs(move[2]) > max(32, abs(move[0]), abs(move[1])) and
            (re.search(r'elevator|lift', p.get('Tag', '') + actor['name'], re.I) or
             (min(size[:2]) >= 48 and size[2] <= min(size[:2]) and abs(move[2]) > size[2])))
    return 'elevator' if lift else 'door'


def prepare(folder, source, log=print):
    """Enrich old lite reference caches once; do not export their BSP again."""
    folder = Path(folder)
    if cached(folder) is not None:
        return
    actors = [a for a in t3d.actors((folder / 'scene.t3d').read_text(encoding='latin1')) if kind(a)]
    meshes = {}
    if actors:
        wanted = {a['name'] for a in actors}
        # Full map caches may already have native mover UVs and texture paths.
        mesh_file = folder / 'meshes.json'
        old = json.loads(mesh_file.read_text(encoding='utf-8')) if mesh_file.exists() else {}
        meshes = {n: old[n] for n in wanted if n in old and old[n].get('kind') == 'mover'}
        info = json.loads((folder / 'textures.json').read_text(encoding='utf-8'))
        missing = lambda: {part['tex']: (0, 0) for mesh in meshes.values() for part in mesh['parts']
                           if part['tex'] != 'none' and (not info.get(part['tex'], {}).get('png') or
                              not (folder / info[part['tex']]['png']).is_file())}
        if len(meshes) != len(wanted) or missing():
            session = kit.Session([Path(source)], 'pieces-movers-' + Path(source).stem)
            try:
                session.cmd('MAP LOAD FILE="..\\Input\\%s"' % Path(source).name)
                if len(meshes) != len(wanted):
                    session.cmd(r'UC_MESHES ..\Output\moving-pieces.txt')
                    exported = data.parse_meshes(session.folder / 'Output/moving-pieces.txt')
                    meshes = {n: m for n, m in exported.items() if n in wanted and m['kind'] == 'mover'}
                if missing():
                    info.update(data.export_textures(session, missing(), folder, log))
                    atomicfile.write_json(folder / 'textures.json', info)
            finally:
                session.close()
    atomicfile.write_json(folder / ASSETS, dict(stamp=_stamp(folder), meshes=meshes))


def entries(folder, map_name):
    """Catalog rows and native textured preview groups, centred at the bottom."""
    assets = cached(folder)
    if assets is None:
        return []
    info = json.loads((Path(folder) / 'textures.json').read_text(encoding='utf-8'))
    rows = []
    for actor in t3d.actors((Path(folder) / 'scene.t3d').read_text(encoding='latin1')):
        what = kind(actor)
        mesh = assets['meshes'].get(actor['name'])
        if not what or not mesh or not mesh.get('parts'):
            continue
        # Never offer a permanently white preview or an unresolved level-local texture.
        refs = {g['tex'] for g in mesh['parts']}
        if any(not re.fullmatch(r'[A-Za-z_]\w*(?:\.\w+)+', t) or t.split('.')[0].lower() in ('mylevel', map_name.lower()) or
               not info.get(t, {}).get('png') or not (Path(folder) / info[t]['png']).is_file() for t in refs):
            continue
        p = actor['props']; loc = t3d.vec(p.get('Location')); rot = t3d.rot(p.get('Rotation'))
        main, post = t3d._scale(p, 'MainScale'), t3d._scale(p, 'PostScale')
        groups = []
        for g in mesh['parts']:
            pts = []
            for i in range(0, len(g['pos']), 3):
                q = t3d._rotate(tuple(g['pos'][i+k] * main[k] for k in range(3)), rot)
                pts.extend(q[k] * post[k] + loc[k] for k in range(3))
            groups.append(dict(tex=g['tex'], flags=g['flags'], pos=pts, uv=g['uv']))
        lo = [min(g['pos'][i] for g in groups for i in range(k, len(g['pos']), 3)) for k in range(3)]
        hi = [max(g['pos'][i] for g in groups for i in range(k, len(g['pos']), 3)) for k in range(3)]
        pivot = [(lo[0]+hi[0])/2, (lo[1]+hi[1])/2, lo[2]]
        for g in groups:
            g['pos'] = [round(v-pivot[i % 3], 3) for i, v in enumerate(g['pos'])]
        name = actor['name']; travel = list(t3d.vec(p.get('KeyPos(1)')))
        texture = max(groups, key=lambda g: len(g['pos']))['tex'].split('.')[-1]
        label = re.sub(r'[_]+', ' ', texture)
        label = re.sub(r'([a-z])([A-Z])', r'\1 \2', label).strip()
        row = dict(id=map_name+'~m'+name, map=map_name, kind=what, label=('Elevator' if what == 'elevator' else 'Door')+' · '+label,
                   cat=CATEGORIES[what == 'elevator'], size=[round(hi[i]-lo[i]) for i in range(3)],
                   brushes=[], actors=[name], lo=lo, hi=hi, tex=sorted(refs), count=1, maps=[map_name],
                   travel=travel, operation='Step on to ride; returns automatically' if what == 'elevator' else 'Use to open / close')
        try:
            template(actor, what, refs)
        except ValueError:
            continue
        # Include the actual geometry and motion: similar-sized doors need not be identical.
        motion = {k: v for k, v in p.items() if k.startswith(('KeyPos(', 'KeyRot(', 'MoveTime', 'OpeningSound', 'ClosedSound'))}
        signature = hashlib.sha256(json.dumps([what, groups, motion], sort_keys=True).encode()).hexdigest()
        rows.append((row, groups, signature))
    return rows


KEEP = {'Location', 'Rotation', 'PrePivot', 'MainScale', 'PostScale', 'PolyFlags', 'CsgOper',
        'MoveTime', 'StayOpenTime', 'MoverGlideType', 'OpeningSound', 'OpenedSound',
        'ClosingSound', 'ClosedSound', 'MoveAmbientSound', 'SoundVolume', 'SoundRadius', 'SoundPitch',
        'KeyPos(1)', 'KeyRot(1)'}


def template(actor, what, textures):
    """Allowlist visual/motion properties. No source tags, keys, events or actor refs."""
    if kind(actor) != what:
        raise ValueError('This moving piece is no longer a supported two-position door or elevator. Rescan Pieces.')
    brush = re.search(r'(?ms)^\s*Begin Brush Name=\w+\s*\n.*?^\s*End Brush', actor['raw'])
    if not brush:
        raise ValueError('This mover has no reusable brush.')
    by_name = {}
    for tex in textures:
        by_name.setdefault(tex.split('.')[-1].lower(), []).append(tex)
    def full_texture(match):
        value = match.group(1)
        candidates = [value] if value in textures else by_name.get(value.split('.')[-1].lower(), [])
        if len(candidates) != 1:
            raise ValueError('This mover has an ambiguous or unavailable texture; choose another piece.')
        return 'Texture=' + candidates[0]
    body = re.sub(r'Texture=(\S+)', full_texture, brush.group(0))
    body = re.sub(r'Begin Brush Name=\w+', 'Begin Brush Name=PieceModel', body, count=1)
    values = {k: v for k, v in actor['props'].items() if k in KEEP}
    for value in values.values():
        if re.search(r"'(?:MyLevel|[0-9]{2}_[\w-]+)\.", value, re.I):
            raise ValueError('This mover uses level-local resources; choose another piece.')
    values.update(NumKeys='2', KeyNum='0', bLocked='False', bPickable='False', bBreakable='False',
                  bOneWay='False', bSlave='False', bTriggerOnceOnly='False', bIsDoor='True' if what == 'door' else 'False',
                  bFrobbable='True' if what == 'door' else 'False', bHighlight='True' if what == 'door' else 'False',
                  InitialState='TriggerToggle' if what == 'door' else 'StandOpenTimed',
                  MoverEncroachType='ME_ReturnWhenEncroach')
    if what == 'elevator':
        values.update(StayOpenTime='4.000000', DelayTime='0.500000', BumpType='BT_PlayerBump')
    return ('Begin Actor Class=DeusExMover Name='+actor['name']+'\n'+body+'\n'+
            "    Brush=Model'MyLevel.PieceModel'\n"+
            ''.join('    %s=%s\n' % (k, v) for k, v in values.items())+'End Actor\n')


def description(prefab):
    """Small Inspector descriptor, also derived for already cached moving prefabs."""
    blocks = prefab.get('blocks', [])
    if len(blocks) != 1 or not blocks[0].get('mover'):
        return None
    p = next(t3d.actors(blocks[0]['raw']))['props']
    lift = p.get('bIsDoor') == 'False'
    return dict(kind='elevator' if lift else 'door', mode='stand' if lift else 'use',
                moveTime=float(p.get('MoveTime', 1)), stayOpenTime=float(p.get('StayOpenTime', 4)),
                locked=p.get('bLocked') == 'True')


def apply_settings(raw, settings):
    """Only independent, typed mover settings; never accept arbitrary T3D from edits."""
    import math
    if not settings:
        return raw
    if not isinstance(settings, dict) or set(settings) - {'mode', 'moveTime', 'stayOpenTime', 'locked'}:
        raise ValueError('Invalid mover settings.')
    values = {}
    for key, prop, minimum in [('moveTime', 'MoveTime', .05), ('stayOpenTime', 'StayOpenTime', 0)]:
        if key not in settings:
            continue
        value = settings[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not minimum <= value <= 3600:
            raise ValueError('Invalid mover time: ' + key)
        values[prop] = '%.6f' % value
    if 'locked' in settings:
        if not isinstance(settings['locked'], bool):
            raise ValueError('Invalid mover lock setting.')
        values['bLocked'] = 'True' if settings['locked'] else 'False'
    if 'mode' in settings:
        mode = settings['mode']
        states = {'use': 'TriggerToggle', 'use-timed': 'TriggerOpenTimed', 'trigger': 'TriggerToggle', 'stand': 'StandOpenTimed'}
        if not isinstance(mode, str) or mode not in states:
            raise ValueError('Invalid mover activation mode.')
        values.update(InitialState=states[mode], bFrobbable='True' if mode.startswith('use') else 'False',
                      bHighlight='True' if mode.startswith('use') else 'False')
    for key, value in values.items():
        line = '    %s=%s' % (key, value)
        raw, count = re.subn(r'(?m)^\s*' + re.escape(key) + r'=[^\r\n]*', lambda m: line, raw, count=1)
        if not count:
            raw = raw.replace('End Actor', line+'\nEnd Actor')
    return raw


def placed(raw, xf, name, original_raw=None):
    """World-space travel vectors rotate with the piece; pivot/closed base stay aligned."""
    def travel(m):
        v = t3d.vec(m.group(2))
        v = xf.vec(tuple(v[k]*xf.scale[k] for k in range(3)))
        return m.group(1)+'(X=%.3f,Y=%.3f,Z=%.3f)' % v
    if original_raw is not None:
        import mover_transform
        raw = mover_transform.apply(raw, next(t3d.actors(original_raw))['props'], xf)
    else:
        raw = re.sub(r'(?m)^(\s*KeyPos\(1\)=)(\([^)]*\))', travel, raw)
    a = next(t3d.actors(raw)); p = a['props']
    extra = {'Tag': name, 'BasePos': p.get('Location', '(X=0,Y=0,Z=0)'),
             'BaseRot': p.get('Rotation', '(Pitch=0,Yaw=0,Roll=0)')}
    for key, value in extra.items():
        line = '    %s=%s' % (key, value)
        raw, count = re.subn(r'(?m)^\s*'+re.escape(key)+r'=[^\r\n]*', lambda m: line, raw, count=1)
        if not count: raw = raw.replace('End Actor', line+'\nEnd Actor')
    return raw
