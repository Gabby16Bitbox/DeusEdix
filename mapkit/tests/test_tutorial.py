"""Tutorial edits live only for an explicit session; clean builds may be reused safely."""
import copy
import importlib.util
import json
import hashlib
import shutil
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('editor_tutorial', KIT / 'editor' / 'tutorial.py')
tutorial = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tutorial)


class TutorialUpdateTests(unittest.TestCase):
    def test_stock_text_updates_without_overwriting_user_story(self):
        old = json.loads((KIT / 'tutorial' / 'story_legacy.json').read_text())
        new = json.loads((KIT / 'tutorial' / 'story.json').read_text())
        own = copy.deepcopy(old)
        own['dialogues'] = [{'id': 'd1', 'owner': 'TutorialScientist', 'steps': [{'text': 'My line'}]}]
        own['infolinks'][2]['lines'] = [{'text': 'My own door instructions'}]
        own['infolinks'].pop(4)  # A deliberate deletion stays deleted.
        own['events'][1]['when']['radius'] = 222
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'story.json'
            path.write_text(json.dumps(own))
            tutorial._refresh_story(path, old, new)
            result = json.loads(path.read_text())
            self.assertEqual(result['dialogues'], own['dialogues'])
            self.assertEqual(result['infolinks'][0]['lines'], new['infolinks'][0]['lines'])
            self.assertEqual(result['infolinks'][2]['lines'], own['infolinks'][2]['lines'])
            self.assertNotIn('i4', [i['id'] for i in result['infolinks']])
            self.assertEqual(result['events'][1]['when']['radius'], 222)
            first = path.read_bytes()
            tutorial._refresh_story(path, new, new)
            self.assertEqual(path.read_bytes(), first)

class TutorialSessionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='.tutorial-session-', dir=Path(__file__).parent)
        self.root = Path(self.temporary.name).resolve()
        self.kit = self.root / 'tools/mapkit'
        self.src = self.kit / 'tutorial'
        shutil.copytree(KIT / 'tutorial', self.src)
        self.installed = self.root / 'fake-game/Revision/DeusEdixProjects/training'
        settings = types.SimpleNamespace(PROJECT=self.root, MAPS_DIR=self.installed, PACKAGE='DXP_training',
                                         STANDALONE=True, MANAGED_PROJECT=True, PROJECT_KIND='tutorial', PROJECT_ID='training')
        fake_story = types.SimpleNamespace(class_name=lambda name: 'UCEd_' + name,
                                          generate=lambda name, content: '// ' + name + '\n' + json.dumps(content, sort_keys=True))
        patches = [patch.object(tutorial, 'KIT', self.kit), patch.object(tutorial, 'SRC', self.src),
                   patch.object(tutorial, 'settings', settings), patch.object(tutorial, '_ACTIVE', None),
                   patch.dict(sys.modules, {'story': fake_story})]
        for context in patches:
            context.start()
            self.addCleanup(context.stop)
        self.addCleanup(self.temporary.cleanup)
        self.edits = self.kit / 'maps/deusedix_tutorial.edits.json'
        self.story = self.kit / ('story/' + tutorial.MAP + '.json')
        self.built = self.kit / ('out/' + tutorial.MAP + '.dx')
        self.scene = self.kit / ('editor/cache/' + tutorial.MAP)
        self.runtime = self.root / ('src/DXP_training/Classes/UCEd_' + tutorial.MAP + '.uc')
        self.builds = []

    def write(self, path, content=b'user changed data'):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def build(self, script):
        self.assertEqual(script, tutorial.SCRIPT)
        self.assertFalse(self.edits.exists())
        self.assertEqual(self.story.read_bytes(), (self.src / 'story.json').read_bytes())
        self.builds.append(script)
        for extension in tutorial._OUTPUTS:
            self.write(self.built.with_name(tutorial.MAP + extension), ('clean ' + extension).encode())
        return True, ['built clean training']

    def test_prepare_runtime_seeds_story_without_resetting_or_building_a_session(self):
        self.assertTrue(tutorial.prepare_runtime())
        self.assertTrue(self.runtime.exists())
        self.assertEqual(self.story.read_bytes(), (self.src / 'story.json').read_bytes())
        self.assertFalse(tutorial.prepare_runtime())
        self.assertIsNone(tutorial.active_session())
        self.assertEqual(self.builds, [])

    def test_fresh_session_discards_old_edits_and_same_token_resumes(self):
        first = tutorial.start(self.build)
        self.write(self.edits, b'{"moved":{"TutorialCrate":true}}')
        self.write(self.story, b'{"dialogues":[{"id":"user"}]}')
        self.write(self.built, b'edited build')
        resumed = tutorial.start(self.build, first['session'])
        self.assertFalse(resumed['fresh'])
        self.assertFalse(resumed['rebuilt'])
        self.assertEqual(self.built.read_bytes(), b'edited build')
        second = tutorial.start(self.build)
        self.assertNotEqual(second['session'], first['session'])
        self.assertTrue(second['fresh'])
        self.assertTrue(second['restored'])
        self.assertFalse(self.edits.exists())
        self.assertEqual(self.built.read_bytes(), b'clean .dx')
        self.assertEqual(len(self.builds), 1)

    def test_end_cleans_only_map_resources_and_restores_stock_runtime(self):
        active = tutorial.start(self.build)['session']
        self.write(self.edits)
        self.write(self.scene / 'geometry.json')
        self.write(self.kit / ('textures/' + tutorial.MAP + '/paint.png'))
        self.write(self.root / ('maps/' + tutorial.MAP + '.dx'))
        self.write(self.installed / (tutorial.MAP + '.dx'))
        self.write(self.runtime, b'custom story code')
        keep = [self.write(self.kit / 'textures/_library/Keep.texture.json'),
                self.write(self.kit / 'textures/_tutorial/TrainingBurgundy.pcx'),
                self.write(self.kit / 'maps/other.edits.json'), self.write(self.kit / 'out/Other.dx'),
                self.write(self.kit / 'story/Other.json'), self.write(self.kit / 'editor/cache/_palette/index.json'),
                self.write(self.installed / 'Other.dx'), self.write(self.installed / 'Save/Current/player.dxs'),
                self.write(self.installed / ('Save/Current/' + tutorial.MAP + '.dxs')),
                self.write(self.installed / 'Save/Save0001/SaveInfo.dxs')]
        before = {p: p.read_bytes() for p in keep}
        ended = tutorial.end(active)
        self.assertTrue(ended['closed'])
        self.assertTrue(ended['storyRuntimeChanged'])
        self.assertIsNone(tutorial.active_session())
        self.assertFalse(self.edits.exists())
        self.assertFalse(self.scene.exists())
        self.assertFalse(self.built.exists())
        self.assertFalse((self.installed / (tutorial.MAP + '.dx')).exists())
        self.assertNotEqual(self.runtime.read_bytes(), b'custom story code')
        self.assertEqual(self.story.read_bytes(), (self.src / 'story.json').read_bytes())
        self.assertEqual(before, {p: p.read_bytes() for p in keep})

    def test_stale_tokens_never_resume_reset_or_end_newer_session(self):
        old = tutorial.start(self.build)['session']
        tutorial.end(old)
        active = tutorial.start(self.build)['session']
        self.write(self.edits)
        for token in (old, 'wrong', '', None):
            with self.assertRaises(ValueError):
                tutorial.require_session(token)
        with self.assertRaises(ValueError):
            tutorial.start(self.build, old)
        with self.assertRaises(ValueError):
            tutorial.reset(old)
        self.assertFalse(tutorial.end(old)['closed'])
        self.assertFalse(tutorial.end(None)['closed'])
        self.assertEqual(tutorial.active_session(), active)
        self.assertTrue(self.edits.exists())

    def test_corrupt_pristine_or_template_change_forces_clean_build(self):
        tutorial.start(self.build)
        folder = tutorial._cache_folder(tutorial._fingerprint())
        self.write(folder / ('output/' + tutorial.MAP + '.dx'), b'corrupt cache')
        self.assertTrue(tutorial.start(self.build)['rebuilt'])
        source = self.src / 'story.json'
        source.write_bytes(source.read_bytes() + b'\n')
        self.assertTrue(tutorial.start(self.build)['rebuilt'])
        self.assertEqual(len(self.builds), 3)

    def test_clean_scene_cache_reuses_export_and_mtime(self):
        active = tutorial.start(self.build)['session']
        clean = self.write(self.scene / 'geometry.json', b'clean geometry')
        stamp = clean.stat().st_mtime_ns
        self.write(self.scene / 'tex/Wall.png', b'original wall')
        self.assertTrue(tutorial.cache_scene(active))
        self.write(clean, b'edited geometry')
        self.write(self.edits)
        tutorial.end(active)
        tutorial.start(self.build)
        self.assertEqual(clean.read_bytes(), b'clean geometry')
        self.assertEqual(clean.stat().st_mtime_ns, stamp)
        self.assertEqual(len(self.builds), 1)

    def test_changed_scene_is_never_accepted_as_pristine(self):
        active = tutorial.start(self.build)['session']
        self.write(self.scene / 'geometry.json')
        self.write(self.edits)
        self.assertFalse(tutorial.cache_scene(active))
        self.edits.unlink()
        self.write(self.built, b'edited build')
        self.assertFalse(tutorial.cache_scene(active))

    def test_legacy_and_custom_project_installed_files_are_not_removed(self):
        self.assertTrue(tutorial.available())
        for kind in ('legacy', 'custom'):
            with self.subTest(kind=kind), patch.object(tutorial.settings, 'PROJECT_KIND', kind):
                self.assertFalse(tutorial.available())
                installed = self.write(self.installed / (tutorial.MAP + '.dx'))
                project = self.write(self.root / ('maps/' + tutorial.MAP + '.dx'))
                runtime = self.write(self.runtime)
                tutorial.start(self.build)
                self.assertEqual(installed.read_bytes(), b'user changed data')
                self.assertEqual(project.read_bytes(), b'user changed data')
                self.assertEqual(runtime.read_bytes(), b'user changed data')
        with patch.object(tutorial.settings, 'PROJECT_ID', 'another-tutorial'):
            self.assertFalse(tutorial.available())

    def test_failed_build_never_creates_session_or_pristine_snapshot(self):
        self.write(self.built, b'old user build')
        with self.assertRaisesRegex(RuntimeError, 'not built'):
            tutorial.start(lambda script: (False, ['compile failed']))
        self.assertIsNone(tutorial.active_session())
        self.assertFalse(self.built.exists())
        self.assertIsNone(tutorial._cache_manifest(tutorial._cache_folder(tutorial._fingerprint())))

    def test_reset_invalidates_token_before_a_cleanup_failure(self):
        active = tutorial.start(self.build)['session']
        with patch.object(tutorial, '_cleanup', side_effect=OSError('map is locked')):
            with self.assertRaises(OSError):
                tutorial.end(active)
        self.assertIsNone(tutorial.active_session())

    def test_process_restart_always_starts_clean_even_if_map_exists(self):
        tutorial.start(self.build)
        self.write(self.edits)
        self.write(self.built, b'old session build')
        tutorial._ACTIVE = None
        opened = tutorial.start(self.build)
        self.assertTrue(opened['fresh'])
        self.assertFalse(self.edits.exists())
        self.assertEqual(self.built.read_bytes(), b'clean .dx')

    def test_template_identity_cannot_redirect_cleanup(self):
        file = self.src / 'tutorial.json'
        value = json.loads(file.read_text(encoding='utf-8'))
        value['map'] = '../Other'
        file.write_text(json.dumps(value), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'identity'):
            tutorial.start(self.build)

    def test_cache_manifest_cannot_restore_outside_map(self):
        tutorial.start(self.build)
        folder = tutorial._cache_folder(tutorial._fingerprint())
        manifest_path = folder / 'manifest.json'
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        manifest['files']['scene/../../../Other'] = hashlib.sha256(b'escape').hexdigest()
        manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
        self.assertIsNone(tutorial._cache_manifest(folder))


if __name__ == '__main__':
    unittest.main()
