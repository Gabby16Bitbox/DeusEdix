"""Packages of other mods in the map editor (the Packages panel): their actor classes in the palette, with
their 3D models and Properties, placed and built like any object of the game. The editor's engine loads
them at startup (kit.py: EditPackages of every run); the list is tools/mapkit/packages.json.

The game must find them too to play a map that uses them: a package in the game's System folders is
found; one kept elsewhere is only linked into the editor's runs (copy it next to the game's packages).
"""
import json
import re
from pathlib import Path

import kit
import settings

HERE = Path(__file__).resolve().parent
GAME = settings.GAME
FOLDERS = list(settings.SYSTEM_DIRS) + [kit.DEV]      # the targeted game's (the original game never reads Revision's)
# loaded anyway: the engine, the game, Revision, this mod (and what they use)
BASE = set(kit.EDIT_PACKAGES) | {settings.PACKAGE, 'UnatcoVoices', settings.ANIMS_PACKAGE, 'RevisionMission', 'RevisionPawn',
                                 'RevisionDeco', 'DeusExCharacters', 'DeusExDeco', 'DeusExItems', 'DeusExSounds'}
# conversations, voices, texts, translations, network: no objects to place
NOISE = re.compile(r'Conversations|ConAudio|ConText|Text$|^F[A-Z]|^(IpDrv|IpServer|UBrowser|UWindow|EngineI|DXOgg|RF|RevisionUI)$')
CACHES = [HERE / 'cache' / '_classes.json', HERE / 'cache' / '_palette' / 'classes.json', HERE / 'cache' / '_palette' / 'defaults.json']


def found():
    """{name: folder} of every package the game can load."""
    out = {}
    for d in FOLDERS:
        if d.is_dir():
            for f in d.glob('*.u'):
                out.setdefault(f.stem, str(d))
    return out


def listing():
    """The panel: the packages of the game's folders that can be added, the ones added, how many objects
    of each one are in the palette."""
    import data
    extra = kit.extra_packages()
    counts = {}
    try:
        for c in data.catalog(log=lambda *a: None):
            counts[c['pkg']] = counts.get(c['pkg'], 0) + 1
    except Exception:
        pass
    have = found()
    names = {p['name'] for p in extra}
    rows = [dict(name=n, folder=d, on=n in names, objects=counts.get(n, 0)) for n, d in sorted(have.items(), key=lambda x: x[0].lower())
            if n not in BASE and not NOISE.search(n)]
    for p in extra:
        if p['name'] not in have:
            rows.append(dict(name=p['name'], folder=str(Path(p['path']).parent) if p.get('path') else '(not found)',
                             on=True, objects=counts.get(p['name'], 0), outside=True, path=p.get('path') or ''))
    for row in rows:                # the packages in use: which game they are made for, and do they load here
        if row['on']:
            row.update(_game(Path(row['path']) if row.get('path') else Path(row['folder']) / (row['name'] + '.u')))
    return dict(packages=rows, loaded=sorted((n for n in counts if n not in names), key=str.lower), counts=counts)


def _game(path):
    """{'game': 'vanilla' | 'revision' | 'other', 'loads': bool, 'note': ...} of a package (gamecheck)."""
    import gamecheck
    try:
        r = gamecheck.report(path, own=gamecheck.own_packages())
    except (OSError, ValueError, IndexError) as exc:
        return dict(game='other', loads=False, note='Cannot read it: %s' % exc)
    return dict(game=r['made_for'], loads=r['loads'], note='' if r['loads'] else r['message'])


def save(extra):
    """extra: [{'name', 'path'}]. Checked, written, and the class caches made again at the next use. A
    package this project's game cannot load (made for Revision, in a project of the original game) is
    refused: every editor session would fail to start with it."""
    have = found()
    old = {p['name'] for p in kit.extra_packages()}
    clean = []
    for p in extra or []:
        path = str(p.get('path') or '').strip().strip('"')
        name = Path(path).stem if path else str(p.get('name') or '').strip()
        if not re.fullmatch(r'\w+', name) or name in kit.EDIT_PACKAGES or any(x['name'] == name for x in clean):
            continue
        if path and not Path(path).is_file():
            raise ValueError('no file %s' % path)
        if not path and name not in have:
            raise ValueError('the game has no package %s (put the .u file in its System folder, or give its path)' % name)
        clean.append(dict(name=name, path='' if name in have and Path(path or 'x.u').suffix.lower() == '.u' else path))
    for p in clean:
        if p['name'] in old:
            continue
        game = _game(Path(p['path']) if p['path'] else Path(have[p['name']]) / (p['name'] + '.u'))
        if not game['loads']:
            raise ValueError('%s: %s' % (p['name'], game['note']))
    kit.PACKAGES_FILE.write_text(json.dumps(dict(extra=clean), indent=1), encoding='utf-8')
    for f in CACHES:
        f.unlink(missing_ok=True)
    return clean
