"""Map picker metadata and importing a .dx into the project's own maps folder."""
import json
import re
import shutil
import struct
import tempfile
from pathlib import Path

import dxmaps
import settings
import ue1pkg

MAX_IMPORT = 128 * 1024 * 1024


def display_name(name):
    words = re.sub(r'^\d+_', '', name).replace('_', ' ')
    words = re.sub(r'([a-z])([A-Z])|([A-Z])([A-Z][a-z])', lambda m: (m[1] + ' ' + m[2]) if m[1] else (m[3] + ' ' + m[4]), words)
    return words.replace('NYC ', 'New York · ').replace('UNATCOHQ', 'UNATCO HQ')


def describe(maps):
    result = []
    for entry in maps:
        m = dict(entry)
        name = m['map']
        edits_name = name if m['kind'] != 'script' else m['script']
        edits = dxmaps.KIT / 'maps' / (edits_name + '.edits.json')
        try:
            changed = any(json.loads(edits.read_text(encoding='utf-8')).values())
        except (OSError, ValueError):
            changed = False
        built = dxmaps.OUT / (name + '.dx')
        installed = dxmaps.MOD_MAPS / (name + '.dx')
        if built.exists() and (not installed.exists() or built.stat().st_mtime_ns > installed.stat().st_mtime_ns):
            changed = True
        m.update(label=display_name(name), mission=int(name[:2]) if re.match(r'^\d\d_', name) else None,
                 changed=changed)
        result.append(m)
    return result


def convert_import(filename, raw):
    """A map made for Revision, as a converted copy for the original game (editor/convert.py), imported
    like any other map. The upload is only read; the conversion works on a private copy."""
    import convert
    name = str(filename or '')
    _new_name(name)          # a taken name fails now, not after a minute of conversion
    if not 36 <= len(raw) <= MAX_IMPORT:
        raise ValueError('Choose a valid Deus Ex map, no larger than 128 MB.')
    (dxmaps.KIT / 'runs').mkdir(parents=True, exist_ok=True)
    folder = Path(tempfile.mkdtemp(prefix='convert-', dir=str(dxmaps.KIT / 'runs')))
    try:
        source = folder / name
        source.write_bytes(raw)
        converted, report = convert.revision_to_vanilla(source, name[:-3], log=lambda *a: None)
    finally:
        shutil.rmtree(folder, ignore_errors=True)
    result = import_map(name, converted)
    result['conversion'] = {k: report.get(k) for k in ('replaced_classes', 'cleared_references', 'retextured', 'removed',
                                                       'song', 'script', 'warnings', 'actors_before', 'actors_after')}
    return result


def _new_name(name):
    """The stem of a new map's file name, refused when it is invalid or already taken."""
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_-]{0,63}\.dx', name, re.I):
        raise ValueError('Use a .dx name with up to 64 letters, numbers, underscores or hyphens (no folders).')
    stem = name[:-3]
    if re.fullmatch(r'CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]', stem, re.I):
        raise ValueError('That filename is reserved by Windows. Choose another name.')
    existing = dxmaps.script_maps()
    directories = (dxmaps.MOD_MAPS, dxmaps.OUT) if dxmaps.isolated_project() else (dxmaps.MOD_MAPS, dxmaps.GAME_MAPS, dxmaps.OUT)
    for directory in directories:
        existing.update(p.stem for p in directory.glob('*.dx'))
    existing.update(p.name[:-len('.edits.json')] for p in (dxmaps.KIT / 'maps').glob('*.edits.json'))
    if stem.casefold() in {s.casefold() for s in existing}:
        raise FileExistsError('A map named %s already exists. Choose a different copy name.' % stem)
    return stem


def import_map(filename, raw):
    """Validate before creating a new file; collisions never overwrite a map or its edits."""
    name = str(filename or '')
    stem = _new_name(name)
    if not 36 <= len(raw) <= MAX_IMPORT:
        raise ValueError('Choose a valid Deus Ex map, no larger than 128 MB.')
    tag, version, _, nn, no, ne, eo, ni, io = struct.unpack_from('<9I', raw)
    if tag != 0x9E2A83C1 or (version & 0xffff) not in (68, 69):
        raise ValueError('This is not a supported Deus Ex .dx package (version 68 or 69).')
    if not nn or not ne or any(count > len(raw) or offset >= len(raw)
                               for count, offset in ((nn, no), (ne, eo), (ni, io))):
        raise ValueError('The map package is incomplete or damaged.')
    folder = dxmaps.MOD_MAPS.resolve()
    game = settings.GAME.resolve()
    if folder == game or game in folder.parents:
        raise ValueError('The project maps folder must be outside the original game folder.')
    folder.mkdir(parents=True, exist_ok=True)
    # The existing package reader checks the export table, without loading anything in the engine.
    with tempfile.NamedTemporaryFile(dir=folder, suffix='.import', delete=False) as f:
        temporary = Path(f.name)
        f.write(raw)
    try:
        try:
            pkg = ue1pkg.Pkg(str(temporary))
            if any(e['size'] < 0 or e['off'] + e['size'] > len(raw) for e in pkg.exports):
                raise ValueError('truncated export')
            if not any(pkg.classname(e) == 'Level' for e in pkg.exports):
                raise ValueError('no level')
        except Exception as exc:
            raise ValueError('This package is damaged or does not contain a map level.') from exc
        # made for this project's game? (a Revision map in a project of the original game cannot load)
        import gamecheck
        game = gamecheck.report(temporary, own=gamecheck.own_packages())
        if not game['loads']:
            hint = (' Open it in a project made for Deus Ex: Revision, or convert a copy for the original game.'
                    if game['made_for'] == 'revision' and settings.TARGET == 'vanilla' else '')
            raise ValueError(game['message'] + hint)
        target = folder / (stem + '.dx')
        if dxmaps.isolated_project():
            import newmap
            raw = newmap.copy_bytes(temporary, stem)
        # Exclusive creation also protects against another import that raced the name check.
        with target.open('xb') as out:
            try:
                out.write(raw)
            except Exception:
                out.close()
                target.unlink(missing_ok=True)
                raise
        return dict(ok=True, script=dxmaps.PREFIX + stem, map=stem, madeFor=game['made_for'])
    finally:
        temporary.unlink(missing_ok=True)
