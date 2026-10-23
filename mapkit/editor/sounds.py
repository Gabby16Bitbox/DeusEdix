"""Sounds of the game for the map editor: the catalog of every sound (host UC_SOUNDS over the game's sound
packages, cache/_sounds/catalog.json, made once) and a file the browser can play for one of them (OBJ
EXPORT, kept in cache/_sounds/play). Used by the AmbientSound property: ambient sounds (rain, hum, wind,
machines, crowds) and the sounds of objects.

The user's own sounds (the browser's Import, My sounds): any file the browser can decode (WAV, MP3, OGG,
FLAC...) arrives here as a WAV, mono 16 bit 44.1 kHz (a sound heard from a place must be mono), is kept in
tools/mapkit/sounds/<Name>.wav and becomes a sound of the editor's package (settings.SOUNDS_PACKAGE: UCSounds
in UNATCO Continues, DeusEdixSounds in DeusEdix) made by Deus Ex's own AUDIO IMPORT, in dist\\ and, when the
game is closed, in the game (else at the next Install)."""
import base64
import json
import os
import re
import shutil
import struct
from pathlib import Path

import kit
import settings

HERE = Path(__file__).resolve().parent
CACHE = HERE / 'cache' / '_sounds'
SOURCES = HERE.parent / 'sounds'
DUBS = HERE.parent / 'dubs'          # the voices given to the lines of the Story (D<key>.wav, index.json)
PACKAGE = settings.SOUNDS_PACKAGE
DIST = kit.PROJECT / 'dist' / (PACKAGE + '.u')
MAX_SECONDS = 600
PACKAGES = (('Ambient.uax', 'RSounds.uax', 'MoverSFX.uax', 'DeusExSounds.u', 'Precipitation.u') if settings.IS_REVISION
            else ('Ambient.uax', 'MoverSFX.uax', 'DeusExSounds.u'))       # the original game: no RSounds, no Precipitation
# the groups that hold loops for places (shown first)
AMBIENT = ('Ambient.Ambient', 'RSounds.Ambient', 'RSounds.Environment', 'Precipitation.Ambient')


def catalog(log=print):
    """[{name: 'Pkg.Group.Sound', group: 'Pkg.Group', size}] of every sound, ambient groups first."""
    path = CACHE / 'catalog.json'
    if path.exists():
        return json.loads(path.read_text(encoding='utf-8'))
    CACHE.mkdir(parents=True, exist_ok=True)
    log('reading the sounds of the game (once)...')
    s = kit.Session([], 'editor-sounds')
    try:
        s.batch(['OBJ LOAD FILE="%s"' % p for p in PACKAGES] + [r'UC_SOUNDS ..\Output\sounds.txt'])
        text = (s.folder / 'Output' / 'sounds.txt').read_text(encoding='utf-8', errors='replace')
    finally:
        s.close()
    out = []
    for line in text.splitlines():
        f = line.split(' ')
        if len(f) >= 2 and f[0].count('.') >= 1:
            group = f[0].rsplit('.', 1)[0]
            out.append(dict(name=f[0], group=group, size=int(f[1]) if f[1].isdigit() else 0))
    out.sort(key=lambda x: (x['group'] not in AMBIENT, x['group'].lower(), x['name'].lower()))
    path.write_text(json.dumps(out), encoding='utf-8')
    return out


def load_commands(edits):
    """OBJ LOAD of the sound packages the edits use (Sound'Pkg.Group.Name' in Properties and added objects,
    the sounds of the interactions): a map build must have them loaded before the objects that use them."""
    text = json.dumps(edits)
    out = []
    for p in PACKAGES + (PACKAGE + '.u',):
        stem = p.split('.')[0]
        if re.search(r"""(Sound'|["'])%s\.""" % re.escape(stem), text, re.I):
            out.append('OBJ LOAD FILE="%s"' % p)
    return out


# ---------------------------------------------------------------- the user's own sounds
def _name(s):
    s = re.sub(r'\W', '', str(s or '').strip().replace(' ', '_').replace('-', '_'))[:40]
    return s if s and not s[0].isdigit() else ('S' + s)[:40]


def _wav_info(data, complete=True):
    """(channels, rate, bits, seconds) of a PCM WAV, or ValueError."""
    if data[:4] != b'RIFF' or data[8:12] != b'WAVE':
        raise ValueError('not a WAV file')
    if len(data) < 12:
        raise ValueError('the WAV header is incomplete')
    end = struct.unpack_from('<I', data, 4)[0] + 8
    if end < 12 or (complete and end > len(data)):
        raise ValueError('the WAV file is truncated')
    pos, fmt, size = 12, None, None
    while pos + 8 <= len(data):
        cid, n = data[pos:pos + 4], struct.unpack('<I', data[pos + 4:pos + 8])[0]
        if pos + 8 + n > end or (complete and pos + 8 + n > len(data)):
            raise ValueError('a WAV chunk is truncated')
        if cid == b'fmt ':
            if n < 16 or pos + 24 > len(data):
                raise ValueError('the WAV format header is incomplete')
            fmt = struct.unpack('<HHIIHH', data[pos + 8:pos + 24])
        elif cid == b'data':
            size = n
            break
        pos += 8 + n + (n & 1)
    if not fmt or fmt[0] != 1:
        raise ValueError('the WAV must be PCM')
    channels, rate, bits = fmt[1], fmt[2], fmt[5]
    align = channels * bits // 8
    if not 1 <= channels <= 32 or not 1000 <= rate <= 384000 or bits not in (8, 16, 24, 32):
        raise ValueError('the WAV has an unsupported sample format')
    if fmt[4] != align or fmt[3] != align * rate or size is None or size <= 0 or size % align:
        raise ValueError('the WAV has invalid or empty sample data')
    return channels, rate, bits, size / float(align * rate)


def _own_index():
    try:
        result = json.loads((SOURCES / 'index.json').read_text(encoding='utf-8'))
        return result if isinstance(result, dict) else {}
    except (OSError, ValueError):
        return {}


def _audio_metadata(path, source='', origin='game'):
    path = Path(path)
    result = dict(bytes=path.stat().st_size, format=path.suffix.lstrip('.').upper(), source=source, origin=origin)
    try:
        with path.open('rb') as stream:
            ch, rate, bits, seconds = _wav_info(stream.read(65536), complete=False)
        result.update(channels=ch, sample_rate=rate, bits=bits, seconds=round(seconds, 4), format='WAV PCM')
    except (ValueError, struct.error):
        pass                           # compressed game audio is decoded by Web Audio on preview
    return result


def own():
    """The imported sounds: [{name: 'UCSounds.Door_creak', short, seconds, kb, group}]."""
    out = []
    index = _own_index()
    if SOURCES.exists():
        for f in sorted(SOURCES.glob('*.wav'), key=lambda p: p.stem.lower()):
            try:
                with open(f, 'rb') as fh:
                    ch, rate, bits, sec = _wav_info(fh.read(65536), complete=False)
            except (OSError, ValueError, struct.error):
                continue
            out.append(dict(name='%s.%s' % (PACKAGE, f.stem), group=PACKAGE, short=f.stem, seconds=round(sec, 2),
                            kb=f.stat().st_size // 1024, own=True, channels=ch, sample_rate=rate, bits=bits,
                            bytes=f.stat().st_size, format='WAV PCM', origin='imported',
                            source=(index.get(f.stem) or {}).get('source', f.name)))
    return out


def everything(log=print):
    """The picker's and the browser's list: the user's sounds first, then the game's."""
    return own() + catalog(log)


def pack(log=print):
    """The sounds package made again from every imported sound and every voice of a line: (ok, lines)."""
    import live
    files = sorted(SOURCES.glob('*.wav')) if SOURCES.exists() else []
    files += sorted(DUBS.glob('D*.wav')) if DUBS.exists() else []
    lines = []
    if not files:                            # nothing left: no package (the maps that used one lose the sound)
        DIST.unlink(missing_ok=True)
        if not live.running():
            (settings.PACKAGES_DIR / (PACKAGE + '.u')).unlink(missing_ok=True)
        return True, ['No imported sounds or voices: %s.u removed.' % PACKAGE]
    s = kit.Session([], 'editor-sounds-pack')
    try:
        inp = s.folder / 'Input'
        cmds = []
        for f in files:
            shutil.copy2(f, inp / f.name)
            cmds.append(r'AUDIO IMPORT FILE="..\Input\%s" NAME=%s PACKAGE=%s' % (f.name, f.stem, PACKAGE))
        cmds.append(r'UC_SAVEPKG %s ..\Output\%s.u' % (PACKAGE, PACKAGE))
        out = s.batch(cmds, timeout=1800)
        made = s.folder / 'Output' / (PACKAGE + '.u')
        bad = [l for l in out.splitlines() if re.search(r'savepkg\|.*\|0|[Cc]ouldn.t|[Ff]ailed', l)]
        if bad or not made.exists():
            return False, ['%s.u was not made' % PACKAGE] + bad[:5]
        DIST.parent.mkdir(exist_ok=True)
        tmp = DIST.with_suffix('.tmp')
        shutil.copy2(made, tmp)
        os.replace(tmp, DIST)                 # a new file: the runs that linked the old one keep it
    finally:
        s.close()
    lines.append('%s.u: %d sound%s (%.1f MB) in dist\\' % (PACKAGE, len(files), '' if len(files) == 1 else 's', DIST.stat().st_size / 1e6))
    if live.running():
        lines.append('The game is open: the sounds go in with the next Install.')
    else:
        settings.PACKAGES_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy2(DIST, settings.PACKAGES_DIR / (PACKAGE + '.u'))
        # the game reads its maps folder (UnatcoMaps, where Install puts the mod's packages) before System: a copy
        # there would hide the new one (20 Oct 2026: an imported model was not in the game), so it is replaced too
        if (settings.MAPS_DIR / (PACKAGE + '.u')).exists():
            shutil.copy2(DIST, settings.MAPS_DIR / (PACKAGE + '.u'))
        lines.append('Installed in the game (%s).' % (settings.PACKAGES_DIR / (PACKAGE + '.u')))
    return True, lines


def import_sounds(items, log=print):
    """items: [{name, wav: data URL of a WAV (mono 16 bit, made by the browser), source}]. Returns (ok, lines,
    names). One package build for all of them; on failure the sounds as they were come back."""
    if not isinstance(items, list) or not 1 <= len(items) <= 64:
        raise ValueError('Choose between 1 and 64 sound files.')
    prepared, notes = [], []
    occupied = {p.stem.lower() for folder in (SOURCES, DUBS) if folder.exists() for p in folder.glob('*.wav')}
    for it in items:
        if not isinstance(it, dict) or not str(it.get('name') or '').strip():
            raise ValueError('Give each sound a name.')
        name = _name(it.get('name'))
        if not name:
            raise ValueError('give the sound a name')
        try:
            raw = base64.b64decode(str(it.get('wav') or '').split(',', 1)[-1], validate=True)
        except (ValueError, TypeError) as error:
            raise ValueError('%s: invalid audio data' % name) from error
        ch, rate, bits, sec = _wav_info(raw)
        if ch != 1 or bits != 16:
            raise ValueError('%s: the sound must arrive mono, 16 bit' % name)
        if sec > MAX_SECONDS:
            raise ValueError('%s is %d seconds long (at most %d)' % (name, sec, MAX_SECONDS))
        stem, number = name, 2
        while name.lower() in occupied:
            suffix = '_' + str(number)
            name = stem[:40 - len(suffix)] + suffix
            number += 1
        occupied.add(name.lower())
        if name != stem:
            notes.append('Kept the existing %s; imported this sound as %s.' % (stem, name))
        source = str(it.get('source') or it.get('name')).replace('\\', '/').rsplit('/', 1)[-1][:200]
        prepared.append((SOURCES / (name + '.wav'), raw, source))
    # All formats and names are checked before any source file is written. Exclusive creation
    # also protects files created by another tool after the name inventory was read.
    SOURCES.mkdir(parents=True, exist_ok=True)
    saved = []
    index_path = SOURCES / 'index.json'
    old_index = index_path.read_bytes() if index_path.exists() else None
    index = _own_index()
    try:
        for f, raw, source in prepared:
            with f.open('xb') as stream:
                saved.append(f)
                stream.write(raw)
            index[f.stem] = dict(source=source)
        index_path.write_text(json.dumps(index, indent=1, ensure_ascii=False), encoding='utf-8')
        ok, lines = pack(log)
        if ok:
            return True, notes + lines, ['%s.%s' % (PACKAGE, f.stem) for f in saved]
    except Exception:
        for f in saved:
            f.unlink(missing_ok=True)
        if old_index is None:
            index_path.unlink(missing_ok=True)
        else:
            index_path.write_bytes(old_index)
        raise
    for f in saved:
        f.unlink(missing_ok=True)
    if old_index is None:
        index_path.unlink(missing_ok=True)
    else:
        index_path.write_bytes(old_index)
    return False, lines, []


# ---------------------------------------------------------------- voices given to the lines (dubbing)
# A line of the Story (a dialogue's, an InfoLink's) can have its own voice: recorded with the microphone in
# the editor, imported, or one of the user's sounds. It becomes the sound D<key> of the same package, key =
# story.voice_key(speaker, text) = what UCVoice.Dub looks for in the game; the line keeps it in "voice". The
# game plays it from the speaker's mouth (UCVoiceDriver): the lips follow it like any line of the game's.
def _dub_index():
    f = DUBS / 'index.json'
    try:
        return json.loads(f.read_text(encoding='utf-8')) if f.exists() else {}
    except ValueError:
        return {}


def _dub_save_index(idx):
    DUBS.mkdir(parents=True, exist_ok=True)
    (DUBS / 'index.json').write_text(json.dumps(idx, indent=1, ensure_ascii=False), encoding='utf-8')


def _speaker(body):
    import story
    if body.get('original'):
        import gamecons
        origin=body['original']
        con=next((c for c in gamecons.catalog(origin.get('package',settings.CONVERSATIONS))['conversations'] if c['path']==origin.get('conversation')),None)
        line=next((s for s in gamecons.speeches(con) if s['path']==origin.get('event')),None) if con else None
        if line is None: raise ValueError('The original line is no longer available; reopen its conversation.')
        body['line']={'text':line['text']}
        return line['speaker']
    if body.get('infolink') is not None:
        return story.info_speaker(body['infolink'])
    return story.line_speaker(body.get('dialogue') or {}, body.get('line') or {})


def dub(body, log=print):
    """body: {map, line: {who, bind, text}, dialogue: {owner, bind} | infolink: {caller},
    wav: data URL (mono 16 bit) | sound: 'UCSounds.Name' (one of the user's), source, old: the key it had}.
    Returns (ok, lines, info)."""
    import story
    speaker = _speaker(body)
    text = (body.get('line') or {}).get('text') or ''
    full_line=body.get('original') or (body.get('dialogue') or {}).get('replaces')
    key = story.raw_voice_key(speaker,text if body.get('original') else story.spoken(text)) if full_line else story.voice_key(speaker, text)
    if not key:
        raise ValueError('this line is too long for one voice (the game shows it in more than one piece): split it in two lines'
                         if speaker and str(text).strip() else 'write the line first')
    if body.get('sound'):
        if not str(body['sound']).startswith(PACKAGE+'.'):
            raise ValueError('Original game voices must be used by reference, not imported as a dub.')
        src = SOURCES / (_name(str(body['sound']).split('.')[-1]) + '.wav')
        if not src.exists():
            raise ValueError('only your own sounds (My sounds) can be a voice: %s' % body['sound'])
        raw = src.read_bytes()
    else:
        raw = base64.b64decode(str(body.get('wav') or '').split(',', 1)[-1])
    ch, rate, bits, sec = _wav_info(raw)
    if ch != 1 or bits != 16:
        raise ValueError('the voice must arrive mono, 16 bit')
    if sec > 120:
        raise ValueError('a voice of %d seconds: at most 2 minutes for one line' % sec)
    DUBS.mkdir(parents=True, exist_ok=True)
    f = DUBS / (key + '.wav')
    before = f.read_bytes() if f.exists() else None
    f.write_bytes(raw)
    idx = _dub_index()
    idx[key] = dict(speaker=speaker, text=text if body.get('original') else story.spoken(text) if full_line else story.spoken(story.pieces(text)[0]), map=body.get('map', ''),
                    original=body.get('original') or idx.get(key, {}).get('original'),
                    seconds=round(sec, 2), source=str(body.get('source') or '')[:120])
    ok, lines = pack(log)
    if not ok:
        if before is None:
            f.unlink(missing_ok=True)
        else:
            f.write_bytes(before)
        return False, lines, None
    _dub_save_index(idx)
    write_dub_registry()
    for p in (CACHE / 'play').glob('%s.%s.*' % (PACKAGE, key)):
        p.unlink(missing_ok=True)
    return True, lines, dict(key=key, name='%s.%s' % (PACKAGE, key), seconds=round(sec, 2), speaker=speaker)


def dub_delete(key):
    if not re.fullmatch(r'D\d+', str(key or '')):
        raise ValueError('not a voice: %r' % key)
    file=DUBS/(key+'.wav'); before=file.read_bytes() if file.exists() else None
    file.unlink(missing_ok=True)
    ok,lines=pack()
    if not ok:
        if before is not None: file.write_bytes(before)
        return ok,lines
    idx = _dub_index()
    idx.pop(key, None)
    _dub_save_index(idx)
    write_dub_registry()
    return ok,lines


def write_dub_registry():
    """Small numeric index for the runtime; no game dialogue or audio is compiled into the tool."""
    keys=sorted(int(k[1:]) for k,v in dubs().items() if v.get('original'))
    lines=['// Generated from the local dub index. No original text or audio.','class UCVoiceDubs extends Object;',
           'static function bool Any() { return %s; }'%str(bool(keys))]
    chunks=[keys[i:i+64] for i in range(0,len(keys),64)]
    lines += ['static function bool Contains(int key) { return '+(' || '.join('Part%d(key)'%i for i in range(len(chunks))) or 'False')+'; }']
    for i,chunk in enumerate(chunks):
        lines.append('static function bool Part%d(int key) { return '%i+' || '.join('key==%d'%k for k in chunk)+'; }')
    path=settings.PROJECT/'src'/settings.PACKAGE/'Classes/UCVoiceDubs.uc'
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text('\n'.join(lines)+'\n',encoding='ascii')


def dubs():
    """{key: {speaker, text, seconds, map}} of the voices given to lines."""
    idx = _dub_index()
    return {k: v for k, v in idx.items() if (DUBS / (k + '.wav')).exists()}


def rekey(story_data, log=print):
    """A story saved: lines whose text (or speaker) changed since their voice was given keep it, under
    their new key. Changes story_data in place; returns the lines of the package build (or [])."""
    import story
    idx, moved = _dub_index(), []
    for line, speaker in story.voiced_lines(story_data):
        old = line.get('voice')
        if not old:
            continue
        if isinstance(old,dict):
            import originalstory
            originalstory.voice_path(old)
            if old.get('text',line.get('text')) != line.get('text') or old.get('speaker',speaker) != speaker:
                line.pop('voice',None)
            else:
                old.update(text=line.get('text'),speaker=speaker)
            continue
        full_line=any(d.get('replaces') and any(line is s or any(line is o for o in s.get('options',[])) for s in d.get('steps',[])) for d in story_data.get('dialogues',[]))
        key = story.raw_voice_key(speaker,story.spoken(line.get('text'))) if full_line else story.voice_key(speaker, line.get('text'))
        if not key or key == old:
            continue
        src = DUBS / (old + '.wav')
        if not src.exists():
            continue
        shutil.copy2(src, DUBS / (key + '.wav'))   # another line may still use the old key
        meta = idx.get(old, {})
        idx[key] = dict(meta, speaker=speaker, text=story.spoken(line.get('text')) if full_line else story.spoken(story.pieces(line.get('text'))[0]))
        line['voice'] = key
        moved.append(key)
    if not moved:
        return []
    _dub_save_index(idx)
    ok, lines = pack(log)
    return ['%d line%s kept %s voice (new text or speaker name).' % (len(moved), '' if len(moved) == 1 else 's',
                                                                   'its' if len(moved) == 1 else 'their')] + lines


def delete_sound(name):
    f = SOURCES / (_name(str(name).split('.')[-1]) + '.wav')
    if not f.exists():
        raise ValueError('no imported sound %s' % name)
    f.unlink()
    return pack()


def playable(name, log=print):
    """A file of the sound the browser can play: {url, type}."""
    if not re.fullmatch(r'[\w.()-]+', name or ''):
        raise ValueError('not a sound: %r' % name)
    folder = CACHE / 'play'
    folder.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r'[^\w.-]', '_', name)
    if name.split('.')[0].lower() == PACKAGE.lower():      # the user's own: its file as imported
        src = SOURCES / (name.split('.')[-1] + '.wav')
        if not src.exists():
            src = DUBS / (name.split('.')[-1] + '.wav')          # the voice of a line
        if not src.exists():
            raise ValueError('no imported sound %s' % name)
        dst = folder / (safe + '.wav')
        if not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime:
            shutil.copy2(src, dst)
        source = (_own_index().get(src.stem) or {}).get('source', src.name)
        return dict(url='/cache/_sounds/play/%s.wav?v=%d' % (safe, src.stat().st_mtime_ns), type='audio/wav',
                    **_audio_metadata(src, source, 'voice' if src.parent == DUBS else 'imported'))
    for ext, typ in (('.wav', 'audio/wav'), ('.ogg', 'audio/ogg'), ('.mp3', 'audio/mpeg')):
        if (folder / (safe + ext)).exists():
            return dict(url='/cache/_sounds/play/%s%s' % (safe, ext), type=typ,
                        **_audio_metadata(folder / (safe + ext), name.split('.')[0]))
    pkg = name.split('.')[0]
    load = next((p for p in PACKAGES if p.split('.')[0].lower() == pkg.lower()), None)
    s = kit.Session([], 'editor-sound')
    try:
        if load:
            s.cmd('OBJ LOAD FILE="%s"' % load)
        # the exporter goes by the file's extension (a sound comes out as it was imported: WAV, or OGG in a .wav)
        s.cmd(r'OBJ EXPORT TYPE=Sound NAME=%s FILE="..\Output\sound.wav"' % name)
        out = s.folder / 'Output' / 'sound.wav'
        data = out.read_bytes() if out.exists() else b''
    finally:
        s.close()
    if not data:
        raise RuntimeError('the sound %s could not be read' % name)
    ext, typ = ('.ogg', 'audio/ogg') if data[:4] == b'OggS' else ('.mp3', 'audio/mpeg') if data[:3] == b'ID3' else ('.wav', 'audio/wav')
    (folder / (safe + ext)).write_bytes(data)
    return dict(url='/cache/_sounds/play/%s%s' % (safe, ext), type=typ,
                **_audio_metadata(folder / (safe + ext), name.split('.')[0]))
