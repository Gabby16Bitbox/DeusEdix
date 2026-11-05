"""Shadow-detail integration check on a generated private room (no user maps).

Run with --project <configured project> --host <UCMapKitHost.exe> --output <folder>.
The project supplies its installed SDK/game paths; the backend under test is this checkout.
Each level must survive Save, Reload and a full BSP/lighting rebuild. Ultra Low must
actually use fewer lightmap samples than Low, not merely store the requested bits.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, required=True)
    parser.add_argument('--host', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    checkout = Path(__file__).resolve().parents[1]
    project_kit = args.project.resolve() / 'tools/mapkit'
    sys.path[:0] = [str(project_kit), str(checkout)]
    import kit
    import geom
    import t3d
    spec = importlib.util.spec_from_file_location('tested_surfaces', checkout / 'editor/surfaces.py')
    surfaces = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(surfaces)
    kit.RUNS = Path(tempfile.mkdtemp(prefix='deusedix-shadow-detail-'))
    kit.prune = lambda: None
    # Keep native dependency lookup on the installed kit; only replace our host/bridge.
    native = kit.native_files()
    kit.HOST = args.host.resolve()
    kit.native_files = lambda: native
    run = kit.new_run([], 'shadow-detail')
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'run.txt').write_text(str(run), encoding='utf-8')

    def brush(name, model, shape, subtract=False):
        shape.name = model
        return (f'Begin Actor Class=Brush Name={name}\n'
                f'    CsgOper=CSG_{"Subtract" if subtract else "Add"}\n'
                + shape.t3d(inside=subtract)
                + f"    Brush=Model'MyLevel.{model}'\nEnd Actor\n")

    mat = geom.Mat('ClenGreyCncrt_A', flags=0x800)  # No Smooth, preserved at every detail level.
    blocks = [brush('ShadowRoom', 'ShadowModel0', geom.box((-512, -512, -128), (512, 512, 384), mat), True),
              brush('ShadowPillar', 'ShadowModel1', geom.box((-64, -64, -128), (64, 64, 180), mat)),
              'Begin Actor Class=Light Name=TestLight\nLocation=(X=0,Y=-250,Z=240)\nLightBrightness=150\nLightRadius=32\nEnd Actor\n']
    (run / 'T3D/room.t3d').write_text(t3d.import_text(blocks), encoding='latin1')
    commands = ['MAP NEW', 'OBJ LOAD FILE="HK_BuildingExt.utx"',
                r'MAP IMPORTADD FILE="..\T3D\room.t3d"', 'UC_UNLINK ShadowModel',
                'MAP REBUILD', 'BSP REBUILD OPTIMAL BALANCE=15', 'UC_WORLD finish',
                r'UC_BSPDUMP ..\Output\base.bin']
    levels = [('ultra-low', 0x808000), ('low', 0x8000), ('normal', 0), ('high', 0x800000), ('normal', 0)]
    for i, (level, bits) in enumerate(levels):
        targets = [dict(brush=name, poly='*') for name in ('ShadowRoom', 'ShadowPillar')]
        commands += surfaces.commands({'surfaces': [dict(op='shadows', args=[level], targets=targets)]})
        commands += [fr'UC_BSPDUMP ..\Output\edited{i}.bin', fr'MAP SAVE FILE="..\Output\level{i}.dx"',
                     fr'MAP LOAD FILE="..\Output\level{i}.dx"', fr'UC_BSPDUMP ..\Output\reloaded{i}.bin',
                     'MAP REBUILD', 'BSP REBUILD OPTIMAL BALANCE=15', 'UC_WORLD finish',
                     'LIGHT APPLY', 'UC_LIGHTSTATS', fr'UC_BSPDUMP ..\Output\rebuilt{i}.bin', 'UC_CAMERAS clear']
    # One face changed, no sibling or other brush may inherit the flags.
    commands += surfaces.commands({'surfaces': [dict(op='shadows', args=['ultra-low'],
                                                     targets=[dict(brush='ShadowPillar', poly=1)])]})
    commands += [r'UC_BSPDUMP ..\Output\single.bin']
    text, _ = kit.execute(run, commands, timeout=180, tries=1)
    assert 'UCMapKit|failed|' not in text, text
    stats = [tuple(map(int, m)) for m in re.findall(r'UCMapKit\|lightstats\|(\d+)\|(\d+)\|(\d+)', text)]
    assert len(stats) == len(levels), stats
    base_h, base = kit.arrays(run / 'Output/base.bin')
    for i, (level, bits) in enumerate(levels):
        for stage in ('edited', 'reloaded', 'rebuilt'):
            header, data = kit.arrays(run / f'Output/{stage}{i}.bin')
            assert header['polygons'] == base_h['polygons'] > 0
            for key in ('vertices', 'vertexCount', 'brush', 'brushPoly', 'mapping', 'pan', 'texture'):
                assert list(data[key]) == list(base[key]), (level, stage, key)
            for old, new in zip(base['flags'], data['flags']):
                assert new & 0x808000 == bits, (level, stage, hex(new))
                assert (old & ~0x808000) == (new & ~0x808000), (level, stage, 'other flags changed')
    assert stats[0][1] < stats[1][1] < stats[2][1] < stats[3][1], stats
    assert stats[2] == stats[4], ('Normal did not reset both bits', stats)
    _, single = kit.arrays(run / 'Output/single.bin')
    changed = [i for i, flags in enumerate(single['flags']) if flags & 0x808000]
    assert changed and all(single['brush'][i] == 1 and single['brushPoly'][i] == 1 for i in changed), changed
    result = dict(project=str(args.project), run=str(run),
                  levels=[dict(level=level, lightmaps=s[0], samples=s[1], bytes=s[2])
                          for (level, _), s in zip(levels, stats)],
                  checks=['native flags', 'UVs and geometry unchanged', 'other flags preserved',
                          'save/reload', 'full rebuild', 'sample density', 'normal reset', 'single face'])
    (args.output / 'result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
