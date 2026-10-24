"""Scene: CSG operations + actors -> T3D files -> headless build (BSP, zones, paths, lighting).

    s = Scene('UCProto')
    s.sub(geom.box(...))                      # carve space (world starts solid)
    s.add(geom.box(...))                      # solid
    s.add(geom.box(...), semisolid=True)      # detail: does not cut the BSP of other brushes
    s.actor('Light', (x, y, z), LightBrightness=120, LightHue=30, LightSaturation=80, LightRadius=24)
    s.drop('BoxLarge', x, y, 100)             # falls onto whatever is below (floor, shelf, platform)
    s.snap('Keypad1', x, y, z, '+x')          # pushed flush against the first wall in that direction
    s.build(out_path)

Placement like the modern editors: drop() and snap() are resolved after the BSP is built, with
line traces in the live SDK editor (kit.Session), using each class's real collision size.
"""
import math
import re
import shutil
from pathlib import Path

import geom
import kit
import settings
import activation

PF_INVISIBLE = 1
PF_MASKED = 2
PF_TRANSLUCENT = 4
PF_NOTSOLID = 8
PF_SEMISOLID = 32
PF_MODULATED = 64
PF_FAKEBACKDROP = 128
PF_TWOSIDED = 256
PF_NOSMOOTH = 2048
PF_UNLIT = 4194304
PF_HIGHSHADOW = 8388608
PF_SPECIALLIT = 1048576
PF_PORTAL = 67108864

DEFAULT_PACKAGES = ['CoreTexMetal', 'CoreTexConcrete', 'CoreTexMisc', 'CoreTexWallObj', 'CoreTexSky', 'CoreTexGlass',
                    'CoreTexStucco', 'CoreTexBrick', 'CoreTexTiles', 'CoreTexWood', 'CoreTexStone', 'HK_BuildingExt',
                    'HK_Signs', 'HK_Decorations', 'HK_Helibase', 'HK_Interior', 'HK_VersaLife', 'RevTexHK']
if not settings.IS_REVISION:                # the original game has no RevTex* packages
    DEFAULT_PACKAGES = [p for p in DEFAULT_PACKAGES if not p.startswith('RevTex')]


def _val(v):
    if isinstance(v, bool):
        return 'True' if v else 'False'
    if isinstance(v, float):
        return ('%.6f' % v)
    if isinstance(v, tuple) and len(v) == 3:
        return '(X=%s,Y=%s,Z=%s)' % tuple(_val(float(c)) for c in v)
    return str(v)


def _head(block):
    m = re.match(r'Begin Actor Class=(\S+) Name=(\S+)', block)
    return (m.group(1), m.group(2)) if m else (None, None)


def _loc(block):
    m = re.search(r'Location=\(X=([-\d.e]+),Y=([-\d.e]+),Z=([-\d.e]+)\)', block)
    return tuple(float(c) for c in m.groups()) if m else None


BRUSH_MODEL = 'UCBrushModel'           # the models of the script's brushes (Scene.brush_blocks)
UNLINK = 'UC_UNLINK ' + BRUSH_MODEL    # host: one surface per polygon again after their import


class _Traces:
    """The drop and snap traces of a build (Scene._resolve), answered from the last build when the brushes
    are the same (out/<map>.traces.json, keyed by Scene._geometry_key). The SDK session that builds the
    geometry to trace it opens only for a trace not seen before: a rebuild that leaves the brushes alone
    (objects, lights, story) skips it."""

    def __init__(self, path, key, open_session):
        import json
        self.path, self.key, self.open_session = path, key, open_session
        self.session, self.reused, self.traced, self.hits = None, 0, 0, {}
        try:
            data = json.loads(path.read_text(encoding='utf-8')) if path and path.exists() else {}
            if data.get('key') == key:
                self.hits = data.get('hits') or {}
        except (OSError, ValueError):
            pass

    def trace(self, start, end):
        q = '%g %g %g %g %g %g' % (tuple(start) + tuple(end))
        if q in self.hits:
            self.reused += 1
            hit = self.hits[q]
            return (tuple(hit[0]), tuple(hit[1])) if hit else None
        if self.session is None:
            self.session = self.open_session()
        hit = self.session.trace(start, end)
        self.hits[q] = [list(hit[0]), list(hit[1])] if hit else None
        self.traced += 1
        return hit

    def close(self):
        import json
        if self.session is not None:
            self.session.close()
        if self.path and self.traced:
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                self.path.write_text(json.dumps({'key': self.key, 'hits': self.hits}), encoding='utf-8')
            except OSError:
                pass


class Scene:
    def __init__(self, map_name, packages=None):
        self.map_name = map_name
        self.ops = []  # (kind, brush, flags)
        self.actors = []  # raw T3D blocks
        self.movers = []  # actor names of movers
        self.textures = []  # (pcx path, name, group, flags)
        self.after_textures = []  # commands right after the texture imports (DrawScale of imported textures)
        self.tex_edits = {}  # textures imported in the map editor (editor/textures.py)
        self.packages = list(packages or DEFAULT_PACKAGES)
        # the sizes of the textures (catalog\<pkg>.txt) are made from the user's own packages the first
        # time (a fresh install of DeusEdix has none): before any brush, whose UVs need them
        import texcat
        if texcat.ensure_index(self.packages):
            geom._SIZES = None
        self.extra_obj = []
        self._n = {}
        self.pending = []  # drop / snap placements resolved by traces after the BSP build
        # structures the map editor can move, turn, copy or delete (begin_group / end_group)
        self.groups = {}  # name -> dict(label, category, copyable)
        self._group = None
        self.op_group = []  # group of each op (parallel to self.ops)
        self.op_xf = []  # placement of each op at build time (geom.XForm or None)
        self.actor_group = {}  # actor name -> group
        self.explicit = set()  # actor names chosen by the script (the mission scripts look for them)
        # what un-nesting a structure in the map editor takes apart (_pieces, edits['unnest'])
        self.actor_note = {}  # actor name -> the script's comment above it (_note)
        self.pieces = {}  # group -> its pieces still inside it
        self.op_piece = []  # piece of each op (parallel to self.ops, from _apply_groups on)

    def _name(self, base):
        i = self._n.get(base, 0)
        self._n[base] = i + 1
        return '%s%d' % (base, i)

    # ------------------------------------------------------------------ structures (groups)
    def begin_group(self, name, label=None, category='Roof', copyable=None):
        """Everything added until end_group() belongs to the structure name: the map editor moves,
        turns, copies or deletes it as one piece (walls, lights and objects together). Calling it
        again with the same name adds more to the same structure. copyable None: copies allowed
        when the structure has no doors and no objects named for the mission scripts."""
        g = self.groups.setdefault(name, dict(label=label or name, category=category, copyable=copyable))
        if label:
            g['label'] = label
        if copyable is not None:
            g['copyable'] = copyable
        self._group = name

    def end_group(self):
        self._group = None

    def join(self, group, *names):
        """Put actors made elsewhere in the script into a structure (the helicopter on its pad)."""
        for n in names:
            self.actor_group[n] = group

    def _own(self, name, explicit):
        if explicit:
            self.explicit.add(name)
        g = self._auto()
        if g:
            self.actor_group[name] = g
            self.actor_note[name] = self._note()

    def _note(self):
        """The comment of the map script above the line being run: (its line, its first line of text).
        Un-nesting a structure in the map editor keeps the things under one comment together."""
        import sys
        here = Path(__file__).resolve()
        f = sys._getframe(1)
        while f is not None and (f.f_code.co_name != '<module>' or Path(f.f_code.co_filename).resolve() == here):
            f = f.f_back
        if f is None:
            return None
        src = getattr(self, '_src', None)
        if src is None:
            src = self._src = {}
        path = f.f_code.co_filename
        if path not in src:
            try:
                src[path] = Path(path).read_text(encoding='utf-8').splitlines()
            except OSError:
                src[path] = []
        lines = src[path]
        heading = lambda t: t.strip().lstrip('#').strip().startswith('---')     # '# ------ section'
        for i in range(min(f.f_lineno, len(lines)) - 1, -1, -1):
            if not lines[i].lstrip().startswith('#'):
                continue
            at = i
            if not heading(lines[i]):
                while at > 0 and lines[at - 1].lstrip().startswith('#') and not heading(lines[at - 1]):
                    at -= 1         # a comment on several lines: its first line names it
            text = lines[at].strip().lstrip('#').strip().strip('-').strip()
            if len(text) > 60:
                text = text[:57].rsplit(' ', 1)[0] + '...'
            return (at + 1, text[:1].upper() + text[1:]) if text else None
        return None

    WIDE = 3500  # automatic structures wider than this (world hull, sky box, map-wide lists) stay fixed

    def _auto(self):
        """Current structure: the one opened with begin_group, otherwise the script's own section:
        everything under a top-level '# ...' comment of the map script is one structure, labelled
        with that comment (category: the enclosing '# ------ ...' heading). No markup needed."""
        if self._group or not getattr(self, 'auto_groups', True):
            return self._group
        import sys
        here = Path(__file__).resolve()
        f = sys._getframe(1)
        while f is not None and (f.f_code.co_name != '<module>' or Path(f.f_code.co_filename).resolve() == here):
            f = f.f_back
        if f is None:
            return None
        src = getattr(self, '_src', None)
        if src is None:
            src = self._src = {}
        path = f.f_code.co_filename
        if path not in src:
            try:
                src[path] = Path(path).read_text(encoding='utf-8').splitlines()
            except OSError:
                src[path] = []
        lines = src[path]
        label = at = section = None
        for i in range(min(f.f_lineno, len(lines)) - 1, -1, -1):
            t = lines[i]
            if not t.startswith('#'):
                continue
            text = t.lstrip('#').strip()
            clean = text.strip('-').strip()
            if label is None and clean:
                at = i
                while at > 0 and lines[at - 1].startswith('#') and not lines[at - 1].lstrip('#').strip().startswith('---'):
                    at -= 1          # a comment on several lines: its first line names the section
                label = lines[at].lstrip('#').strip().strip('-').strip() or clean
            if text.startswith('---'):
                section = clean
                break
        if label is None:
            return None
        name = 'auto%d' % (at + 1)
        if name not in self.groups:
            short = label if len(label) <= 60 else label[:57].rsplit(' ', 1)[0] + '...'
            self.groups[name] = dict(label=short[:1].upper() + short[1:], category=(section or 'Other')[:40],
                                     copyable=None, auto=True)
        return name

    def _dissolve_wide(self):
        """Automatic structures spread over the whole map (hull, sky box, navigation, mission lists)
        are not structures: their pieces stay where the script puts them."""
        pts = {}
        for i, (_, b, _) in enumerate(self.ops):
            g = self.op_group[i]
            if g and self.groups.get(g, {}).get('auto'):
                pts.setdefault(g, []).extend(b.bounds())
        for block in self.actors:
            g = self.actor_group.get(_head(block)[1])
            if g and self.groups.get(g, {}).get('auto'):
                pts.setdefault(g, []).append(_loc(block))
        for p in self.pending:
            g = self.actor_group.get(p[3])
            if g and self.groups.get(g, {}).get('auto'):
                pts.setdefault(g, []).append(p[2])
        wide = set()
        for g, ps in pts.items():
            ps = [p for p in ps if p]
            if max(max(p[i] for p in ps) - min(p[i] for p in ps) for i in (0, 1)) > self.WIDE:
                wide.add(g)
        if wide:
            self.op_group = [None if g in wide else g for g in self.op_group]
            self.actor_group = {n: g for n, g in self.actor_group.items() if g not in wide}
            for g in wide:
                self.groups.pop(g, None)

    # ------------------------------------------------------------------ CSG
    def sub(self, brush):
        self.ops.append(('sub', brush, 0))
        self.op_group.append(self._auto())
        self._mark(brush)
        return brush

    def add(self, brush, semisolid=False, nonsolid=False, flags=0):
        f = flags | (PF_SEMISOLID if semisolid else 0) | (PF_NOTSOLID if nonsolid else 0)
        self.ops.append(('add', brush, f))
        self.op_group.append(self._auto())
        self._mark(brush)
        return brush

    def _mark(self, brush):
        if self.op_group[-1] and not hasattr(brush, 'note'):
            try:
                brush.note = self._note()
            except AttributeError:
                pass

    def add_all(self, brushes, **kw):
        for b in brushes:
            self.add(b, **kw)

    # ------------------------------------------------------------------ actors
    @staticmethod
    def _block(cls, loc, name, rot, body, props):
        lines = ['Begin Actor Class=%s Name=%s' % (cls, name), '    Location=' + _val(tuple(float(c) for c in loc))]
        if rot is not None:
            p, y, r = rot if isinstance(rot, tuple) else (0, rot, 0)
            lines.append('    Rotation=(Pitch=%d,Yaw=%d,Roll=%d)' % (int(p), int(y), int(r)))
        for k, v in props.items():
            lines.append('    %s=%s' % (k, _val(v)))
        if body:
            lines.append(body.rstrip('\n'))
        lines.append('End Actor')
        return '\n'.join(lines) + '\n'

    def actor(self, cls, loc, name=None, rot=None, body='', **props):
        explicit = name is not None
        name = name or self._name(cls.split('.')[-1])
        self.actors.append(self._block(cls, loc, name, rot, body, props))
        self._own(name, explicit)
        return name

    def paste(self, src_map, piece, at, yaw=0, face=None):
        """A ready-made piece of an ORIGINAL map (tools/mapkit/library.py, editor 'Libreria pezzi'):
        its brushes, lamps and props, with its pivot (centre, lowest point) put at `at` and turned
        by yaw, or turned so that its front (a sign's text, a lamp) looks toward face '+x' '-x' '+y'
        '-y'. It belongs to the current structure. Rule: never build what the game already has.
        piece can also be a whole area (a shop with its back room): a dict for prefabs.region_piece,
        dict(ords=[brush ordinals], lo=, hi= (its scenery), skip=[names], skip_cls=[classes], pivot=).
        src_map 'object': piece is an object of the map editor's Pieces (catalog/objects.json, e.g.
        '03_NYC_AirfieldHeliBase~949'): only its own brushes, its pivot at the centre of its bottom."""
        if not hasattr(self, 'script_pastes'):
            self.script_pastes = []
        self.script_pastes.append(dict(src=src_map, piece=piece, at=tuple(at), yaw=int(yaw) % 65536, face=face,
                                       group=self._auto(), pid='S%d' % len(self.script_pastes), note=self._note()))

    def _materialize_pastes(self):
        """The pieces of the script's paste() calls become actor blocks (imported with the actors,
        before the BSP rebuild), members of their structure."""
        entries = getattr(self, 'script_pastes', [])
        if not entries or getattr(self, '_pasted', False):
            return
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parent / 'editor'))
        import prefabs
        for e in entries:
            if e['src'] == 'object':                # an object of the map editor's Pieces (editor/gamelib.py)
                import gamelib
                pf = prefabs.load(gamelib.prefab(e['piece'], log=lambda *a: None)['id'])
            elif isinstance(e['piece'], dict):      # a whole area (prefabs.region_piece)
                pf = prefabs.region_piece(e['src'], e['piece'], log=lambda *a: None)
            else:
                pf = prefabs.library_piece(e['src'], e['piece'], log=lambda *a: None)
            off = tuple(e['at'][i] - pf['pivot'][i] for i in range(3))
            yaw = e['yaw']
            if e.get('face'):
                if pf.get('facing') is None:
                    print('  PASTE: %s %s has no clear front; face=%s ignored' % (e['src'], e['piece'], e['face']))
                else:
                    want = {'+x': 0, '+y': 16384, '-x': 32768, '-y': 49152}[e['face']]
                    yaw = (want - pf['facing']) % 65536
            blocks, brushes, actors = prefabs.place(dict(pid=e['pid'], prefab=pf['id'], offset=off, yaw=yaw, _prefab=pf))
            for cmd in prefabs.package_commands(pf['packages']):
                if cmd not in self.extra_obj:
                    self.extra_obj.append(cmd)
            self.actors += blocks
            self.movers += [n for block in blocks for cls, n in [_head(block)] if cls == 'DeusExMover']
            for n in brushes + actors:
                if e['group']:
                    self.actor_group[n] = e['group']
            e['members'] = list(brushes) + list(actors)     # one piece when its structure is un-nested
            e['label'] = pf.get('label')
        self._pasted = True

    def drop(self, cls, x, y, z_from, name=None, rot=None, lift=0.0, **props):
        """Place cls on the first surface below (x, y, z_from): floor, shelf, platform, step."""
        explicit = name is not None
        name = name or self._name(cls.split('.')[-1])
        self.pending.append(('drop', cls, (x, y, z_from), name, rot, lift, props))
        self._own(name, explicit)
        return name

    def snap(self, cls, x, y, z, toward, name=None, rot=None, gap=0.5, **props):
        """Push cls from (x, y, z) toward '+x' '-x' '+y' '-y' until it touches a wall; it faces away
        from the wall (rot overrides)."""
        explicit = name is not None
        name = name or self._name(cls.split('.')[-1])
        self.pending.append(('snap', cls, (x, y, z), name, rot, gap, dict(props, _toward=toward)))
        self._own(name, explicit)
        return name

    def _resolve(self, session):
        import sizes
        cache = sizes.load()
        missing = [c for _, c, *_ in self.pending if c.split('.')[-1] not in cache]
        if missing:
            sizes.query(missing)
            cache = sizes.load()
        report = []
        for kind, cls, (x, y, z), name, rot, extra, props in self.pending:
            r, h = cache.get(cls.split('.')[-1]) or (16.0, 16.0)
            if kind == 'drop':
                hit = session.trace((x, y, z), (x, y, z - 4000))
                if hit is None:
                    report.append('  DROP: %s %s found no surface below (%g %g %g)' % (cls, name, x, y, z))
                    loc = (x, y, z)
                else:
                    loc = (x, y, hit[0][2] + h + extra)
                self.actors.append(self._block(cls, loc, name, rot, '', props))
            else:
                props = dict(props)
                toward = props.pop('_toward')
                # a direction name, or a vector when the structure was turned in the editor
                d = {'+x': (1, 0, 0), '-x': (-1, 0, 0), '+y': (0, 1, 0), '-y': (0, -1, 0)}.get(toward, toward)
                hit = session.trace((x, y, z), (x + d[0] * 3000, y + d[1] * 3000, z))
                if hit is None:
                    report.append('  SNAP: %s %s found no wall toward %s' % (cls, name, toward))
                    loc, yaw = (x, y, z), 0
                else:
                    (hx, hy, hz), n = hit
                    loc = (hx + n[0] * (r + extra), hy + n[1] * (r + extra), z)
                    yaw = int(round(math.atan2(n[1], n[0]) * 32768 / math.pi)) % 65536
                self.actors.append(self._block(cls, loc, name, rot if rot is not None else (0, yaw, 0), '', props))
        self.pending = []
        for line in report:
            print(line)
        return report

    # ------------------------------------------------------------------ edits from the map editor
    def _apply_box_edits(self, edits):
        """Blocks added in the editor (tools/mapkit/editor): boxes with one texture each; water, zone
        portals and sky (editor/zones.py)."""
        import sys as _sys
        _sys.path.insert(0, str(Path(__file__).resolve().parent / 'editor'))
        import zones as _zones
        self.zone_edits = edits
        for cmd in _zones.packages(edits):
            if cmd not in self.extra_obj:
                self.extra_obj.append(cmd)
        has_sky = any(re.match(r'Begin Actor Class=SkyZoneInfo ', a) for a in self.actors)
        import motions as _motions
        for op, br, fl in _motions.wall_ops(edits):  # invisible walls (solid collision boxes)
            self.add(br, flags=fl)
        self.motion_edits = edits if edits.get('motions') else None
        sky_ops, self.zone_actors = _zones.skybox(edits, has_sky)
        for op, br, fl in sky_ops:                  # the sky box, and the sheet of its clouds
            if op == 'sub':
                self.sub(br)
            else:
                self.add(br, semisolid=True)
        self.zone_actors += _zones.actors(edits)
        for b in edits.get('boxes', []):
            lo, hi = b['lo'], b['hi']
            turn = lambda br, inside=False: geom.rotate_brush(br, [(lo[k]+hi[k])/2 for k in range(3)], b.get('rot'), inside)
            if not all(hi[i] > lo[i] for i in range(3)):
                continue
            if b.get('mover'):                     # a block that can move (an animated mover, editor/motions.py)
                import motions as _motions
                c, brush, props = _motions.moving_block(b)
                self.mover('DeusExMover', tuple(c), brush, name=b['name'], **props)
                continue
            if _zones.is_zone_box(b):              # water (a pool, its surface a zone portal), a zone portal
                for op, br, fl in _zones.brush_ops(b):
                    if op == 'sub':
                        self.sub(turn(br, True))
                    else:
                        self.add(turn(br), flags=fl)
                continue
            mat = geom.Mat(b.get('tex') or 'ClenGreyCncrt_A')
            if b.get('sign'):                      # a sign: its text on the front face (editor/textures.py)
                import sys as _sys
                _sys.path.insert(0, str(Path(__file__).resolve().parent / 'editor'))
                import textures as _textures
                mat = _textures.sign_mats(b, edits)
            import blocks as _blocks               # its shape: a cube, a wedge, a cylinder, a cone, a sphere, a dome
            if b.get('hole'):                      # a hole: cuts through what the map has (doorways, pits, rooms)
                for br in _blocks.brushes(b, _zones.hole_mats(b) if b.get('sky') else mat, b.get('name', 'EditBox')):
                    self.sub(turn(br, True))
                continue
            for br in _blocks.brushes(b, mat, b.get('name', 'EditBox')):     # a hollow one: its convex pieces
                self.add(turn(br), semisolid=not b.get('solid', False))
        # walls, roads, floors and roofs drawn in the editor (Map > Draw ...): editor/drawn.py
        import drawn as _drawn
        for pkg in _drawn.packages(edits):           # their textures' packages, when not among the usual ones
            if pkg not in self.packages and ('OBJ LOAD FILE="%s.utx"' % pkg) not in self.extra_obj:
                self.extra_obj.append('OBJ LOAD FILE="%s.utx"' % pkg)
        built, report = _drawn.all_brushes(edits)
        for _name, br in built:
            self.add(br, semisolid=True)
        for line in report:
            print(line)

    def _apply_actor_edits(self, edits):
        """Moved / deleted / added actors from the editor. A moved or deleted actor is matched by name
        and class (and, for automatic names, by its original position), so later script changes that
        shift automatic names do not move the wrong thing."""
        report = []
        self.scales = {}

        def head(block):
            m = re.match(r'Begin Actor Class=(\S+) Name=(\S+)', block)
            return (m.group(1), m.group(2)) if m else (None, None)

        def loc_of(block):
            m = re.search(r'Location=\(X=([-\d.]+),Y=([-\d.]+),Z=([-\d.]+)\)', block)
            return tuple(float(c) for c in m.groups()) if m else None

        def match(block, name, info):
            cls, n = head(block)
            if n != name or (info.get('cls') and info['cls'].split('.')[-1] != cls.split('.')[-1]):
                return False
            orig = info.get('orig')
            if orig and loc_of(block) and max(abs(a - b) for a, b in zip(loc_of(block), orig)) > 2:
                return False
            return True
        deleted = edits.get('deleted', {})
        if isinstance(deleted, list):
            deleted = {n: {} for n in deleted}
        keep = []
        for block in self.actors:
            _, n = head(block)
            if n in deleted and match(block, n, deleted[n]):
                report.append('  EDIT deleted %s' % n)
                continue
            info = edits.get('moved', {}).get(n)
            if info and match(block, n, info):
                original_block = block
                x, y, z = info['loc']
                block = re.sub(r'Location=\([^)]*\)', 'Location=(X=%.2f,Y=%.2f,Z=%.2f)' % (x, y, z), block, count=1)
                if 'rot' in info:
                    p_, y_, r_ = (int(v) for v in info['rot'])
                    rot = 'Rotation=(Pitch=%d,Yaw=%d,Roll=%d)' % (p_, y_, r_)
                    if 'Rotation=(' in block:
                        block = re.sub(r'Rotation=\([^)]*\)', rot, block, count=1)
                    else:
                        block = block.replace('\n', '\n    %s\n' % rot, 1)
                report.append('  EDIT moved %s' % n)
                if n in self.movers:
                    import mover_transform, t3d
                    old = next(t3d.actors(original_block))['props']
                    block = mover_transform.apply(block, old, mover_transform.relocation(old, info['loc'], info.get('rot') or t3d.rot(old.get('Rotation'))))
                if info.get('scale') and abs(float(info['scale']) - 1) > 1e-3:
                    self.scales[n] = float(info['scale'])
            elif info:
                report.append('  EDIT skipped %s (not found as %s at its original place)' % (n, info.get('cls')))
            keep.append(block)
        self.actors = keep
        # A deleted door also leaves the mover preparation/animation roster. Its brush is
        # embedded in the actor block above; no surrounding CSG or other door is removed.
        live_names = {_head(block)[1] for block in keep}
        self.movers = [name for name in getattr(self, 'movers', []) if name in live_names]
        for a in edits.get('added', []):
            props = dict(a.get('props', {}))
            if str(a['cls']).endswith('UCCutscene'):  # its keys, lines and options (editor/cutscenes.py)
                import sys as _sys
                _sys.path.insert(0, str(Path(__file__).resolve().parent / 'editor'))
                import cutscenes as _cuts
                props.update(_cuts.props(edits, a['name']))
            self.actor(a['cls'], tuple(a['loc']), name=a['name'], rot=tuple(int(v) for v in a.get('rot', (0, 0, 0))),
                       **props)
            report.append('  EDIT added %s %s' % (a['cls'], a['name']))
            if a.get('scale') and abs(float(a['scale']) - 1) > 1e-3:
                self.scales[a['name']] = float(a['scale'])
        # the emails and bulletins of the computers: hidden UCTextBlock actors (editor/comptexts.py)
        if edits.get('texts') or edits.get('documents'):
            import sys as _sys
            _sys.path.insert(0, str(Path(__file__).resolve().parent / 'editor'))
            import comptexts
            import documents
            for a in comptexts.blocks(edits, self.map_name) + documents.blocks(edits, self.map_name):
                self.actor(a['cls'], tuple(a['loc']), name=a['name'], rot=(0, 0, 0), **a['props'])
            report += comptexts.report(edits)
            report += documents.report(edits)
        if edits.get('level'):                  # a music actor for a map without one (editor/mapsettings.py)
            import sys as _sys
            _sys.path.insert(0, str(Path(__file__).resolve().parent / 'editor'))
            import mapsettings as _ms
            for a in _ms.commands(edits, self.map_name)[1]:
                self.actor(a['cls'], tuple(a['loc']), name=a['name'], rot=(0, 0, 0), **a['props'])
            report += _ms.report(edits)
        if edits.get('anims') or edits.get('props') or edits.get('added'):
            # what the characters do when not busy (editor/anims.py): UCAnimSet actors of the editor's package
            import sys as _sys
            _sys.path.insert(0, str(Path(__file__).resolve().parent / 'editor'))
            import anims as _anims
            for a in _anims.blocks(edits):
                self.actor(a['cls'], tuple(a['loc']), name=a['name'], rot=(0, 0, 0), **a['props'])
            report += _anims.report(edits)
        if edits.get('behave') or edits.get('player_move'):
            # the characters' behaviours, JC's movement (editor/behaviours.py): UCBehave, UCPlayerMove of the editor's package
            import sys as _sys
            _sys.path.insert(0, str(Path(__file__).resolve().parent / 'editor'))
            import behaviours as _behaviours
            for a in _behaviours.blocks(edits):
                self.actor(a['cls'], tuple(a['loc']), name=a['name'], rot=(0, 0, 0), **a['props'])
            report += _behaviours.report(edits)
        if getattr(self, 'motion_edits', None):   # a UCMotion per animated object (editor/motions.py)
            import motions as _motions
            for a in _motions.blocks(edits, self._mover_names()):
                self.actor(a['cls'], tuple(a['loc']), name=a['name'], rot=(0, 0, 0), **a['props'])
            report += _motions.report(edits, self._mover_names())
        for a in getattr(self, 'zone_actors', None) or []:    # the WaterZones of the pools, the sky zone
            self.actor(a['cls'], tuple(a['loc']), name=a['name'], rot=(0, 0, 0), **a['props'])
            report.append('  EDIT zone %s %s' % (a['cls'], a['name']))
        if edits.get('links') or edits.get('usable') or edits.get('objectTags'):
            # the interactions (when this happens, do that): UCLink actors of the editor's package (editor/links.py),
            # and a UCUsable for every object JC can use (Properties > Usable)
            import sys as _sys
            _sys.path.insert(0, str(Path(__file__).resolve().parent / 'editor'))
            import links as _links
            for a in _links.blocks(edits):
                self.actor(a['cls'], tuple(a['loc']), name=a['name'], rot=(0, 0, 0), **a['props'])
            report += _links.report(edits)
            self.link_edits = edits
        if edits.get('navmesh') or edits.get('links') or (edits.get('level') or {}).get('navmesh'):
            # the walkable area in the game (editor/navbake.py): when characters are sent "on the walkable area"
            import sys as _sys
            _sys.path.insert(0, str(Path(__file__).resolve().parent / 'editor'))
            import navbake as _navbake
            for a in _navbake.blocks(edits, self.map_name):
                self.actor(a['cls'], tuple(a['loc']), name=a['name'], rot=(0, 0, 0), **a['props'])
            report += _navbake.report(edits, self.map_name)
        for line in report:
            print(line)
        return report

    # ------------------------------------------------------------------ structures moved in the editor
    def _pivots(self):
        """Pivot of every structure as the script makes it: centre of its brushes (X, Y) at their
        lowest Z; a structure without brushes uses its actors."""
        boxes = {}
        for i, (_, b, _) in enumerate(self.ops):
            g = self.op_group[i] if i < len(self.op_group) else None
            if g:
                boxes.setdefault(g, []).extend(b.bounds())
        for block in self.actors:
            g = self.actor_group.get(_head(block)[1])
            if g and g not in boxes:
                boxes.setdefault('~' + g, []).append(_loc(block))
        for p in self.pending:
            g = self.actor_group.get(p[3])
            if g and g not in boxes:
                boxes.setdefault('~' + g, []).append(p[2])
        out = {}
        for key, pts in boxes.items():
            pts = [p for p in pts if p]
            if not pts:
                continue
            lo = [min(p[i] for p in pts) for i in range(3)]
            hi = [max(p[i] for p in pts) for i in range(3)]
            out.setdefault(key.lstrip('~'), (round((lo[0] + hi[0]) / 2, 1), round((lo[1] + hi[1]) / 2, 1), round(lo[2], 1)))
        return out

    def _apply_groups(self, edits):
        """Structures moved, turned, copied or deleted in the map editor:
        edits['groups'] = {name: {'offset': [x, y, z], 'yaw': units, 'deleted': bool}}
        edits['copies'] = [{'group': name, 'id': 'c1', 'offset': [...], 'yaw': units}]
        Offsets and turns are relative to the structure as the script makes it."""
        report = []
        self._dissolve_wide()
        self.pivots = pivots = self._pivots()
        for g in [g for g in self.groups if g not in pivots]:       # sections with nothing in them
            self.groups.pop(g)
        self.placement = {}
        gedits = dict(edits.get('groups') or {})
        copies = list(edits.get('copies') or [])
        # structures taken apart in the editor (Un-nest): before the copies, so a piece can be copied too
        unnest = set(edits.get('unnest') or [])
        self.op_piece = [None] * len(self.ops)
        self.pieces = {}
        originals = list(self.groups)
        self._pieces(originals)
        report += self._unnest(unnest, pivots, originals)
        n_ops = len(self.ops)
        for c in copies:
            g = c.get('group')
            if g not in self.groups or g not in pivots:
                report.append('  EDIT skipped copy of %s (no such structure)' % g)
                continue
            if not self._copyable(g):
                report.append('  EDIT skipped copy of %s (it has doors or mission objects)' % g)
                continue
            cid = re.sub(r'\W', '', str(c.get('id') or 'c%d' % len(self.groups)))
            cname = '%s~%s' % (g, cid)
            self.groups[cname] = dict(self.groups[g], label='%s (copy %s)' % (self.groups[g]['label'], cid), copy_of=g)
            pivots[cname] = pivots[g]
            gedits[cname] = dict(offset=c.get('offset', (0, 0, 0)), yaw=c.get('yaw', 0), pitch=c.get('pitch', 0), roll=c.get('roll', 0), scale=c.get('scale'),
                                 stretch=c.get('stretch'))
            for i in range(n_ops):
                if self.op_group[i] == g:
                    self.ops.append(self.ops[i])
                    self.op_group.append(cname)
                    self.op_piece.append(None)
            for block in list(self.actors):
                old = _head(block)[1]
                if self.actor_group.get(old) == g:
                    new = '%s_%s' % (old, cid)
                    self.actors.append(block.replace('Name=%s\n' % old, 'Name=%s\n' % new, 1))
                    self.actor_group[new] = cname
                    if old in self.actor_note:
                        self.actor_note[new] = self.actor_note[old]
            for p in list(self.pending):
                if self.actor_group.get(p[3]) == g:
                    new = '%s_%s' % (p[3], cid)
                    self.pending.append(p[:3] + (new,) + p[4:])
                    self.actor_group[new] = cname
                    if p[3] in self.actor_note:
                        self.actor_note[new] = self.actor_note[p[3]]
            report.append('  EDIT copied %s as %s' % (g, cname))
        made = [g for g in self.groups if g not in originals and self.groups[g].get('copy_of')]   # copies: pieces of their own
        self._pieces(made)
        report += self._unnest(unnest, pivots, made)
        gone = {g for g, e in gedits.items() if e.get('deleted') and g in self.groups}
        if gone:
            keep = [i for i in range(len(self.ops)) if self.op_group[i] not in gone]
            self.ops = [self.ops[i] for i in keep]
            self.op_group = [self.op_group[i] for i in keep]
            self.op_piece = [self.op_piece[i] for i in keep]
            self.actors = [b for b in self.actors if self.actor_group.get(_head(b)[1]) not in gone]
            self.pending = [p for p in self.pending if self.actor_group.get(p[3]) not in gone]
            report += ['  EDIT deleted structure %s' % g for g in sorted(gone)]
        xfs = {}
        for g, e in gedits.items():
            if g not in self.groups or g in gone or g not in pivots:
                if g not in self.groups:
                    report.append('  EDIT skipped structure %s (not in the script any more)' % g)
                continue
            off = tuple(float(v) for v in (e.get('offset') or (0, 0, 0)))
            yaw = int(e.get('yaw') or 0) % 65536
            pitch, roll = int(e.get('pitch') or 0) % 65536, int(e.get('roll') or 0) % 65536
            scale = tuple(max(0.05, float(v)) for v in (e.get('scale') or (1, 1, 1)))
            if any(abs(k - 1) > 1e-6 for k in scale) and not self._scalable(g):
                report.append('  EDIT %s not stretched: it has doors or lifts (moved only)' % g)
                scale = (1.0, 1.0, 1.0)
            self.placement[g] = dict(offset=list(off), yaw=yaw, pitch=pitch, roll=roll, scale=list(scale), stretch=bool(e.get('stretch')))
            xf = geom.XForm(pivots[g], off, yaw, scale, bool(e.get('stretch')), pitch=pitch, roll=roll)
            if any(off) or xf.rotated or xf.scaled:
                xfs[g] = xf
                report.append('  EDIT moved structure %s by (%g, %g, %g)%s%s' % (
                    g, off[0], off[1], off[2], ', turned %d deg' % round(yaw * 360 / 65536) if yaw else '',
                    ', stretched %s' % '/'.join('%g' % k for k in scale) if xf.scaled else ''))
        self.op_xf = [xfs.get(g) for g in self.op_group]
        self.actors = [self._xf_block(b, xfs[self.actor_group[_head(b)[1]]])
                       if self.actor_group.get(_head(b)[1]) in xfs else b for b in self.actors]
        moved = []
        for p in self.pending:
            xf = xfs.get(self.actor_group.get(p[3]))
            if xf is None:
                moved.append(p)
                continue
            kind, cls, start, name, rot, extra, props = p
            if rot is not None:
                pr, yr, rr = rot if isinstance(rot, tuple) else (0, rot, 0)
                rot = xf.rot((pr, yr, rr))
            if kind == 'snap':
                t = props['_toward']
                d = {'+x': (1, 0, 0), '-x': (-1, 0, 0), '+y': (0, 1, 0), '-y': (0, -1, 0)}.get(t, t)
                props = dict(props, _toward=xf.vec(d))
            moved.append((kind, cls, xf.point(start), name, rot, extra, props))
        self.pending = moved
        for line in report:
            print(line)
        return report

    def _pieces(self, names):
        """The pieces of the structures names, what un-nesting takes apart in the map editor: each brush
        the script adds or cuts, each piece pasted from another map (its brushes and objects together).
        Ids by order inside the structure (g/o0, g/p0...), so the same from one build to the next."""
        names = [g for g in names if g in self.groups and not self.groups[g].get('paste')]
        want = set(names)
        n = {}
        for i, (_, b, _) in enumerate(self.ops):
            g = self.op_group[i]
            if g not in want or self.op_piece[i]:
                continue
            k = n[g] = n.get(g, -1) + 1
            pts = [p for p in b.bounds() if p]
            lo = [min(p[j] for p in pts) for j in range(3)]
            hi = [max(p[j] for p in pts) for j in range(3)]
            pid = '%s/o%d' % (g, k)
            self.op_piece[i] = pid
            self.pieces.setdefault(g, []).append(dict(
                id=pid, note=getattr(b, 'note', None), label=None, members=[],
                pivot=[round((lo[0] + hi[0]) / 2, 1), round((lo[1] + hi[1]) / 2, 1), round(lo[2], 1)]))
        for g in names:
            base = self.groups[g].get('copy_of') or g
            cid = g.split('~', 1)[1] if self.groups[g].get('copy_of') else None
            j = -1
            for e in getattr(self, 'script_pastes', []):
                if e.get('group') != base:
                    continue
                j += 1
                members = [m if cid is None else '%s_%s' % (m, cid) for m in e.get('members') or []]
                members = [m for m in members if self.actor_group.get(m) == g]
                if members:
                    label = re.sub(r' · \d+ pieces$', '', e.get('label') or '') or None
                    self.pieces.setdefault(g, []).append(dict(id='%s/p%d' % (g, j), note=e.get('note'), label=label,
                                                              members=members, pivot=[round(float(v), 1) for v in e['at']]))
        for g in names:                       # their names: the script's comment, numbered when it says several
            pcs = self.pieces.get(g, [])
            for k, p in enumerate(pcs):
                p['label'] = p['label'] or (p['note'][1] if p['note'] else '%s · part %d' % (self.groups[g]['label'], k + 1))
            count = {}
            for p in pcs:
                count[p['label']] = count.get(p['label'], 0) + 1
            seen = {}
            for p in pcs:
                if count[p['label']] > 1:
                    seen[p['label']] = seen.get(p['label'], 0) + 1
                    p['label'] = '%s (%d)' % (p['label'], seen[p['label']])

    def _unnest(self, want, pivots, names):
        """edits['unnest'], structures taken apart in the map editor: 'g' (all of it: its pieces become
        structures of their own, its other objects are free), 'g/o3' or 'g/p1' (one piece of it),
        'a:<actor>' (one object out of its structure)."""
        report = []
        if not want:
            return report
        for g in names:
            if g not in self.groups:
                continue
            whole = g in want
            pcs = self.pieces.get(g, [])
            out = [p for p in pcs if whole or p['id'] in want]
            for p in out:
                pid = p['id']
                self.groups[pid] = dict(label=p['label'], category=self.groups[g].get('category', ''),
                                        copyable=None, piece_of=g)
                pivots[pid] = tuple(p['pivot'])
                for i, q in enumerate(self.op_piece):
                    if q == pid:
                        self.op_group[i] = pid
                for m in p['members']:
                    if self.actor_group.get(m) == g:
                        self.actor_group[m] = pid
            if out:
                self.pieces[g] = [p for p in pcs if p not in out]
            if whole:
                for n in [n for n, gg in self.actor_group.items() if gg == g]:
                    del self.actor_group[n]
            if out or whole:
                report.append('  EDIT un-nested %s: %s' % (g, 'all of it' if whole else ', '.join(p['id'] for p in out)))
            if g not in self.op_group and g not in self.actor_group.values():
                self.groups.pop(g, None)
        brushes = {_head(b)[1] for b in self.actors if _head(b)[0] == 'Brush'}      # a pasted piece's brushes stay with it
        for n in [w[2:] for w in sorted(want) if w.startswith('a:')]:
            if n in brushes:
                continue
            if self.actor_group.get(n) in names or self.groups.get(self.actor_group.get(n), {}).get('piece_of') in names:
                del self.actor_group[n]
                report.append('  EDIT %s taken out of its structure' % n)
        return report

    def _apply_prefabs(self, edits):
        """Structures copied from other maps (editor\\prefabs.py): their brushes and objects are imported
        with the actors, before the BSP rebuild, so they become part of the map."""
        entries = [e for e in (edits.get('prefabs') or []) if not e.get('deleted')]
        self.pastes = []
        if not entries:
            return []
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parent / 'editor'))
        import prefabs
        report = []
        for e in entries:
            try:
                pf = prefabs.load(e['prefab'])
                blocks, brushes, actors = prefabs.place(e)
            except (OSError, KeyError, ValueError) as err:
                report.append('  EDIT skipped paste %s (%s)' % (e.get('pid'), err))
                continue
            for cmd in prefabs.package_commands(pf['packages']):
                if cmd not in self.extra_obj:
                    self.extra_obj.append(cmd)
            g = 'paste~%s' % e['pid']
            self.groups[g] = dict(label='%s (from %s)' % (pf['label'], pf['source']), category='Pasted',
                                  copyable=False, paste=True, rotatable=pf.get('rotatable', True))
            getattr(self, 'pivots', {})[g] = tuple(pf['pivot'])
            getattr(self, 'placement', {})[g] = dict(offset=list(e.get('offset') or [0, 0, 0]), yaw=int(e.get('yaw') or 0),
                                                     pitch=int(e.get('pitch') or 0), roll=int(e.get('roll') or 0),
                                                     scale=list(e.get('scale') or [1, 1, 1]), stretch=bool(e.get('stretch')))
            self.actors += blocks
            self.movers += [n for block in blocks for cls, n in [_head(block)] if cls == 'DeusExMover']
            for n in actors + brushes:
                self.actor_group[n] = g
            self.pastes.append((g, brushes))
            report.append('  EDIT pasted %s from %s' % (pf['label'], pf['source']))
        for line in report:
            print(line)
        return report

    def in_structure(self, group, name):
        """group is the structure name, or a piece taken out of it (Un-nest)."""
        return bool(group) and (group == name or self.groups.get(group, {}).get('piece_of') == name)

    def _copyable(self, g):
        c = self.groups.get(g, {}).get('copyable')
        if c is not None:
            return bool(c)
        members = [n for n, gg in self.actor_group.items() if gg == g]
        return not any(n in self.movers or n in self.explicit for n in members)

    def _scalable(self, g):
        if 'rotatable' in self.groups.get(g, {}):
            return self.groups[g]['rotatable']
        return not any(n in self.movers for n, gg in self.actor_group.items() if gg == g)

    def _rotatable(self, g):
        return True

    @staticmethod
    def _xf_block(block, xf):
        """An actor of a moved structure: its position, its facing and its position-like
        properties (BasePos, entryPoint, ...) follow the structure."""
        import t3d
        original = next(t3d.actors(block), None)

        def point(m):       # also exported vectors, which leave zero components out
            p = xf.point(t3d.vec(m.group(2)))
            return '%s(X=%.2f,Y=%.2f,Z=%.2f)' % ((m.group(1),) + p)
        block = re.sub(r'(?m)^(\s*(?:Location|BasePos|\w*Point|\w*Pos)=)(\((?:[XYZ]=[-\d.e+]+,?)*\))', point, block)
        if xf.rotated:
            m = re.search(r'(?m)^(\s*)Rotation=(\([^)]*\))', block)
            if m:
                p_, y_, r_ = t3d.rot(m.group(2))
                block = block.replace(m.group(0), '%sRotation=(Pitch=%d,Yaw=%d,Roll=%d)'
                                      % ((m.group(1),) + xf.rot((p_, y_, r_))), 1)
            else:
                block = re.sub(r'(?m)^(\s*Location=.*)$', lambda mm: mm.group(1) + '\n    Rotation=(Pitch=%d,Yaw=%d,Roll=%d)'
                               % xf.rotation, block, count=1)
        if original and 'Mover' in original['cls']:
            import mover_transform
            block = mover_transform.apply(block, original['props'], xf)
        return block

    def structures(self):
        """The structures of the built map for the editor (out/<map>.groups.json): brushes by build
        order (UC_BSPDUMP reports the same order), actors, pivot and placement."""
        out = {}
        for g, info in self.groups.items():
            out[g] = dict(label=info['label'], category=info.get('category', ''), copy_of=info.get('copy_of'),
                          copyable=self._copyable(info.get('copy_of') or g),
                          rotatable=self._rotatable(info.get('copy_of') or g),
                          scalable=self._scalable(info.get('copy_of') or g),
                          pivot=list(getattr(self, 'pivots', {}).get(g) or self._pivots().get(g) or (0, 0, 0)),
                          placement=getattr(self, 'placement', {}).get(g, dict(offset=[0, 0, 0], yaw=0)),
                          brushes=[], actors=[], gameplay=False, deleted=True, piece_of=info.get('piece_of'), pieces=[])
        for i, g in enumerate(self.op_group):
            if g in out:
                out[g]['brushes'].append(i)
                out[g]['deleted'] = False
        k = len(self.ops)          # pasted brushes are imported with the actors: they come after the ops
        brush_ord = {}
        for block in self.actors:
            cls, n = _head(block)
            if cls != 'Brush':
                continue
            brush_ord[n] = k
            g = self.actor_group.get(n)
            if g in out:
                out[g]['brushes'].append(k)
                out[g]['deleted'] = False
            k += 1
        for block in self.actors:
            n = _head(block)[1]
            g = self.actor_group.get(n)
            if g in out:
                out[g]['actors'].append(n)
                out[g]['deleted'] = False
                if n in self.explicit:
                    out[g]['gameplay'] = True
        # what is inside each structure, for the editor's Un-nest: its pieces (brushes by build order,
        # the objects of a pasted piece) and its objects with the script's comment above them
        op_piece = self.op_piece if len(self.op_piece) == len(self.ops) else []
        for g, pcs in self.pieces.items():
            if g not in out:
                continue
            for p in pcs:
                inside = [m for m in p['members'] if self.actor_group.get(m) == g]
                out[g]['pieces'].append(dict(
                    id=p['id'], label=p['label'], note=p['note'], pivot=p['pivot'],
                    brushes=[i for i, q in enumerate(op_piece) if q == p['id']] + [brush_ord[m] for m in inside if m in brush_ord],
                    actors=[m for m in inside if m not in brush_ord],
                    copyable=not any(m in self.movers or m in self.explicit for m in inside),
                    rotatable=not any(m in self.movers for m in inside)))
        for g, s in out.items():
            s['notes'] = {n: self.actor_note[n] for n in s['actors'] if self.actor_note.get(n)}
        return out

    def light(self, loc, brightness=96, hue=32, sat=128, radius=16, cls='Light', **props):
        return self.actor(cls, loc, LightBrightness=int(brightness), LightHue=int(hue), LightSaturation=int(sat),
                          LightRadius=int(radius), **props)

    def spot(self, loc, rot, brightness=160, hue=32, sat=128, radius=24, cone=64, **props):
        """Spotlight pointing along rot (pitch, yaw, roll); cone 0..255."""
        return self.actor('Spotlight', loc, rot=rot, LightBrightness=int(brightness), LightHue=int(hue),
                          LightSaturation=int(sat), LightRadius=int(radius), LightCone=int(cone),
                          LightEffect='LE_Spotlight', **props)

    def mover(self, cls, loc, brush, name=None, **props):
        """Brush mover (doors, cabins). brush coordinates are relative to loc."""
        explicit = name is not None
        name = name or self._name('UCMover')
        model = 'UCMdl' + name
        body = geom.Brush(brush.faces, model).t3d() + "    Brush=Model'MyLevel.%s'" % model
        self.actors.append(self._block(cls, loc, name, None, body, dict(BasePos=tuple(float(c) for c in loc), **props)))
        self._own(name, explicit)
        self.movers.append(name)
        return name

    def texture(self, pcx, name, group='Map', masked=False):
        head = Path(pcx).read_bytes()[:16]
        w = int.from_bytes(head[8:10], 'little') + 1
        h = int.from_bytes(head[10:12], 'little') + 1
        geom.register(name, w, h)
        self.textures.append((Path(pcx), name, group, masked))
        return name

    def report_stretch(self, limit=1.3):
        """Print textures applied with a tile aspect different from the texture's own (stretched).
        Faces fitted explicitly (signs, the pad H) are skipped."""
        seen = {}
        for _, b, _ in self.ops:
            for f in b.faces:
                m = f.mat
                if f.u is not None or m is None or m.tile is None or isinstance(m.tile, (int, float)):
                    continue
                tu, tv = geom.tex_size(m.tex)
                if min(tu, tv) <= 16:
                    continue  # gradients and flat colours stretch on purpose
                r = (m.tile[0] / m.tile[1]) / (tu / tv)
                if r > limit or r < 1 / limit:
                    seen[(m.tex, tuple(m.tile))] = (tu, tv, r)
        self.stretched = seen
        for (tex, tile), (tu, tv, r) in sorted(seen.items()):
            print('  STRETCHED: %s tile %s on a %dx%d texture (x%.2f)' % (tex, tile, tu, tv, r))

    def report_usage(self, quiet=False):
        """Compare each face with how the original maps use its texture (texusage.json):
        SCALE  drawn at another scale than the game uses on that kind of surface
        KIND   a wall texture on a floor (or the other way round)
        (With no tile given, a material already takes the game's scale: geom.game_scale.)"""
        import texusage
        db = texusage.load()
        if not db:
            return {}
        found = {}
        for kind_op, b, _ in self.ops:
            inside = kind_op == 'sub'
            for f in b.faces:
                m = f.mat
                # hazard bands are fitted to their band width (maps' hazard()), like the originals
                if (m is None or f.u is not None or m.flags & PF_UNLIT or m.tex.startswith('UC')
                        or m.tex == 'WarnYeloStrip_A'):
                    continue
                d = db.get(m.tex.lower())
                if d is None or d['faces'] < 8:
                    continue
                nz = -f.normal[2] if inside else f.normal[2]
                kind = 'floor' if nz > 0.7 else ('ceiling' if nz < -0.7 else 'wall')
                tu, tv, su, sv = geom._scales(m, kind)
                mine = su / tu if tu else 1.0
                ref = d.get('scale_by_kind', {}).get(kind, d['scale'])
                ext = [max(p[i] for p in f.verts) - min(p[i] for p in f.verts) for i in range(3)]
                long_ = max(ext[0], ext[1]) if kind != 'wall' else max((ext[0] ** 2 + ext[1] ** 2) ** 0.5, ext[2])
                if (d['scale_share'] >= 0.4 or kind in d.get('scale_by_kind', {})) and not (0.62 < mine / ref < 1.6):
                    found.setdefault((m.tex, 'SCALE'), []).append('%.2f here, %.2f in the game (%s)' % (mine, ref, kind))
                short_ = min(ext[0], ext[1]) if kind != 'wall' else min((ext[0] ** 2 + ext[1] ** 2) ** 0.5, ext[2])
                if d[kind] < 0.05 and d['faces'] >= 20:
                    found.setdefault((m.tex, 'KIND'), []).append('%s here; game: wall %d%% floor %d%% ceiling %d%%'
                                                                 % (kind, d['wall'] * 100, d['floor'] * 100,
                                                                    d['ceiling'] * 100))
        if not quiet:
            for (tex, what), notes in sorted(found.items()):
                print('  TEXTURE %-5s %s: %s (%d faces)' % (what, tex, notes[0], len(notes)))
        self.usage = found
        return found

    # ------------------------------------------------------------------ build
    def commands(self, folder):
        """One-shot order: brushes, actors, then the rebuild (actors get their zones from it;
        importing them after the rebuild made LIGHT APPLY crash at random). The brushes go ahead of the
        actors in one MAP IMPORTADD: the same build order, one import instead of three commands a brush."""
        return (self.brush_commands(folder, brushes=False) + self.actor_commands(folder, self.brush_blocks())
                + self.world_commands())

    def brush_blocks(self):
        """The script's brushes as Brush actors in build order, for MAP IMPORTADD: the CSG is done once by
        MAP REBUILD, not again at every BRUSH ADD (about 10 ms each, twice per Rebuild).
        What BRUSH ADD made is kept: the names Brush2, Brush3... (face edits name their brush: UC_SURFACE)
        and, with UNLINK after the import, every polygon a surface of its own (the import joins the coplanar
        faces of one texture into one surface, and the faces would be numbered differently). Each model
        gets a name of its own (two models of one name in MyLevel would be one)."""
        out = []
        for i, (kind, brush, flags) in enumerate(self.ops):
            xf = self.op_xf[i] if i < len(self.op_xf) else None
            model = re.sub(r'\ABegin Brush Name=\S+', 'Begin Brush Name=%s%d' % (BRUSH_MODEL, i),
                           brush.t3d(inside=(kind == 'sub'), xf=xf), count=1)
            out.append('Begin Actor Class=Brush Name=Brush%d\n    CsgOper=%s\n%s%s    Brush=Model\'MyLevel.%s%d\'\nEnd Actor\n'
                       % (i + 2, 'CSG_Subtract' if kind == 'sub' else 'CSG_Add',
                          '    PolyFlags=%d\n' % flags if flags and kind != 'sub' else '', model, BRUSH_MODEL, i))
        return out

    def _find_packages(self, names):
        """The game's texture packages holding these textures, not loaded yet: their index is made from the
        player's own .utx first (a fresh install only has the usual packages'; a texture typed in New map
        or a script, e.g. the catacombs' Ctcomb_3, would otherwise stop the build)."""
        import sys as _sys
        _sys.path.insert(0, str(Path(__file__).resolve().parent / 'editor'))
        import texcat
        import texpicker
        import drawn as _drawn
        if texcat.ensure_index(texpicker._packages()):
            geom._SIZES = None
            _drawn._PACKAGE_OF = None
        geom.tex_size('x')
        loaded = set(p.lower() for p in self.packages) | set(
            m.group(1).lower() for m in (re.match(r'OBJ LOAD FILE="(\w+)\.utx"', c) for c in self.extra_obj) if m)
        out = []
        for name in names:
            pkg = _drawn.package_of(name)
            if pkg and pkg.lower() not in loaded and pkg not in out:
                out.append(pkg)
        return out

    def brush_commands(self, folder, brushes=True):
        """The map's setup (packages, textures) and, unless brushes is False, its brushes (one MAP IMPORTADD)."""
        folder = Path(folder)
        cmds = ['MAP NEW']
        for p in self.packages:
            cmds.append('OBJ LOAD FILE="%s.utx"' % p)
        cmds += self.extra_obj
        # the editor's classes (UCTextBlock, the Character Creator's UCCustom*...): their package has to be
        # loaded before the actors are imported, or the import skips them without a word
        if settings.STANDALONE and not any(re.match(r'Begin Actor Class=(?:\w+\.)?UCBoot ', a) for a in self.actors):
            # DeusEdix: the actor that starts the editor's story, texts and characters' fates in the game
            self.actors.append(self._block('UCBoot', (0, 0, 0), 'UCBoot0', (0, 0, 0), '', {}))
        mod = 'OBJ LOAD FILE="%s.u"' % settings.PACKAGE
        if mod not in self.extra_obj and any(re.match(r'Begin Actor Class=(UC|%s\.)' % re.escape(settings.PACKAGE), a) for a in self.actors):
            cmds.append(mod)
        for pcx, name, group, masked in self.textures:
            shutil.copy2(pcx, folder / 'Input' / pcx.name)
            cmds.append('TEXTURE IMPORT FILE="..\\Input\\%s" NAME=%s GROUP=%s PACKAGE=MyLevel MIPS=1 FLAGS=%d'
                        % (pcx.name, name, group, 2 if masked else 0))
        cmds += self.after_textures
        brush_dir = folder / 'T3D'
        known = set(n.lower() for _, n, _, _ in self.textures)
        geom.tex_size('x')
        missing = sorted(set(f.mat.tex for _, b, _ in self.ops for f in b.faces
                             if f.mat.tex.lower() not in geom._SIZES and f.mat.tex.lower() not in known))
        if missing:                                # a texture of a package the catalog has not read yet
            for pkg in self._find_packages(missing):
                cmds.insert(1, 'OBJ LOAD FILE="%s.utx"' % pkg)
            missing = [t for t in missing if t.lower() not in geom._SIZES]
        if missing:
            raise ValueError('unknown textures (not in the catalog): ' + ', '.join(missing))
        if not getattr(self, '_reported', False):
            self.report_stretch()
            self.report_usage()
            self._reported = True
        if brushes and self.ops:
            import t3d
            (brush_dir / 'brushes.t3d').write_text(t3d.import_text(self.brush_blocks()), encoding='ascii')
            cmds += ['MAP IMPORTADD FILE="..\\T3D\\brushes.t3d"', UNLINK]
        return cmds

    def _geometry_key(self):
        """What the drop and snap traces hit: the brushes in order (CSG, flags, polygons), not their textures."""
        import hashlib
        h = hashlib.sha1(b'traces 2\n')          # 2: the geometry is imported in one go (brush_blocks)
        for i, (kind, brush, flags) in enumerate(self.ops):
            xf = self.op_xf[i] if i < len(self.op_xf) else None
            h.update(('%s %s\n' % (kind, flags)).encode())
            for line in brush.t3d(inside=(kind == 'sub'), xf=xf).splitlines():
                line = line.strip()
                if line.startswith('Vertex'):
                    h.update(line.encode() + b'\n')
                elif line.startswith('Begin Polygon'):
                    h.update(re.sub(r'Texture=\S+\s*', '', line).encode() + b'\n')
        return h.hexdigest()

    def _trace_session(self, label):
        """A live SDK session with the geometry alone built, for drop and snap traces."""
        session = kit.Session([], (label or self.map_name) + '-trace')
        try:
            session.batch(self.brush_commands(session.folder) + ['MAP REBUILD'])
        except BaseException:
            session.close()
            raise
        return session

    def world_commands(self):
        # UnrealEd's optimal rebuild after the CSG (MAP REBUILD alone leaves more BSP nodes than needed)
        cmds = ['MAP REBUILD', 'BSP REBUILD OPTIMAL BALANCE=15', 'UC_WORLD finish', 'UC_ACTORS check']
        disabled = activation.names(getattr(self, 'activation_edits', {}))
        for m in self.movers:
            if m not in disabled:
                cmds.append('UC_MOVER prep %s 1 1 1' % m)
        return cmds

    def _mover_names(self):
        return set(self.movers) | {_head(a)[1] for a in self.actors if re.match(r'Begin Actor Class=\w*Mover', a)}

    def actor_commands(self, folder, brushes=()):
        """brushes (brush_blocks): the script's brushes, imported ahead of the actors in the same file."""
        import t3d
        folder = Path(folder)
        (folder / 'T3D' / 'actors.t3d').write_text(t3d.import_text(list(brushes) + self.actors), encoding='latin1',
                                                    errors='replace')    # pasted blocks may carry accents
        # objects made bigger or smaller in the editor: DrawScale and collision times the factor
        cmds = ['MAP IMPORTADD FILE="..\\T3D\\actors.t3d"'] + ([UNLINK] if brushes else []) + ['UC_SCALE %s %.4f' % (n, f) for n, f in
                                                              sorted(getattr(self, 'scales', {}).items())]
        if self.tex_edits:                    # skins of objects changed in the map editor
            import textures as _textures
            cmds += _textures.actor_commands(self.tex_edits, self.map_name)
        if getattr(self, 'prop_edits', None):   # the Properties panel of the map editor
            import props as _props
            cmds = cmds + _props.commands(self.prop_edits)
            import documents as _documents
            cmds += _documents.commands(self.prop_edits, self.map_name)
        if getattr(self, 'sound_edits', None):  # the sound packages the edits use (the game's, the imported ones)
            import sounds as _sounds
            cmds = _sounds.load_commands(self.sound_edits) + cmds
        if getattr(self, 'motion_edits', None):  # the keys of animated movers, moving lights
            import motions as _motions
            lights = {_head(a)[1] for a in self.actors if re.match(r'Begin Actor Class=(Light|Spotlight|TriggerLight)', a)}
            cmds += _motions.commands(self.motion_edits, self._mover_names(), lights)
        if getattr(self, 'model_edits', None):  # the packages of the models placed (editor Models tab)
            import models as _models
            cmds = _models.load_commands(self.model_edits) + cmds
        if getattr(self, 'link_edits', None):   # lights the interactions turn on and off
            import links as _links
            cmds += _links.commands(_links.object_tags.with_baked(self.link_edits, ''.join(self.actors)), {a['name']: a for a in t3d.actors(''.join(self.actors)) if re.match(r'(Light|Spotlight|TriggerLight)', a['cls'])})
        if getattr(self, 'level_edits', None):  # the map's settings: music, information, ambient light
            import sys as _sys
            _sys.path.insert(0, str(Path(__file__).resolve().parent / 'editor'))
            import mapsettings as _ms
            level_cmds, _, loads = _ms.commands(self.level_edits, self.map_name)
            cmds = loads + cmds + level_cmds
        # Export the full editor representation, then remove inactive actors before BSP checks,
        # paths and lighting. Their properties and saved edits remain available for reactivation.
        return cmds + activation.commands(getattr(self, 'activation_edits', {}))

    def build(self, out_map, light=True, paths=True, label=None, keep_t3d=True, edits=None):
        """drop/snap placements are traced in a live session on the geometry alone; the map itself
        is then built in one fresh run in the proven order (LIGHT APPLY crashed at random when
        actors were imported after a rebuild, or inside the interactive session)."""
        import json
        import time
        from editor import rebuild as _rebuild
        stages = _rebuild.script_stages(light, paths)
        light, paths = stages['lights'], stages['paths']
        t0 = time.time()
        self._group = None
        # the script is done: what the editor adds now (blocks, drawn walls, objects) belongs to no section of
        # it. Without this, all of it joined the script's last comment ("Where JC appears..." in a New map), a
        # structure that moved them together and named every added object in the Story's lists.
        self.auto_groups = False
        self._materialize_pastes()
        changes = {}
        if edits and Path(edits).exists():
            changes = json.loads(Path(edits).read_text(encoding='utf-8'))
            self._apply_box_edits(changes)
        activation.names(changes)
        self.activation_edits = changes
        self._apply_groups(changes)
        self._apply_prefabs(changes)
        if changes.get('textures'):           # pictures imported in the map editor, on objects and faces
            import sys as _sys
            _sys.path.insert(0, str(Path(__file__).resolve().parent / 'editor'))
            import textures as _textures
            self.tex_edits = changes
            _textures.scene_apply(self, changes)
        if self.pending:
            traces = _Traces(Path(out_map).with_suffix('.traces.json') if out_map else None, self._geometry_key(),
                             lambda: self._trace_session(label))
            try:
                self._resolve(traces)
            finally:
                traces.close()
            if traces.reused and not traces.traced:
                print('  brushes as in the last build: %d drop/snap places reused, no trace session' % traces.reused)
        if changes.get('props') or changes.get('rawprops') or changes.get('documents'):
            import sys as _sys
            _sys.path.insert(0, str(Path(__file__).resolve().parent / 'editor'))
            self.prop_edits = changes
        self.level_edits = changes if changes.get('level') else None
        self.sound_edits = changes or None
        if changes and (any(a.get('cls') == 'UCMeshDeco' or (a.get('props') or {}).get('Mesh')
                            for a in changes.get('added') or [])
                        or any(p.get('Mesh') for p in (changes.get('props') or {}).values())):
            import sys as _sys
            _sys.path.insert(0, str(Path(__file__).resolve().parent / 'editor'))
            self.model_edits = changes
        if changes:
            self._apply_actor_edits(changes)
        if not changes.get('level'):
            # The project default applies even to an untouched generated map.
            import sys as _sys
            _sys.path.insert(0, str(Path(__file__).resolve().parent / 'editor'))
            import player_profiles
            for a in player_profiles.blocks(changes):
                self.actor(a['cls'], tuple(a['loc']), name=a['name'], rot=(0, 0, 0), **a['props'])
        folder = kit.new_run([], label or self.map_name)
        cmds = self.commands(folder)
        import sys as _sys
        _sys.path.insert(0, str(Path(__file__).resolve().parent / 'editor'))
        import player_profiles as _players
        player_cmds = _players.prepare_commands(changes, folder)
        if player_cmds:
            # A fresh MAP NEW has no loadable MyLevel package yet. Materialize a
            # PRIVATE intermediate map before creating its local animation mesh.
            cmds += ['MAP SAVE FILE="..\\Output\\player-base.dx"',
                     'MAP LOAD FILE="..\\Output\\player-base.dx"'] + player_cmds
        import surfaces as _surfaces
        surface_cmds = _surfaces.commands(changes)
        if surface_cmds:
            cmds += _surfaces.load_commands(changes, local_package=self.map_name) + ['UC_LIGHTSTATS'] + surface_cmds
            light = light or _surfaces.needs_lighting(changes)
        if paths:
            # path nodes rest on the floor (Deus Ex links no point floating 25 units up: host UC_NAVDROP)
            cmds += ['UC_NAVDROP *', 'PATHS DEFINE']
        if light:
            cmds.append('LIGHT APPLY')
        if surface_cmds:
            cmds.append('UC_LIGHTSTATS')
        cmds.append('UC_CAMERAS clear')
        cmds.append('MAP SAVE FILE="..\\Output\\%s.dx"' % self.map_name)
        cmds.append('MAP EXPORT FILE="..\\Output\\%s.t3d"' % self.map_name)
        text, _ = kit.execute(folder, cmds, 'build.log', timeout=3600)
        _players.verify_build(folder)
        if surface_cmds and light:
            for line in _surfaces.report(text):
                print(line)
        sec = time.time() - t0
        world = re.findall(r'UCMapKit\|world\|.*', text)
        light_line = re.findall(r'\d+ Lights, \d+ Polys, \d+ Pairs, \d+ Rays', text)
        out = folder / 'Output' / (self.map_name + '.dx')
        if out_map:
            Path(out_map).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(out, out_map)
            exported = folder / 'Output' / (self.map_name + '.t3d')
            if exported.exists():
                shutil.copy2(exported, Path(out_map).with_suffix('.t3d'))   # for plans (mcp_server map_plan)
            activation.save(out_map, folder, changes)
            # structures for the map editor (brush order = the order UC_BSPDUMP reports)
            Path(out_map).with_suffix('.groups.json').write_text(json.dumps(self.structures(), indent=0),
                                                                 encoding='utf-8')
        print('built %s in %.1fs  %s  %s  -> %s' % (self.map_name, sec, world, light_line, out_map or out))
        if getattr(self, 'zone_edits', None) and (folder / 'Output' / (self.map_name + '.t3d')).exists():
            import zones as _zones                 # zones of the editor that leak
            for line in _zones.report((folder / 'Output' / (self.map_name + '.t3d')).read_text(encoding='latin1', errors='replace'),
                                      self.zone_edits):
                print(line)
        # actors whose origin is inside solid geometry (lights there light nothing)
        buried = re.findall(r'UCMapKit\|in solid\|(.*)', text)
        for line in buried:
            print('  IN SOLID: ' + line.strip())
        self.buried = buried
        return folder, out
