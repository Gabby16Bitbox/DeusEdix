"""Reusable, two-position game doors/lifts. Generated locally, never shipped assets.

Only the stock DeusExMover is accepted: script-specific movers and multi-floor
controllers cannot be copied as independent objects without their mission logic.
"""
import hashlib
import functools
import json
import math
import re
from pathlib import Path

import atomicfile
import data
import kit
import t3d
import packed

VERSION = 1
CATEGORIES = ['Doors · moving', 'Elevators · two stops']
IDENTITY = r'[0-9]{2}_[A-Za-z0-9_-]+~(?:[0-9]+|m[A-Za-z_][A-Za-z0-9_]*)'
ASSETS = 'moving-pieces.json'


def _stamp(folder):
    # the T3D's date and size, the same once it is packed (packed.signature): what was stamped before still matches
    mtime, size = packed.signature(Path(folder) / 'scene.t3d')
    return [VERSION, mtime, size]


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
    actors = [a for a in t3d.actors(packed.read_text(folder / 'scene.t3d', encoding='latin1')) if kind(a)]
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
            read = False
            try:
                session.cmd('MAP LOAD FILE="..\\Input\\%s"' % Path(source).name)
                if len(meshes) != len(wanted):
                    session.cmd(r'UC_MESHES ..\Output\moving-pieces.bin')
                    exported = data.parse_meshes(session.folder / 'Output/moving-pieces.bin')
                    meshes = {n: m for n, m in exported.items() if n in wanted and m['kind'] == 'mover'}
                if missing():
                    info.update(data.export_textures(session, missing(), folder, log))
                    atomicfile.write_json(folder / 'textures.json', info)
                read = True
            finally:
                session.close()
                if read:
                    kit.discard(session.folder)     # all it wrote was read (kit.discard)
    atomicfile.write_json(folder / ASSETS, dict(stamp=_stamp(folder), meshes=meshes))


def entries(folder, map_name):
    """Catalog rows and native textured preview groups, centred at the bottom."""
    assets = cached(folder)
    if assets is None:
        return []
    info = json.loads((Path(folder) / 'textures.json').read_text(encoding='utf-8'))
    rows = []
    for actor in t3d.actors(packed.read_text(Path(folder) / 'scene.t3d', encoding='latin1')):
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
ENCROACH = {'door': 'ME_IgnoreWhenEncroach', 'elevator': 'ME_ReturnWhenEncroach'}
# the Inspector's Opens of a hinged door (17 Nov 2026, Gabby): the way it turns as the original map has it, the other
# way, away from whoever opens it (the game class UCDoorMover, in the project's package), or into the room a point is in
DOOR_CLASS = 'UCDoorMover'
OPENS = ('built', 'other', 'away', 'into')
# what a door does when it meets someone (the Inspector's "Meets someone"): ignore is ENCROACH['door']
MEETS = {'ignore': 'ME_IgnoreWhenEncroach', 'stop': 'ME_StopWhenEncroach', 'return': 'ME_ReturnWhenEncroach',
         'crush': 'ME_CrushWhenEncroach'}


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
                  # a door that meets someone goes on opening, as 1549 of Revision's 1654 hinged doors do (Return closed
                  # it again in the player's face, 17 Nov 2026); a lift still goes back
                  MoverEncroachType=ENCROACH[what])
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
                locked=p.get('bLocked') == 'True', keyId=p.get('KeyIDNeeded', ''),
                # lock picking and damage (14 Nov 2026): the game's DeusExMover defaults when the piece does not say
                pickable=p.get('bPickable') == 'True', lockStrength=float(p.get('lockStrength', 0.2)),
                breakable=p.get('bBreakable') == 'True', doorStrength=float(p.get('doorStrength', 0.25)),
                minDamage=int(float(p.get('minDamageThreshold', 10))),
                # a hinged door (its turn when open): the Inspector offers which way it opens
                turn=0 if lift else t3d.rot(p.get('KeyRot(1)'))[1], opens='built', meets='ignore')


def apply_settings(raw, settings):
    """Only independent, typed mover settings; never accept arbitrary T3D from edits."""
    import math
    if not settings:
        return raw
    if not isinstance(settings, dict) or set(settings) - {'mode', 'moveTime', 'stayOpenTime', 'locked', 'keyId', 'pickable',
                                                           'lockStrength', 'breakable', 'doorStrength', 'minDamage',
                                                           'opens', 'into', 'meets'}:
        raise ValueError('Invalid mover settings.')
    _opens_of(settings)             # checked here, done once the door is placed (opening)
    _meets_of(settings)             # and meeting
    values = {}
    # lock picking and damage (14 Nov 2026, Gabby: a door from Objects > Movers had no lockpicking or damage options):
    # DeusExMover bPickable/lockStrength, bBreakable/doorStrength (0 easy or weak, 1 hard or strong), minDamageThreshold
    for key, prop in [('pickable', 'bPickable'), ('breakable', 'bBreakable')]:
        if key in settings:
            if not isinstance(settings[key], bool):
                raise ValueError('Invalid door setting: ' + key)
            values[prop] = 'True' if settings[key] else 'False'
    for key, prop in [('lockStrength', 'lockStrength'), ('doorStrength', 'doorStrength')]:
        if key in settings:
            value = settings[key]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
                raise ValueError('Invalid door strength: use a number from 0 to 1.')
            values[prop] = '%.6f' % value
    if 'minDamage' in settings:
        value = settings['minDamage']
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1000:
            raise ValueError('Invalid minimum damage: use a number from 0 to 1000.')
        values['minDamageThreshold'] = str(int(round(value)))
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
    if 'keyId' in settings:
        key = settings['keyId']
        if key is not None and (isinstance(key, bool) or not isinstance(key, (str, int))):
            raise ValueError('Invalid door Key ID: use letters, digits or underscores, e.g. 2 or ApartmentDoor.')
        key = '' if key is None else str(key).strip()
        if key and not re.fullmatch(r'[A-Za-z0-9_]{1,63}', key):
            raise ValueError('Invalid door Key ID: use 1-63 letters, digits or underscores, e.g. 2 or ApartmentDoor.')
        values['KeyIDNeeded'] = 'None' if not key or key.lower() == 'none' else key
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
    if p.get('bIsDoor') == 'True':
        extra['MoverEncroachType'] = ENCROACH['door']       # also a door of a prefab made before 17 Nov 2026
    return _set(raw, extra)


def _set(raw, values):
    for key, value in values.items():
        line = '    %s=%s' % (key, value)
        raw, count = re.subn(r'(?m)^\s*'+re.escape(key)+r'=[^\r\n]*', lambda m: line, raw, count=1)
        if not count: raw = raw.replace('End Actor', line+'\nEnd Actor')
    return raw


def _opens_of(settings):
    """(how, into point) of mover settings; ValueError when they are not right."""
    how = (settings or {}).get('opens', 'built')
    if how not in OPENS:
        raise ValueError('Invalid door opening: use ' + ', '.join(OPENS) + '.')
    into = (settings or {}).get('into')
    if how == 'into':
        if (not isinstance(into, (list, tuple)) or len(into) not in (2, 3) or
                any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in into)):
            raise ValueError('A door that opens into a room needs into: a point [x, y, z] in that room.')
    return how, into


def _meets_of(settings):
    """What a door does when it meets someone (mover settings' meets); ValueError when it is not one of MEETS."""
    how = (settings or {}).get('meets', 'ignore')
    if how not in MEETS:
        raise ValueError('Invalid door setting meets: use ' + ', '.join(MEETS) + '.')
    return how


def meeting(raw, settings):
    """A placed door's "When it meets someone" (17 Nov 2026, the game's MoverEncroachType, asked about on the modding
    Discord): 'ignore' (placed() set it: it goes on through them, as 1549 of Revision's 1654 hinged doors), 'stop'
    (it waits until they move), 'return' (it goes back), 'crush' (it goes on and hurts them). A lift keeps its own."""
    how = _meets_of(settings)
    if how == 'ignore' or next(t3d.actors(raw))['props'].get('bIsDoor') != 'True':
        return raw
    return _set(raw, {'MoverEncroachType': MEETS[how]})


def swing_center(actor, yaw):
    """Where the middle of a door is, turned yaw (Unreal units, 65536 a whole turn) about its hinge (its Location)."""
    lo, hi = t3d.bounds(actor)
    hinge = t3d.vec(actor['props'].get('Location'))
    middle = [(lo[k] + hi[k]) / 2 - hinge[k] for k in range(3)]
    q = t3d._rotate(middle, (0, yaw, 0))
    return tuple(q[k] + hinge[k] for k in range(3))


def _unrotate(p, r):
    """t3d._rotate undone (yaw, pitch, roll taken back in the other order)."""
    pitch, yaw, roll = (a * math.pi / 32768.0 for a in r)
    x, y, z = p
    cy, sy = math.cos(-yaw), math.sin(-yaw)
    x, y = x * cy - y * sy, x * sy + y * cy
    cp, sp = math.cos(-pitch), math.sin(-pitch)
    x, z = x * cp - z * sp, x * sp + z * cp
    cr, sr = math.cos(-roll), math.sin(-roll)
    y, z = y * cr - z * sr, y * sr + z * cr
    return (x, y, z)


def _vec(v):
    return '(X=%.3f,Y=%.3f,Z=%.3f)' % tuple(v)


def _frame(actor):
    """A shut door seen from its hinge (its Location): `u` along its width, `n` across its thickness (both flat),
    `m` the middle of its thickness along n, `far` its other edge along u (signed), `low`/`high` its bottom and top.
    None without vertices."""
    p = actor['props']
    pts = [v for _, vs in t3d.world_verts(actor) for v in vs]
    if not pts:
        return None
    hinge = t3d.vec(p.get('Location'))
    flat = [(q[0] - hinge[0], q[1] - hinge[1]) for q in pts]
    mx, my = sum(x for x, _ in flat) / len(flat), sum(y for _, y in flat) / len(flat)
    sxx = sum((x - mx) ** 2 for x, _ in flat)
    syy = sum((y - my) ** 2 for _, y in flat)
    sxy = sum((x - mx) * (y - my) for x, y in flat)
    along = 0.5 * math.atan2(2 * sxy, sxx - syy)            # the door's width; its thickness across it
    u, n = (math.cos(along), math.sin(along)), (-math.sin(along), math.cos(along))
    depth = [x * n[0] + y * n[1] for x, y in flat]
    width = [x * u[0] + y * u[1] for x, y in flat]
    far = max(width) if abs(max(width)) >= abs(min(width)) else min(width)
    return dict(hinge=hinge, u=u, n=n, m=(min(depth) + max(depth)) / 2, far=far,
                low=min(q[2] for q in pts), high=max(q[2] for q in pts))


def _flipper(f):
    """Mirrored across the plane through the hinge, across the door's thickness."""
    n = f['n']

    def flip(v):
        d = v[0] * n[0] + v[1] * n[1]
        return (v[0] - 2 * d * n[0], v[1] - 2 * d * n[1], v[2])
    return flip


ROOM_TURNS = (1 / 3.0, 2 / 3.0, 0.85)    # how far open (of its whole turn) the room it needs is tried
ROOM_HEIGHTS = (0.25, 0.75)              # at which heights of the door
ROOM_LINES = 10                          # lines a way: UCDoorMover's BuiltRoomFrom[10] ... MirrorRoomTo[10]


def sweep(actor):
    """The room a hinged door needs to open, each way (17 Nov 2026, from the modding Discord: a gate in a narrow alley
    turned the other way goes into the wall): lines through the middle of its thickness at a quarter and three
    quarters of its height, from 0.4 of its width out to its edge less 4 units, at a third, two thirds and 0.85 of its
    turn, and its edge between those. {'built': [[a, b], ...], 'other': [...]} in the world, `other` the mirror image
    (mirror()); None for a door that does not turn."""
    p = actor['props']
    turn = t3d.rot(p.get('KeyRot(1)'))[1]
    f = _frame(actor) if turn else None
    if not f:
        return None
    hinge, u, n, m, far = f['hinge'], f['u'], f['n'], f['m'], f['far']
    key = t3d.vec(p.get('KeyPos(1)'))
    sign, width = (1 if far >= 0 else -1), abs(far)

    def at(t, part, z):
        q = t3d._rotate((u[0] * t + n[0] * m, u[1] * t + n[1] * m, 0.0), (0, turn * part, 0))
        return (hinge[0] + q[0] + key[0] * part, hinge[1] + q[1] + key[1] * part, z + key[2] * part)
    lines = []
    for h in ROOM_HEIGHTS:
        z = f['low'] + (f['high'] - f['low']) * h
        edge = [at(sign * max(width - 4, width * 0.5), part, z) for part in ROOM_TURNS]
        lines += [(at(sign * width * 0.4, part, z), e) for part, e in zip(ROOM_TURNS, edge)]
        lines += list(zip(edge, edge[1:]))
    flip, shift = _flipper(f), (2 * m * n[0], 2 * m * n[1], 0.0)

    def other(v):
        r = flip(tuple(v[k] - hinge[k] for k in range(3)))
        return tuple(round(r[k] + hinge[k] + shift[k], 3) for k in range(3))
    rounded = lambda v: tuple(round(c, 3) for c in v)
    return dict(built=[[rounded(a), rounded(b)] for a, b in lines], other=[[other(a), other(b)] for a, b in lines])


def mirror(actor):
    """The other way of a hinged door as the mirror image of its own swing across the middle of its thickness
    (17 Nov 2026, Gabby: turned the other way about the same hinge, a door hinged on one face of its thickness went
    into the jamb). Its hinge goes to the other face (`shift`, world) and its PrePivot by `prepivot`, so shut it stays
    where it is; `keypos` its KeyPos(1) mirrored; `built` and `other` where its middle ends, open each way. None
    without vertices."""
    p = actor['props']
    f = _frame(actor)
    if not f:
        return None
    hinge, n, m = f['hinge'], f['n'], f['m']
    shift = (2 * m * n[0], 2 * m * n[1], 0.0)
    flip = _flipper(f)
    main, post = t3d._scale(p, 'MainScale'), t3d._scale(p, 'PostScale')
    local = _unrotate(tuple(shift[k] / (post[k] or 1) for k in range(3)), t3d.rot(p.get('Rotation')))
    prepivot = tuple(local[k] / (main[k] or 1) for k in range(3))
    keypos = t3d.vec(p.get('KeyPos(1)'))
    built = swing_center(actor, t3d.rot(p.get('KeyRot(1)'))[1])
    built = tuple(built[k] + keypos[k] for k in range(3))
    rel = flip(tuple(built[k] - hinge[k] for k in range(3)))
    other = tuple(rel[k] + hinge[k] + shift[k] for k in range(3))
    return dict(shift=shift, prepivot=prepivot, keypos=flip(keypos), built=built, other=other)


def opening(raw, settings):
    """A placed door's Opens (apply_settings checked it): 'built' the turn of the original map; 'other' the same turn
    the other way, as the mirror image of its own (mirror(): the hinge goes to the other face of the door); 'into'
    whichever of the two takes the door into the room `into` is in (closer to that point when open); 'away' the class
    UCDoorMover, which picks it each time from who opens it. Anything else, or a door that slides, is left as it is."""
    how, into = _opens_of(settings)
    if how == 'built':
        return raw
    actor = next(t3d.actors(raw))
    p = actor['props']
    turn = t3d.rot(p.get('KeyRot(1)'))
    if p.get('bIsDoor') != 'True' or not turn[1] or not t3d.bounds(actor):
        return raw
    other = mirror(actor)
    if how == 'away':
        raw = re.sub(r'^Begin Actor Class=\S+', 'Begin Actor Class=' + DOOR_CLASS, raw, count=1)
        values = {'MirrorHinge': _vec(other['shift']), 'MirrorPrePivot': _vec(other['prepivot']),
                  'MirrorKeyPos': _vec(other['keypos']), 'BuiltMiddle': _vec(other['built']),
                  'MirrorMiddle': _vec(other['other'])}
        # the room each way needs: the game traces these lines once and never turns it into a wall (UCDoorMover.HasRoom)
        room = sweep(actor) or {}
        for way, prefix in (('built', 'Built'), ('other', 'Mirror')):
            for i, (a, b) in enumerate(room.get(way, [])[:ROOM_LINES]):
                values['%sRoomFrom(%d)' % (prefix, i)] = _vec(a)
                values['%sRoomTo(%d)' % (prefix, i)] = _vec(b)
        return _set(raw, values)
    if how == 'into':
        far = lambda q: math.hypot(*(q[k] - into[k] for k in range(2)))
        if far(other['other']) >= far(other['built']):
            return raw
    values = {'KeyRot(1)': '(Pitch=%d,Yaw=%d,Roll=%d)' % (turn[0], -turn[1], turn[2])}
    if any(abs(v) > 0.001 for v in other['keypos']):
        values['KeyPos(1)'] = _vec(other['keypos'])
    if any(abs(v) > 0.001 for v in other['shift']):
        moved = _vec(t3d.vec(p.get('Location'))[k] + other['shift'][k] for k in range(3))
        pre = t3d.vec(p.get('PrePivot'))
        values.update({'Location': moved, 'BasePos': moved,
                       'PrePivot': _vec(pre[k] + other['prepivot'][k] for k in range(3))})
    return _set(raw, values)
