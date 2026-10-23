"""Project-local protagonists; map overrides cook into UCPlayerMap, never game INIs.

Character assets remain NPC templates. Only their validated appearance is copied.
State separation is deliberately gated until native travel/save regression tests pass.
"""
import hashlib
import json
import re
from pathlib import Path

import settings
import atomicfile

KIT = Path(__file__).resolve().parents[1]
FILE = KIT / 'players.json'
ID = re.compile(r'^[a-z0-9][a-z0-9-]{0,47}$')
REF = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){1,3}$')
# Other skeleton/body families require a separately verified motion adapter.
BODIES = {'GM_Trench', 'GM_Trench_F', 'GM_DressShirt', 'GM_DressShirt_F',
          'GM_DressShirt_B', 'GM_DressShirt_S', 'GM_Suit', 'GM_Jumpsuit',
          'GM_ScaryTroop', 'GM_Scubasuit', 'GFM_Trench', 'GFM_SuitSkirt',
          'GFM_SuitSkirt_F', 'GFM_Dress', 'GFM_TShirtPants',
          'GMK_DressShirt', 'GMK_DressShirt_F'}
INDEPENDENT_READY = False


def read():
    if not FILE.exists():
        return {'version': 1, 'default': 'jc', 'state': 'shared'}
    try:
        value = json.loads(FILE.read_text(encoding='utf-8-sig'))
    except (OSError, ValueError) as exc:
        raise ValueError('Cannot read Player characters settings. The file was left unchanged.') from exc
    return validate_config(value)


def profile_id(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ValueError('Invalid player character ID.')
    return value


def validate_config(value):
    if not isinstance(value, dict) or value.get('version') != 1:
        raise ValueError('Unsupported Player characters settings.')
    state = value.get('state', 'shared')
    if state not in ('shared', 'independent'):
        raise ValueError('Invalid player progress mode.')
    if state == 'independent' and not INDEPENDENT_READY:
        raise ValueError('Separate protagonist inventories are not available yet. Use shared player progress.')
    return dict(version=1, default=profile_id(value.get('default', 'jc')), state=state)


def appearance(cid):
    profile_id(cid)
    if cid == 'jc':
        return dict(id='jc', name='JC Denton', props={'ProfileID': '"jc"', 'ProfileFlag': 'UCEdPlayer_jc', 'bUseOriginal': 'True'})
    file = KIT / 'characters' / (cid + '.json')
    try:
        ch = json.loads(file.read_text(encoding='utf-8-sig'))
    except (OSError, ValueError) as exc:
        raise ValueError('Player character "%s" is missing or unreadable. Choose another in Map settings.' % cid) from exc
    if not isinstance(ch, dict) or ch.get('id') != cid:
        raise ValueError('Player character asset has a mismatched ID: ' + cid)
    body = ch.get('body')
    if body not in BODIES:
        raise ValueError('This character body is not supported as a player yet: ' + str(body))
    skins = ch.get('skins')
    if not isinstance(skins, list) or len(skins) != 8:
        raise ValueError('Player character needs all eight skin slots: ' + cid)
    props = {'ProfileID': '"%s"' % cid, 'ProfileFlag': 'UCEdPlayer_' + cid.replace('-', '_'), 'bUseOriginal': 'False',
             'Mesh': "LodMesh'DeusExCharacters.%s'" % body}
    for i, skin in enumerate(skins):
        if skin in (None, '', 'None'):
            props['MultiSkins(%d)' % i] = 'None'
        elif not isinstance(skin, str) or not REF.fullmatch(skin):
            raise ValueError('Invalid player skin reference: ' + cid)
        else:
            props['MultiSkins(%d)' % i] = "Texture'%s'" % skin
    for field in ('texture', 'skin'):
        value = ch.get(field)
        if value:
            if not isinstance(value, str) or not REF.fullmatch(value):
                raise ValueError('Invalid player texture reference: ' + cid)
            props[field.title()] = "Texture'%s'" % value
    # No AI, allegiance, BindName, health, collision or inventory is inherited.
    return dict(id=cid, name=str(ch.get('name') or cid)[:64], props=props)


def catalog():
    options = [dict(id='jc', name='JC Denton', supported=True)]
    for path in sorted((KIT / 'characters').glob('*.json')):
        if path.stem == 'jc':
            continue
        try:
            ch = json.loads(path.read_text(encoding='utf-8-sig'))
            option = dict(id=path.stem, name=str(ch.get('name') or path.stem)[:64], supported=True)
            appearance(path.stem)
        except (OSError, ValueError, TypeError, AttributeError) as exc:
            option = dict(id=path.stem, name=path.stem, supported=False, reason=str(exc))
        options.append(option)
    raw = FILE.read_bytes() if FILE.exists() else b''
    return dict(config=read(), characters=options, revision=hashlib.sha256(raw).hexdigest(),
                independent=INDEPENDENT_READY, temporary=getattr(settings, 'PROJECT_KIND', '') == 'tutorial')


def save(value, expected):
    if getattr(settings, 'PROJECT_KIND', '') == 'tutorial':
        raise ValueError('The tutorial is temporary. Set a project player in a normal project.')
    current = catalog()
    if expected != current['revision']:
        raise ValueError('Player settings changed in another window. Reopen them before saving.')
    value = validate_config(value)
    appearance(value['default'])
    atomicfile.write_json(FILE, value)
    return catalog()


def validate_edits(edits):
    lv = edits.get('level') or {}
    if not isinstance(lv, dict):
        raise ValueError('Invalid map settings.')
    if 'player' in lv:
        appearance(profile_id(lv['player']))


def blocks(edits):
    validate_edits(edits)
    # Existing maps without this feature must build exactly as before.
    if not FILE.exists() and 'player' not in (edits.get('level') or {}):
        return []
    config = read()
    cid = (edits.get('level') or {}).get('player', config['default'])
    look = appearance(cid)
    return [dict(cls='UCPlayerMap', name='UCPlayerMap0', loc=[0, 0, 0], props=look['props'])]


def references(cid):
    refs = []
    if read()['default'] == cid:
        refs.append('the project default')
    for path in (KIT / 'maps').glob('*.edits.json'):
        try:
            if (json.loads(path.read_text(encoding='utf-8')).get('level') or {}).get('player') == cid:
                refs.append(path.name.removesuffix('.edits.json'))
        except (OSError, ValueError):
            # Do not silently delete an asset when its references cannot be checked.
            raise ValueError('Cannot check player references in ' + path.name)
    return refs


def build_dependency(edits):
    """Include resolved appearance/default changes in a map's stale-build check."""
    current = blocks(edits)
    if not current: return None
    import player_motion
    return dict(controllers=current, motion_version=player_motion.VERSION)


def _animation_mesh(body, log):
    import anims
    mesh = 'DeusExCharacters.' + body
    info = anims.load(mesh, log=log)
    data = (anims.CACHE / (anims._safe(mesh) + '.anim')).read_bytes()
    return info, data


def prepare_commands(edits, folder, log=print, *, loader=None, body=None):
    """Append a private, map-local body with any missing player motions.

    Call after the controller was imported and before MAP SAVE. The optional
    loader/body arguments permit native regression tests without user caches.
    """
    import base64
    import player_motion
    if body is None:
        current = blocks(edits)
        if not current or current[0]['props']['bUseOriginal'] == 'True': return []
        body = current[0]['props']['Mesh'].split('.')[-1].rstrip("'")
    if body not in BODIES: raise ValueError('Unsupported player body: ' + str(body))
    if body == 'GM_Trench': return []
    loader = loader or (lambda name: _animation_mesh(name, log))
    info, raw = loader(body)
    donor_info, donor_raw = loader('GM_Trench')
    digest = hashlib.sha256(str(player_motion.VERSION).encode() + raw + donor_raw).hexdigest()
    cache = KIT / 'editor/cache/_player_motion' / (digest + '.json')
    try:
        cached = json.loads(cache.read_text(encoding='utf8'))
        payload = base64.b64decode(cached['data'], validate=True)
        if hashlib.sha256(payload).hexdigest() != cached['sha256']: raise ValueError('Invalid motion cache')
        report = cached['sequences']
    except (OSError, ValueError, KeyError, TypeError):
        log('Preparing player animations for %s...' % body)
        payload, report = player_motion.generate(player_motion.Mesh(info,raw), player_motion.Mesh(donor_info,donor_raw))
        cache.parent.mkdir(parents=True, exist_ok=True)
        atomicfile.write_json(cache, dict(data=base64.b64encode(payload).decode(),
                                         sha256=hashlib.sha256(payload).hexdigest(), sequences=report))
    if not report: return []
    name = 'UCP_' + body
    input_dir = Path(folder) / 'Input'; input_dir.mkdir(exist_ok=True)
    (input_dir / (name + '.motion')).write_bytes(payload)
    cmds = ['UC_ANIMNEW DeusExCharacters.%s MyLevel %s ..\\Input\\%s.motion' % (body,name,name)]
    donor_sequences = {s['name']:s for s in donor_info['seqs']}
    expected = []
    start = info['counts']['frames']
    replaced = set()
    for seq in report:
        source = donor_sequences[seq['name']]
        expected.append(dict({k:source[k] for k in ('name','group','frames','rate','notifys')}, start=start))
        if seq.get('replacement'):
            replaced.add(source['name'])
            cmds.append('MESH SEQUENCE MESH=MyLevel.%s SEQ=%s STARTFRAME=%d NUMFRAMES=%d RATE=%g GROUP=%s' %
                        (name,source['name'],start,source['frames'],source['rate'],source['group']))
        start += source['frames']
        for time, callback in source['notifys']:
            if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', callback):
                raise ValueError('Invalid player animation callback.')
            cmds.append('MESH NOTIFY MESH=MyLevel.%s SEQ=%s TIME=%g FUNCTION=%s' % (name,source['name'],time,callback))
    cmds += ["UC_PROP UCPlayerMap0 Mesh LodMesh'MyLevel.%s'" % name,
             'UC_ANIMDUMP MyLevel.%s ..\\Output\\%s.anim' % (name,name)]
    manifest = Path(folder) / 'Input/player-motion-check.json'
    # A single real map uses one body; tests can prepare several in the same map.
    checks = json.loads(manifest.read_text()) if manifest.exists() else []
    c = info['counts']
    vertex_offset = info['offset'] + c['faces']*8 + c['wedges']*4 + c['specialFaces']*8
    checks.append(dict(body=body, mesh=name, sequences=expected,
                       original_sequences=[s for s in info['seqs'] if s['name'] not in replaced],
                       original_frames=c['frames'], frame_verts=c['frameVerts'],
                       original_sha=hashlib.sha256(raw[vertex_offset:]).hexdigest(),
                       added_sha=hashlib.sha256(payload[payload.index(b'\ndata\n')+6:]).hexdigest()))
    atomicfile.write_json(manifest, checks)
    return cmds


def verify_build(folder):
    """Fail closed before publishing a build whose copied animation data is missing."""
    import anims
    manifest = Path(folder) / 'Input/player-motion-check.json'
    if not manifest.exists(): return
    for check in json.loads(manifest.read_text()):
        file = Path(folder) / 'Output' / (check['mesh'] + '.anim')
        if not file.exists(): raise ValueError('The player animation model was not built: ' + check['body'])
        raw = file.read_bytes()
        result = anims.parse(raw)
        c = result['counts']
        offset = result['offset'] + c['faces']*8 + c['wedges']*4 + c['specialFaces']*8
        split = offset + check['original_frames']*check['frame_verts']*6
        if c['frameVerts'] != check['frame_verts'] or hashlib.sha256(raw[offset:split]).hexdigest() != check['original_sha']:
            raise ValueError('The original player body was changed by the animation build.')
        if hashlib.sha256(raw[split:]).hexdigest() != check['added_sha']:
            raise ValueError('The adapted player animation frames were not preserved.')
        seqs = {s['name']:s for s in result['seqs']}
        for expected in check['sequences'] + check['original_sequences']:
            actual = seqs.get(expected['name'], {})
            if any(actual.get(key) != value for key,value in expected.items()):
                raise ValueError('The player animation was not built correctly: ' + expected['name'])
