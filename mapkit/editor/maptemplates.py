"""Map templates (as Unity's scene templates): File > Save map as template... keeps the open map's place in the project
to start new maps from, with a picture of the 3D view and a description; New map shows them as tiles beside An empty
room and A copy of a map, and deletes them.

A template is a folder of the project beside the maps, tools/mapkit/maps/templates/<id>/:
    template.json  {version, id, name, description, created, source (the map it was made from), base, edits}
    thumb.jpg      the 3D view when it was saved, without the editor's marks
    textures/      the pictures imported into that map (textures/<map>/) that its edits name
    <map>.dx       the map it is made on, when that map has no room script of its own (a copy, an imported map)
base: {'room': {size, textures, mood}}: the room of a map made with New map > An empty room (newmap.room_of), made
      again by create_empty; or {'map': '<map>.dx'}: that file, copied as New map > A copy of a map copies one.
A map made from a template is a new map: its own name, mission and place name, its base, the template's edits (the
names of the things in it stay: they are the new map's own) with the pictures copied into its own folder; a map exit
that led into the old map leads into the new one (a Teleporter's URL, a MapExit's DestMap, set in Properties or in All
properties).

What a template keeps of a map's edits and what it leaves out is data: KEEP, DROP, LEVEL_DROP and PROPS_DROP (a field
in neither is left out: tests/test_maptemplates.py asks for every field the editor writes to be in one of them).
"""
import base64
import copy
import json
import os
import re
import shutil
import time
from pathlib import Path

import atomicfile
import cutscenes
import dxmaps
import maplinks
import newmap
import props
import textures

VERSION = 1
PICTURE = 'thumb.jpg'
MAX_PICTURE = 8 * 1024 * 1024
ID = re.compile(r'\d{8}-\d{6}-[A-Za-z0-9_]{1,48}')          # <stamp>-<name, 40 at most>[_<n>]

# what a template keeps of a map's edits: the place
KEEP = {
    'boxes': 'the blocks (holes, zone portals and water too)',
    'drawn': 'the walls, roads, floors, ceilings, stairs and roofs drawn',
    'added': 'the objects placed: lights, decorations, pickups, the start, map exits, zones, sounds (not the characters)',
    'prefabs': 'the structures pasted from the Pieces and from other maps',
    'copies': "the copies of the map's own structures",
    'groups': "the map's own structures moved or deleted",
    'moved': "the map's own objects moved",
    'deleted': "the map's own objects deleted",
    'disabled': 'objects that are off in the game',
    'props': "the properties set (not the Story's names: PROPS_DROP)",
    'rawprops': 'All properties',
    'textures': 'the pictures imported (their files are copied with the template)',
    'retexture': 'what wears them',
    'surfaces': 'the textures and alignment of faces',
    'level': "Map settings, the sky and the time of day (not the old place's own words: LEVEL_DROP)",
    'motions': 'objects that move (Animation)',
    'anims': 'what objects do when idle',
    'player_move': 'how JC moves in the map',
    'paths': 'whether a Rebuild makes the AI paths again',
    'nests': 'folders', 'unnest': 'structures taken apart', 'order': "the Hierarchy's order",
    'defaultFolder': 'the folder new objects go in',
}
# ... and what it leaves out: the old map's story and logic, which name its characters, flags and conversations, and
# what the editor makes again
DROP = {
    'links': "Interactions: rules about the old map's objects, its flags and its goals",
    'usable': 'objects JC uses for an interaction',
    'objectTags': "the interactions' scripting tags",
    'cutscenes': "cutscenes: they film the old map's characters and say its lines (their cameras go too)",
    'texts': "computers' emails and bulletins: the story's words",
    'documents': 'the texts of books, newspapers and data cubes',
    'behave': "the characters' tactics",
    'fxpreview': "the preview of the interactions' effects",
    'navmesh': 'the walkable area: made again before every Rebuild',
}
# Map settings that are the old place's own: the new map has its own place name (New map) and opening lines
LEVEL_DROP = {'info': ('MissionLocation', 'startupMessage')}
# properties that bind an object to the old map's Story: its conversations find their speakers by this name
PROPS_DROP = ('BindName',)
# properties that point a computer at the texts left out with edits['texts'] (app.js editTexts): the editor's package
# holds its emails, the old map's list of bulletins its bulletins
TEXTS_PROPS = ('TextPackage', 'bulletinTag')
# the properties of a map exit that say where it leads (as newmap.copy_bytes has them): a Teleporter's URL, a bare value
# a tag inside the map (False), and a MapExit's DestMap, a bare value a map (True)
EXITS = {'URL': False, 'DestMap': True}
# the edits by object name, where what is left out with its object goes too
NAMED = ('props', 'rawprops', 'disabled', 'motions', 'anims')


def root():
    return newmap.maps_folder() / 'templates'


def _left_out(actor):
    """A placed object a template leaves out: a character (it carries the old map's story: conversations, orders,
    patrols) or a cutscene's camera."""
    if cutscenes.is_camera(actor):
        return True
    cls = str(actor.get('cls', ''))
    return cls != 'PlayerStart' and (actor.get('kind') == 'pawn' or props.is_a(cls, 'ScriptedPawn', log=lambda *a: None) is True)


def _unbind(values, keys=PROPS_DROP):
    """An object's properties without the Story's names (PROPS_DROP), or without those keys."""
    if isinstance(values, dict):
        for key in keys:
            values.pop(key, None)


def place_of(edits):
    """A template's edits from a map's: KEEP's fields, without the characters and cutscene cameras (and what is theirs),
    the Story's names and the old place's own words."""
    if not isinstance(edits, dict):
        raise ValueError('Invalid map edits.')
    out = {k: copy.deepcopy(v) for k, v in edits.items() if k in KEEP}
    added = [a for a in out.get('added') or [] if isinstance(a, dict)]
    gone = {a.get('name') for a in added if _left_out(a)}
    out['added'] = [a for a in added if a.get('name') not in gone]
    for a in out['added']:
        a.pop('bind', None)
        _unbind(a.get('props'))
    for field in NAMED:
        if isinstance(out.get(field), dict):
            out[field] = {name: v for name, v in out[field].items() if name not in gone}
    for field in ('props', 'rawprops'):
        for values in (out.get(field) or {}).values():
            _unbind(values)
    texted = set(edits.get('texts') or {}) if isinstance(edits.get('texts'), dict) else set()
    for values in [(out.get('props') or {}).get(name) for name in texted] + [a.get('props') for a in out['added'] if a.get('name') in texted]:
        _unbind(values, TEXTS_PROPS)
    keys = {'a:%s' % name for name in gone}
    if isinstance(out.get('nests'), list):
        out['nests'] = [dict(n, items=[k for k in n.get('items') or [] if k not in keys]) for n in out['nests'] if isinstance(n, dict)]
    if isinstance(out.get('order'), list):
        out['order'] = [k for k in out['order'] if k not in keys]
    if isinstance(out.get('retexture'), list):
        out['retexture'] = [r for r in out['retexture'] if not (isinstance(r, dict) and r.get('kind') == 'actor' and r.get('name') in gone)]
    for part, names in LEVEL_DROP.items():
        own = (out.get('level') or {}).get(part)
        if isinstance(own, dict):
            for name in names:
                own.pop(name, None)
    return out


def _base(source):
    """What a map is made on: ({'room': room}, None) for a room New map made, ({'map': file name}, its .dx) for a map
    file (kept under its own name: the copy loads it as that map)."""
    source = Path(source)
    if source.suffix.lower() == '.dx':
        return {'map': source.name}, source
    room = newmap.room_of(source.read_text(encoding='utf-8'))
    if room is None:
        raise ValueError('This map is made by a map script of its own: only maps made with New map (an empty room or '
                         'a copy of a map) and maps of the project can be templates.')
    return {'room': room}, None


def _picture(data_url):
    """The picture of a template (a JPEG data URL of the 3D view), b'' for none."""
    if not data_url:
        return b''
    prefix = 'data:image/jpeg;base64,'
    if not isinstance(data_url, str) or not data_url.startswith(prefix):
        raise ValueError('The picture of a template is a JPEG of the 3D view.')
    raw = base64.b64decode(data_url[len(prefix):], validate=True)
    if not raw.startswith(b'\xff\xd8') or len(raw) > MAX_PICTURE:
        raise ValueError('The picture of the template is not a JPEG of at most 8 MB.')
    return raw


def _text(value, most, what):
    """A template's name (one line, not empty) or its description, at most `most` characters."""
    text =' '.join(str(value or '').split()) if what == 'name' else str(value or '').strip()
    if what == 'name' and not text:
        raise ValueError('Give the template a name.')
    if len(text) > most:
        raise ValueError('The %s of a template is at most %d characters.' % (what, most))
    return text


def _plain(path):
    """A folder or file of its own: not a link or a junction (never delete through one: Python 3.10 sees a junction as a
    folder)."""
    try:
        return not (os.lstat(path).st_file_attributes & 0x400)      # FILE_ATTRIBUTE_REPARSE_POINT
    except AttributeError:
        return not Path(path).is_symlink()


def _own_pictures(edits, map_name):
    """The files of the pictures the edits name, in textures/<map>/: [(entry, [files])]."""
    folder = textures.ROOT / map_name
    out = []
    for name, t in sorted((edits.get('textures') or {}).items()):
        if not isinstance(t, dict) or not re.fullmatch(r'[\w-]{1,64}', str(name)):
            continue
        files = [folder / (name + ext) for ext in ('.pcx', '.png', textures.PROJECT_SUFFIX)]
        out.append((t, [f for f in files if f.is_file()]))
    return out


def save(map_name, source, name, description='', picture='', edits=None, check=None):
    """Keep a map as a template: source is what it is made from (its script, or its .dx); check refuses edits the
    editor would not save (server.check_edits). Returns the template's entry (listing)."""
    name, description = _text(name, 80, 'name'), _text(description, 2000, 'description')
    base, base_file = _base(source)
    kept = place_of(edits)
    if check:
        check(kept)
    jpeg = _picture(picture)
    slug = re.sub(r'[^A-Za-z0-9]+', '_', name).strip('_')[:40] or 'Map'
    stamp, n = time.strftime('%Y%m%d-%H%M%S'), 1
    root().mkdir(parents=True, exist_ok=True)
    while True:
        tid = '%s-%s%s' % (stamp, slug, '' if n == 1 else '_%d' % n)
        try:
            (root() / tid).mkdir()
            break
        except FileExistsError:
            n += 1
    folder = root() / tid
    try:
        for t, files in _own_pictures(kept, map_name):
            (folder / 'textures').mkdir(exist_ok=True)
            for f in files:
                shutil.copy2(f, folder / 'textures' / f.name)
            t['pcx'], t['png'] = Path(t.get('pcx', '')).name, Path(t.get('png', '')).name
        if base_file:
            shutil.copy2(base_file, folder / base_file.name)
        if jpeg:
            (folder / PICTURE).write_bytes(jpeg)
        atomicfile.write_json(folder / 'template.json', dict(
            version=VERSION, id=tid, name=name, description=description, created=time.strftime('%Y-%m-%d %H:%M'),
            source=map_name, base=base, edits=kept))
    except BaseException:
        _remove(folder)
        raise
    return next(t for t in listing() if t['id'] == tid)


def _folder(tid):
    folder = root() / str(tid)
    if not isinstance(tid, str) or not ID.fullmatch(tid) or not (folder / 'template.json').is_file() or not _plain(folder):
        raise ValueError('There is no such map template.')
    return folder


def load(tid):
    return json.loads((_folder(tid) / 'template.json').read_text(encoding='utf-8'))


def listing():
    """The project's templates for New map's tiles, by name: {id, name, description, created, source, room (or None:
    a copy of a map), picture (its url, '' for none)}."""
    out = []
    for path in sorted(root().glob('*/template.json')) if root().is_dir() else []:
        try:
            t = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        if not isinstance(t, dict) or t.get('id') != path.parent.name or not ID.fullmatch(path.parent.name):
            continue
        thumb = path.parent / PICTURE
        out.append(dict(id=t['id'], name=t.get('name') or t['id'], description=t.get('description') or '',
                        created=t.get('created') or '', source=t.get('source') or '', room=(t.get('base') or {}).get('room'),
                        picture='/map_templates/%s/%s?v=%d' % (t['id'], PICTURE, thumb.stat().st_mtime_ns) if thumb.is_file() else ''))
    return sorted(out, key=lambda t: t['name'].casefold())


def picture_file(rel):
    """The file of a template's picture (/map_templates/<id>/thumb.jpg)."""
    parts = Path(rel).parts
    if len(parts) != 2 or parts[1] != PICTURE:
        raise ValueError('There is no such picture.')
    return _folder(parts[0]) / PICTURE


def _remove(folder):
    """A template's folder out of the project: its own files, one by one, never through a link."""
    pictures = folder / 'textures'
    for sub in (pictures, folder):
        if not sub.is_dir() or not _plain(sub):
            continue
        for f in sub.iterdir():
            if f.is_file() and _plain(f):
                f.unlink()
        sub.rmdir()


def delete(tid):
    _remove(_folder(tid))


def _into(url, old, new, bare_map=False):
    """A map exit's URL into the old map, made to lead into the new one (as copy_bytes does for a copied map's own); a
    bare value is a tag inside the map (a Teleporter's URL), or a map when bare_map (a MapExit's DestMap)."""
    raw = str(url or '')
    text = raw.strip('"')
    if '#' not in text and '/' not in text and not bare_map:
        return url
    destination, _tag = maplinks.split_url(text)
    if destination.casefold() != str(old).casefold():
        return url
    moved = new + text[len(destination):]
    return '"%s"' % moved if raw.startswith('"') else moved


def _for_map(edits, folder, old, new):
    """The template's edits in the new map: its pictures copied into the map's own folder (textures/<new>/, which
    must not have pictures of those names), exits into the old map into the new one. Returns the files copied."""
    target, copied = textures.ROOT / new, []
    try:
        for t in (edits.get('textures') or {}).values():
            if not isinstance(t, dict):
                continue
            for field in ('pcx', 'png'):
                if t.get(field):
                    t[field] = '%s/%s' % (new, Path(t[field]).name)
        for f in sorted((folder / 'textures').glob('*')) if (folder / 'textures').is_dir() else []:
            target.mkdir(parents=True, exist_ok=True)
            with (target / f.name).open('xb') as out:
                copied.append(target / f.name)
                out.write(f.read_bytes())
    except BaseException:
        _forget(copied, target)
        raise
    named = [v for field in ('props', 'rawprops') for v in (edits.get(field) or {}).values()]
    for values in [a.get('props') for a in edits.get('added') or []] + named:
        for prop, bare_map in EXITS.items():
            if isinstance(values, dict) and values.get(prop):
                values[prop] = _into(values[prop], old, new, bare_map)
    return copied


def _forget(copied, target):
    for f in copied:
        f.unlink(missing_ok=True)
    if target.is_dir() and _plain(target) and not any(target.iterdir()):
        target.rmdir()


def create(tid, name, mission, location='', build=None):
    """A new map from a template: (script, map, ok, lines). A room is made (newmap.create_empty) and built now (build:
    the server's); a map file is copied (newmap.copy_bytes, publish) and opens with the edits to Rebuild. A map whose
    making fails leaves nothing behind (its script, its edits, its pictures)."""
    t = load(tid)
    folder, edits, room = _folder(tid), copy.deepcopy(t.get('edits') or {}), (t.get('base') or {}).get('room')
    if room:
        script, new = newmap.create_empty(name, mission, room['size'], location, room['textures'], mood=room['mood'])
        target = newmap.maps_folder() / (script + '.edits.json')
    else:
        new = newmap.free_name(mission, name)
        base = folder / Path(str(t['base']['map'])).name
        script, new = newmap.publish(newmap.copy_bytes(base, new, mission=mission, location=location), new)
        target = dxmaps.edits_path(new)
    copied = []
    try:
        copied = _for_map(edits, folder, t.get('source') or '', new)
        atomicfile.write_json(target, edits)
        ok, lines = build(script) if room and build else (True, [])
    except BaseException:
        _discard(script, new, room, target, copied)
        raise
    if not ok:
        _discard(script, new, room, target, copied)
    return script, new, ok, ['made from the template %s' % t.get('name')] + list(lines)


def _discard(script, new, room, edits_file, copied):
    if room:
        newmap.discard(script)
    else:
        (dxmaps.MOD_MAPS / (new + '.dx')).unlink(missing_ok=True)
    edits_file.unlink(missing_ok=True)
    _forget(copied, textures.ROOT / new)
