"""'Play from here' of the map editor: the game opens on the installed map with JC where the editor's
camera is, after a mission state (one of the mod's UCDbg* debug commands, which set the flags and jump
to their map) and extra flags; then the player has the controls (UCShotRunner step 'play').
"""
import re
import sys
from pathlib import Path

ED = Path(__file__).resolve().parent
KIT = ED.parent
PROJECT = KIT.parents[1]
sys.path.insert(0, str(KIT))
import live  # noqa: E402
import settings  # noqa: E402

CLASSES = PROJECT / 'src' / settings.PACKAGE / 'Classes'
# what the debug commands prepare (their own comments are in Italian)
SETUPS_EN = {}   # English descriptions of a mod's own debug setups (UCDbg* classes), by class name


def setups(map_name):
    """The debug commands that end in this map: [{name, text}]."""
    out = []
    for f in sorted(CLASSES.glob('UCDbg*.uc')):
        t = f.read_text(encoding='latin1', errors='replace')
        m = re.search(r'Jump\("([^"#]+)', t)
        if not m or m.group(1).lower() != map_name.lower():
            continue
        d = re.search(r'//\s*%s\s*-\s*(.+)' % re.escape(f.stem), t)
        out.append(dict(name=f.stem, text=SETUPS_EN.get(f.stem) or (d.group(1).strip() if d else f.stem)))
    return out


def _same(a, b):
    a, b = Path(a), Path(b)
    if not (a.exists() and b.exists()) or a.stat().st_size != b.stat().st_size:
        return False
    return a.read_bytes() == b.read_bytes()


def pending_install(map_name, is_dx, out_dir, built_current):
    """What the game would miss: the last rebuild not installed, or the mod's copy not in the game yet."""
    mod = PROJECT / 'maps' / (map_name + '.dx')
    game = settings.MAPS_DIR / (map_name + '.dx')
    if is_dx:
        if built_current(map_name):
            return 'your last rebuild is not installed'
    else:
        out = Path(out_dir) / (map_name + '.dx')
        if out.exists() and not _same(out, mod):
            return 'your last rebuild is not installed'
    if mod.exists() and not _same(mod, game):
        return "the mod's copy of this map is not in the game yet"
    return ''


def flags_text(route, extra):
    """'UNATCORouteCommitted=1,Flag=1,Other=0' from the dialog's choices."""
    isolated = getattr(settings, 'PROJECT_KIND', 'legacy') in ('custom', 'tutorial')
    out = ['UNATCORouteCommitted=1'] if route and not isolated else []
    for item in re.split(r'[,\s;]+', extra or ''):
        if not item:
            continue
        name, _, value = item.partition('=')
        if re.fullmatch(r'\w+', name):
            out.append('%s=%s' % (name, '0' if value.strip() in ('0', 'false', 'False', 'no') else '1'))
    return ','.join(out)


def start(map_name, at, yaw, pitch, setup, flags, display_mode='external'):
    if setup and not (CLASSES / (setup + '.uc')).exists():
        raise ValueError('unknown mission state %s' % setup)
    return live.play(map_name, at=at, yaw=yaw, pitch=pitch, setup=setup, flags=flags, display_mode=display_mode)
