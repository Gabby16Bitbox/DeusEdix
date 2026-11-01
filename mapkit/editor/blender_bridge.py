"""Project-local Blender round trips. No runtime build or animation save is implicit."""
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
import uuid

MAX_BYTES = 64 * 1024 * 1024
MAX_FRAMES = 10000
_lock = threading.RLock()
_processes = {}


def root():
    import anims
    return anims.STUDIO / '.blender'


def read(path):
    if path.stat().st_size > MAX_BYTES:
        raise ValueError('The Blender exchange is too large.')
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, data):
    text = json.dumps(data, allow_nan=False, separators=(',', ':'))
    if len(text.encode('utf-8')) > MAX_BYTES:
        raise ValueError('The Blender exchange is too large.')
    temporary = path.with_suffix('.tmp')
    temporary.write_text(text, encoding='utf-8')
    temporary.replace(path)


def folder(session):
    if not isinstance(session, str) or not re.fullmatch(r'[a-f0-9]{32}', session):
        raise ValueError('Invalid Blender session.')
    p = root() / session
    if p.is_symlink() or p.resolve().parent != root().resolve() or not p.is_dir():
        raise ValueError('This Blender session is not in this project.')
    return p


def executables():
    paths = []
    found = shutil.which('blender')
    if found:
        paths.append(Path(found))
    for base in (os.environ.get('ProgramFiles'), os.environ.get('LOCALAPPDATA')):
        if base:
            paths.extend(sorted((Path(base) / 'Blender Foundation').glob('Blender */blender.exe'), reverse=True))
    paths += [Path('/Applications/Blender.app/Contents/MacOS/Blender'), Path('/usr/bin/blender')]
    return list(dict.fromkeys(str(p.resolve()) for p in paths if p.is_file()))


def executable(path=None):
    if not path:
        pref = root() / 'preferences.json'
        path = read(pref).get('executable') if pref.is_file() else None
        path = path or next(iter(executables()), None)
    if not path:
        raise ValueError('Blender was not found. Set its executable path in the Blender panel.')
    p = Path(path).expanduser().resolve()
    if p.name.lower() not in ('blender.exe', 'blender') or not p.is_file():
        raise ValueError('Choose the Blender executable (blender.exe on Windows).')
    return p


def info():
    try:
        selected = str(executable())
    except ValueError:
        selected = ''
    sessions = []
    if root().is_dir():
        for p in sorted(root().glob('*/input.json'), key=lambda x: x.stat().st_mtime, reverse=True)[:20]:
            try:
                data = read(p)
                state = read(p.parent / 'status.json') if (p.parent / 'status.json').is_file() else {}
                sessions.append(dict(id=p.parent.name, name=data['animation']['name'], mesh=data['mesh'],
                                     ready=(p.parent / 'result.json').is_file(), state=state))
            except (OSError, ValueError, KeyError):
                continue
    return dict(executable=selected, detected=executables(), sessions=sessions)


def vector(v, size):
    if not isinstance(v, list) or len(v) != size or any(type(x) not in (int, float) or not math.isfinite(x) for x in v):
        raise ValueError('Blender returned an invalid numeric value.')


def validate_samples(samples, frames, names):
    if not isinstance(samples, list) or len(samples) != frames:
        raise ValueError('The Blender frame count does not match its motion.')
    for s in samples:
        if not isinstance(s, dict) or not isinstance(s.get('rot'), dict) or not isinstance(s.get('grip', {}), dict) or set(s.get('grip', {})) - {'l', 'r'}:
            raise ValueError('Blender returned an invalid pose.')
        vector(s.get('root'), 3)
        if set(s.get('rot', {})) != set(names):
            raise ValueError('The character skeleton changed. Keep the original Studio bones.')
        for q in s['rot'].values():
            vector(q, 4)
            if not .99 < sum(v*v for v in q) < 1.01:
                raise ValueError('Blender returned an invalid bone rotation.')
        for value in s.get('grip', {}).values():
            if value is not None and (type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1):
                raise ValueError('Grip must be between 0 and 1.')


def validate_controls(value,frames,names):
    if not isinstance(value,dict) or value.get('schema')!=1 or not isinstance(value.get('ik'),dict) or set(value['ik'])-{'l_arm','r_arm','l_leg','r_leg'}:
        raise ValueError('Invalid humanoid controls.')
    validate_samples(value.get('fkSamples'),frames,names)
    for chain,data in value['ik'].items():
        if not isinstance(data,dict) or type(data.get('enabled')) is not bool or not isinstance(data.get('samples'),list) or len(data['samples'])!=frames:
            raise ValueError('Invalid IK control samples.')
        for sample in data['samples']:
            if not isinstance(sample,dict):raise ValueError('Invalid IK control sample.')
            for field,size in (('v',3),('pole',3),('q',4)):vector(sample.get(field),size)
            if 'twist' in sample:vector(sample['twist'],2)
            if not .99 < sum(v*v for v in sample['q']) < 1.01:raise ValueError('Invalid IK control rotation.')


def validate_seams(data, bones):
    body = data.get('body', {})
    if not isinstance(body, dict):
        raise ValueError('Invalid character geometry.')
    if 'seams' not in body:
        return  # Older exchanges retain their original skinning.
    seams, positions = body['seams'], body.get('position')
    if not isinstance(seams, list) or not isinstance(positions, list) or len(positions) % 3:
        raise ValueError('Invalid character joint corrections.')
    if seams and not data.get('controls'):
        raise ValueError('Joint corrections require the Studio humanoid controls.')
    seen = set()
    for entry in seams:
        if not isinstance(entry, list) or len(entry) != 4:
            raise ValueError('Invalid character joint correction.')
        vertex, parent, child, weight = entry
        if (any(type(i) is not int for i in (vertex,parent,child))
                or not 0 <= vertex < len(positions)//3 or vertex in seen
                or not 0 <= parent < len(bones) or not 0 <= child < len(bones)
                or bones[child]['parent'] != bones[parent]['name']
                or bones[child]['name'] not in ('l_upperarm','r_upperarm','l_forearm','r_forearm')
                or type(weight) not in (int,float) or not math.isfinite(weight) or not 0 <= weight <= 1):
            raise ValueError('Invalid character joint correction.')
        seen.add(vertex)


def create_session(data):
    import anims
    if 'includeKeys' in data and type(data['includeKeys']) is not bool:
        raise ValueError('Choose whether to include animation keys.')
    anims._studio_validate(data.get('animation'))
    if not 1 <= data['animation']['frames'] <= MAX_FRAMES:
        raise ValueError('Blender exchanges support up to 10,000 frames.')
    if not isinstance(data.get('mesh'), str) or len(data['mesh']) > 256:
        raise ValueError('Choose a character model first.')
    bones = data.get('bones')
    if not isinstance(bones, list) or any(not isinstance(b, dict) for b in bones):
        raise ValueError('The Blender exchange needs the Studio skeleton.')
    names = [b.get('name') for b in bones]
    if set(names) != anims._STUDIO_BONES or len(names) != 17:
        raise ValueError('The Blender exchange needs the Studio skeleton.')
    seen = set()
    for b in bones:
        if (b.get('parent') is None and b['name'] != 'pelvis') or (b.get('parent') is not None and b['parent'] not in seen):
            raise ValueError('The Blender skeleton hierarchy is invalid.')
        vector(b.get('head'), 3)
        vector(b.get('tail'), 3)
        seen.add(b['name'])
    props = data.get('props', [])
    if not isinstance(props, list) or any(not isinstance(p, dict) for p in props) or [p.get('definition') for p in props] != data['animation'].get('props', []):
        raise ValueError('The Blender prop definitions do not match the animation.')
    for p in props:
        vector(p.get('quaternion'), 4)
    validate_samples(data.get('samples'), data['animation']['frames'], names)
    validate_seams(data, bones)
    if 'controls' in data:
        validate_controls(data['controls'],data['animation']['frames'],names)
        if type(data.get('height')) not in (int,float) or not math.isfinite(data['height']) or not 0 < data['height'] < 100000:
            raise ValueError('Invalid humanoid rig height.')
    payload = copy.deepcopy(data)
    payload['schema'] = 1
    payload['session'] = uuid.uuid4().hex
    # Serialize before creating anything: malformed/non-finite JSON never launches Blender.
    text = json.dumps(payload, allow_nan=False, separators=(',', ':'))
    if len(text.encode('utf-8')) > MAX_BYTES:
        raise ValueError('The Blender exchange is too large.')
    directory = root() / payload['session']
    directory.mkdir(parents=True)
    write(directory / 'input.json', payload)
    return directory


def launch(directory, exe):
    existing = _processes.get(str(directory))
    if existing is not None and existing.poll() is None:
        raise ValueError('This session is already open in Blender. Use its DeusEdix sidebar to send changes back.')
    script = Path(__file__).with_name('blender_studio.py')
    with (directory / 'blender.log').open('ab') as log:
        process = subprocess.Popen([str(exe), '--factory-startup', '--python', str(script), '--', str(directory)],
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    _processes[str(directory)] = process
    def finished():
        code = process.wait()
        if not (directory / 'status.json').is_file():
            write(directory / 'status.json', dict(error=f'Blender could not prepare the scene (exit {code}). See {directory / "blender.log"}.'))
    threading.Thread(target=finished, daemon=True).start()


def result(session):
    import anims
    d = folder(session)
    if not (d / 'result.json').is_file():
        state = read(d / 'status.json') if (d / 'status.json').is_file() else {}
        return dict(ready=False, state=state)
    original, output = read(d / 'input.json'), read(d / 'result.json')
    if output.get('schema') != 1 or output.get('session') != session or output.get('mesh') != original['mesh']:
        raise ValueError('This Blender result belongs to another character or session.')
    frames, fps = output.get('frames'), output.get('fps')
    if type(frames) is not int or not 1 <= frames <= MAX_FRAMES or type(fps) not in (float, int) or not math.isfinite(fps) or not 0 < fps <= 240:
        raise ValueError('Invalid Blender frame range or frame rate.')
    if type(output.get('loop')) is not bool:
        raise ValueError('Invalid Blender loop setting.')
    validate_samples(output.get('samples'), frames, [b['name'] for b in original['bones']])
    if 'controls' in output:
        if 'controls' not in original:raise ValueError('This older session has no humanoid controls. Send a new session.')
        validate_controls(output['controls'],frames,[b['name'] for b in original['bones']])
    if 'poseKeys' in output:
        keyed = output['poseKeys']
        if (not isinstance(keyed, list) or len(keyed) > frames or any(type(f) is not int or not 0 <= f < frames for f in keyed)
                or keyed != sorted(set(keyed))):
            raise ValueError('Invalid Blender pose key frames.')
    props = output.get('props', [])
    probe = copy.deepcopy(original['animation'])
    # Props have a stricter game-frame limit than ordinary motion.
    import anim_props
    anim_props.validate(props, frames)
    probe['props'] = props
    anims._studio_validate(probe)
    for p in props:
        vector(p.get('quaternion'), 4)
        if not .99 < sum(v*v for v in p['quaternion']) < 1.01:
            raise ValueError('Invalid prop rotation from Blender.')
    before_props = {p['id']: p for p in original['animation'].get('props', [])}
    if len(props) != len(before_props) or {p['id'] for p in props} != set(before_props) or any(p['cls'] != before_props[p['id']]['cls'] for p in props):
        raise ValueError('Keep the original props. Add or remove game props in Animation Studio.')
    return dict(ready=True, original=original['animation'], mesh=original['mesh'], bones=original['bones'], baseline=original['samples'], controlBaseline=original.get('controls'),
                result=output, revision=hashlib.sha256((d / 'result.json').read_bytes()).hexdigest())


def handle(action, data):
    with _lock:
        if action == 'info':
            return info()
        if action == 'configure':
            exe = executable(data.get('executable'))
            root().mkdir(parents=True, exist_ok=True)
            write(root() / 'preferences.json', dict(executable=str(exe)))
            return info()
        if action == 'start':
            exe = executable()
            directory = create_session(data)
            launch(directory, exe)
            return dict(id=directory.name, folder=str(directory))
        if action == 'resume':
            directory = folder(data.get('session'))
            launch(directory, executable())
            return dict(id=directory.name)
        if action == 'result':
            return result(data.get('session'))
        raise ValueError('Unknown Blender action.')
