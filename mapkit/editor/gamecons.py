"""Read-only original conversations and on-demand voice previews from the local game install.

No exported text/audio is a distributable asset: all generated data lives in editor/cache.
FRevisionConversations is Revision's female-player variant, not a French translation.
Conversations of mods: a package not in SETS (a map's ConversationPackage, another mod's package) is
read the same way when it holds conversations, or uses the package that holds them (as DeusExConversations
uses DeusExConText); its voices are where the engine says they are (conversation_set).
"""
import hashlib
import json
import os
import re
from pathlib import Path

import kit
import settings
import t3d

HERE = Path(__file__).resolve().parent
CACHE = settings.GAME_CACHE / '_gamecons'        # the game's conversations and voices: shared by its projects
VOICES = settings.GAME_CACHE / '_gamevoices'
VERSION = 2
SETS = {
    'RevisionConversations': ('RevisionConversationsText', 'RevisionConversationsAudio'),
    'FRevisionConversations': ('FRevisionConversationsText', 'FRevisionConversationsAudio'),
    'DeusExConversations': ('DeusExConText', 'DeusExConAudio'),
}
_memory = {}
_holds = {}
MODS = CACHE / 'mods.json'          # the mods' conversation packages seen so far (packages() lists them)


def _package(name):
    if not re.fullmatch(r'[A-Za-z0-9_]+', name):
        raise ValueError('Invalid conversation package name.')
    for root in (settings.REVISION / 'System', settings.GAME / 'System'):
        path = root / (name + '.u')
        if path.is_file():
            return path
    # a mod's: where the game reads packages, this project's packages, the other mods' it uses
    import gamecheck
    path = gamecheck.files(settings.TARGET).get(name.lower())
    if path and path.suffix.lower() == '.u':
        return path
    for path in [settings.MAPS_DIR / (name + '.u'), kit.PROJECT / 'dist' / (name + '.u')] + [
            Path(p['path']) for p in kit.extra_packages() if p.get('path') and p['name'].lower() == name.lower()]:
        if path.is_file():
            return path
    raise FileNotFoundError('Conversation package is not installed: ' + name)


def holds_conversations(path):
    """Does this package have conversations of its own (ConSys objects)?"""
    import ue1pkg
    st = path.stat()
    key = (str(path).lower(), st.st_size, st.st_mtime_ns)
    if key not in _holds:
        pkg = ue1pkg.Pkg(str(path))
        _holds[key] = any(pkg.classname(e) in ('ConversationList', 'Conversation') for e in pkg.exports)
    return _holds[key]


def conversation_set(package):
    """(package with the conversations, prefix of its voice packages or '') of a conversation package: the
    game's own (SETS), or a mod's: itself when it has conversations, else a package it uses that has them.
    A mod's voices ('' prefix) are found from the engine's answer (catalog)."""
    if package in SETS:
        return SETS[package]
    try:
        path = _package(package)
    except FileNotFoundError as exc:
        raise ValueError('This conversation package is not installed: ' + str(package)) from exc
    if holds_conversations(path):
        return package, ''
    import ue1pkg
    pkg = ue1pkg.Pkg(str(path))
    for _cls_pkg, cls, outer, name in pkg.imports:
        if cls == 'Package' and outer == 0:
            try:
                if holds_conversations(_package(name)):
                    return name, ''
            except (FileNotFoundError, ValueError):
                continue
    raise ValueError('There are no conversations in the package ' + str(package))


def _remember_mod(package):
    if package in SETS:
        return
    try:
        known = json.loads(MODS.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        known = []
    if package not in known:
        _write(MODS, sorted(set(known) | {package}))


def _files(package):
    text, audio = conversation_set(package)
    files = [_package(package), _package(text), _package('ConSys')]
    for root in (settings.REVISION / 'System', settings.GAME / 'System') if audio else ():
        for p in sorted(root.glob(audio + '*.u')):
            if p.name.lower() not in {f.name.lower() for f in files}:
                files.append(p)
    unique = []
    for f in files:
        if f.name.lower() not in {u.name.lower() for u in unique}:
            unique.append(f)
    return unique


def packages():
    labels = {'RevisionConversations': 'Revision · JC',
              'FRevisionConversations': 'Revision · Female JC', 'DeusExConversations': 'Deus Ex · JC'}
    available = []
    for name, label in labels.items():
        try:
            _package(name); _package(SETS[name][0])
        except FileNotFoundError:
            continue
        available.append(dict(name=name, label=label))
    # the mods': seen in maps, or the packages of other mods this project uses that have conversations
    try:
        mods = json.loads(MODS.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        mods = []
    mods += [p['name'] for p in kit.extra_packages()]
    for name in dict.fromkeys(mods):
        if name in labels:
            continue
        try:
            conversation_set(name)
        except (ValueError, OSError):
            continue
        available.append(dict(name=name, label='Mod · ' + name))
    return available


def _stamp(files):
    return hashlib.sha256(json.dumps([(str(p.resolve()), p.stat().st_size, p.stat().st_mtime_ns)
                                    for p in files]).encode()).hexdigest()


def _write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    os.replace(tmp, path)


def ref(value):
    m = re.fullmatch(r"\w+'([^']+)'", str(value or ''))
    return m[1] if m else ('' if value in (None, 'None') else str(value))


def normalize(rows):
    """Follow native chains with cycle/dangling-reference checks; preserve all event properties."""
    objects = {r['path']: r for r in rows}
    def props(row):
        return {k.lower(): v for k, v in row.get('properties', {}).items()
                if not k.startswith('ObjectInternal') and k not in ('Outer', 'ObjectFlags', 'Name', 'Class')}
    def obj(value):
        path = ref(value)
        if not path:
            return {}
        if path not in objects:
            raise ValueError('Unresolved conversation object: ' + path)
        return objects[path]
    def chain(value, key):
        seen = set()
        while ref(value):
            row = obj(value)
            if row['path'] in seen:
                raise ValueError('Cyclic conversation chain: ' + row['path'])
            seen.add(row['path']); yield row
            value = props(row).get(key)
    def flags(value):
        return [dict(flag=p.get('flagname', ''), value=p.get('value') == 'True',
                     expiration=int(p.get('expiration', 0)))
                for r in chain(value, 'nextflagref') for p in [props(r)]]
    missions, membership = [], {}
    for row in rows:
        if row['class'] != 'ConversationList':
            continue
        p = props(row)
        mission = dict(number=int(p.get('missionnumber', 0)), title=p.get('missiondescription', ''), path=row['path'])
        missions.append(mission)
        for item in chain(p.get('conversations'), 'next'):
            membership.setdefault(ref(props(item).get('conobject')), []).append(mission['number'])
    conversations, flag_sources, goals, notes = [], {}, {}, {}
    for row in rows:
        if row['class'] != 'Conversation':
            continue
        p = props(row); member_missions = sorted(set(membership.get(row['path'], [])))
        con = dict(path=row['path'], name=p.get('conname', ''), owner=p.get('conownername', ''),
                   description=p.get('description', ''), mission=member_missions[0] if member_missions else None, missions=member_missions,
                   group=p.get('audiopackagename', ''), properties=p, requires=flags(p.get('flagreflist')),
                   events=[], speakers=[])
        for event in chain(p.get('eventlist'), 'nextevent'):
            ep = props(event)
            ev = dict(path=event['path'], type=event['class'].removeprefix('ConEvent'),
                      label=ep.get('label', ''), properties=ep)
            if ev['type'] == 'Speech':
                speech = props(obj(ep.get('conspeech')))
                ev.update(speaker=ep.get('speakername', ''), speakingTo=ep.get('speakingtoname', ''),
                          text=speech.get('speech', ''), soundID=int(speech.get('soundid', -1)), sound=None)
                con['speakers'].append(ev['speaker'])
            if ev['type'] == 'Choice':
                ev['choices'] = []
                for choice in chain(ep.get('choicelist'), 'nextchoice'):
                    cp = props(choice)
                    ev['choices'].append(dict(path=choice['path'], text=cp.get('choicetext', ''),
                        label=cp.get('choicelabel', ''), soundID=int(cp.get('soundid', -1)), sound=None,
                        speaker='JCDenton', flags=flags(cp.get('flagref')), skill=ref(cp.get('skillneeded')),
                        skillLevel=int(cp.get('skilllevelneeded', 0)), properties=cp))
            if 'flagref' in ep:
                ev['flags'] = flags(ep['flagref'])
            if ev['type'] == 'RandomLabel':
                ev['labels'] = event.get('labels', [])
            if ev['type'] == 'AddGoal':
                goals.setdefault(ep.get('goalname', ''), []).append(dict(conversation=con['name'], text=ep.get('goaltext', '')))
            if ev['type'] == 'AddNote':
                notes.setdefault(ep.get('notetext', ''), []).append(con['name'])
            con['events'].append(ev)
        con['speakers'] = sorted(set(con['speakers']))
        for f in con['requires'] + [f for e in con['events'] for f in e.get('flags', [])] + [f for e in con['events'] for c in e.get('choices', []) for f in c['flags']]:
            if f['flag']:
                flag_sources.setdefault(f['flag'], []).append(con['name'])
        conversations.append(con)
    conversations.sort(key=lambda c: (c['mission'] if c['mission'] is not None else 999, c['owner'].lower(), c['name'].lower()))
    by_owner, by_speaker = {}, {}
    for con in conversations:
        by_owner.setdefault(con['owner'].casefold(), []).append(con['path'])
        for speaker in con['speakers']:
            by_speaker.setdefault(speaker.casefold(), []).append(con['path'])
    return dict(missions=sorted(missions, key=lambda m: m['number']), conversations=conversations,
                byOwner=by_owner, bySpeaker=by_speaker,
                flags={k: sorted(set(v)) for k, v in flag_sources.items()}, goals=goals, notes=notes)


def speeches(con):
    for event in con['events']:
        if event['type'] == 'Speech':
            yield event
        yield from event.get('choices', [])


def _sound_names(files, any_name=False):
    # Validate every derived reference against the actual exports, without extracting audio bytes.
    import ue1pkg
    found = set()
    for file in files:
        if 'Audio' not in file.stem and not any_name:
            continue
        pkg = ue1pkg.Pkg(str(file))
        def full(index, seen=None):
            seen = set() if seen is None else seen
            if index == 0:
                return file.stem
            if index in seen or index < 0:
                raise ValueError('Invalid sound export outer in ' + file.name)
            seen.add(index)
            e = pkg.exports[index - 1]
            return full(e['pkg'], seen) + '.' + e['name']
        found.update(full(i) for i, e in enumerate(pkg.exports, 1) if pkg.classname(e) == 'Sound')
    return found


def catalog(package=None, log=print):
    package = package or settings.CONVERSATIONS     # Revision's, or the original game's DeusExConversations
    files = _files(package); signature = _stamp(files)
    key = (package, signature, VERSION)
    if key in _memory:
        return _memory[key]
    path = CACHE / (package + '.json')
    if path.exists():
        try:
            result = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            result = {}
        if result.get('signature') == signature and result.get('version') == VERSION:
            _memory[key] = result; return result
    log('Reading original conversations from your game install...')
    session = kit.Session([], 'gamecons-' + package)
    try:
        text, audio = conversation_set(package)
        session.batch(['OBJ LOAD FILE="%s.u"' % text, 'OBJ LOAD FILE="%s.u"' % package,
                       r'UC_CONDUMP ..\Output\conversations.jsonl'])
        rows = kit.rows(session.folder / 'Output' / 'conversations.jsonl')
        result = normalize(rows)
        groups = {}
        for con in result['conversations']:
            first = next((s for s in speeches(con) if s['soundID'] >= 0), None)
            if first and con['group'] not in groups:
                groups[con['group']] = (con, first)
        if not audio:
            # a mod: the engine looks for the voices of a group in <package without 'Text'>Audio<group>.u
            # (DeusExConText -> DeusExConAudioMission01); a mod may have none, or some groups only
            base = (text[:-4] if text.lower().endswith('text') else text) + 'Audio'
            def voiced(group):
                try:
                    return bool(_package(base + group))
                except (FileNotFoundError, ValueError):
                    return False
            groups = {group: pair for group, pair in groups.items() if voiced(group)}
        session.batch([r'UC_CONSOUND %s %d ..\Output\soundrefs.jsonl' % (con['path'], line['soundID'])
                       for con, line in groups.values()])
        resolved = kit.rows(session.folder / 'Output' / 'soundrefs.jsonl')
        if len(resolved) != len(groups):
            raise ValueError('The engine did not resolve every original audio group.')
        prefixes = {}
        for row, group in zip(resolved, groups):
            sound = row['sound']
            if not sound or not sound.endswith('_' + str(row['id'])):
                raise ValueError('Cannot resolve the original voice naming rule for ' + group)
            prefixes[group] = sound.rsplit('_', 1)[0] + '_'
        if audio:
            names = _sound_names(files)
        else:                       # a mod's voices: the packages the engine found them in
            found = []
            for top in sorted({prefix.split('.')[0] for prefix in prefixes.values()}):
                try:
                    found.append(_package(top))
                except (FileNotFoundError, ValueError):
                    continue
            names = _sound_names(found, any_name=True)
        missing = []
        for con in result['conversations']:
            for speech in speeches(con):
                if speech['soundID'] < 0 or con['group'] not in prefixes:      # a mod's group without voices
                    continue
                candidate = prefixes[con['group']] + str(speech['soundID'])
                if candidate in names:
                    speech['sound'] = candidate
                else:
                    missing.append(dict(conversation=con['name'], event=speech['path'], sound=candidate))
        result.update(version=VERSION, signature=signature, package=package, variant='female' if package == 'FRevisionConversations' else 'male',
                      missingAudio=missing, sourceFiles=[p.name for p in files], soundPrefixes=prefixes)
        # Keep the full reflected dump separately for diagnostics and future event types.
        CACHE.mkdir(parents=True, exist_ok=True)
        (CACHE / (package + '.jsonl')).write_text(dump, encoding='utf-8')
        _write(path, result)
    finally:
        session.close()
    _memory.clear(); _memory[key] = result
    return result


def for_map(map_name, actors, package=None):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', map_name):
        raise ValueError('Invalid map name.')
    scene = HERE / 'cache' / map_name / 'scene.t3d'
    if not scene.exists():
        raise ValueError('Open the map before reading its conversations.')
    map_actors = list(t3d.actors(scene.read_text(encoding='latin1')))
    level = next((a['props'] for a in map_actors if a['cls'].split('.')[-1] == 'DeusExLevelInfo'), {})
    mission = int(level.get('missionNumber', 0))
    default_package = level.get('ConversationPackage', 'DeusExConversations').strip('"')
    package = package or default_package
    if not package or package.casefold() == 'none':
        return dict(map=map_name, mission=mission, package='', variant='', conversations=[], actors={},
                    flags={}, goals={}, notes={}, radioScope='This map has no original conversation package.')
    data = catalog(package)
    _remember_mod(package)
    binds = {a.get('bind', '').casefold() for a in actors if a.get('bind')}
    triggers = {str(v).strip('"').casefold() for a in map_actors for k, v in a['props'].items() if k.lower() in ('conname', 'conversation')}
    selected = [c for c in data['conversations'] if mission in c['missions']
                and (c['owner'].casefold() in binds or c['name'].casefold() in triggers or c['properties'].get('bdatalinkcon') == 'True')]
    by_actor = {a['name']: [c['path'] for c in selected if a.get('bind') and c['owner'].casefold() == a['bind'].casefold()] for a in actors}
    import story
    for con in selected:
        for line in speeches(con):
            line['dubKey']=story.raw_voice_key(line.get('speaker',''),line['text'])
    return dict(map=map_name, mission=mission, package=package, variant=data['variant'], conversations=selected,
                actors={k: v for k, v in by_actor.items() if v}, flags=data['flags'], goals=data['goals'], notes=data['notes'],
                radioScope='InfoLinks include mission-wide calls, whose triggers may be in mission scripts.')


def edit_copy(map_name, actors, path, disabled=False, preferred_actor=''):
    import originalstory
    data=for_map(map_name,actors)
    con=next((c for c in data['conversations'] if c['path']==path),None)
    if con is None: raise ValueError('Choose an original conversation from this map.')
    if is_bark(con): raise ValueError('Ambient NPC phrases are read-only. You can use their voices in your own lines.')
    actor=next((name for name,paths in data['actors'].items() if path in paths),'')
    if path in data['actors'].get(preferred_actor,[]): actor=preferred_actor
    if con['properties'].get('bdatalinkcon')=='True': actor='@player'
    if not actor: raise ValueError('The owner of this conversation is not in the map.')
    return originalstory.convert(con,actor,data['package'],disabled)


def is_bark(con):
    return con.get('properties', {}).get('bnoninteractive', '').lower() == 'true' or con.get('group', '').lower() == 'aibarks'


def search(query='', package=None, mission=None, owner='', limit=100, offset=0, kind='all'):
    package = package or settings.CONVERSATIONS
    if kind not in ('all', 'conversations', 'barks'):
        raise ValueError('Unknown voice category.')
    data = catalog(package); words = str(query).casefold().split(); found = []
    cons = [c for c in data['conversations'] if kind == 'all' or is_bark(c) == (kind == 'barks')]
    owners = sorted({name for c in cons if mission is None or int(mission) in c['missions']
                     for name in [c['owner'], *c['speakers']] if name})
    for con in cons:
        if mission is not None and int(mission) not in con['missions']:
            continue
        if owner and owner.casefold() not in {con['owner'].casefold(), *(s.casefold() for s in con['speakers'])}:
            continue
        for speech in speeches(con):
            text = ' '.join([con['name'], con['owner'], speech.get('speaker', ''), speech['text']]).casefold()
            if all(word in text for word in words):
                found.append(dict(conversation=con['name'], conversationPath=con['path'], mission=con['mission'], missions=con['missions'],
                                  owner=con['owner'], bark=is_bark(con), **{k: speech.get(k) for k in ('path', 'speaker', 'text', 'soundID', 'sound')}))
    offset=max(0,int(offset)); limit=max(1,min(int(limit),250))
    return dict(package=package, packages=packages(), total=len(found), lines=found[offset:offset+limit], missions=data['missions'], owners=owners)


def audio_format(raw):
    if raw.startswith(b'OggS'):
        return 'ogg', 'audio/ogg'
    if raw.startswith(b'RIFF') and raw[8:12] == b'WAVE':
        return 'wav', 'audio/wav'
    # Revision also has MP3 streams without ID3 tags. UE1 exports them with a .wav suffix.
    if raw.startswith(b'ID3') or (len(raw) >= 2 and raw[0] == 0xff and raw[1] & 0xe0 == 0xe0
                                and raw[1] & 0x06 != 0 and raw[1] & 0x18 != 0x08):
        return 'mp3', 'audio/mpeg'
    raise ValueError('The original voice has an unsupported audio format.')


def playable(sound, package=None):
    data = catalog(package)
    con = next((c for c in data['conversations'] if any(s.get('sound') == sound for s in speeches(c))), None)
    if not con:
        raise ValueError('Choose a voice from the original conversation catalogue.')
    folder = VOICES / data['signature'][:16]
    folder.mkdir(parents=True, exist_ok=True)
    def cached(name):
        for suffix in ('wav', 'ogg', 'mp3'):
            file = folder / (name + '.' + suffix)
            if file.is_file():
                with file.open('rb') as stream:
                    ext, mime = audio_format(stream.read(12))
                correct = folder / (name + '.' + ext)
                if file != correct and not correct.exists():
                    file.rename(correct)
                return dict(url='/cache/_gamevoices/%s/%s.%s' % (folder.name, name, ext), type=mime, original=True)
    existing = cached(sound)
    if existing:
        return existing
    pending = sorted({s['sound'] for s in speeches(con) if s.get('sound') and not cached(s['sound'])})
    session = kit.Session([], 'gamevoices')
    try:
        session.batch(['OBJ LOAD FILE="%s.u"' % p for p in sorted({n.split('.')[0] for n in pending})])
        session.batch([r'OBJ EXPORT TYPE=Sound NAME=%s FILE="..\Output\%d.wav"' % (name, i) for i, name in enumerate(pending)])
        for i, name in enumerate(pending):
            raw = (session.folder / ('Output/%d.wav' % i)).read_bytes()
            ext, _ = audio_format(raw)
            (folder / (name + '.' + ext)).write_bytes(raw)
    finally:
        session.close()
    return cached(sound)
