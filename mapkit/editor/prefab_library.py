"""Project-local reusable snapshots of rebuilt structures, lights and scenery.

The server must check draft/build/cache freshness before save(). This module never
runs the engine or changes a map: it publishes one immutable, ordinary prefab
compatible with prefabs.place() and the existing placement preview.

A prefab has versions (Unity's linked prefabs): each one an immutable bundle of its own (prefabs/usr_<id>), its
library.json naming the prefab it belongs to (line: the id of its first version) and its number (revision). A placed
copy names the version it places (edits.prefabs[].prefab, read again by every build) and stays linked to the prefab:
Update instances moves it to the newest version, Apply to prefab (new_version) saves a copy back as a new version. The
library lists each prefab once, by its newest version. Its picture (thumb.jpg) is kept with its first version. A
deleted prefab's versions stay on disk, hidden (retired): copies are built from them, and the page's Undo, its clipboard
or another tab may place one again. They go when the project is opened again and nothing saved places them (sweep).
"""
import base64
import functools
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tempfile
import uuid

import atomicfile
import classes
import prefabs
import settings
import t3d

ROOT = prefabs.ROOT
_ID = re.compile(r'usr_[a-f0-9]{32}')
_NAME = re.compile(r'[A-Za-z_][A-Za-z0-9_]*')
_MAP = re.compile(r'[A-Za-z0-9_][A-Za-z0-9_-]{0,127}')
_MAX_BLOCKS = 4096
_MAX_BYTES = 64 * 1024 * 1024
_PID = re.compile(r'[A-Za-z0-9_]{1,40}')
_PLACE = ('offset', 'yaw', 'pitch', 'roll', 'scale', 'stretch')     # where an edits.prefabs entry puts its copy
THUMB = 'thumb.jpg'                   # a prefab's picture (its card in the Prefabs browser), with its first version
MAX_THUMB = 2 * 1024 * 1024
MAPS = prefabs.KIT / 'maps'           # the project's map edits and map templates: what places the prefabs


def _safe(root, path):
    root, path = Path(root).absolute(), Path(path).absolute()
    if path != root and not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('Prefab assets must stay inside their project folder.')
    for part in (path, *path.parents):
        if part.exists() or part.is_symlink():
            if part.is_symlink() or getattr(os.lstat(part), 'st_file_attributes', 0) & 0x400:
                raise ValueError('Prefab assets cannot follow linked files or folders.')
        if part == root:
            break
    return path


def _read_json(root, name):
    path = _safe(root, Path(root) / name)
    if not path.is_file() or path.stat().st_size > _MAX_BYTES:
        raise ValueError('Rebuild and reopen the map: its prefab snapshot data is missing or too large (%s).' % name)
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        raise ValueError('Cannot read prefab snapshot data: %s.' % name) from exc


def _names(selection, key):
    value = selection.get(key, [])
    if (not isinstance(value, list) or len(value) > _MAX_BLOCKS or
            any(not isinstance(name, str) or not name or len(name) > 256 or any(ord(c) < 32 for c in name) for name in value)):
        raise ValueError('Invalid prefab selection: %s.' % key)
    return list(dict.fromkeys(value))


def _scenery(actor):
    cls = actor['cls'].split('.')[-1]
    tree = classes.tree()
    if tree.is_a(cls, 'Mover') or ('Mover' in cls and cls not in tree) or prefabs.STORY.search(cls):
        return False
    # by the parents: a class-name substring alone misses pawns such as ScientistFemale
    return tree.is_a(cls, 'Light', 'Decoration') or cls in {'UCMeshDeco'}


def _vector(value, length, context):
    if (not isinstance(value, (list, tuple)) or len(value) != length or
            any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in value)):
        raise ValueError('Invalid geometry in prefab snapshot: %s.' % context)
    return value


def _select(selection, structures, brushes, actors):
    if not isinstance(selection, dict) or set(selection) - {'structures', 'actors', 'boxes'}:
        raise ValueError('Choose structures, scenery or rebuilt blocks for the prefab.')
    structure_names, actor_names, box_names = (_names(selection, key) for key in ('structures', 'actors', 'boxes'))
    if not structure_names and not actor_names and not box_names:
        raise ValueError('Select something to save as a prefab first.')
    if not isinstance(structures, dict) or not isinstance(brushes, list):
        raise ValueError('Rebuild and reopen the map before saving this prefab.')
    wanted, brush_names = set(actor_names), set()
    for name in structure_names:
        st = structures.get(name)
        if not isinstance(st, dict):
            raise ValueError('Structure %s is not in this rebuilt map. Rebuild and reopen it first.' % name)
        for raw in st.get('brush_names') or []:
            if not isinstance(raw, str):
                raise ValueError('Invalid brush names in structure %s.' % name)
            brush_names.add(raw)
        for ordinal in st.get('brushes') or []:
            if isinstance(ordinal, bool) or not isinstance(ordinal, int) or not 0 <= ordinal < len(brushes):
                raise ValueError('A brush of %s is missing. Rebuild and reopen the map first.' % name)
            brush_names.add(brushes[ordinal]['name'])
        members = st.get('actors') or []
        if not isinstance(members, list) or any(not isinstance(member, str) for member in members):
            raise ValueError('Invalid actor names in structure %s.' % name)
        wanted.update(members)
    for name in box_names:
        if name not in actors or actors[name]['cls'].split('.')[-1] != 'Brush':
            raise ValueError('Block %s has no stable rebuilt brush identity. This block type cannot yet be saved; select its rebuilt structure instead.' % name)
        brush_names.add(name)
    wanted.update(brush_names)
    if not wanted or len(wanted) > _MAX_BLOCKS:
        raise ValueError('Choose a prefab containing between 1 and %d rebuilt objects.' % _MAX_BLOCKS)
    missing = wanted - actors.keys()
    if missing:
        raise ValueError('Selected objects are missing from the rebuilt map: %s. Rebuild and reopen it first.' % ', '.join(sorted(missing)[:6]))
    if any(actors[name]['cls'].split('.')[-1] != 'Brush' for name in brush_names):
        raise ValueError('A selected structure contains a mover or an invalid brush identity. No prefab was saved.')
    return wanted, brush_names, dict(structures=len(structure_names), boxes=len(box_names))


def _preview(geo, meshes, selected, brush_names, actors):
    groups, points = [], []
    faces = geo.get('faces') or []
    for group in geo.get('groups') or []:
        pos, uv = group.get('pos') or [], group.get('uv') or []
        if len(pos) % 9 or len(uv) != len(pos) // 3 * 2:
            raise ValueError('Invalid triangle data in the prefab preview. Rebuild and reopen the map.')
        ids = group.get('faces') or []
        if len(ids) != len(pos) // 9:
            raise ValueError('The preview is older than brush selection. Rebuild and reopen the map.')
        use = []
        for i, face in enumerate(ids):
            if isinstance(face, int) and 0 <= face < len(faces) and faces[face].get('brush') in brush_names:
                use.append(i)
        if not use:
            continue
        copied = dict(tex=group['tex'], flags=group.get('flags', 0), pos=[], uv=[], uvFrames=[])
        for i in use:
            copied['pos'].extend(pos[i * 9:i * 9 + 9])
            copied['uv'].extend(uv[i * 6:i * 6 + 6])
            frames = group.get('uvFrames', [])
            copied['uvFrames'].append(frames[i] if i < len(frames) else None)
        groups.append(copied)
    for name in selected - brush_names:
        actor, mesh = actors[name], meshes.get(name) or {}
        rotation = t3d.rot(actor['props'].get('Rotation'))
        location = t3d.vec(actor['props'].get('Location'))
        for part in mesh.get('parts') or []:
            pos, uv = part.get('pos') or [], part.get('uv') or []
            if len(pos) % 9 or len(uv) != len(pos) // 3 * 2:
                raise ValueError('Invalid mesh preview for %s.' % name)
            transformed = []
            for i in range(0, len(pos), 3):
                p = t3d._rotate(_vector(pos[i:i + 3], 3, name), rotation)
                transformed.extend(p[k] + location[k] for k in range(3))
            groups.append(dict(tex=part['tex'], flags=part.get('flags', 0), pos=transformed, uv=list(uv)))
    for group in groups:
        for i in range(0, len(group['pos']), 3):
            points.append(tuple(_vector(group['pos'][i:i + 3], 3, 'preview vertex')))
    return groups, points


def _descriptor(prefab):
    return {key: prefab[key] for key in ('id', 'label', 'source', 'pivot', 'rotatable', 'counts')} | dict(
        kind='prefab', display='/prefabs/%s/display.json' % prefab['id'])


def line_of(marker):
    """The prefab a saved version belongs to: the id of its first version (one saved before versions is its own)."""
    return marker.get('line') or marker['id']


def revision_of(marker):
    """A saved version's number in its prefab (1 for one saved before versions)."""
    return marker.get('revision') or 1


def _item(marker):
    """A prefab as the Prefabs browser lists it: its newest version (id: what a new copy places), the prefab it is
    (line), that version's number and the prefab's picture."""
    line = line_of(marker)
    thumb = ROOT / line / THUMB
    return _descriptor(marker) | dict(line=line, version=revision_of(marker), thumb='/prefabs/%s/%s?v=%d' % (
        line, THUMB, thumb.stat().st_mtime_ns) if thumb.is_file() else '')


def _label(label):
    if (not isinstance(label, str) or not label.strip() or len(label.strip()) > 80 or
            any(ord(c) < 32 for c in label)):
        raise ValueError('Give the prefab a name of 1–80 characters without control characters.')
    return label.strip()


def _picture(data_url):
    """A prefab's picture (a JPEG data URL of the 3D view, made small by the page), b'' for none."""
    if not data_url:
        return b''
    prefix = 'data:image/jpeg;base64,'
    if not isinstance(data_url, str) or not data_url.startswith(prefix):
        raise ValueError('The picture of a prefab is a JPEG of the 3D view.')
    try:
        raw = base64.b64decode(data_url[len(prefix):], validate=True)
    except ValueError as exc:
        raise ValueError('The picture of the prefab could not be read.') from exc
    if not raw.startswith(b'\xff\xd8') or len(raw) > MAX_THUMB:
        raise ValueError('The picture of a prefab is a JPEG of at most 2 MB.')
    return raw


def _capture(map_name, selection, folder, structures):
    """The selected rebuilt objects of a map as the editor's cache has them (the map as it is shown): their T3D blocks
    (each under its actor's name), the preview's triangles, the points around them and what they need."""
    if not isinstance(map_name, str) or not _MAP.fullmatch(map_name):
        raise ValueError('Invalid source map for this prefab.')
    folder = Path(folder)
    source = _safe(folder, folder / 'scene.t3d')
    if not source.is_file() or source.stat().st_size > _MAX_BYTES:
        raise ValueError('Rebuild and reopen the map before saving this prefab.')
    text = source.read_text(encoding='latin1')
    parsed = list(t3d.actors(text))
    actors = {actor['name']: actor for actor in parsed}
    if len(actors) != len(parsed):
        raise ValueError('The map snapshot has duplicate actor names; no prefab was saved.')
    brushes = _read_json(folder, 'brushes.json')
    selected, brush_names, counts = _select(selection, structures, brushes, actors)
    geo = _read_json(folder, 'geometry.json')
    meshes = _read_json(folder, 'meshes.json') if (folder / 'meshes.json').exists() else {}
    if not isinstance(geo, dict) or not isinstance(meshes, dict):
        raise ValueError('Invalid prefab preview data. Rebuild and reopen the map.')
    blocks, bounds, dependencies, texture_names = [], [], set(), set()
    for actor in parsed:  # Deduplicate while preserving engine brush/CSG order.
        if actor['name'] not in selected:
            continue
        name, cls, raw = actor['name'], actor['cls'].split('.')[-1], actor['raw']
        # MAP EXPORT writes these engine-owned fields for every real actor.
        # They are recomputed on import and are not authored resource/link data.
        raw = re.sub(r'(?m)^[ \t]*(?:Level|Region)=.*\n?', '', raw)
        if not _NAME.fullmatch(name):
            raise ValueError('Unsupported actor name in this prefab: %s.' % name)
        is_brush = cls == 'Brush'
        if is_brush:
            brush_names.add(name)
        elif not _scenery(actor):
            raise ValueError('%s (%s) is gameplay, a mover or unsupported scenery. Remove it from the selection; no selected objects were discarded.' % (name, cls))
        if actor['props'].get('Event', 'None') not in ('None', '', '""'):
            raise ValueError('%s carries a gameplay Event. Remove its link before saving a reusable prefab.' % name)
        for line in raw.splitlines():
            brush_model = is_brush and re.fullmatch(r"\s*Brush=Model'MyLevel\.[A-Za-z_][A-Za-z0-9_]*'\s*", line, re.I)
            if re.search(r'\bMyLevel\.', line, re.I) and not brush_model:
                raise ValueError('%s uses a map-local resource or actor link. Move that resource to a project package before saving the prefab.' % name)
        blocks.append(dict(name=name, cls=actor['cls'], brush=is_brush, raw=prefabs._clean_block(raw)))
        box = t3d.bounds(actor) if is_brush else None
        if box:
            bounds.extend(box)
        elif not is_brush:
            loc = _vector(t3d.vec(actor['props'].get('Location')), 3, name)
            bounds.append(tuple(loc))
        else:
            raise ValueError('Brush %s has no valid polygons; no prefab was saved.' % name)
        dependencies.update(re.findall(r"\b\w+'([A-Za-z_][A-Za-z0-9_]*)\.[^']+'", raw))
        for poly in t3d.polys(actor['body']):
            if poly.get('texture'):
                texture_names.add(poly['texture'])
    display_groups, preview_points = _preview(geo, meshes, selected, brush_names, actors)
    bounds.extend(preview_points)
    for point in bounds:
        _vector(point, 3, 'selection bounds')
    texture_info = geo.get('textures') or {}
    for name in texture_names:
        matches = [tex for tex in texture_info if tex == name or tex.split('.')[-1].lower() == name.split('.')[-1].lower()]
        dependencies.update(tex.split('.')[0] for tex in matches if '.' in tex)
    packages = sorted({group['tex'].split('.')[0] for group in display_groups if '.' in group['tex']} |
                      {name.split('.')[0] for name in texture_names if '.' in name} |
                      {tex.split('.')[0] for tex in texture_info if '.' in tex and any(tex.split('.')[-1].lower() == name.split('.')[-1].lower() for name in texture_names)})
    counts.update(brushes=len(brush_names), actors=len(blocks) - len(brush_names))
    return dict(blocks=blocks, groups=display_groups, textures=texture_info, bounds=bounds, packages=packages,
                dependencies=sorted(dependencies | set(packages)), counts=counts, folder=folder)


def _publish(prefab, captured, line, revision, slots, picture=b''):
    """One version published as a complete immutable bundle at once (prefab.json, display.json and its textures,
    library.json: its prefab, number and the slots its prefab has used); picture: the prefab's picture, kept with its
    first version. Returns its library.json."""
    marker = dict(version=1, target=getattr(settings, 'TARGET', 'revision'), project=getattr(settings, 'PROJECT_ID', None),
                  dependencies=captured['dependencies'], line=line, revision=revision, slots=slots, **_descriptor(prefab))
    folder, texture_info = captured['folder'], captured['textures']
    _safe(ROOT, ROOT)
    ROOT.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.usr-', dir=ROOT))
    destination = _safe(ROOT, ROOT / prefab['id'])
    try:
        textures, copied, total = {}, set(), sum(len(block['raw'].encode('latin1')) for block in prefab['blocks'])
        for group in captured['groups']:
            tex = group['tex']
            info = texture_info.get(tex) or {}
            png = info.get('png')
            if png:
                relative = PurePosixPath(png) if isinstance(png, str) else None
                if (not relative or relative.is_absolute() or '..' in relative.parts or '\\' in png or ':' in png or
                        relative.suffix.lower() != '.png'):
                    raise ValueError('Invalid texture path in the prefab preview.')
                asset = _safe(folder, folder / png)
                if not asset.is_file():
                    raise ValueError('A prefab preview texture is missing. Reopen the map before saving.')
                if png not in copied:
                    total += asset.stat().st_size
                    if total > _MAX_BYTES:
                        raise ValueError('This prefab exceeds the 64 MB snapshot limit.')
                    target = _safe(staging, staging / png)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(asset, target)
                    copied.add(png)
            textures[tex] = dict(png=png)
        atomicfile.write_json(staging / 'display.json', dict(groups=captured['groups'], textures=textures))
        atomicfile.write_json(staging / 'prefab.json', prefab)
        atomicfile.write_json(staging / 'library.json', marker)
        if picture:
            (staging / THUMB).write_bytes(picture)
        os.rename(staging, destination)  # Publish the complete immutable bundle at once.
    finally:
        if staging.exists():
            _safe(ROOT, staging)
            shutil.rmtree(staging)
    return marker


def save(map_name, selection, label, folder, structures, picture=''):
    """Save as prefab: the selected rebuilt objects as a new prefab of the library (its first version), the 3D view
    (picture) as its picture."""
    label, jpeg = _label(label), _picture(picture)
    captured = _capture(map_name, selection, folder, structures)
    bounds = captured['bounds']
    pivot = [(min(p[k] for p in bounds) + max(p[k] for p in bounds)) / 2 for k in (0, 1)] + [min(p[2] for p in bounds)]
    ident = 'usr_' + uuid.uuid4().hex
    prefab = dict(id=ident, label=label, source=map_name, structure='library', pivot=pivot,
                  blocks=captured['blocks'], packages=captured['packages'], rotatable=True, facing=None, counts=captured['counts'])
    return _item(_publish(prefab, captured, ident, 1, len(prefab['blocks']), jpeg))


def _markers():
    """Every saved version's library.json, the retired ones too, each checked as belonging to this project."""
    _safe(ROOT, ROOT)
    if not ROOT.exists():
        return []
    out = []
    for folder in ROOT.iterdir():
        if not _ID.fullmatch(folder.name):
            continue
        _safe(ROOT, folder)
        marker = _read_json(folder, 'library.json')
        if (not isinstance(marker, dict) or marker.get('version') != 1 or marker.get('id') != folder.name or
                marker.get('target') != getattr(settings, 'TARGET', 'revision') or
                marker.get('project') != getattr(settings, 'PROJECT_ID', None)):
            raise ValueError('A saved prefab belongs to another target or project: %s.' % folder.name)
        if (not _safe(folder, folder / 'prefab.json').is_file() or
                not _safe(folder, folder / 'display.json').is_file()):
            raise ValueError('A saved prefab is incomplete: %s.' % folder.name)
        if (not isinstance(marker.get('label'), str) or not marker['label'] or len(marker['label']) > 80 or
                not isinstance(marker.get('source'), str) or not _MAP.fullmatch(marker['source']) or
                not isinstance(marker.get('counts'), dict) or not isinstance(marker.get('rotatable'), bool)):
            raise ValueError('A saved prefab has invalid library metadata: %s.' % folder.name)
        def whole(key, least):
            return isinstance(marker[key], int) and not isinstance(marker[key], bool) and marker[key] >= least
        if (('line' in marker and not (isinstance(marker['line'], str) and _ID.fullmatch(marker['line']))) or
                ('revision' in marker and not whole('revision', 1)) or ('slots' in marker and not whole('slots', 0)) or
                not isinstance(marker.get('retired', False), bool)):
            raise ValueError('A saved prefab has invalid version data: %s.' % folder.name)
        _vector(marker.get('pivot'), 3, 'saved prefab pivot')
        out.append(marker)
    return out


def _versions():
    """The prefabs of the library: {line: [its versions' library.json, oldest first]}, without the retired ones."""
    lines = {}
    for marker in _markers():
        if not marker.get('retired'):
            lines.setdefault(line_of(marker), []).append(marker)
    for versions in lines.values():
        versions.sort(key=lambda marker: (revision_of(marker), marker['id']))
    return lines


def _prefab(line):
    """The versions of one prefab of the library, oldest first (ValueError for none)."""
    versions = _versions().get(line) if isinstance(line, str) else None
    if not versions:
        raise ValueError('There is no such prefab in the library.')
    return versions


def library():
    items = [_item(versions[-1]) for versions in _versions().values()]
    return sorted(items, key=lambda item: (item['label'].casefold(), item['id']))


def rename(line, label):
    """Rename a prefab: every version of it, its card in the library and its copies' structures at their next Rebuild."""
    label, versions = _label(label), _prefab(line)
    for marker in versions:
        folder = _safe(ROOT, ROOT / marker['id'])
        atomicfile.write_json(folder / 'prefab.json', dict(_read_json(folder, 'prefab.json'), label=label))
        atomicfile.write_json(folder / 'library.json', dict(marker, label=label))
    return _item(dict(versions[-1], label=label))


def thumbnail(line, picture):
    """A prefab's picture replaced with the 3D view (a small JPEG made by the page)."""
    versions, jpeg = _prefab(line), _picture(picture)
    if not jpeg:
        raise ValueError('Open a map: the picture of a prefab is taken from its 3D view.')
    (_safe(ROOT, ROOT / line) / THUMB).write_bytes(jpeg)
    return _item(versions[-1])


def _placed(also=()):
    """The versions the project places: {bundle id: [where]} by the prefabs entries of every map's edits and map
    template's, and `also` (the ids the open map places, its edits not saved yet). An edits file that cannot be read
    stops it: what it places is not known."""
    out = {ident: ['the open map'] for ident in also if isinstance(ident, str)}
    sources = [(path, None) for path in sorted(MAPS.glob('*.edits.json'))]
    sources += [(path, 'edits') for path in sorted((MAPS / 'templates').glob('*/template.json'))]
    for path, key in sources:
        try:
            saved = json.loads(path.read_text(encoding='utf-8'))
            where = 'template "%s"' % saved.get('name', path.parent.name) if key else path.name[:-len('.edits.json')]
            entries = (saved.get(key) if key else saved).get('prefabs') or []
        except (OSError, ValueError, AttributeError) as exc:
            raise ValueError('Cannot check where the prefab is placed: %s cannot be read.' % path.name) from exc
        for entry in entries:
            if isinstance(entry, dict) and isinstance(entry.get('prefab'), str):
                out.setdefault(entry['prefab'], []).append(where)
    return out


def usage(line):
    """Where the project places a prefab (any version of it): {'copies': n, 'places': [maps, templates]}."""
    _prefab(line)
    placed = _placed()
    places = [where for marker in _markers() if line_of(marker) == line for where in placed.get(marker['id'], [])]
    return dict(copies=len(places), places=sorted(set(places)))


def _remove(folder):
    """A version's folder out of the library: its own files and folders, one by one; nothing goes when a link is in
    it (never delete through a link)."""
    folder = _safe(ROOT, folder)
    inside = [folder, *folder.rglob('*')]
    if any(path.is_symlink() or getattr(os.lstat(path), 'st_file_attributes', 0) & 0x400 for path in inside):
        raise ValueError('A saved prefab folder holds a link, so it was left as it is: %s.' % folder.name)
    for path in sorted(inside, key=lambda p: len(p.parts), reverse=True):
        if path.is_dir():
            path.rmdir()
        else:
            path.unlink()


def delete(line, also=()):
    """Delete a prefab from the library: every version of it retired (hidden), none taken off the disk. A saved map, a
    template, the open map's edits not saved yet (also: the ids it places), the page's Undo and Redo, its clipboard or
    another tab of the project may still place one, and a copy whose version is gone can never be built again: the
    versions go when the project is opened again and nothing saved places them (sweep). Returns {'retired': n,
    'places': [the maps and templates placing its versions]}."""
    versions = _prefab(line)
    placed = _placed(also)
    places = set()
    for marker in versions:
        places.update(placed.get(marker['id'], []))
        atomicfile.write_json(_safe(ROOT, ROOT / marker['id']) / 'library.json', dict(marker, retired=True))
    return dict(retired=len(versions), places=sorted(places))


def sweep():
    """The project opened (its worker starting, before any page: no Undo, no other tab of it can place a version yet):
    the retired versions no saved map or template places taken off the disk. A map or a template that cannot be read
    stops it (ValueError): what it places is not known. Returns how many went."""
    placed = _placed()
    gone = 0
    for marker in _markers():
        if marker.get('retired') and marker['id'] not in placed:
            _remove(ROOT / marker['id'])
            gone += 1
    return gone


def _placement(entry):
    """A placed copy's edits.prefabs entry as members() and new_version() read it: the version it places, its pid,
    where it is."""
    if (not isinstance(entry, dict) or not isinstance(entry.get('pid'), str) or not _PID.fullmatch(entry['pid']) or
            not isinstance(entry.get('prefab'), str) or not _ID.fullmatch(entry['prefab'])):
        raise ValueError('This is not a placed copy of a prefab of the library.')
    if not (ROOT / entry['prefab'] / 'prefab.json').is_file():
        raise ValueError("This copy's version of its prefab is missing from the library.")
    out = dict(pid=entry['pid'], prefab=entry['prefab'], **{key: entry[key] for key in _PLACE if key in entry})
    for key in ('offset', 'scale'):
        if out.get(key) is not None:
            _vector(out[key], 3, 'copy placement')
    try:
        prefabs.entry_xform((0, 0, 0), out)
    except (TypeError, ValueError) as exc:
        raise ValueError('Invalid placement of a copy of a prefab.') from exc
    return out


def members(entries):
    """Update instances: where the objects of placed copies stand in the version each entry names (the entries with
    the newest version's id), as the build puts them (prefabs.place): {pid: {name: {cls, loc, rot}}}. The editor keeps
    a copy's own changes against these (static/prefab-links.js updateCopy)."""
    if not isinstance(entries, list) or len(entries) > 256:
        raise ValueError('Invalid prefab copies.')
    out = {}
    for entry in map(_placement, entries):
        out[entry['pid']] = {actor['name']: dict(cls=actor['cls'], loc=[round(v, 3) for v in t3d.vec(actor['props'].get('Location'))],
                                                 rot=list(t3d.rot(actor['props'].get('Rotation'))))
                             for raw in prefabs.place(entry)[0] for actor in t3d.actors(raw)}
    return out


def _inverse(xf):
    """A copy's placement (an unscaled geom.XForm) undone: its objects back in their prefab's own frame, around its pivot."""
    import geom
    turn = geom.rotation_between(xf.rotation, (0, 0, 0))
    return geom.XForm([xf.pivot[k] + xf.offset[k] for k in range(3)], [-v for v in xf.offset], turn[1],
                      pitch=turn[0], roll=turn[2])


def _unplaced(group, back):
    """A preview group of a copy in its prefab's own frame: its corners moved back, its texture frames turned back
    (texture_mapping.frame: origin, U and V, the pans)."""
    pos = group['pos']
    out = dict(group, pos=[c for i in range(0, len(pos), 3) for c in back.point(pos[i:i + 3])])
    if group.get('uvFrames'):
        out['uvFrames'] = [None if f is None else [*back.point(f[0:3]), *back.vec(f[3:6]), *back.vec(f[6:9]), *f[9:]]
                           for f in group['uvFrames']]
    return out


def new_version(map_name, entry, folder, structures):
    """Apply to prefab: a placed copy of a library prefab (its entry in the map's saved edits), as it is built in the
    map now, saved as the prefab's newest version. Its move and turn are undone (its objects back in the prefab's own
    frame), each object keeps its slot (its name in every copy, prefabs.place) and others get slots the prefab never
    used; the prefab keeps its name, source and pivot. Returns the library's item for it."""
    entry = _placement(entry)
    placed = next((marker for marker in _markers() if marker['id'] == entry['prefab']), None)
    versions = _versions().get(line_of(placed)) if placed else None
    if not versions:
        raise ValueError('This prefab is no longer in the library: Unpack the copy, or save it as a new prefab.')
    newest = versions[-1]
    if newest['id'] != placed['id']:      # it would undo the versions made since: their changes are not on this copy
        raise ValueError('This copy is on version %d of its prefab and version %d is in the library: Update instances '
                         'first, then apply it.' % (revision_of(placed), revision_of(newest)))
    xf = prefabs.entry_xform(placed['pivot'], entry)
    if xf.scaled:
        raise ValueError("Set the copy's scale back to 100% before applying it: a prefab keeps its own size.")
    captured = _capture(map_name, dict(structures=['paste~' + entry['pid']]), folder, structures)
    back = _inverse(xf)
    used = newest.get('slots')
    if used is None:                  # a prefab saved before slots: its objects are numbered in order
        used = len(_read_json(ROOT / newest['id'], 'prefab.json')['blocks'])
    taken = [prefabs.member_slot(entry['pid'], block['name']) for block in captured['blocks']]
    free = max([used] + [slot + 1 for slot in taken if slot is not None])
    seen = set()
    for block, slot in zip(captured['blocks'], taken):
        if slot is None or slot in seen:      # not one of the copy's own objects by its name: a slot of its own
            slot, free = free, free + 1
        seen.add(slot)
        block['slot'] = slot
        block['raw'] = prefabs.xf_block(block['raw'], back)
    captured['groups'] = [_unplaced(group, back) for group in captured['groups']]
    counts = dict(captured['counts'], structures=newest['counts'].get('structures', 1))
    prefab = dict(id='usr_' + uuid.uuid4().hex, label=newest['label'], source=newest['source'], structure='library',
                  pivot=list(placed['pivot']), blocks=captured['blocks'], packages=captured['packages'], rotatable=True,
                  facing=None, counts=counts)
    return _item(_publish(prefab, captured, line_of(placed), revision_of(newest) + 1, free))
