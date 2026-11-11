"""Audit real rendered prop geometry against the built BSP, including shelves and door pockets.

Run after building tutorial/tutorial_map.py. Meshes come from the SDK, not collision cylinders:
the latter miss the computer keyboard and were insufficient to catch the original clipping.
"""
import itertools
import json
import math
import re
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT/'editor')]
import data, kit, sizes, t3d

folder = data.prepare('00_DeusEdix_Tutorial')
actors = {a['name']: a for a in t3d.actors((folder/'scene.t3d').read_text(encoding='latin1'))}
meshes = json.loads((folder/'meshes.json').read_text())
dimensions = sizes.load()
models = {}
for name, mesh in meshes.items():
    if mesh['kind'] != 'mesh':
        continue
    actor = actors[name]
    loc, rot = t3d.vec(actor['props'].get('Location')), t3d.rot(actor['props'].get('Rotation'))
    points = {tuple(round(p[k]+loc[k], 4) for k in range(3))
              for part in mesh['parts'] for i in range(0, len(part['pos']), 3)
              for p in [t3d._rotate(part['pos'][i:i+3], rot)]}
    if not points:
        continue
    lo = tuple(min(p[k] for p in points) for k in range(3))
    hi = tuple(max(p[k] for p in points) for k in range(3))
    models[name] = dict(cls=mesh['cls'], points=points, lo=lo, hi=hi, loc=loc)

session = kit.Session([KIT/'out'/'00_DeusEdix_Tutorial.dx'], 'tutorial-clearance')
try:
    session.cmd('MAP LOAD FILE="..\\Input\\00_DeusEdix_Tutorial.dx"')
    commands, samples = [], []
    for name, model in models.items():
        loc = model['loc']
        actor = actors[name]
        half = float(actor['props'].get('CollisionHeight', dimensions.get(model['cls'], [0, 0])[1]))
        # Stock standing animations can extend a few units below their collision bottom.
        # Clamp only that floor contact, never a horizontal wall penetration.
        floor = loc[2] - half
        for p in model['points']:
            q = (p[0], p[1], max(p[2], floor+1))
            commands.append('UC_TRACE %g %g %g %g %g %g' % (*loc, *q))
            samples.append((name, q))
    hits = []
    for i in range(0, len(commands), 400):
        output = session.batch(commands[i:i+400])
        results = re.findall(r'UCMapKit\|trace\|([^\r\n]+)', output)
        assert len(results) == len(commands[i:i+400]), 'SDK did not answer every clearance trace'
        for (name, end), result in zip(samples[i:i+400], results):
            if result.startswith('hit|'):
                hit = tuple(float(v) for v in result.split('|')[1].split())
                if math.dist(end, hit) > 1.25:  # SDK hit bias is 0.5, plus rounding/flush contacts.
                    hits.append((name, tuple(round(v, 2) for v in end), hit))
    assert not hits, ('model intersects BSP', hits[:30])

    # Separate props may touch their support, but must not interpenetrate one another.
    overlaps = []
    for (an, a), (bn, b) in itertools.combinations(models.items(), 2):
        depth = [min(a['hi'][k], b['hi'][k])-max(a['lo'][k], b['lo'][k]) for k in range(3)]
        if min(depth) > .3:
            overlaps.append((an, bn, depth))
    assert not overlaps, ('overlapping model bounds', overlaps)

    # Books and lamps on mesh furniture need support over their entire footprint.
    for name, prop in models.items():
        if prop['cls'] not in ('BookOpen', 'BookClosed', 'Lamp1'):
            continue
        # Test the base that touches the table; a lampshade may overhang it naturally.
        base = [p for p in prop['points'] if p[2] <= prop['lo'][2]+1]
        corners = list(itertools.product(*[(min(p[k] for p in base)+.3, max(p[k] for p in base)-.3) for k in (0, 1)]))
        for x, y in corners:
            floor = session.trace((x, y, prop['lo'][2]+1), (x, y, prop['lo'][2]-2))
            supports = [other for key, other in models.items() if key != name
                        and abs(other['hi'][2]-prop['lo'][2]) < .3
                        and all(other['lo'][k]-.3 <= (x,y)[k] <= other['hi'][k]+.3 for k in (0,1))]
            assert floor or supports, ('unsupported furniture item', name, x, y, prop['lo'][2])

    # Trace each door's full swept volume into its pocket, inset from flush floor/ceiling.
    door_samples = 0
    for name, actor in actors.items():
        if actor['cls'] != 'DeusExMover':
            continue
        lo, hi = t3d.bounds(actor)
        travel = t3d.vec(actor['props']['KeyPos(1)'])
        for p in itertools.product(*[(lo[k]+1, (lo[k]+hi[k])/2, hi[k]-1) for k in range(3)]):
            end = tuple(p[k]+travel[k] for k in range(3))
            assert session.trace(p, end) is None, ('blocked door pocket', name, p, end)
            door_samples += 1
    print('PASS %d rendered props, %d mesh/BSP traces, pair separation, furniture support, %d door sweep traces'
          % (len(models), len(samples), door_samples), flush=True)
finally:
    session.close()
