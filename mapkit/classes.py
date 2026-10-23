"""List actor classes of the game packages by parent (e.g. all decorations).

    python tools\\mapkit\\classes.py DeusExDecoration
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from ue1pkg import Pkg  # noqa: E402

from settings import GAME  # noqa: E402
PACKAGES = [GAME / 'System' / 'Engine.u', GAME / 'System' / 'DeusEx.u', GAME / 'Revision' / 'System' / 'RevisionDeco.u',
            GAME / 'Revision' / 'System' / 'Revision.u', GAME / 'Revision' / 'System' / 'RevisionPawn.u']


def hierarchy():
    parents, origin = {}, {}
    for path in PACKAGES:
        if not path.exists():
            continue
        p = Pkg(str(path))
        for e in p.exports:
            if p.classname(e) == 'Class':
                parents.setdefault(e['name'], p.refname(e['super']))
                origin.setdefault(e['name'], path.stem)
    return parents, origin


def isa(parents, c, base):
    for _ in range(40):
        if c == base:
            return True
        if c not in parents:
            return False
        c = parents[c]
    return False


if __name__ == '__main__':
    base = sys.argv[1] if len(sys.argv) > 1 else 'DeusExDecoration'
    parents, origin = hierarchy()
    found = sorted(c for c in parents if c != base and isa(parents, c, base))
    groups = {}
    for c in found:
        groups.setdefault(parents[c], []).append(c + ('' if origin[c] == 'DeusEx' else '[' + origin[c] + ']'))
    print(len(found), 'classes under', base)
    for k in sorted(groups):
        print(k + ': ' + ', '.join(groups[k]))
