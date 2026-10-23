"""Visual bone accessories, validated before saving and emitted as read-only frame tracks.

No game inventory classes are spawned. UCAnimProp copies their default appearance only.
The trajectories are sampled in actor space alongside the baked character frames.
"""
import hashlib
import json
import math
import re

BONES = {'pelvis', 'spine', 'chest', 'neck', 'head', 'l_upperarm', 'l_forearm', 'l_hand',
         'r_upperarm', 'r_forearm', 'r_hand', 'l_thigh', 'l_calf', 'l_foot', 'r_thigh', 'r_calf', 'r_foot'}
CHUNK = 64


def signature(animation):
    return hashlib.sha256(json.dumps(animation, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def number(value, limit, label, positive=False):
    if type(value) not in (float, int) or not math.isfinite(value) or abs(value) > limit or (positive and value <= 0):
        raise ValueError('Invalid prop ' + label)


def vector(value, limit, label):
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError('Prop %s must have three values' % label)
    for v in value:
        number(v, limit, label)


def validate(props, frames=None, baked=False):
    if not isinstance(props, list) or len(props) > 8:
        raise ValueError('An animation supports up to eight visual props')
    if props and (type(frames) is not int or not 1 <= frames <= 6000):
        raise ValueError('Animations with props support 1 to 6000 frames')
    ids = set()
    for p in props:
        if not isinstance(p, dict) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,63}', str(p.get('id', ''))):
            raise ValueError('Invalid prop ID')
        if p['id'] in ids:
            raise ValueError('Duplicate prop ID')
        ids.add(p['id'])
        if p.get('space', 'bone') not in ('bone', 'scene'):
            raise ValueError('Unknown prop placement')
        if not isinstance(p.get('cls'), str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,127}', p['cls']):
            raise ValueError('Invalid game prop class')
        number(p.get('scale'), 10, 'scale', positive=True)
        if p['scale'] < .01:
            raise ValueError('Prop scale must be at least 1%')
        if baked:
            samples = p.get('samples')
            if not isinstance(samples, list) or len(samples) != frames:
                raise ValueError('Prop sample count must match character frames')
            for sample in samples:
                if not isinstance(sample, dict):
                    raise ValueError('Invalid prop sample')
                vector(sample.get('position'), 1e7, 'sample position')
                vector(sample.get('rotation'), 65536, 'sample rotation')
        else:
            if p.get('space', 'bone') != 'scene' and p.get('bone') not in BONES:
                raise ValueError('Unknown prop bone')
            vector(p.get('position'), 4096, 'offset')
            vector(p.get('rotation'), 36000, 'rotation')
            if 'enabled' in p and type(p['enabled']) is not bool:
                raise ValueError('Prop enabled must be true or false')


def class_paths(props, info):
    paths = {}
    for p in props:
        cls = p['cls']; meta = info.get(cls) or {}
        if not meta.get('mesh') or not re.fullmatch(r'\w+', meta.get('pkg', '')):
            raise ValueError('Prop model is unavailable: ' + cls)
        # Only the supported palette categories, never player/AI/trigger actors.
        parents = {v.lower().split('.')[-1] for v in meta.get('parents', [])}
        if not parents.intersection({'decoration', 'inventory'}):
            raise ValueError('Choose a decoration or inventory prop: ' + cls)
        paths[cls] = meta['pkg'] + '.' + cls
    return paths


def blocks(studio, edits, info_loader, anim_package):
    """Only animations referenced by this map get controllers; data is shared across pawns."""
    used = set()
    def visit(value):
        if isinstance(value, str):
            used.update(s.lower() for s in re.findall(r'\w+', value))
        elif isinstance(value, dict):
            for v in value.values(): visit(v)
        elif isinstance(value, list):
            for v in value: visit(v)
    visit(edits)
    if not used:
        return []
    out, info, emitted = [], None, set()
    for path in sorted((studio / 'baked').glob('*/*.props.json')):
        name = path.name[:-len('.props.json')]
        if name.lower() not in used or not (studio / (name + '.json')).is_file():
            continue
        if not path.with_name(name + '.bin').is_file():
            continue
        doc = json.loads(path.read_text(encoding='utf-8'))
        tracks = doc.get('props', []); frames = doc.get('frames')
        validate(tracks, frames, baked=True)
        source = json.loads((studio / (name + '.json')).read_text(encoding='utf-8'))
        # Never silently build with stale props following a newly edited animation.
        expected = [p for p in source.get('props', []) if p.get('enabled', True)]
        if doc.get('source_props') != expected or source.get('frames') != frames or doc.get('source_signature') != signature(source):
            raise ValueError('Save %s in Animation Studio again to update its prop tracks' % name)
        if not tracks:
            continue
        if info is None: info = info_loader()
        classes = class_paths(tracks, info)
        mesh = path.parent.name.split('.')[-1]
        if not re.fullmatch(r'\w+', mesh) or not re.fullmatch(r'[A-Za-z]\w{0,40}', name):
            raise ValueError('Invalid prop model or animation')
        for track in tracks:
            identity = (mesh.lower(), name.lower(), track['id'])
            if identity in emitted: continue
            emitted.add(identity)
            key = 'UCProp_' + hashlib.sha256('|'.join(identity).encode()).hexdigest()[:20]
            for start in range(0, frames, CHUNK):
                samples = track['samples'][start:start + CHUNK]
                props = {'StartFrame': str(start), 'SampleCount': str(len(samples))}
                if start == 0:
                    props.update(bRoot='True', FrameCount=str(frames), AnimationName=name, ModelName=mesh,
                                 ModelPackage=anim_package, PropClass='"' + classes[track['cls']] + '"',
                                 PropScale='%.6f' % track['scale'])
                    if track.get('space') == 'scene':
                        props['bSceneSpace'] = 'True'
                if start + CHUNK < frames:
                    props['NextName'] = key + '_' + str(start + CHUNK)
                for i, sample in enumerate(samples):
                    props['Positions(%d)' % i] = '(X=%.6f,Y=%.6f,Z=%.6f)' % tuple(sample['position'])
                    props['Rotations(%d)' % i] = '(Pitch=%d,Yaw=%d,Roll=%d)' % tuple(round(v) for v in sample['rotation'])
                out.append(dict(cls='UCAnimPropTrack', name=key + '_' + str(start), loc=[0,0,0], props=props))
    return out
