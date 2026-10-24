"""Project-local reusable snapshots of rebuilt structures, lights and scenery.

The server must check draft/build/cache freshness before save(). This module never
runs the engine or changes a map: it publishes one immutable, ordinary prefab
compatible with prefabs.place() and the existing placement preview.
"""
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


def save(map_name, selection, label, folder, structures):
    if not isinstance(map_name, str) or not _MAP.fullmatch(map_name):
        raise ValueError('Invalid source map for this prefab.')
    if (not isinstance(label, str) or not label.strip() or len(label.strip()) > 80 or
            any(ord(c) < 32 for c in label)):
        raise ValueError('Give the prefab a name of 1–80 characters without control characters.')
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
    pivot = [(min(p[k] for p in bounds) + max(p[k] for p in bounds)) / 2 for k in (0, 1)] + [min(p[2] for p in bounds)]
    texture_info = geo.get('textures') or {}
    for name in texture_names:
        matches = [tex for tex in texture_info if tex == name or tex.split('.')[-1].lower() == name.split('.')[-1].lower()]
        dependencies.update(tex.split('.')[0] for tex in matches if '.' in tex)
    packages = sorted({group['tex'].split('.')[0] for group in display_groups if '.' in group['tex']} |
                      {name.split('.')[0] for name in texture_names if '.' in name} |
                      {tex.split('.')[0] for tex in texture_info if '.' in tex and any(tex.split('.')[-1].lower() == name.split('.')[-1].lower() for name in texture_names)})
    counts.update(brushes=len(brush_names), actors=len(blocks) - len(brush_names))
    ident = 'usr_' + uuid.uuid4().hex
    prefab = dict(id=ident, label=label.strip(), source=map_name, structure='library', pivot=pivot,
                  blocks=blocks, packages=packages, rotatable=True, facing=None, counts=counts)
    marker = dict(version=1, target=getattr(settings, 'TARGET', 'revision'), project=getattr(settings, 'PROJECT_ID', None),
                  dependencies=sorted(dependencies | set(packages)), **_descriptor(prefab))
    _safe(ROOT, ROOT)
    ROOT.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.usr-', dir=ROOT))
    destination = _safe(ROOT, ROOT / ident)
    try:
        textures, copied, total = {}, set(), sum(len(block['raw'].encode('latin1')) for block in blocks)
        for group in display_groups:
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
        atomicfile.write_json(staging / 'display.json', dict(groups=display_groups, textures=textures))
        atomicfile.write_json(staging / 'prefab.json', prefab)
        atomicfile.write_json(staging / 'library.json', marker)
        os.rename(staging, destination)  # Publish the complete immutable bundle at once.
    finally:
        if staging.exists():
            _safe(ROOT, staging)
            shutil.rmtree(staging)
    return _descriptor(prefab)


def library():
    _safe(ROOT, ROOT)
    if not ROOT.exists():
        return []
    items = []
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
        _vector(marker.get('pivot'), 3, 'saved prefab pivot')
        items.append(_descriptor(marker))
    return sorted(items, key=lambda item: (item['label'].casefold(), item['id']))
