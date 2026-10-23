"""Links between maps (the map editor's "Links"): where each map can be left and entered.

In Deus Ex a map is left through a Teleporter whose URL is "Map#Tag" (JC touches it and travels) or a
MapExit (DestMap, when it is triggered), and entered at the Teleporter whose Tag is that #Tag ("Map"
alone: at its PlayerStart). They are read offline from the .dx files (tools/ue1pkg.py), cached by file
date: the mod's maps (maps\\), the map scripts' builds (tools/mapkit/out) and the game's maps.
"""
import json
import re
import sys
from pathlib import Path

import data
import dxmaps

sys.path.insert(0, str(dxmaps.PROJECT / 'tools'))
import ue1pkg  # noqa: E402

CACHE = data.CACHE / '_links.json'
DEFAULT_TAGS = ('', 'none', 'teleporter', 'mapexit', 'playerstart')


def map_file(map_name):
    """The .dx the game would load for this map: a script's build, the mod's copy or the original."""
    if dxmaps.isolated_project() and map_name.casefold() not in {name.casefold() for name in all_maps()}:
        return None
    out = data.OUT / (map_name + '.dx')
    if map_name in dxmaps.script_maps() and out.exists():
        return out
    try:
        return dxmaps.source(map_name)
    except FileNotFoundError:
        return out if out.exists() else None


def all_maps():
    names = {p.stem for p in dxmaps.MOD_MAPS.glob('*.dx')} | dxmaps.script_maps()
    if not dxmaps.isolated_project() and dxmaps.GAME_MAPS.exists():
        names |= {p.stem for p in dxmaps.GAME_MAPS.glob('*.dx') if re.match(r'^\d\d_', p.stem)}
    return sorted(names)


def _read(path):
    p = ue1pkg.Pkg(str(path))
    out = []
    for i, e in enumerate(p.exports):
        cls = p.classname(e)
        if not (cls == 'PlayerStart' or 'Teleporter' in cls or cls == 'MapExit'):
            continue
        try:
            vals = {n: p.pval(v) for (n, t, a, v) in p.props(i + 1)}
        except Exception:      # a property the reader does not know: skip the object
            continue
        loc = vals.get('Location')
        rot = vals.get('Rotation')
        out.append(dict(name=e['name'], cls=cls, tag=str(vals.get('Tag') or ''),
                        url=str(vals.get('URL') or vals.get('DestMap') or ''), enabled=bool(vals.get('bEnabled', True)),
                        loc=[round(c) for c in loc] if isinstance(loc, tuple) else None,
                        yaw=rot[1] if isinstance(rot, tuple) else 0))
    return out


_mem = {}


def points(map_name, cache=None):
    """Every way in and out of a map: [{name, cls, tag, url, enabled, loc, yaw}]."""
    path = map_file(map_name)
    if not path or not path.exists():
        return []
    key = '%s|%d|%d' % (path, path.stat().st_mtime_ns, path.stat().st_size)
    store = cache if cache is not None else _load()
    hit = store.get(map_name)
    if hit and hit.get('key') == key:
        return hit['points']
    try:
        pts = _read(path)
    except Exception:
        pts = []
    store[map_name] = dict(key=key, points=pts)
    if cache is None:
        _save(store)
    return pts


def _load():
    if 'store' not in _mem:
        try:
            _mem['store'] = json.loads(CACHE.read_text(encoding='utf-8')) if CACHE.exists() else {}
        except ValueError:
            _mem['store'] = {}
    return _mem['store']


def _save(store):
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(store), encoding='utf-8')


def split_url(url):
    m = re.match(r'^([^#?/]+)(?:[#/]([^?]*))?', url or '')
    return (m.group(1), m.group(2) or '') if m else ('', '')


def validate_travel(edits=None, story_data=None):
    """Reject explicit travel outside an independent campaign, without changing either payload.

    Used on map/Story saves by the server. Empty draft actions and local Teleporter tags
    remain editable; map names are matched case-insensitively like the engine.
    """
    if not dxmaps.isolated_project():
        return
    available = {name.casefold() for name in all_maps()}
    missing = set()

    def check(value, local=False):
        url = str(value or '').strip().strip('"')
        if not url or url.casefold() == 'none' or url.startswith('#'):
            return
        if local and '/' not in url and '#' not in url:
            return
        destination, _tag = split_url(url)
        if destination.casefold() not in available:
            missing.add(destination or url)

    def visit(value):
        if isinstance(value, list):
            for child in value:
                visit(child)
        elif isinstance(value, dict):
            if value.get('type') == 'travel':
                check(value.get('map'))
            if value.get('verb') == 'travel':
                check(value.get('a'))
            for key, child in value.items():
                if key in ('URL', 'DestMap'):
                    check(child, local=key == 'URL')
                elif isinstance(child, (dict, list)):
                    visit(child)

    visit(edits)
    visit(story_data)
    if missing:
        raise ValueError('Travel destination is not in this project: %s. Add the map to this project first.' % ', '.join(sorted(missing)))


def arrivals(map_name):
    """Where another map can send JC in this one: '' (the PlayerStart) and the tags of its teleporters."""
    pts = points(map_name)
    tags = sorted({p['tag'] for p in pts if 'Teleporter' in p['cls'] and not p['url'] and p['tag'].lower() not in DEFAULT_TAGS})
    return dict(map=map_name, start=any(p['cls'] == 'PlayerStart' for p in pts), tags=tags)


def links(map_name):
    """This map's exits (where they lead), its arrival points, and the exits of every other map that
    lead here (the first call reads all the maps: about a minute)."""
    store = _load()
    mine = points(map_name, store)
    exits = [dict(p, to_map=split_url(p['url'])[0], to_tag=split_url(p['url'])[1]) for p in mine if p['url']]
    incoming = []
    for m in all_maps():
        if m.lower() == map_name.lower():
            continue
        for p in points(m, store):
            to, tag = split_url(p['url'])
            if to and to.lower() == map_name.lower():
                incoming.append(dict(from_map=m, name=p['name'], tag=tag))
    _save(store)
    result = dict(map=map_name, exits=exits, arrivals=arrivals(map_name)['tags'],
                  start=any(p['cls'] == 'PlayerStart' for p in mine), incoming=incoming)
    if dxmaps.isolated_project():
        available = {name.casefold() for name in all_maps()}
        unresolved = [p for p in exits if p['to_map'] and p['to_map'].casefold() not in available
                      and not ('Teleporter' in p['cls'] and '/' not in p['url'] and '#' not in p['url'])]
        result['unresolved'] = unresolved
        result['warnings'] = ['%s leads outside this project: %s' % (p['name'], p['url']) for p in unresolved]
    return result
