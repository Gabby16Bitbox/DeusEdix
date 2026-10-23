"""Animations of the characters in the map editor.

- The model of a character class with every frame of every animation (host UC_ANIMDUMP), made once per
  model into cache/_anims/<model>.anim (the host's file: a text header, then the arrays) and
  <model>.json (the header read: sequences, counts, mapping). The 3D view plays them on the characters.
- What the editor's choices become in the map: edits['anims'] = {character name: {'idle': sequence,
  'rate': speed, 'own': True when it uses an animation of the Animation Studio, 'loc': [x, y, z]}} and
  the PatrolAnim of the patrol points (Properties) -> UCAnimSet actors of the mod (one per character,
  one for every patrol point). 'own': the character takes, in the game, the copy of its model in
  UCAnims.u (the Studio's animations added to it), whatever model the game gave it (HDTP or not).
  'still': True (Inspector > Behaviour > Stays put): the character never turns while standing or talking,
  animated or not (UCAnimSet.bStayPut); only its head follows JC.
"""
import json
import math
import re
import shutil
from pathlib import Path

import kit
import settings
import anim_props

HERE = Path(__file__).resolve().parent
CACHE = settings.GAME_CACHE / '_anims'          # the game's animations: shared by its projects
VERSION = 2                 # 2: the model's own skins


def _safe(name):
    return re.sub(r'[^\w.-]', '_', name)


def class_info(refresh=False, log=print):
    """{class: {'mesh', 'pkg', 'parents'}} of every actor class of the game and the mod with a model
    (UC_CLASSES), made once."""
    path = CACHE / 'classes.json'
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding='utf-8'))
    CACHE.mkdir(parents=True, exist_ok=True)
    log('reading the models of the classes (once)...')
    s = kit.Session([], 'editor-anims')
    try:
        s.batch(['MAP NEW', 'OBJ LOAD FILE="%s.u"' % settings.PACKAGE] + ['OBJ LOAD FILE="%s"' % p for p in settings.GAME_LOADS]
                + [r'UC_CLASSES ..\Output\classes.txt'])
        text = (s.folder / 'Output' / 'classes.txt').read_text(encoding='utf-8', errors='replace')
    finally:
        s.close()
    out = {}
    for line in text.splitlines():
        f = line.split('\t')
        if len(f) > 8 and f[0] == 'C' and f[5] != 'None':
            out[f[1]] = dict(mesh=f[5], pkg=f[2], parents=[x for x in f[8].split('/') if x])
    path.write_text(json.dumps(out, indent=0, sort_keys=True), encoding='utf-8')
    return out


def class_meshes(refresh=False, log=print):
    """{class: model path}."""
    return {c: i['mesh'] for c, i in class_info(refresh, log).items()}


def hdtp_table():
    """{class: HDTP model} of the game's characters whose Facelift puts an HDTP model on them in the game
    (DeusEx classes only: ScriptedPawn.Facelift leaves every other package alone). Read from the
    game's sources (DevInstall): the first HDTPCharacters model each class loads."""
    path = CACHE / 'hdtp.json'
    if path.exists():
        return json.loads(path.read_text(encoding='utf-8'))
    src = kit.PROJECT / 'DevInstall' / 'DeusEx' / 'Classes'
    out = {}
    for f in sorted(src.glob('*.uc')) if src.exists() else []:
        if f.stem in ('Human', 'JCDentonMale') or 'Carcass' in f.stem:
            continue
        text = f.read_text(encoding='latin-1', errors='replace')
        m = re.search(r'DynamicLoadObject\("HDTPCharacters\.(HDTP\w+)"', text)
        if m:
            out[f.stem] = 'HDTPCharacters.' + m.group(1)
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=0, sort_keys=True), encoding='utf-8')
    return out


def models_of(cls, log=print):
    """The models a character class has in the game: its own, and the HDTP one when Revision's HDTP
    gives it one (the Studio's animations are baked onto every one of them)."""
    cls = cls.split('.')[-1]
    info = class_info(log=log)
    if cls not in info and cls.startswith('UCCustom'):
        info = class_info(refresh=True, log=log)
    c = info.get(cls)
    if not c:
        return []
    out = [c['mesh']]
    if c['pkg'] == 'DeusEx':
        table = hdtp_table()
        for k in [cls] + c['parents']:
            if k in table:
                out.append(table[k])
                break
            if k in ('ScriptedPawn', 'Pawn'):
                break
    return out


def mesh_of(cls, log=print):
    cls = cls.split('.')[-1]
    meshes = class_meshes(log=log)
    if cls not in meshes and cls.startswith('UCCustom'):      # a character made after the table: read again
        meshes = class_meshes(refresh=True, log=log)
    return meshes.get(cls)


def parse(data):
    """The header of a UC_ANIMDUMP file -> dict; 'offset' = where its arrays start."""
    i = data.index(b'data\n')
    out = dict(version=VERSION, seqs=[], tex=[], mats=[], offset=i + 5)
    for line in data[:i].decode('utf-8', errors='replace').splitlines():
        f = line.split(' ')
        if f[0] == 'mesh':
            out['mesh'], out['lod'], out['vertsize'] = f[1], int(f[2]), int(f[3])
        elif f[0] == 'counts':
            keys = ('frameVerts', 'frames', 'specialVerts', 'modelVerts', 'faces', 'wedges', 'materials', 'specialFaces',
                    'remap', 'oldFrameVerts', 'verts')
            out['counts'] = dict(zip(keys, [int(x) for x in f[1:12]]))
        elif f[0] == 'xform':
            n = [float(x) for x in f[1:10]]
            out['scale'], out['origin'], out['rot'] = n[0:3], n[3:6], [int(x) for x in n[6:9]]
        elif f[0] == 'seq' and len(f) >= 7:
            notes = [[float(f[7 + 2 * k]), f[8 + 2 * k]] for k in range(int(f[6])) if 8 + 2 * k < len(f)]
            out['seqs'].append(dict(name=f[1], group=f[2], start=int(f[3]), frames=int(f[4]), rate=float(f[5]), notifys=notes))
        elif f[0] == 'tex' and len(f) >= 3:
            out['tex'].append(f[2])
        elif f[0] == 'mat' and len(f) >= 4:
            out['mats'].append([int(f[2]), int(f[3])])
    return out


def load(mesh, log=print):
    """The sequences of a model (and the url of its frames), made once."""
    if not re.fullmatch(r'[\w.]+', mesh or ''):
        raise ValueError('not a model: %r' % mesh)
    info = CACHE / (_safe(mesh) + '.json')
    if info.exists():
        d = json.loads(info.read_text(encoding='utf-8'))
        if d.get('version') == VERSION:
            return d
    CACHE.mkdir(parents=True, exist_ok=True)
    log('reading the animations of %s (once)...' % mesh)
    s = kit.Session([], 'editor-anim')
    try:
        s.cmd(r'UC_ANIMDUMP %s ..\Output\model.anim' % mesh)
        src = s.folder / 'Output' / 'model.anim'
        if not src.exists():
            raise RuntimeError('the game has no model %s' % mesh)
        shutil.copy2(src, CACHE / (_safe(mesh) + '.anim'))
    finally:
        s.close()
    d = parse((CACHE / (_safe(mesh) + '.anim')).read_bytes())
    d['url'] = '/cache/_anims/%s.anim' % _safe(mesh)
    # the model's own skins (an HDTP model has them; the game's usually take the character's MultiSkins)
    own = {t: (0, 0) for t in d['tex'] if t != 'None'}
    d['skins'] = {}
    if own:
        import data
        s = kit.Session([], 'editor-anim-tex')
        try:
            info_tex = data.export_textures(s, own, CACHE, log)
        finally:
            s.close()
        for i, t in enumerate(d['tex']):
            if (info_tex.get(t) or {}).get('png'):
                d['skins'][str(i)] = '/cache/_anims/' + info_tex[t]['png']
    info.write_text(json.dumps(d), encoding='utf-8')
    return d


def for_class(cls, log=print):
    """The animations of a character class: its model's (the game's) and the Studio's baked on it."""
    mesh = mesh_of(cls, log=log)
    if not mesh:
        return None
    d = load(mesh, log=log)
    return dict(d, cls=cls, models=models_of(cls, log=log), custom=baked_for(mesh))


# ---------------------------------------------------------------- the Animation Studio
# tools/mapkit/anims: <name>.json the animations (bone rotations by frame), rigs/<model>.json the skeleton
# of each model (joints, the bones of each vertex: made by the Studio from the game's own animations),
# baked/<model>/<name>.bin + .json the animation as the model's frames (made by the Studio), packed by
# pack() into UCAnims.u: a copy of each model with its animations added.
STUDIO = kit.PROJECT / 'tools' / 'mapkit' / 'anims'


def _name_ok(name):
    return bool(re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,40}', name or ''))


def studio_list():
    out = []
    for f in sorted(STUDIO.glob('*.json')):
        try:
            a = json.loads(f.read_text(encoding='utf-8'))
        except ValueError:
            continue
        out.append(dict(name=a.get('name', f.stem), fps=a.get('fps'), frames=a.get('frames'), loop=a.get('loop'),
                        source=a.get('source', ''), made_on=a.get('made_on', '')))
    baked = {}
    for d in sorted((STUDIO / 'baked').glob('*')) if (STUDIO / 'baked').exists() else []:
        baked[d.name] = sorted(f.stem for f in d.glob('*.bin'))
    rigs = sorted(f.stem for f in (STUDIO / 'rigs').glob('*.json')
                  if not f.name.endswith('.legacy.json')) if (STUDIO / 'rigs').exists() else []
    return dict(anims=out, baked=baked, rigs=rigs)


def studio_get(name):
    f = STUDIO / (name + '.json')
    return json.loads(f.read_text(encoding='utf-8')) if _name_ok(name) and f.exists() else None


_STUDIO_BONES = frozenset((
    'pelvis', 'spine', 'chest', 'neck', 'head',
    'l_upperarm', 'l_forearm', 'l_hand', 'r_upperarm', 'r_forearm', 'r_hand',
    'l_thigh', 'l_calf', 'l_foot', 'r_thigh', 'r_calf', 'r_foot',
))
_STUDIO_CURVE_MODES = frozenset(('smooth', 'linear', 'hold'))
# the IK controllers of the Studio (static/studio.js CHAINS): a hand or a foot with its arm or leg
_STUDIO_IK_CHAINS = frozenset(('l_arm', 'r_arm', 'l_leg', 'r_leg'))


def _studio_number(value, label):
    # bool is an int in Python, but is not a numeric animation value in JSON/JS.
    valid = type(value) in (int, float)
    try:
        valid = valid and math.isfinite(value)
    except OverflowError:
        valid = False
    if not valid:
        raise ValueError('%s must be a finite number' % label)


def _studio_vector(value, size, label):
    if not isinstance(value, list) or len(value) != size:
        raise ValueError('%s must contain %d numbers' % (label, size))
    for number in value:
        _studio_number(number, label)


def _studio_key_frames(keys, frames, label, allow_empty=False):
    if not isinstance(keys, list):
        raise ValueError('%s keys must be an array' % label)
    if not keys and not allow_empty:
        raise ValueError('%s must keep at least one key' % label)
    previous = -1
    for key in keys:
        if not isinstance(key, dict):
            raise ValueError('%s keys must be objects' % label)
        frame = key.get('f')
        if type(frame) is not int or not 0 <= frame < frames:
            raise ValueError('%s key frames must be integers from 0 to %d' % (label, frames - 1))
        if frame <= previous:
            raise ValueError('%s keys must have sorted, unique frames' % label)
        previous = frame


def _studio_validate(anim):
    if not isinstance(anim, dict):
        raise ValueError('Animation must be an object')
    if not isinstance(anim.get('name'), str) or not _name_ok(anim['name']):
        raise ValueError('a name of letters, digits and _ (it becomes the name of the animation in the game)')
    frames = anim.get('frames')
    # Copy retains the game's frame count/rate, including one-frame poses. The
    # manual UI's 600-frame limit is not a restriction on existing/copied files.
    if type(frames) is not int or not 1 <= frames <= 2147483647:
        raise ValueError('Animation frame count must be an integer from 1 to 2147483647')
    _studio_number(anim.get('fps'), 'Animation fps')
    if anim['fps'] <= 0:
        raise ValueError('Animation fps must be greater than zero')
    if 'loop' in anim and type(anim['loop']) is not bool:
        raise ValueError('Animation loop must be true or false')
    anim_props.validate(anim.get('props', []), frames)
    if 'grip' in anim:                  # how far each hand is closed (static/studio-grip.js): 0..1 per key
        grip = anim['grip']
        if not isinstance(grip, dict) or not set(grip) <= {'l', 'r'}:
            raise ValueError('Animation grip must be an object with l and r')
        for side, data in grip.items():
            if not isinstance(data, dict):
                raise ValueError('%s grip must be an object' % side)
            _studio_key_frames(data.get('keys'), frames, '%s grip' % side, allow_empty=True)
            for key in data['keys']:
                _studio_vector(key.get('v'), 1, '%s grip value' % side)
                if not 0 <= key['v'][0] <= 1:
                    raise ValueError('%s grip must be from 0 to 1' % side)
    keys = anim.get('keys')
    _studio_key_frames(keys, frames, 'Pose')
    for key in keys:
        rotations = key.get('rot')
        if not isinstance(rotations, dict):
            raise ValueError('Pose rotations must be an object')
        for bone, rotation in rotations.items():
            if bone not in _STUDIO_BONES:
                raise ValueError('Unknown pose bone: %s' % bone)
            _studio_vector(rotation, 4, '%s quaternion' % bone)
        # Old pose readers deliberately treat a missing root as [0, 0, 0].
        if 'root' in key:
            _studio_vector(key['root'], 3, 'Pose root position')
    if 'tracks' in anim:
        tracks = anim['tracks']
        if not isinstance(tracks, dict):
            raise ValueError('Animation tracks must be an object')
        for bone, track in tracks.items():
            if bone != '$root' and bone not in _STUDIO_BONES:
                raise ValueError('Unknown track bone: %s' % bone)
            if not isinstance(track, dict):
                raise ValueError('%s track must be an object' % bone)
            label = '%s track' % bone
            # An empty track explicitly keeps this bone at rest. It must not
            # fall back to the complete poses retained for old animation files.
            track_keys = track.get('keys')
            _studio_key_frames(track_keys, frames, label, allow_empty=True)
            for key in track_keys:
                if bone == '$root':
                    _studio_vector(key.get('v'), 3, label + ' position')
                else:
                    _studio_vector(key.get('q'), 4, label + ' quaternion')
                # A missing mode inherits the animation's legacy interpolation.
                if 'mode' in key and (not isinstance(key['mode'], str)
                                      or key['mode'] not in _STUDIO_CURVE_MODES):
                    raise ValueError('%s interpolation must be smooth, linear or hold' % label)
    if 'ik' in anim:
        ik = anim['ik']
        if not isinstance(ik, dict):
            raise ValueError('Animation IK must be an object')
        for chain, data in ik.items():
            if chain not in _STUDIO_IK_CHAINS:
                raise ValueError('Unknown IK chain: %s' % chain)
            label = '%s IK' % chain
            if not isinstance(data, dict):
                raise ValueError('%s must be an object' % label)
            _studio_key_frames(data.get('keys'), frames, label)
            for key in data['keys']:
                _studio_vector(key.get('v'), 3, label + ' position')
                _studio_vector(key.get('q'), 4, label + ' turn')
                _studio_vector(key.get('pole'), 3, label + ' pole')
                if 'mode' in key and (not isinstance(key['mode'], str) or key['mode'] not in _STUDIO_CURVE_MODES):
                    raise ValueError('%s interpolation must be smooth, linear or hold' % label)
            if 'curves' in data:
                if not isinstance(data['curves'], dict) or set(data['curves']) - {'v', 'q', 'pole'}:
                    raise ValueError('Unknown IK curve target')
                for field, channels in data['curves'].items():
                    if not isinstance(channels, dict) or set(channels) != {'x', 'y', 'z'}:
                        raise ValueError('IK curves must contain x, y and z channels')
                    for axis, channel in channels.items():
                        curve_label = '%s %s %s curve' % (label, field, axis)
                        _studio_key_frames(channel, frames, curve_label)
                        for key in channel:
                            _studio_number(key.get('v'), curve_label + ' value')
                            if not isinstance(key.get('mode'), str) or key['mode'] not in _STUDIO_CURVE_MODES:
                                raise ValueError('%s interpolation must be smooth, linear or hold' % curve_label)
    if 'curves' not in anim:
        return
    curves = anim['curves']
    if not isinstance(curves, dict):
        raise ValueError('Animation curves must be an object')
    for bone, channels in curves.items():
        if bone != '$root' and bone not in _STUDIO_BONES:
            raise ValueError('Unknown curve bone: %s' % bone)
        if not isinstance(channels, dict) or set(channels) != {'x', 'y', 'z'}:
            raise ValueError('%s curves must contain x, y and z channels' % bone)
        for axis, channel in channels.items():
            label = '%s %s curve' % (bone, axis)
            _studio_key_frames(channel, frames, label)
            for key in channel:
                _studio_number(key.get('v'), label + ' value')
                if not isinstance(key.get('mode'), str) or key['mode'] not in _STUDIO_CURVE_MODES:
                    raise ValueError('%s interpolation must be smooth, linear or hold' % label)


def studio_save(anim):
    _studio_validate(anim)
    # Validate/serialize before touching the filesystem. Keep metadata and the
    # original quaternion/interpolation values exactly as supplied.
    try:
        text = json.dumps(anim, allow_nan=False)
    except (TypeError, ValueError) as error:
        raise ValueError('Animation must contain valid JSON data: %s' % error) from error
    import tempfile
    STUDIO.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=STUDIO,
                                         prefix='.' + anim['name'] + '-', suffix='.tmp', delete=False) as output:
            temporary = Path(output.name)
            output.write(text)
        temporary.replace(STUDIO / (anim['name'] + '.json'))
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return True


def studio_delete(name):
    if not _name_ok(name):
        return False
    (STUDIO / (name + '.json')).unlink(missing_ok=True)
    for d in (STUDIO / 'baked').glob('*') if (STUDIO / 'baked').exists() else []:
        for ext in ('.bin', '.json', '.props.json'):
            (d / (name + ext)).unlink(missing_ok=True)
    return True


def rig_get(mesh, legacy=False):
    """A model's skeleton; legacy: the one it had before the Studio made it again for a new version (the
    animations made with it keep it: static/studio.js rigOfAnim), None when there is none."""
    f = STUDIO / 'rigs' / (_safe(mesh) + ('.legacy.json' if legacy else '.json'))
    return json.loads(f.read_text(encoding='utf-8')) if f.exists() else None


def rig_save(rig):
    """rig['legacy']: the skeleton an upgrade replaces, kept once (the first one is the one the older
    animations were made with)."""
    if not re.fullmatch(r'[\w.]+', rig.get('mesh') or ''):
        raise ValueError('rig without a model')
    (STUDIO / 'rigs').mkdir(parents=True, exist_ok=True)
    rig = dict(rig)
    if rig.pop('legacy', False):
        f = STUDIO / 'rigs' / (_safe(rig['mesh']) + '.legacy.json')
        if not f.exists():
            f.write_text(json.dumps(rig), encoding='utf-8')
        return True
    (STUDIO / 'rigs' / (_safe(rig['mesh']) + '.json')).write_text(json.dumps(rig), encoding='utf-8')
    return True


def bake_save(mesh, name, frames, rate, data, group='UCAnim', props=None):
    """An animation baked on a model: frames x FrameVerts x int16 xyz (raw model units)."""
    if not re.fullmatch(r'[\w.]+', mesh or '') or not _name_ok(name):
        raise ValueError('bad model or name')
    props = [] if props is None else props
    anim_props.validate(props, frames, baked=True)
    source = studio_get(name) or {}
    source_props = [p for p in source.get('props', []) if p.get('enabled', True)]
    if [(p['id'], p['cls'], p['scale'], p.get('space', 'bone')) for p in props] != [(p['id'], p['cls'], p['scale'], p.get('space', 'bone')) for p in source_props]:
        raise ValueError('Prop bake does not match the saved animation. Save again.')
    if props:
        anim_props.class_paths(props, class_info())
    d = load(mesh)
    if len(data) != frames * d['counts']['frameVerts'] * 6:
        raise ValueError('%d bytes for %d frames of %d vertices' % (len(data), frames, d['counts']['frameVerts']))
    folder = STUDIO / 'baked' / mesh
    folder.mkdir(parents=True, exist_ok=True)
    (folder / (name + '.bin')).write_bytes(data)
    (folder / (name + '.json')).write_text(json.dumps(dict(name=name, frames=frames, rate=rate, group=group)), encoding='utf-8')
    # Sidecars are not animation entries and are never sent with the model geometry.
    (folder / (name + '.props.json')).write_text(json.dumps(dict(frames=frames, props=props,
        source_props=source_props, source_signature=anim_props.signature(source)), allow_nan=False), encoding='utf-8')
    return True


def baked_for(mesh):
    """The Studio's animations baked on a model: [{name, frames, rate, url}]."""
    folder = STUDIO / 'baked' / mesh
    out = []
    for f in sorted(folder.glob('*.json')) if folder.exists() else []:
        m = json.loads(f.read_text(encoding='utf-8'))
        b = f.with_suffix('.bin')
        if b.exists():
            out.append(dict(m, url='/anims/baked/%s/%s.bin?v=%d' % (mesh, m['name'], b.stat().st_mtime_ns)))
    return out


def pack(log=print):
    """UCAnims.u: a copy of every model with Studio animations, the animations after its own frames
    (host UC_ANIMNEW), in dist\ and, when the game is closed, in the game (else at the next install)."""
    import live
    lines = []
    folder = STUDIO / 'baked'
    meshes = sorted(d.name for d in folder.iterdir() if d.is_dir() and any(d.glob('*.bin'))) if folder.exists() else []
    dist = kit.PROJECT / 'dist' / (settings.ANIMS_PACKAGE + '.u')
    s = kit.Session([], 'animpack')
    try:
        for mesh in meshes:
            head, body = [], b''
            for meta in sorted((folder / mesh).glob('*.json')):
                m = json.loads(meta.read_text(encoding='utf-8'))
                b = meta.with_suffix('.bin')
                if not b.exists():
                    continue
                head.append('seq %s %s %d %g' % (m['name'], m.get('group') or 'UCAnim', m['frames'], float(m['rate'])))
                body += b.read_bytes()
            (s.folder / 'Input').mkdir(exist_ok=True)
            (s.folder / 'Input' / (mesh + '.txt')).write_bytes(('\n'.join(head) + '\ndata\n').encode() + body)
            out = s.cmd(r'UC_ANIMNEW %s %s %s ..\Input\%s.txt' % (mesh, settings.ANIMS_PACKAGE, mesh.split('.')[-1], mesh))
            ok = re.search(r'UCMapKit\|animnew\|(\S+)\|(\d+) sequences', out)
            lines.append('  %s: %s' % (mesh, ('%s animations' % ok.group(2)) if ok else 'FAILED'))
            if not ok:
                return False, lines + [out[-600:]]
        out = s.cmd(r'UC_ANIMSAVE ..\Output\%s.u' % settings.ANIMS_PACKAGE)
        made = s.folder / 'Output' / (settings.ANIMS_PACKAGE + '.u')
        if not made.exists():
            return False, lines + ['%s.u was not written' % settings.ANIMS_PACKAGE, out[-600:]]
        dist.parent.mkdir(exist_ok=True)
        shutil.copy2(made, dist)
    finally:
        s.close()
    lines.append('%s: %d models (%.1f MB) in dist\\' % (dist.name, len(meshes), dist.stat().st_size / 1e6) if meshes
                 else '%s: empty (the Studio has no animation left) in dist\\' % dist.name)
    if live.running():
        lines.append('The game is open: the new animations go in with the next Install.')
    else:
        settings.PACKAGES_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy2(dist, settings.PACKAGES_DIR / dist.name)
        # the game reads its maps folder (UnatcoMaps, where Install puts the mod's packages) before System: a copy
        # there would hide the new one (20 Oct 2026: an imported model was not in the game), so it is replaced too
        if (settings.MAPS_DIR / dist.name).exists():
            shutil.copy2(dist, settings.MAPS_DIR / dist.name)
        lines.append('Installed in the game (%s).' % (settings.PACKAGES_DIR / dist.name))
    return True, lines


def appearance_blocks(edits):
    """Keep explicit mesh replacements through Revision's initial HDTP/Facelift pass."""
    props = {a['name']: dict(a.get('props') or {}) for a in edits.get('added') or []}
    for name, changed in (edits.get('props') or {}).items():
        props.setdefault(name, {}).update(changed)
    out = []
    for name, visual in sorted(props.items()):
        mesh = str(visual.get('Mesh') or '')
        # Only the explicit appearance-only workflow (including its cleared skins).
        if (name in (edits.get('deleted') or {}) or not re.fullmatch(r'\w+', name)
                or 'Skin' not in visual or not re.fullmatch(r"(?:LodMesh|Mesh)'[\w.]+\.[\w]+'", mesh, re.I)):
            continue
        keep = dict(PawnName=name, AppearanceMesh=mesh, AppearanceSkin=visual.get('Skin', 'None'))
        for i in range(8):
            keep['AppearanceSkins(%d)' % i] = visual.get('MultiSkins(%d)' % i, 'None')
        # Re-texturing the replacement later must also survive startup.
        for tex in edits.get('retexture') or []:
            if tex.get('kind') == 'actor' and tex.get('name') == name and tex.get('tex') in (edits.get('textures') or {}):
                import textures
                slot = int(tex.get('slot') or 0)
                if 0 <= slot < 8:
                    keep['AppearanceSkins(%d)' % slot] = textures.ref(tex['tex'])
        out.append(dict(cls='UCAnimSet', name='UCAppearance_' + name, loc=[0, 0, 0], props=keep))
    return out


def blocks(edits):
    """The UCAnimSet actors of the map: [{'cls', 'name', 'loc', 'props'}], like edits['added']."""
    out = []
    deleted = edits.get('deleted') or {}
    for name, a in sorted((edits.get('anims') or {}).items()):
        if not re.fullmatch(r'\w+', name) or not isinstance(a, dict) or name in deleted:
            continue
        props = {}
        if a.get('idle') and re.fullmatch(r'\w+', a['idle']):
            props['IdleAnim'] = a['idle']
            props['IdleRate'] = '%.6f' % max(0.05, float(a.get('rate') or 1))
        if a.get('own'):
            props['bOwnModel'] = 'True'
        if a.get('still'):
            props['bStayPut'] = 'True'
        if props:
            props['PawnName'] = name
            out.append(dict(cls='UCAnimSet', name='UCAnim_' + name, loc=list(a.get('loc') or [0, 0, 0]),
                            props=props))
    # the animations of the patrol points: one UCAnimSet without a character does them for everybody
    points = [a for a in edits.get('added') or [] if a.get('cls') == 'PatrolPoint']
    with_anim = [n for n, p in (edits.get('props') or {}).items() if str(p.get('PatrolAnim') or 'None') != 'None']
    with_anim += [a['name'] for a in points if str((a.get('props') or {}).get('PatrolAnim') or 'None') != 'None']
    if with_anim:
        loc = next((a['loc'] for a in points if a['name'] in with_anim), [0, 0, 0])
        out.append(dict(cls='UCAnimSet', name='UCAnim_Patrols', loc=list(loc), props={}))
    return out + appearance_blocks(edits) + anim_props.blocks(STUDIO, edits, class_info, settings.ANIMS_PACKAGE)


def report(edits):
    lines = []
    for name, a in sorted((edits.get('anims') or {}).items()):
        what = [x for x in (('idle %s' % a['idle']) if a.get('idle') else '', 'its model with the Studio animations' if a.get('own') else '',
                            'stays put' if a.get('still') else '') if x]
        if what:
            lines.append('  EDIT animation of %s: %s' % (name, ', '.join(what)))
    return lines
