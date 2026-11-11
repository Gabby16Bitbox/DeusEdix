"""The project's logic patterns (P8 slice 2, editor/LOGIC.md "Patterns"): a block of rules saved from the Logic window
(Save as pattern...), to place again in other maps.

tools/mapkit/logic/patterns/<slug>.json:
    {"version": 1, "name": "Alarm network", "versions": [{"v": 1, "made": "2026-11-10T14:02:00", "rules": [...],
     "pieces": [...], "objects": [...], "slots": [...], "ports": [...], "states": [...]}, ...]}

What a version holds is made by editor/static/logic-patterns.js patternOf: its rules with ids R1, R2..., the map's
objects they named replaced by {slot}. Saving a pattern of the same name again adds a version: maps that placed an
older one keep it until they update.

The editor ships a library of patterns (P8 slice 4) in tools/mapkit/editor/config/patterns, copied into every project
with the editor's files (projects.py _payload): every project sees them as its own. A project's file of the same slug
wins; saving a shipped pattern again writes the project's file, its versions after the library's (a map's "slug@v"
stays the same pattern).
"""
import json
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
if str(KIT) not in sys.path:
    sys.path.insert(0, str(KIT))
import atomicfile  # noqa: E402

VERSION = 1
MAX_BYTES = 2 * 1024 * 1024          # one version, as sent
MAX_VERSIONS = 200
SLUG = re.compile(r'^[a-z0-9][a-z0-9-]{0,47}$')
PARTS = ('rules', 'pieces', 'objects', 'slots', 'ports', 'states')


def folder(kit=None):
    return Path(kit or KIT) / 'logic' / 'patterns'


def library(kit=None):
    """The patterns that come with the editor (read only: never written by the editor)."""
    return Path(kit or KIT) / 'editor' / 'config' / 'patterns'


def slug_of(name):
    """A file name for a pattern's name: lower case, letters and digits joined by '-' (at most 48)."""
    s = re.sub(r'[^a-z0-9]+', '-', str(name or '').lower()).strip('-')[:48].strip('-')
    return s or 'pattern'


def _read(p):
    try:
        data = json.loads(p.read_text(encoding='utf-8-sig'))
    except (OSError, ValueError, UnicodeError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get('versions'), list) or not data['versions']:
        return None
    return data


def _summary(slug, data):
    last = data['versions'][-1] if isinstance(data['versions'][-1], dict) else {}
    slots = [s for s in last.get('slots') or [] if isinstance(s, dict)]
    return dict(slug=slug, name=str(data.get('name') or slug), v=last.get('v', len(data['versions'])), versions=len(data['versions']),
                made=last.get('made', ''), rules=len(last.get('rules') or []),
                slots=[dict(id=s.get('id'), words=s.get('words', ''), family=s.get('family', ''), carried=bool(s.get('carried'))) for s in slots])


def listed(kit=None):
    """The project's patterns and the editor's library, by name: [{slug, name, v, versions, made, rules, slots,
    shipped}] (shipped: the library's, not changed in this project)."""
    found = {}
    for shipped, d in ((True, library(kit)), (False, folder(kit))):
        if d.is_dir():
            for p in sorted(d.glob('*.json')):
                data = _read(p)
                if data is not None and SLUG.match(p.stem):
                    found[p.stem] = dict(_summary(p.stem, data), shipped=shipped)
    return sorted(found.values(), key=lambda x: x['name'].lower())


def load(slug, kit=None):
    """A pattern with all its versions (the project's, else the library's), or None."""
    if not isinstance(slug, str) or not SLUG.match(slug):
        return None
    data = _read(folder(kit) / (slug + '.json'))
    shipped = data is None
    if shipped:
        data = _read(library(kit) / (slug + '.json'))
    if data is None:
        return None
    return dict(data, slug=slug, shipped=shipped)


def _check(version):
    if not isinstance(version, dict):
        raise ValueError('A pattern needs its rules.')
    rules = version.get('rules')
    if not isinstance(rules, list) or not rules or not all(isinstance(r, dict) for r in rules):
        raise ValueError('A pattern needs at least one rule.')
    for key in PARTS:
        if key in version and not isinstance(version[key], list):
            raise ValueError('A pattern\'s %s must be a list.' % key)
    if len(json.dumps(version)) > MAX_BYTES:
        raise ValueError('This pattern is too big to save (over 2 MB).')
    return {key: version.get(key) or [] for key in PARTS}


def save(name, version, kit=None, now=None):
    """Keep a version of the pattern called name: a new file, or one more version of the pattern of that name.
    Gives back its summary ({slug, name, v, ...})."""
    name = str(name or '').strip()
    if not name:
        raise ValueError('A pattern needs a name.')
    if len(name) > 80:
        raise ValueError('A pattern\'s name is at most 80 letters.')
    parts = _check(version)
    d = folder(kit)
    base = slug_of(name)
    slug, data = base, None
    for n in range(1, 100):                 # the file of that name, or a free one (another name may share a slug)
        slug = base if n == 1 else '%s-%d' % (base[:44], n)
        p = d / (slug + '.json')
        old = _read(p) if p.exists() else None
        if old is None and p.exists():
            continue                         # a file that cannot be read: never overwritten
        if old is None and (library(kit) / (slug + '.json')).exists():
            old = _read(library(kit) / (slug + '.json'))     # a shipped pattern: its versions go on in the project
            if old is None:
                continue
        if old is None or str(old.get('name', '')).strip().lower() == name.lower():
            data = old
            break
    else:
        raise ValueError('Too many patterns share this name.')
    versions = list(data['versions']) if data else []
    if len(versions) >= MAX_VERSIONS:
        raise ValueError('This pattern has %d versions: save it under another name.' % MAX_VERSIONS)
    made = time.strftime('%Y-%m-%dT%H:%M:%S', time.localtime(now))
    versions.append(dict(v=len(versions) + 1, made=made, **parts))
    name = str(data.get('name') or name) if data else name     # the name it was first saved with, however typed now
    d.mkdir(parents=True, exist_ok=True)
    atomicfile.write_json(d / (slug + '.json'), dict(version=VERSION, name=name, versions=versions), indent=1)
    return _summary(slug, dict(name=name, versions=versions))


# ---------------------------------------------------------------- patterns placed in a map (P8 slice 3)
# edits['logic']['instances'] = [{"id": "P1", "pattern": <slug>, "v": 2, "slots": {<slot id>: <object name>},
#                                 "name": what the Logic window calls it}]
# Like the Logic runtime (logicruntime.py), the loaders (server.load_edits, dxmaps.load_edits, scene.py) put the
# versions the map's instances use in the edits they read, as edits['logicPatterns'] = {"<slug>@<v>": version}
# (apply); the page sets it too when it places one. links.blocks expands each instance into rules P1_R1... and logic
# items P1_B1... (expand), and editor/static/logic-patterns.js expandInstances does the same for the Logic window: a
# placed pattern is a macro, it costs the game nothing more than the rules it writes. A version's rules hold no
# instance, so an expansion never expands again.
KEY = 'logicPatterns'
INSTANCE = re.compile(r'^P\d+$')
SLOT_TEXT = re.compile(r'^\{([a-z][a-z0-9_]*)\}$')
ITEM_KINDS = ('blocks', 'phases', 'groups', 'points')


def instances(edits):
    """The map's placed patterns, cleaned: [{id, pattern, v, slots, name}]"""
    logic = edits.get('logic') if isinstance(edits, dict) else None
    raw = logic.get('instances') if isinstance(logic, dict) else None
    out, seen = [], set()
    for x in raw if isinstance(raw, list) else []:
        if not isinstance(x, dict) or not INSTANCE.match(str(x.get('id', ''))) or x['id'] in seen:
            continue
        if not isinstance(x.get('pattern'), str) or not SLUG.match(x['pattern']) or not isinstance(x.get('v'), int):
            continue
        seen.add(x['id'])
        slots = x.get('slots') if isinstance(x.get('slots'), dict) else {}
        out.append(dict(id=x['id'], pattern=x['pattern'], v=x['v'], name=str(x.get('name') or x['pattern']),
                        slots={str(k): str(v) for k, v in slots.items() if isinstance(v, str)}))
    return out


def apply(edits, kit=None):
    """The edits with the versions their placed patterns use in them, and only those (a copy; the same edits when none
    is placed and they hold none). A version is never changed once saved, so the copy a map was saved with is kept
    when the project no longer has it (a map from another project, a mod's); with neither, its instance writes no rule."""
    if not isinstance(edits, dict):
        return edits
    found = {}
    kept = edits.get(KEY) if isinstance(edits.get(KEY), dict) else {}
    for inst in instances(edits):
        key = '%s@%d' % (inst['pattern'], inst['v'])
        if key in found:
            continue
        data = load(inst['pattern'], kit)
        version = next((v for v in (data or {}).get('versions') or [] if isinstance(v, dict) and v.get('v') == inst['v']), None)
        if version is not None:
            found[key] = dict(version, name=data.get('name', inst['pattern']))
        elif isinstance(kept.get(key), dict) and isinstance(kept[key].get('rules'), list):
            found[key] = kept[key]
    if not found:
        if KEY not in edits:
            return edits
        out = dict(edits)
        del out[KEY]
        return out
    return dict(edits, **{KEY: found})


def _filled(value, slots, key=''):
    """A copy with each '{slot}' string the object placed in that slot ('' when none is)"""
    if isinstance(value, str):
        m = SLOT_TEXT.match(value)
        return slots.get(m.group(1), '') if m and m.group(1) in slots else value
    if isinstance(value, list):
        return [_filled(v, slots, key) for v in value]
    if isinstance(value, dict):
        return {k: _filled(v, slots, k) for k, v in value.items()}
    return value


def expand(edits):
    """The edits with each placed pattern written out (a copy; the same edits when none is): its rules P1_R1... (its
    "If not" links, step ids and groups following, 'instance': 'P1'), its logic items P1_B1... in edits['logic'], its
    slots the objects the instance names"""
    insts = instances(edits)
    versions = edits.get(KEY) if isinstance(edits, dict) and isinstance(edits.get(KEY), dict) else {}
    if not insts or not versions:
        return edits
    links = list(edits.get('links') or [])
    logic = dict(edits.get('logic') or {})
    for inst in insts:
        ver = versions.get('%s@%d' % (inst['pattern'], inst['v']))
        if not isinstance(ver, dict):
            continue
        pid = inst['id']
        slot_ids = [s.get('id') for s in ver.get('slots') or [] if isinstance(s, dict) and isinstance(s.get('id'), str)]
        slots = {s: inst['slots'].get(s, '') for s in slot_ids}
        rules = [r for r in ver.get('rules') or [] if isinstance(r, dict) and isinstance(r.get('id'), str)]
        rule_ids = {r['id']: '%s_%s' % (pid, r['id']) for r in rules}
        pieces = [p for p in ver.get('pieces') or [] if isinstance(p, dict) and p.get('kind') in ITEM_KINDS and isinstance(p.get('item'), dict)]
        item_ids = {p['item'].get('id'): '%s_%s' % (pid, p['item'].get('id')) for p in pieces}
        for r in rules:
            x = _filled(r, slots)
            x['id'] = rule_ids[r['id']]
            x['instance'] = pid
            if x.get('otherwiseOf') in rule_ids:
                x['otherwiseOf'] = rule_ids[x['otherwiseOf']]
            for key in ('do', 'else'):
                for a in x.get(key) or []:
                    if not isinstance(a, dict):
                        continue
                    if isinstance(a.get('id'), str) and a['id'].startswith(r['id'] + '_'):
                        a['id'] = pid + '_' + a['id']
                    if a.get('group') in item_ids:
                        a['group'] = item_ids[a['group']]
            links.append(x)
        for p in pieces:
            item = _filled(p['item'], slots)
            item['id'] = item_ids[p['item'].get('id')]
            if isinstance(item.get('members'), list):    # a slot left empty is no member
                item['members'] = [m for m in item['members'] if m != '']
            logic[p['kind']] = list(logic.get(p['kind']) or []) + [item]
    return dict(edits, links=links, logic=logic)
