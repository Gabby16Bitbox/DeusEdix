"""Export original Revision maps to T3D and summarise their props: where to look for references.

    python tools/mapkit/refscan.py 06_HongKong_Helibase 09_NYC_Dockyard ...

For each map prints the PlayerStart, the decoration classes it uses (with counts) and the
densest prop clusters (good camera targets for tools/shots.ps1 'player' shots).
The T3D files are kept in tools/mapkit/refs/<map>.t3d for later lookups.
"""
import collections
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import kit  # noqa: E402
import settings  # noqa: E402
import t3d  # noqa: E402

REV_MAPS = settings.REVISION_MAPS
REFS = HERE / 'refs'
SKIP = ('Light', 'PathNode', 'PlayerStart', 'ZoneInfo', 'AmbientSound', 'Brush', 'Mover', 'Trigger', 'Teleporter',
        'InterpolationPoint', 'SpecialEvent', 'Dispatcher', 'FlagTrigger', 'PatrolPoint', 'HidePoint', 'LevelInfo',
        'SkyZoneInfo', 'Spotlight', 'TriggerLight', 'DeusExLevelInfo', 'MapExit', 'ConversationTrigger',
        'AllianceTrigger', 'GoalCompleteTrigger', 'DataLinkTrigger', 'SoundEvent', 'Camera', 'SequenceTrigger')


def export(map_name):
    REFS.mkdir(exist_ok=True)
    import polys
    cached = polys.ref_path(map_name)
    if cached is not None:
        return cached
    out = REFS / (map_name + '.t3d')
    src = REV_MAPS / (map_name + '.dx')
    folder = kit.new_run([src], 'ref-' + map_name)
    kit.execute(folder, ['MAP LOAD FILE="..\\Input\\%s.dx"' % map_name,
                         'MAP EXPORT FILE="..\\Output\\%s.t3d"' % map_name], 'export.log', timeout=900)
    shutil.copy2(folder / 'Output' / (map_name + '.t3d'), out)
    return out


def summary(map_name):
    export(map_name)
    import polys
    text = polys.ref_text(map_name)
    props = []
    for a in t3d.actors(text):
        cls = a['cls']
        if any(cls.endswith(s) for s in SKIP) or 'Brush' in cls or 'Mover' in cls:
            continue
        loc = t3d.vec(a['props'].get('Location', ''))
        props.append((cls, loc))
    print('==', map_name, len(props), 'props')
    for a in t3d.actors(text):
        if a['cls'].endswith('PlayerStart'):
            print('  PlayerStart', t3d.vec(a['props'].get('Location', '')))
    counts = collections.Counter(c for c, _ in props)
    print('  classes:', ', '.join('%s x%d' % kv for kv in counts.most_common(45)))
    # clusters on a 600-unit grid
    cells = collections.defaultdict(list)
    for c, (x, y, z) in props:
        cells[(int(x // 600), int(y // 600), int(z // 400))].append(c)
    for (cx, cy, cz), cl in sorted(cells.items(), key=lambda kv: -len(kv[1]))[:8]:
        top = collections.Counter(cl).most_common(6)
        print('  cluster (%d,%d,%d) n=%d: %s' % (cx * 600 + 300, cy * 600 + 300, cz * 400 + 200, len(cl),
                                                 ', '.join('%s x%d' % kv for kv in top)))


if __name__ == '__main__':
    for m in sys.argv[1:]:
        summary(m)
