"""Engine integration checks using a generated room, never a user's map.

Run with the mapkit Python. An optional mapkit path tests an installed-mode stage.
"""
import json
import math
import shutil
import sys
from pathlib import Path

KIT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import geom
import kit
import surfaces
from scene import Scene


def polygons(path):
    """UC_BSPDUMP -> {(brush, its source polygon): [{tex, flags, uv (base, U, V, pan, size), verts}]}."""
    header, a = kit.arrays(path)
    result, at = {}, 0
    for i in range(header['polygons']):
        n = a['vertexCount'][i] * 3
        m = a['mapping'][i * 11:i * 11 + 11].tolist()
        result.setdefault((a['brush'][i], a['brushPoly'][i]), []).append(dict(
            tex=header['textures'][a['texture'][i]], flags=a['flags'][i], verts=a['vertices'][at:at + n].tolist(),
            uv=m[:9] + [float(a['pan'][i * 2]), float(a['pan'][i * 2 + 1])] + m[9:]))
        at += n
    return result


def close(a, b):
    return all(abs(x - y) < .002 for x, y in zip(a, b))


def main():
    for bad in [dict(op='scale', args=[0, 1]), dict(op='pan', args=[float('nan'), 0]),
                dict(op='texture', args=['Bad\nMAP NEW']), dict(op='shadows', args=['ultra'])]:
        try:
            surfaces.commands({'surfaces': [dict(targets=[dict(brush='Brush1', poly=0)], **bad)]})
        except ValueError:
            pass
        else:
            raise AssertionError('Invalid edit accepted')
    scene = Scene('SurfaceTest', packages=['HK_BuildingExt'])
    scene.auto_groups = False
    scene.sub(geom.box((-512, -512, -128), (512, 512, 384), 'ClenGreyCncrt_A'))
    scene.add(geom.prism((0, 0), 96, -128, 128, 'ClenGreyCncrt_A', sides=8, ry=64))
    scene.light((0, -250, 240), brightness=150, radius=24)
    scene.actor('PlayerStart', (-256, -256, 0))
    folder, source = scene.build(None, light=True, paths=False, label='surface-test-base')
    # Keep this generated fixture outside the run pruner, for the browser/pipeline checks.
    fixture = Path(__file__).parent / 'SurfaceTest.dx'
    shutil.copy2(source, fixture)
    source = fixture
    session = kit.Session([source], 'surface-test-names')
    try:
        session.batch([r'MAP LOAD FILE="..\Input\SurfaceTest.dx"', r'UC_BRUSHES ..\Output\brushes.jsonl'])
        names = [row['name'] for row in kit.rows(session.folder / 'Output' / 'brushes.jsonl')]
    finally:
        session.close()
    results = {}
    for mode, args in [('floor', []), ('wall', []), ('tile', []), ('tile-u', []), ('tile-v', []),
                       ('pan', [16, -8]), ('scale', [2, .5]), ('rotate', []), ('flip-u', []), ('flip-v', []),
                       ('texture', ['HK_BuildingExt.Concrete.ClenGreyCncrt_A']), ('shadows', ['ultra-low']), ('shadows', ['low']), ('shadows', ['normal']), ('shadows', ['high']), ('cylinder', [])]:
        run = kit.new_run([source], 'surface-test-' + mode)
        target = '*' if mode == 'cylinder' else 1
        row = dict(op=mode, args=args, targets=[dict(brush=names[1], poly=target)])
        cmds = [r'MAP LOAD FILE="..\Input\SurfaceTest.dx"', r'UC_BSPDUMP ..\Output\before.txt', 'UC_LIGHTSTATS']
        cmds += surfaces.commands({'surfaces': [row]})
        cmds += [r'UC_BSPDUMP ..\Output\after.txt', r'MAP SAVE FILE="..\Output\edited.dx"',
                 r'MAP LOAD FILE="..\Output\edited.dx"', r'UC_BSPDUMP ..\Output\reloaded.txt',
                 'MAP REBUILD', 'BSP REBUILD OPTIMAL BALANCE=15', 'UC_WORLD finish', r'UC_BSPDUMP ..\Output\rebuilt.txt']
        if mode == 'shadows':
            cmds += ['LIGHT APPLY', 'UC_LIGHTSTATS']
        text, _ = kit.execute(run, cmds, timeout=180)
        before, after, reload, rebuilt = [polygons(run / 'Output' / (name + '.txt')) for name in ('before', 'after', 'reloaded', 'rebuilt')]
        assert set(after) == set(rebuilt), (mode, 'CSG changed face identities')
        for key in after:
            assert close(after[key][0]['uv'], reload[key][0]['uv']), (mode, key, 'save lost mapping')
            assert close(after[key][0]['uv'], rebuilt[key][0]['uv']), (mode, key, 'rebuild lost mapping', after[key][0]['uv'], rebuilt[key][0]['uv'])
            assert after[key][0]['flags'] == rebuilt[key][0]['flags'], (mode, key, 'rebuild lost flags')
            if key[0] != 1 or (target != '*' and key[1] != 1):
                assert close(before[key][0]['uv'], after[key][0]['uv']), (mode, key, 'unselected mapping changed')
        a, b = after[(1, 1)][0], before[(1, 1)][0]
        if mode == 'pan':
            assert close(a['uv'][9:11], [b['uv'][9] + 16, b['uv'][10] - 8])
        if mode == 'scale':
            assert close(a['uv'][3:6], [v / 2 for v in b['uv'][3:6]])
        if mode.startswith('tile'):
            uv = a['uv']
            coords = [[sum((v[i] - uv[i]) * uv[3 + axis * 3 + i] for i in range(3))
                       for axis in range(2)] for v in [a['verts'][j:j + 3] for j in range(0, len(a['verts']), 3)]]
            spans = [max(p[k] for p in coords) - min(p[k] for p in coords) for k in range(2)]
            if mode in ('tile', 'tile-u'):
                assert abs(spans[0] - uv[11]) < .01, (mode, spans, uv)
            if mode in ('tile', 'tile-v'):
                assert abs(spans[1] - uv[12]) < .01, (mode, spans, uv)
            if mode != 'tile':
                assert abs(math.dist(uv[3:6], [0]*3) - math.dist(uv[6:9], [0]*3)) < .001
        if mode == 'cylinder':
            # Shared side vertices must agree modulo one tile, including the closing seam.
            shared = {}
            for (brush, face), pieces in after.items():
                if brush != 1 or face < 2:
                    continue
                for piece in pieces:
                    uv = piece['uv']
                    for j in range(0, len(piece['verts']), 3):
                        v = tuple(piece['verts'][j:j + 3])
                        coord = [sum((v[i] - uv[i]) * uv[3 + axis * 3 + i] for i in range(3)) / uv[11 + axis] for axis in range(2)]
                        if v in shared:
                            assert all(abs((x-y)-round(x-y)) < .001 for x,y in zip(coord, shared[v])), (v, coord, shared[v])
                        shared[v] = coord
        if mode == 'shadows':
            assert a['flags'] & 0x808000 == {'ultra-low': 0x808000, 'low': 0x8000, 'normal': 0, 'high': 0x800000}[args[0]]
            results['shadows-' + args[0]] = surfaces.report(text)
        results[mode] = str(run)
        print('PASS', mode, *args, flush=True)
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
