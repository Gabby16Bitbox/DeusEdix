"""The project's Logic runtime (P6, editor/LOGIC.md "Classic rules"), kept for one release as a way back.

tools/mapkit/logic/runtime.json: {"version": 1, "runtime": "classic"}. Absent, or anything else: "v2".
  - "v2": a rule with any of the new options (links.needs_rule) is built as a UCRule, the others as the UCLink they
    always were.
  - "classic": every rule a UCLink, as before P6; a rule that needs the new options stops the build, named.
  - "all": every rule a UCRule, even a plain one. Not offered in the editor: the golden-log parity test plays the
    behaviour fixtures in the game with it, to show a UCRule writes the same lines as the UCLink it replaces.

Like the mission phases (missionphases.py), apply() writes it into the edits the builds read (dxmaps.load_edits,
server.load_edits, scene.py) as edits['logicRuntime'], so a change makes the builds out of date (their fingerprint
is the edits'), and links.blocks reads it there. A map's own saved copy of the key means nothing: apply() replaces it.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
if str(KIT) not in sys.path:
    sys.path.insert(0, str(KIT))
import atomicfile  # noqa: E402

VERSION = 1
DEFAULT = 'v2'
CHOICES = ('v2', 'classic', 'all')
KEY = 'logicRuntime'


def path(kit=None):
    return Path(kit or KIT) / 'logic' / 'runtime.json'


def load(kit=None):
    """The project's runtime ('v2' when it has no file, or its file cannot be read)."""
    try:
        value = json.loads(path(kit).read_text(encoding='utf-8-sig'))
    except (OSError, ValueError, UnicodeError):
        return DEFAULT
    runtime = value.get('runtime') if isinstance(value, dict) else None
    return runtime if runtime in CHOICES else DEFAULT


def save(runtime, kit=None):
    """Keep the project's runtime; 'v2' takes the file away (the default). Gives it back as kept."""
    if runtime not in CHOICES:
        raise ValueError('Unknown Logic runtime: %r (v2 or classic)' % (runtime,))
    p = path(kit)
    if runtime == DEFAULT:
        try:
            p.unlink()
        except FileNotFoundError:
            pass
        return DEFAULT
    p.parent.mkdir(parents=True, exist_ok=True)
    atomicfile.write_json(p, dict(version=VERSION, runtime=runtime), indent=1)
    return runtime


def apply(edits, runtime=None, kit=None):
    """The edits with the project's runtime in them (a copy; the same edits when it is v2 and they do not say another)"""
    runtime = load(kit) if runtime is None else runtime
    if not isinstance(edits, dict):
        return edits
    if runtime == DEFAULT:
        if KEY not in edits:
            return edits
        out = dict(edits)
        del out[KEY]
        return out
    return dict(edits, **{KEY: runtime})


def of(edits):
    """The runtime the edits are built with (links.blocks)"""
    value = edits.get(KEY) if isinstance(edits, dict) else None
    return value if value in CHOICES else DEFAULT
