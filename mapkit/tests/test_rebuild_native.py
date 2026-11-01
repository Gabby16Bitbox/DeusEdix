"""Native-engine proof: generated room only; never installs or edits game maps.

Run directly with mapkit Python. The room and its generated textures live in a
temporary test folder. Engine runs are isolated from other tests and retained
only until the assertions finish.
"""
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

from PIL import Image

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import activation
import dxmaps
import geom
import kit
import rebuild
import t3d
from scene import Scene
from test_surfaces import polygons, close


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def dump(path):
    run = kit.new_run([path], 'rebuild-read')
    kit.execute(run, ['MAP LOAD FILE="..\\Input\\%s"' % path.name,
                      r'UC_BSPDUMP ..\Output\bsp.bin'])
    return polygons(run / 'Output' / 'bsp.bin')


def main():
    with tempfile.TemporaryDirectory(dir=KIT / 'tests', prefix='rebuild-native-') as temp:
        root = Path(temp)
        with patch.object(kit, 'RUNS', root / 'runs'), \
                patch.dict(os.environ, {rebuild.ENV_MODE: 'auto'}):
            Image.new('P', (16, 16), 128).save(root / 'gray.pcx')
            scene = Scene('RebuildFixture', packages=[])
            scene.texture(root / 'gray.pcx', 'RebuildGray')
            scene.auto_groups = False
            scene.sub(geom.box((-256, -256, -64), (256, 256, 256), 'RebuildGray'))
            scene.actor('CrateUnbreakableSmall', (0, 0, 0), name='FixtureCrate', HitPoints='29')
            scene.actor('Light', (0, 0, 160), name='FixtureLight', LightBrightness='128', LightRadius='8')
            scene.actor('PlayerStart', (120, 120, 0), name='FixtureStart')
            edits_path = root / 'edits.json'
            # Bake a UV edit into the source: forced BSP must keep it, even with
            # no edit overlay left to replay during subsequent builds.
            edits_path.write_text(json.dumps({'surfaces': [
                {'op': 'pan', 'args': [16, -8], 'targets': [{'brush': 'Brush2', 'poly': 0}]}]}))
            source = root / 'RebuildFixture.dx'
            with patch.dict(os.environ, {rebuild.ENV_MODE: 'full'}):
                folder, _ = scene.build(source, light=False, paths=False, edits=edits_path)
            log = (folder / 'build.log').read_text(errors='replace')
            assert 'UCMapKit|command|PATHS DEFINE' in log
            assert 'UCMapKit|command|LIGHT APPLY' in log
            before = dump(source)
            source_sha = digest(source)
            print('PASS generated map: Full forces lighting and paths even when the script disables them', flush=True)
            out = root / 'out'
            with patch.object(dxmaps, 'MOD_MAPS', root), patch.object(dxmaps, 'OUT', out), \
                    patch.object(dxmaps, 'edits_path', lambda _: edits_path):
                edits_path.write_text('{}')
                ok, lines = dxmaps.build('RebuildFixture')
                assert ok, lines
                info = json.loads(dxmaps._info_path('RebuildFixture').read_text())['built']
                assert not (info['geometry'] or info['lights'] or info['paths']), info
                print('PASS Automatic: unchanged imported map keeps baked geometry, lighting and paths', flush=True)
                # Repeat a clean full rebuild to exercise the user's exact request.
                edits_path.write_text('{"paths": false}')
                for attempt in range(2):
                    ok, lines = dxmaps.build('RebuildFixture', options={'mode': 'full'})
                    assert ok, lines
                    info = json.loads(dxmaps._info_path('RebuildFixture').read_text())['built']
                    assert info['geometry'] and info['lights'] and info['paths'], info
                    assert digest(source) == source_sha, 'Source map changed'
                    after = dump(out / source.name)
                    assert set(before) == set(after), 'Source face identities changed'
                    for key in before:
                        assert close(before[key][0]['uv'], after[key][0]['uv']), ('Baked UV mapping changed', key)
                        assert close(before[key][0]['verts'], after[key][0]['verts']), ('Geometry changed', key)
                    actors = {a['name']: a for a in t3d.actors((out / 'RebuildFixture.t3d').read_text(encoding='latin1'))}
                    assert actors['FixtureCrate']['props']['HitPoints'] == '29'
                print('PASS repeated clean Full: BSP, lighting and paths regenerated; baked UVs, actor data and source preserved', flush=True)
                edits_path.write_text(json.dumps({'disabled': {'FixtureCrate': True}}))
                ok, lines = dxmaps.build('RebuildFixture', options={'mode': 'full'})
                assert ok, lines
                assert digest(source) == source_sha
                actors = {a['name']: a for a in t3d.actors((out / 'RebuildFixture.t3d').read_text(encoding='latin1'))}
                assert 'FixtureCrate' not in actors
                archived = activation.load(out / source.name)
                assert any('FixtureCrate' in actor and 'HitPoints=29' in actor for actor in archived['actors'])
                print('PASS Full with inactive object: absent in runtime; reactivation data preserved', flush=True)
    print('PASS native rebuild checks; temporary fixture removed, no maps installed', flush=True)


if __name__ == '__main__':
    main()
