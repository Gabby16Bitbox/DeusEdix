"""Real engine regression: generated room only; no game maps are installed or changed."""
import copy
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch
from PIL import Image

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import activation
import data
import dxmaps
import geom
import t3d
from scene import Scene


def actors(path):
    return {a['name']: a for a in t3d.actors(Path(path).read_text(encoding='latin1'))}


with tempfile.TemporaryDirectory(dir=KIT / 'tests', prefix='activation-engine-') as temp:
    root = Path(temp)
    Image.new('P', (16, 16), 128).save(root / 'gray.pcx')

    def make_scene():
        scene = Scene('ActivationFixture', packages=['CoreTexMetal'])
        scene.texture(root / 'gray.pcx', 'ActivationGray')
        scene.auto_groups = False
        scene.sub(geom.box((-256, -256, -64), (256, 256, 256), 'ActivationGray'))
        scene.actor('CrateUnbreakableSmall', (0, 0, 0), name='FixtureCrate', HitPoints='7')
        scene.actor('UNATCOTroop', (-100, 0, 0), name='FixtureGuard', Health='67')
        scene.mover('DeusExMover', (0, -120, 0), geom.box((-32, -8, 0), (32, 8, 64), 'ActivationGray'), name='FixtureDoor')
        scene.actor('Light', (0, 0, 160), name='FixtureLight', LightBrightness='128', LightRadius='8')
        scene.actor('PlayerStart', (120, 120, 0), name='FixtureStart')
        return scene

    source = root / 'ActivationFixture.dx'
    make_scene().build(source, paths=False)
    source_sha = activation.digest(source)
    disabled_names = {'FixtureCrate', 'NewFixtureCrate', 'FixtureGuard', 'FixtureDoor'}
    edits = {'disabled': {name: True for name in disabled_names},
             'props': {'FixtureCrate': {'HitPoints': '29'}},
             'added': [{'name': 'NewFixtureCrate', 'cls': 'CrateUnbreakableSmall', 'loc': [80, 0, 0],
                        'props': {'HitPoints': '31'}}]}
    editfile = root / 'fixture.edits.json'
    editfile.write_text(json.dumps(edits))
    original_edits = editfile.read_bytes()
    scripted = root / 'scripted.dx'
    make_scene().build(scripted, paths=False, edits=editfile)
    runtime = actors(scripted.with_suffix('.t3d'))
    assert not disabled_names & runtime.keys()
    saved = activation.load(scripted)
    editor = {a['name']: a for a in t3d.actors(activation.editor_text('', saved))}
    assert editor['FixtureCrate']['props']['HitPoints'] == '29', editor
    assert editor['NewFixtureCrate']['props']['HitPoints'] == '31', editor
    assert disabled_names <= saved['meshes'].keys()
    assert 'Begin Brush' in editor['FixtureDoor']['raw']
    with patch.object(data, 'CACHE', root / 'cache'), patch.object(data, 'OUT', root):
        data.prepare('ActivationFixture', src=scripted, log=lambda *a: None)
        shown = {a['name']: a for a in data.actors('ActivationFixture')}
        assert disabled_names <= shown.keys(), (disabled_names - shown.keys(), shown)
        assert shown['FixtureGuard']['kind'] == 'pawn'
        assert shown['FixtureDoor']['kind'] == 'mover'
        shown_meshes = json.loads((root / 'cache' / 'ActivationFixture' / 'meshes.json').read_text())
        assert disabled_names <= shown_meshes.keys()
    assert editfile.read_bytes() == original_edits
    print('PASS script build: original/added crates, character and mover omitted; editor properties, meshes and edits preserved', flush=True)

    enabled = copy.deepcopy(edits); enabled['disabled'] = {}
    editfile.write_text(json.dumps(enabled))
    make_scene().build(scripted, paths=False, edits=editfile)
    runtime = actors(scripted.with_suffix('.t3d'))
    assert runtime['FixtureCrate']['props']['HitPoints'] == '29'
    assert runtime['NewFixtureCrate']['props']['HitPoints'] == '31'
    assert disabled_names <= runtime.keys()
    assert not activation.sidecar(scripted).exists()
    print('PASS script build: re-enabled with complete configuration', flush=True)

    editfile.write_text(json.dumps(edits))
    out = root / 'out'; out.mkdir()
    with patch.object(dxmaps, 'MOD_MAPS', root), patch.object(dxmaps, 'OUT', out), \
            patch.object(dxmaps, 'edits_path', lambda _: editfile):
        ok, lines = dxmaps.build('ActivationFixture')
        assert ok, lines
        runtime = actors(out / 'ActivationFixture.t3d')
        assert not disabled_names & runtime.keys()
        assert activation.digest(source) == source_sha
        assert editfile.read_bytes() == original_edits
        # This install is confined to the temporary fixture folder, never the game.
        assert dxmaps.install('ActivationFixture')[0]
        private = dxmaps.source('ActivationFixture')
        assert activation.digest(private) == source_sha
        assert editfile.read_bytes() == original_edits
        # out/ and editor caches are disposable; only maps/.authoring + saved edits
        # are needed to reopen the project and rebuild every inactive object.
        assert out.resolve().is_relative_to(root.resolve())
        shutil.rmtree(out)
        assert dxmaps.source('ActivationFixture') == private
        assert not dxmaps.built_current('ActivationFixture')
        editfile.write_text(json.dumps(enabled))
        ok, lines = dxmaps.build('ActivationFixture')
        assert ok, lines
        runtime = actors(out / 'ActivationFixture.t3d')
        assert runtime['FixtureCrate']['props']['HitPoints'] == '29'
        assert runtime['NewFixtureCrate']['props']['HitPoints'] == '31'
        assert disabled_names <= runtime.keys()
        assert dxmaps.install('ActivationFixture')[0]
        assert activation.digest(private) == source_sha
        assert not activation.sidecar(out / 'ActivationFixture.dx').exists()
        print('PASS original .dx: disable, private install, discard out cache, reopen, re-enable, rebuild and install; durable source unchanged', flush=True)

print('PASS activation engine regression', flush=True)
