"""Mission phases shared by the project (P3 slice 7, editor/LOGIC.md "Mission phases").

A project declares its mission phase sets once, in tools/mapkit/logic/phases.json:
    {"version": 1, "sets": [{"id": "MP1", "name": "Raid", "phases": ["Calm", "Alarm", "Escape"]}]}
"name" is the name of the flags (a Phases block's StateName: the counter <name>, the states <name>_<phase>), so every
map that uses the set reads and moves the same phase: it goes on from one map to the next and in the saves.

A map uses a set through a Phases block (UCBPhases) linked to it: edits.logic.mission = {<block name>: <set id>}.
The block's Phases and StateName are the set's, whatever the map's edits say: apply() writes them into the edits
the builds read (dxmaps.load_edits, scene.py), so changing the set changes every map at its next build, and the
build fingerprint (dxmaps._edits_fingerprint) sees it.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
if str(KIT) not in sys.path:
    sys.path.insert(0, str(KIT))
import atomicfile  # noqa: E402

VERSION = 1
MAX_SETS = 32
MAX_PHASES = 32


def path(kit=None):
    return Path(kit or KIT) / 'logic' / 'phases.json'


def flag_name(text):
    """UCBlock.FlagName (statecatalog.block_flag_name): anything but an ASCII letter, a digit or _ becomes _, a
    leading digit gets X_, 60 at most"""
    name = ''.join(ch if re.match(r'[A-Za-z0-9_]$', ch) and ch.isascii() else '_' for ch in str(text or '').strip())
    if name[:1].isdigit():
        name = 'X_' + name
    return name[:60]


def _clean(text, most=60):
    """a name or a phase as typed: no quote, backslash or comma (the block keeps the list as "a, b, c")"""
    return re.sub(r'[",\\|]', '', str(text if text is not None else '')).strip()[:most]


def validate(sets):
    """The sets as they will be kept, or ValueError saying what is wrong (in the editor's words)."""
    if not isinstance(sets, list):
        raise ValueError('Mission phases: a list of phase sets is expected.')
    if len(sets) > MAX_SETS:
        raise ValueError('Mission phases: at most %d phase sets.' % MAX_SETS)
    out, names, ids = [], set(), set()
    for k, s in enumerate(sets):
        if not isinstance(s, dict):
            raise ValueError('Mission phases: phase set %d is not a set.' % (k + 1))
        name = _clean(s.get('name'))
        if not flag_name(name):
            raise ValueError('Mission phases: phase set %d needs a name.' % (k + 1))
        if flag_name(name).lower() in names:
            raise ValueError('Mission phases: two phase sets are called "%s".' % name)
        names.add(flag_name(name).lower())
        phases, seen = [], set()
        raw = s.get('phases')
        for p in (raw.split(',') if isinstance(raw, str) else raw if isinstance(raw, list) else []):
            p = _clean(p)
            if flag_name(p) and flag_name(p).lower() not in seen:
                seen.add(flag_name(p).lower())
                phases.append(p)
        if not phases:
            raise ValueError('Mission phases: "%s" needs at least one phase.' % name)
        if len(phases) > MAX_PHASES:
            raise ValueError('Mission phases: "%s" has more than %d phases.' % (name, MAX_PHASES))
        sid = str(s.get('id') or '')
        if not re.fullmatch(r'MP\d{1,4}', sid) or sid in ids:
            sid = ''
        out.append(dict(id=sid, name=name, phases=phases))
        if sid:
            ids.add(sid)
    n = 1
    for s in out:                       # a new set gets the first id free
        while not s['id']:
            if 'MP%d' % n not in ids:
                s['id'] = 'MP%d' % n
                ids.add(s['id'])
            n += 1
    return out


def load(kit=None):
    """The project's sets ([] when it has none, or its file cannot be read)."""
    try:
        value = json.loads(path(kit).read_text(encoding='utf-8-sig'))
        return validate(value.get('sets') if isinstance(value, dict) else [])
    except (OSError, ValueError, UnicodeError):
        return []


def save(sets, kit=None):
    """Keep the sets (validated) and give them back as kept, with their ids."""
    kept = validate(sets)
    p = path(kit)
    p.parent.mkdir(parents=True, exist_ok=True)
    atomicfile.write_json(p, dict(version=VERSION, sets=kept), indent=1, ensure_ascii=False)
    return kept


def links_of(edits):
    """{block name: set id} of a map's edits (edits.logic.mission)"""
    logic = edits.get('logic') if isinstance(edits, dict) else None
    mission = logic.get('mission') if isinstance(logic, dict) else None
    return {str(k): str(v) for k, v in mission.items() if k and v} if isinstance(mission, dict) else {}


def block_props(s):
    """A Phases block's settings as the set says them (edits' property texts)"""
    return {'Phases': '"%s"' % ', '.join(s['phases']), 'StateName': '"%s"' % s['name']}


def apply(edits, sets=None, kit=None):
    """The edits with each linked Phases block set as its mission set (a copy; the same edits when nothing is linked).
    A block linked to a set the project no longer has keeps what the map says."""
    links = links_of(edits)
    if not links:
        return edits
    by_id = {s['id']: s for s in (load(kit) if sets is None else sets)}
    out = dict(edits)
    added = [dict(a) for a in (edits.get('added') or [])]
    props = {k: dict(v) if isinstance(v, dict) else v for k, v in (edits.get('props') or {}).items()}
    lower = {name.lower(): sid for name, sid in links.items()}
    placed = set()
    for a in added:
        sid = lower.get(str(a.get('name') or '').lower())
        if sid in by_id and a.get('cls') == 'UCBPhases':
            a['props'] = dict(a.get('props') or {}, **block_props(by_id[sid]))
            placed.add(str(a['name']).lower())
    for name, sid in links.items():
        if sid not in by_id:
            continue
        keys = [k for k in props if k.lower() == name.lower()]
        for k in keys:                  # the Inspector's values over the placed ones: the set's win
            if isinstance(props[k], dict):
                props[k] = dict(props[k], **block_props(by_id[sid])) if name.lower() not in placed else \
                    {p: v for p, v in props[k].items() if p not in ('Phases', 'StateName')}
    raw = {k: dict(v) if isinstance(v, dict) else v for k, v in (edits.get('rawprops') or {}).items()}
    for name, sid in links.items():     # nor All properties (the engine may spell it "stateName")
        for k in [k for k in raw if k.lower() == name.lower() and sid in by_id and isinstance(raw[k], dict)]:
            raw[k] = {p: v for p, v in raw[k].items() if p.lower() not in ('phases', 'statename')}
    out['added'] = added
    out['props'] = props
    if 'rawprops' in edits:
        out['rawprops'] = raw
    return out
