"""Map settings of the map editor ("Map" in the top bar).

- Music: Revision plays OGG files (Revision\\Music) chosen by a DXOggMusicInfo actor of the map
  (DXOgg package): one for exploring (and its intro), combat, conversations, the end of the map, death,
  and the same for the PS2 soundtrack option. presets(): what every original map uses (tools/mapkit/refs).
  The original game (settings.TARGET 'vanilla') has one song per map instead: LevelInfo.Song, a music
  package of Deus Ex\\Music (<name>.umx holds the Music <name>); the game plays its sections itself
  (exploring, combat, conversations...). One "role" then: Song, the .umx file; no preview (the browser
  cannot play tracker music).
- Information: DeusExLevelInfo's MissionLocation (the place's name), MapAuthor, startupMessage (up to 4
  lines shown when the map starts).
- Ambient light: the zone light of the map (LevelInfo's AmbientBrightness / Hue / Saturation; maps with
  ZoneInfo actors have it per zone as well).

edits['level'] = {'music': {AmbientIntroOggFile: 'x.ogg', ...}, 'info': {MissionLocation, MapAuthor,
startupMessage: [4 lines]}, 'ambient': {AmbientBrightness, AmbientHue, AmbientSaturation}}; the builds turn
it into UC_PROP lines on the map's own actors (the host's "@Class": the first actor of that class,
"@@Class": all of them) and adds a DXOggMusicInfo of its own (the map may have none).
"""
import gzip
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
CACHE = HERE / 'cache'
import sys  # noqa: E402
sys.path.insert(0, str(KIT))
import settings  # noqa: E402
import player_profiles
MUSIC_DIR = settings.REVISION / 'Music'
ROLES = [('AmbientIntroOggFile', 'Exploring: intro', 'Ambientintro'), ('AmbientOggFile', 'Exploring', 'Ambient'),
         ('CombatOggFile', 'Combat', 'Combat'), ('ConversationOggFile', 'Conversations', 'Convo'),
         ('OutroOggFile', 'Leaving the map', 'Outro|End'), ('DeathOggFile', 'Death', 'Death')]
PS2 = {'AmbientOggFile': 'PS2AmbientOggFile', 'CombatOggFile': 'PS2CombatOggFile',
       'ConversationOggFile': 'PS2ConversationOggFile', 'OutroOggFile': 'PS2OutroOggFile', 'DeathOggFile': 'PS2DeathOggFile'}
MUSIC_KEYS = [r[0] for r in ROLES] + list(PS2.values())
OGG = 'ogg_music' in settings.FEATURES
if not OGG:                                 # the original game: the map's song (LevelInfo.Song)
    ROLES = [('Song', 'Music of the map', '')]
    PS2 = {}
    MUSIC_KEYS = ['Song']
HINT = ('Revision plays a track for each moment; ▶ listens to it' if OGG else
        'Deus Ex plays the parts of one song (exploring, combat, conversations) by itself')


def music_files():
    """Every OGG of Revision's music: [{file, role}] (role guessed from the name); the original game's
    songs (.umx) with role Song."""
    if not OGG:
        return [dict(file=f.name, role='Song') for f in sorted(MUSIC_DIR.glob('*.umx'))] if MUSIC_DIR.exists() else []
    out = []
    for f in sorted(MUSIC_DIR.glob('*.ogg')) if MUSIC_DIR.exists() else []:
        role = next((key for key, _, pat in ROLES if re.search(r'_(%s)$' % pat, f.stem, re.I)), '')
        out.append(dict(file=f.name, role=role))
    return out


def parse_struct(text):
    """(A="x",B="y") -> {A: x, B: y} (strings only)."""
    return {k: v for k, v in re.findall(r'(\w+)="([^"]*)"', text or '')}


def _song_presets():
    """{map: {'Song': file.umx}}: the song of every original map of the original game, read once."""
    path = CACHE / '_music_presets_vanilla.json'
    if path.exists():
        return json.loads(path.read_text(encoding='utf-8'))
    sys.path.insert(0, str(settings.PROJECT / 'tools'))
    from ue1pkg import Pkg
    out = {}
    for f in sorted(settings.ORIGINAL_MAPS.glob('*.dx')):
        try:
            pkg = Pkg(str(f))
            info = next((i for i, e in enumerate(pkg.exports) if pkg.classname(e) == 'LevelInfo'), None)
            song = info is not None and {n: pkg.pval(v) for n, _t, _a, v in pkg.props(info + 1)}.get('Song')
        except Exception:            # a map the reader does not understand: no preset for it
            continue
        if song and (MUSIC_DIR / (str(song) + '.umx')).is_file():
            out[f.stem] = {'Song': str(song) + '.umx'}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=0), encoding='utf-8')
    return out


def presets():
    """{map: {key: file}}: the music of every original map (refs/*.t3d.gz), read once."""
    if not OGG:
        return _song_presets()
    path = CACHE / '_music_presets.json'
    if path.exists():
        return json.loads(path.read_text(encoding='utf-8'))
    out = {}
    for f in sorted((KIT / 'refs').glob('*.t3d.gz')):
        text = gzip.open(f, 'rt', encoding='latin-1', errors='replace').read()
        m = re.search(r'Begin Actor Class=DXOggMusicInfo Name=\S+\n(.*?)End Actor', text, re.S)
        mi = m and re.search(r'^\s*MusicInfo=\((.*)\)\s*$', m.group(1), re.M)
        if mi:
            out[f.name.split('.')[0]] = parse_struct(mi.group(1))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=0), encoding='utf-8')
    return out


def _block(text, cls):
    m = re.search(r'Begin Actor Class=%s Name=(\S+)\n(.*?)End Actor' % cls, text, re.S)
    return (m.group(1), m.group(2)) if m else (None, '')


def current(map_name):
    """What the map has now (the editor's last look at it, cache/<map>/scene.t3d): the names of its
    actors and its values."""
    path = CACHE / map_name / 'scene.t3d'
    text = path.read_text(encoding='latin-1', errors='replace') if path.exists() else ''
    level, lbody = _block(text, 'LevelInfo')
    dx, dbody = _block(text, 'DeusExLevelInfo')
    mus, mbody = _block(text, 'DXOggMusicInfo')
    zones = len(re.findall(r'Begin Actor Class=(?:\w*ZoneInfo|SkyZoneInfo) ', text))
    val = lambda body, key, d='': (re.search(r'^\s*%s=(.*)$' % re.escape(key), body, re.M) or [None, d])[1]
    unq = lambda v: v[1:-1] if len(v) > 1 and v[0] == '"' else v
    mi = re.search(r'^\s*MusicInfo=\((.*)\)\s*$', mbody, re.M)
    if not OGG:                         # the original game: LevelInfo's Song=Music'Name.Name'
        song = re.search(r"^\s*Song=Music'(\w+)\.\w+'", lbody, re.M)
        mus, mi = (level if song else None), None
    info = dict(MissionLocation=unq(val(dbody, 'MissionLocation')), MapAuthor=unq(val(dbody, 'MapAuthor')),
                startupMessage=[unq(val(dbody, 'startupMessage(%d)' % i)) for i in range(4)])
    ambient = dict(AmbientBrightness=int(val(lbody, 'AmbientBrightness', '0') or 0), AmbientHue=int(val(lbody, 'AmbientHue', '0') or 0),
                   AmbientSaturation=int(val(lbody, 'AmbientSaturation', '255') or 255))
    music = parse_struct(mi.group(1)) if mi else {}
    if not OGG:
        music = {'Song': song.group(1) + '.umx'} if song else {}
    return dict(names=dict(level=level, dx=dx, music=mus), music=music,
                info=info, ambient=ambient, zones=zones)


def _q(s):
    return '"%s"' % str(s).replace('"', "'")


def commands(edits, map_name):
    """(UC_PROP lines, actor blocks to add [{cls, name, loc, props}], package loads) for edits['level']."""
    lv = edits.get('level') or {}
    player_blocks = player_profiles.blocks(edits)
    if not lv:
        return [], player_blocks, []
    cur = current(map_name)
    names = cur['names']
    cmds, blocks, loads = [], player_blocks, []
    music = {k: v for k, v in (lv.get('music') or {}).items() if k in MUSIC_KEYS and re.fullmatch(r'[\w .-]*', v or '')}
    if lv.get('music') is not None and not OGG:
        song = Path(music.get('Song') or '').stem
        if song and (MUSIC_DIR / (song + '.umx')).is_file():
            loads.append('OBJ LOAD FILE="%s.umx"' % song)
            cmds.append("UC_PROP @LevelInfo Song Music'%s.%s'" % (song, song))
        else:
            cmds.append('UC_PROP @LevelInfo Song None')
    elif lv.get('music') is not None:
        struct = '(%s)' % ','.join('%s=%s' % (k, _q(music.get(k, ''))) for k in MUSIC_KEYS)
        # a music actor of ours (the map may have none: a new map, a script map), and every music actor
        # of the map gets the same tracks (Revision takes them from any of them)
        loads.append('OBJ LOAD FILE="DXOgg.u"')
        blocks.append(dict(cls='DXOggMusicInfo', name='UCMusicInfo', loc=[0, 0, 0], props={'MusicInfo': struct}))
        cmds.append('UC_PROP @@DXOggMusicInfo MusicInfo %s' % struct)
    info = lv.get('info') or {}
    if info and names['dx']:
        plain = lambda t: re.sub(r'[\r\n"]+', ' ', str(t or '')).strip()     # UC_PROP takes a string as it is
        for key in ('MissionLocation', 'MapAuthor'):
            if key in info:
                cmds.append('UC_PROP @DeusExLevelInfo %s %s' % (key, plain(info[key])))
        for i, line in enumerate((info.get('startupMessage') or [])[:4]):
            cmds.append('UC_PROP @DeusExLevelInfo startupMessage(%d) %s' % (i, plain(line)))
    amb = lv.get('ambient') or {}
    if amb:
        for key in ('AmbientBrightness', 'AmbientHue', 'AmbientSaturation'):
            if key in amb:
                cmds.append('UC_PROP @LevelInfo %s %d' % (key, max(0, min(255, int(amb[key])))))
    return cmds, blocks, loads


def report(edits):
    lv = edits.get('level') or {}
    out = []
    if lv.get('music') is not None:
        out.append('  EDIT music: %s' % (lv['music'].get('AmbientOggFile') or lv['music'].get('Song') or 'none'))
    if lv.get('info'):
        out.append('  EDIT map information: %s' % (lv['info'].get('MissionLocation') or ''))
    if lv.get('ambient'):
        out.append('  EDIT ambient light: %s' % lv['ambient'])
    return out
