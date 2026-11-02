"""Project isolation uses synthetic application trees; no real registry, game or worker."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
# an existing workspace in development mode: its devmode.json
DEV = dict(name='Existing mod', package='ExistingMod', mapsDir='ExistingMaps', animsPackage='ExistingAnims',
           modelsPackage='ExistingModels', soundsPackage='ExistingSounds')
sys.path.insert(0, str(KIT))
import projects


class ProjectsTests(unittest.TestCase):
    def setUp(self):
        self.temp_parent = KIT / 'backup/project_manager_20261014/test-runs'
        self.temp_parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=self.temp_parent, prefix='project-')
        self.base = Path(self.temp.name)
        self.app = self.base / 'app'
        self.code = self.app / 'tools/mapkit'
        self.store = self.base / 'projects'
        self.game = self.base / 'game'
        self.write('deusedix.json', json.dumps({'game': str(self.game), 'package': 'DeusEdix'}))
        for name, content in {
            'tools/mapkit/settings.py': KIT.joinpath('settings.py').read_text(encoding='utf-8'),
            'tools/mapkit/kit.py': '# application kit\n',
            'tools/mapkit/project_server.py': '# supervisor\n',
            'tools/mapkit/project_game.py': '# active project paths\n',
            'tools/mapkit/editor/server.py': '# server\n',
            'tools/mapkit/editor/static/app.js': 'window.application = 1;\n',
            'tools/mapkit/editor/static/picture.svg': '<svg/>',
            'tools/mapkit/editor/static/audio/tutorial-music.mp3': 'own tutorial music',
            'tools/mapkit/tutorial/tutorial.json': '{"steps":[]}',
            'tools/mapkit/catalog/sizes.json': '{}',
            'tools/mapkit/bin/UCMapKitHost.exe': 'synthetic host',
            'tools/mapkit/bin/UCEngineBridge.dll': 'synthetic engine bridge',
            'tools/mapkit/bin/DeusEdixNav.u': 'synthetic native package',
            'tools/mapkit/bin/DeusEdixNav.dll': 'synthetic native package DLL',
            'tools/mapkit/bin/private.obj': 'not shipped',
            'tools/ue1pkg.py': '# package reader',
            'docs/tutorials/07-map-editor.md': '# Editor guide',
            'tools/mapkit/maps/secret.py': 'PRIVATE MAP',
            'tools/mapkit/story/Private.json': 'PRIVATE STORY',
            'tools/mapkit/sounds/Private.wav': 'PRIVATE SOUND',
            'tools/mapkit/editor/cache/user.json': 'PRIVATE CACHE',
            'tools/mapkit/tests/private.py': 'not shipped',
            'tools/mapkit/project-template/src/DeusEdix/Classes/UCBoot.uc':
                'class UCBoot extends Actor;\nX=Class\'DeusEdix.UCScene\';\n'
                'Y="DeusEdixSounds.D"; Z="DeusEdixAnims.Mesh";\n'
                'if (Left(s,9)=="DeusEdix:") Log("DeusEdix: original marker");\n',
            'tools/mapkit/project-template/src/DeusEdix/Classes/UCVoiceDubs.uc': '// empty user registry',
            'tools/mapkit/project-template/src/DeusEdix/Classes/UCPortraits.uc': '// empty portraits',
            'tools/mapkit/project-template/src/DeusEdix/Textures/UCFade.pcx': 'synthetic own texture',
        }.items():
            self.write(name, content)
        self.manager = projects.ProjectManager(self.app, self.store)

    def tearDown(self):
        self.assertTrue(self.base.resolve().is_relative_to(self.temp_parent.resolve()))
        self.temp.cleanup()

    def write(self, relative, content):
        path = self.app / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8')
        return path

    def test_builtins_list_without_provision_or_legacy_modification(self):
        before = (self.code / 'maps/secret.py').read_bytes()
        rows = self.manager.list_projects()
        self.assertEqual({r['id'] for r in rows}, {'legacy', 'deusex-story', 'training', 'training-revision', 'deusex-goty', 'training-vanilla'})
        self.assertEqual(self.manager.provision('legacy')['path'], str(self.app))
        self.assertEqual((self.code / 'maps/secret.py').read_bytes(), before)
        self.assertFalse((self.store / 'training').exists())
        self.assertFalse((self.app / projects.MANIFEST).exists())

    def test_custom_workspaces_are_empty_and_independent(self):
        a, b = self.manager.create('Alpha'), self.manager.create('Beta')
        self.assertNotEqual(a['package'], b['package'])
        for meta in (a, b):
            path = Path(meta['path'])
            self.assertEqual(list((path / 'maps').glob('*.dx')), [])
            for folder in ('maps', 'story', 'sounds'):
                self.assertEqual(list((path / 'tools/mapkit' / folder).iterdir()), [])
            self.assertFalse((path / 'tools/mapkit/editor/cache/user.json').exists())
            self.assertFalse((path / 'tools/mapkit/tests').exists())
            self.assertFalse((path / 'tools/mapkit/bin/private.obj').exists())
            self.assertTrue((path / 'tools/mapkit/project_server.py').is_file())
            self.assertTrue((path / 'tools/mapkit/project_game.py').is_file())
            self.assertTrue((path / 'tools/mapkit/editor/static/audio/tutorial-music.mp3').is_file())
            self.assertTrue((path / 'tools/ue1pkg.py').is_file())
            self.assertEqual((path / 'docs/guide/guide.md').read_text(), '# Editor guide')
            cfg = json.loads((path / 'deusedix.json').read_text())
            self.assertEqual(cfg['mapsDir'], 'DeusEdixProjects/' + meta['id'])
            self.assertEqual(cfg['soundsPackage'], meta['package'] + 'Sounds')
        (Path(a['path']) / 'tools/mapkit/story/SameMap.json').write_text('A')
        self.assertFalse((Path(b['path']) / 'tools/mapkit/story/SameMap.json').exists())

    def test_clean_namespace_preserves_conversation_provenance(self):
        meta = self.manager.create('Runtime')
        text = (Path(meta['path']) / 'src' / meta['package'] / 'Classes/UCBoot.uc').read_text()
        self.assertIn("Class'%s.UCScene'" % meta['package'], text)
        self.assertIn('"%sSounds.D"' % meta['package'], text)
        self.assertIn('"%sAnims.Mesh"' % meta['package'], text)
        self.assertIn('Left(s,9)=="DeusEdix:"', text)
        self.assertIn('Log("DeusEdix: original marker")', text)

    def test_builtin_provision_is_private(self):
        original = self.manager.provision('deusex-story')
        training = self.manager.provision('training')
        self.assertEqual(original['kind'], 'original')
        self.assertEqual(training['kind'], 'tutorial')
        self.assertNotEqual(original['package'], training['package'])
        self.assertEqual(list((Path(training['path']) / 'tools/mapkit/maps').iterdir()), [])

    def test_original_and_revision_tutorials_have_separate_runtime_and_data(self):
        self.write('tools/mapkit/project-template/vanilla/Classes/UCBoot.uc', 'class UCBoot extends Actor; // vanilla\n')
        revision = self.manager.provision('training-revision')
        vanilla = self.manager.provision('training-vanilla')
        self.assertEqual(projects._target(revision.get('target')), 'revision')
        self.assertEqual(vanilla['target'], 'vanilla')
        self.assertNotEqual(revision['package'], vanilla['package'])
        self.assertNotEqual(revision['path'], vanilla['path'])
        for project in (revision, vanilla):
            root = Path(project['path'])
            cfg = json.loads((root/'deusedix.json').read_text())
            self.assertEqual(cfg['mapsDir'],'DeusEdixProjects/'+project['id'])
        runtime = Path(vanilla['path'])/'src'/vanilla['package']/'Classes/UCBoot.uc'
        self.assertIn('// vanilla',runtime.read_text())

    def test_refresh_preserves_user_data_and_generated_runtime(self):
        meta = self.manager.create('Refresh')
        root = Path(meta['path'])
        generated = root / 'src' / meta['package'] / 'Classes/UCVoiceDubs.uc'
        generated.write_text('// user voice index')
        story = root / 'tools/mapkit/story/Keep.json'
        story.write_text('{"keep":true}')
        catalog = root / 'tools/mapkit/catalog/sizes.json'
        catalog.write_text('{"new_object":{"height":32}}')
        self.write('tools/mapkit/editor/static/app.js', 'window.application = 2;')
        self.write('tools/mapkit/editor/static/new.js', '// new module')
        self.manager.provision(meta['id'])
        self.assertEqual((root / 'tools/mapkit/editor/static/app.js').read_text(), 'window.application = 2;')
        self.assertTrue((root / 'tools/mapkit/editor/static/new.js').exists())
        self.assertEqual(generated.read_text(), '// user voice index')
        self.assertEqual(story.read_text(), '{"keep":true}')
        self.assertEqual(catalog.read_text(), '{"new_object":{"height":32}}')
        self.assertNotIn(generated.relative_to(root).as_posix(), json.loads((root / projects.OWNED).read_text())['files'])

    def test_conflict_stops_refresh_before_any_other_owned_file_changes(self):
        meta = self.manager.create('Conflict')
        root = Path(meta['path'])
        local = root / 'tools/mapkit/editor/static/app.js'
        local.write_text('// Claude changed this')
        server = root / 'tools/mapkit/editor/server.py'
        before = server.read_bytes()
        self.write('tools/mapkit/editor/server.py', '# newer server')
        self.write('tools/mapkit/editor/static/app.js', '// newer canonical app')
        with self.assertRaises(projects.ProjectConflictError) as error:
            self.manager.provision(meta['id'])
        self.assertIn('tools/mapkit/editor/static/app.js', error.exception.conflicts)
        self.assertEqual(local.read_text(), '// Claude changed this')
        self.assertEqual(server.read_bytes(), before)

    def test_infolink_style_is_project_data_even_if_old_manifest_owned_it(self):
        self.write('tools/mapkit/project-template/src/DeusEdix/Classes/UCInfoLinkStyle.uc', '// default style')
        meta = self.manager.create('Style')
        root = Path(meta['path'])
        rel = 'src/' + meta['package'] + '/Classes/UCInfoLinkStyle.uc'
        owned = json.loads((root / projects.OWNED).read_text())
        owned['files'][rel] = projects._hash(b'// default style')
        (root / projects.OWNED).write_text(json.dumps(owned))
        (root / rel).write_text('// generated red Contractor style')
        self.write('tools/mapkit/editor/static/app.js', '// particles update')
        result = self.manager.provision(meta['id'], preserve_local=True)
        self.assertNotIn('updateWarning', result)
        self.assertEqual((root / rel).read_text(), '// generated red Contractor style')
        self.assertEqual((root / 'tools/mapkit/editor/static/app.js').read_text(), '// particles update')
        self.assertNotIn(rel, json.loads((root / projects.OWNED).read_text())['files'])
        self.assertTrue(Path(result['updateNotice']['backup']).is_dir())

    def test_updates_merge_separate_local_changes_and_keep_them_next_time(self):
        rel = 'tools/mapkit/editor/static/app.js'
        self.write(rel, 'const version = 1;\nconst custom = false;\nconst end = 0;\n')
        meta = self.manager.create('Merge')
        root = Path(meta['path'])
        (root / rel).write_text('const version = 1;\nconst custom = true;\nconst end = 0;\n')
        self.write(rel, 'const version = 2;\nconst custom = false;\nconst end = 0;\n')
        result = self.manager.provision(meta['id'], preserve_local=True)
        self.assertNotIn('updateWarning', result)
        self.assertEqual((root / rel).read_text(), 'const version = 2;\nconst custom = true;\nconst end = 0;\n')
        backup = Path(result['updateNotice']['backup']) / 'files' / rel
        self.assertIn('const version = 1;', backup.read_text())
        self.write(rel, 'const version = 3;\nconst custom = false;\nconst end = 0;\n')
        self.manager.provision(meta['id'], preserve_local=True)
        self.assertEqual((root / rel).read_text(), 'const version = 3;\nconst custom = true;\nconst end = 0;\n')
        count = len(list((root / '.deusedix-updates').iterdir()))
        self.manager.provision(meta['id'], preserve_local=True)
        self.assertEqual(count, len(list((root / '.deusedix-updates').iterdir())))

    def test_conflict_can_update_with_backup_without_replacing_map_data(self):
        meta = self.manager.create('Repair')
        root = Path(meta['path'])
        rel = 'tools/mapkit/editor/static/app.js'
        (root / rel).write_text('// local editor patch')
        (root / 'maps/Keep.dx').write_bytes(b'private map')
        self.write(rel, '// newer editor')
        warning = self.manager.provision(meta['id'], preserve_local=True)['updateWarning']
        self.assertTrue(warning['canUpdate'])
        self.assertEqual((root / rel).read_text(), '// local editor patch')
        result = self.manager.provision(meta['id'], update_local=True)
        self.assertEqual((root / rel).read_text(), '// newer editor')
        self.assertEqual((Path(result['updateNotice']['backup']) / 'files' / rel).read_text(), '// local editor patch')
        self.assertEqual((root / 'maps/Keep.dx').read_bytes(), b'private map')

    def test_failed_update_rolls_back_files_and_ownership(self):
        meta = self.manager.create('Rollback')
        root = Path(meta['path'])
        app = 'tools/mapkit/editor/static/app.js'
        server = 'tools/mapkit/editor/server.py'
        before = {rel: (root / rel).read_bytes() for rel in (app, server, projects.OWNED, projects.BASE)}
        self.write(app, '// new app')
        self.write(server, '# new server')
        write = projects._write
        def fail(path, data):
            if path == root / app and data == b'// new app':
                raise OSError('simulated locked file')
            return write(path, data)
        with patch.object(projects, '_write', side_effect=fail):
            with self.assertRaises(OSError):
                self.manager.provision(meta['id'])
        for rel, data in before.items():
            self.assertEqual((root / rel).read_bytes(), data)

    def test_merge_refuses_overlap_and_same_position_insertions(self):
        self.assertIsNone(projects._merge_editor(b'a\nb\n', b'a\nlocal\nb\n', b'a\nnew\nb\n'))
        self.assertIsNone(projects._merge_editor(b'a\nb\n', b'a\nlocal\n', b'a\nnew\n'))
        self.assertEqual(projects._merge_editor(b'a\nb\nc\n', b'local\r\nb\r\nc\r\n', b'a\nb\nnew\n'),
                         b'local\r\nb\r\nnew\r\n')

    def test_create_rejects_unsafe_names_and_existing_content(self):
        for name in ('', '  ', '../Bad', 'Bad\\Name', 'CON', 'A\x00B', 'x' * 81):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.manager.create(name)
        occupied = self.base / 'occupied'
        occupied.mkdir()
        sentinel = occupied / 'keep.txt'
        sentinel.write_text('unchanged')
        with self.assertRaises(FileExistsError):
            self.manager.create('Safe', occupied)
        self.assertEqual(sentinel.read_text(), 'unchanged')

    def test_create_rejects_game_application_and_nested_projects(self):
        a = self.manager.create('Alpha')
        for folder in (self.game / 'map', self.app, self.app / 'tools/new', Path(a['path']) / 'nested', self.base):
            with self.subTest(folder=folder), self.assertRaises((ValueError, FileExistsError)):
                self.manager.create('Unsafe', folder)

    def test_open_existing_registers_identity_and_refuses_duplicate_copy(self):
        meta = self.manager.create('Portable', self.base / 'portable')
        other = projects.ProjectManager(self.app, self.base / 'other-registry')
        self.assertEqual(other.open_project(meta['path']), meta)
        clone = self.base / 'duplicate'
        shutil.copytree(meta['path'], clone)
        with self.assertRaises(ValueError):
            other.open_project(clone)

    def test_no_unknown_runtime_or_generated_story_is_seeded(self):
        self.write('tools/mapkit/project-template/src/DeusEdix/Classes/UCEd_Private.uc', '// private story')
        with self.assertRaises(ValueError):
            self.manager.create('Invalid template')
        self.assertEqual(len(self.manager.list_projects()), 6)

    def test_registry_override_does_not_touch_real_projects(self):
        with patch.dict(os.environ, {'DEUSEDIX_APP_ROOT': str(self.app), 'DEUSEDIX_PROJECTS_DIR': str(self.store)}):
            self.assertEqual(projects.default_location(), str(self.store))
            self.assertEqual(len(projects.list_projects()), 6)

    def test_package_aliases_cannot_be_registered_as_different_projects(self):
        for ident in ('same-id', 'same_id'):
            folder = self.base / ident
            folder.mkdir()
            (folder / projects.MANIFEST).write_text(json.dumps(dict(version=1, id=ident, name=ident,
                kind='custom', package='DXP_same_id')))
        self.manager.open_project(self.base / 'same-id')
        with self.assertRaises(ValueError):
            self.manager.open_project(self.base / 'same_id')
        with self.assertRaises(ValueError):
            self.manager.provision(self.base / 'same_id')
        self.assertFalse((self.base / 'same_id/tools').exists())

    def test_invalid_data_folder_preflight_preserves_owned_code(self):
        meta = self.manager.create('Preflight')
        root = Path(meta['path'])
        before = (root / 'tools/mapkit/editor/server.py').read_bytes()
        self.write('tools/mapkit/editor/server.py', '# new server')
        # Use an additional expected empty folder as a conflicting file.
        with patch.object(projects, 'DATA_DIRS', projects.DATA_DIRS + ('user-folder',)):
            (root / 'user-folder').write_text('keep this file')
            with self.assertRaises(ValueError):
                self.manager.provision(meta['id'])
        self.assertEqual((root / 'tools/mapkit/editor/server.py').read_bytes(), before)
        self.assertEqual((root / 'user-folder').read_text(), 'keep this file')

    def test_registry_and_unregistered_nested_workspace_paths_are_rejected(self):
        for folder in (self.app, self.base, self.game / 'Projects'):
            with self.subTest(folder=folder), self.assertRaises(ValueError):
                projects.ProjectManager(self.app, folder)
        parent = self.base / 'external-project'
        parent.mkdir()
        (parent / projects.MANIFEST).write_text('{}')
        with self.assertRaises(ValueError):
            self.manager.create('Nested', parent / 'child')

    def test_builtin_identity_kind_cannot_be_repurposed(self):
        folder = self.store / 'training'
        folder.mkdir(parents=True)
        (folder / projects.MANIFEST).write_text(json.dumps(dict(version=1, id='training', name='Other',
            kind='custom', package='DXP_training')))
        with self.assertRaises(ValueError):
            self.manager.provision('training')
        self.assertFalse((folder / 'tools').exists())

    def workspace(self, name='Existing mod', package=None):
        root = self.base / name
        for rel in ('maps', 'tools/mapkit/maps', 'tools/mapkit/editor',
                    'src/' + (package or DEV['package']) + '/Classes'):
            (root / rel).mkdir(parents=True, exist_ok=True)
        for rel in ('settings.py', 'project_server.py', 'kit.py'):
            shutil.copy2(KIT / rel, root / 'tools/mapkit' / rel)
        (root / 'tools/mapkit/editor/server.py').write_text('# user editor')
        (root / 'tools/mapkit/maps/roof.edits.json').write_text('{"keep":true}')
        (root / 'maps/roof.dx').write_bytes(b'authored map')
        if package:
            (root / 'deusedix.json').write_text(json.dumps(dict(package=package, target='vanilla', game=str(self.game))))
        else:                                   # development mode: the mod's names (settings.devmode)
            (root / 'devmode.json').write_text(json.dumps(DEV))
        return root

    @staticmethod
    def snapshot(root):
        return {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}

    def test_existing_workspace_registers_and_opens_without_conversion(self):
        root = self.workspace()
        before = self.snapshot(root)
        meta = self.manager.open_project(root)
        self.assertTrue(meta['external'])
        self.assertEqual(meta['kind'], 'workspace')
        self.assertEqual(meta['package'], DEV['package'])
        self.assertEqual(self.manager.open_project(root), meta)
        self.assertEqual(self.manager.provision(meta['id']), meta)
        self.assertEqual(self.snapshot(root), before)
        self.assertFalse((root / projects.MANIFEST).exists())
        self.assertFalse((root / projects.OWNED).exists())
        self.assertEqual(len([p for p in self.manager.list_projects() if p['id'] == meta['id']]), 1)

    def test_existing_workspace_keeps_game_and_package_and_refuses_alias(self):
        root = self.workspace('Other mod', 'MyMod')
        meta = self.manager.open_project(root)
        self.assertEqual(meta['target'], 'vanilla')
        self.assertEqual(meta['package'], 'MyMod')
        duplicate = self.workspace('Duplicate mod', 'MyMod')
        with self.assertRaises(ValueError):
            self.manager.open_project(duplicate)

    def test_untracked_workspace_explains_why_installer_did_not_update_it(self):
        root = self.workspace()
        meta = self.manager.open_project(root)
        before = self.snapshot(root)
        result = self.manager.provision(meta['id'], preserve_local=True)
        self.assertIn('updateWarning', result)
        self.assertFalse(result['updateWarning']['canUpdate'])
        self.assertEqual(self.snapshot(root), before)

    def test_integrated_workspace_updates_and_keeps_private_campaign_and_aliases(self):
        root = self.workspace()
        meta = self.manager.open_project(root)
        payload, _ = self.manager._payload(meta)
        # A maintainer has integrated the shared files once and recorded the baseline.
        for rel, data in payload.items():
            if rel.startswith('src/'):
                continue
            target = root / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        baseline = {rel: value for rel, value in payload.items() if not rel.startswith('src/')}
        (root / projects.BASE).write_bytes(projects._base_bytes(baseline))
        (root / projects.OWNED).write_text(json.dumps(dict(version=1,files={rel:projects._hash(b) for rel,b in baseline.items()})))
        custom = root / 'src' / DEV['package'] / 'Classes/UCBoot.uc'
        custom.write_text('// private campaign startup')
        self.write('tools/mapkit/project-template/src/DeusEdix/Classes/UCParticles.uc', 'class UCParticles extends Actor;')
        self.write('tools/mapkit/project-template/src/DeusEdix/Classes/UCViewMoment.uc', 'X="DeusEdixAnims.Mesh";')
        self.write('tools/mapkit/editor/static/app.js', '// updated Effects browser')
        result = self.manager.provision(meta['id'], preserve_local=True)
        self.assertNotIn('updateWarning', result)
        self.assertEqual(custom.read_text(), '// private campaign startup')
        self.assertEqual((root / 'maps/roof.dx').read_bytes(), b'authored map')
        self.assertEqual((root / 'tools/mapkit/editor/static/app.js').read_text(), '// updated Effects browser')
        self.assertIn('ExistingAnims.Mesh', (root / 'src' / DEV['package'] / 'Classes/UCViewMoment.uc').read_text())
        self.assertTrue((root / 'src' / DEV['package'] / 'Classes/UCParticles.uc').is_file())

    def test_incomplete_or_old_workspace_is_not_registered(self):
        root = self.workspace()
        source = root / 'tools/mapkit/settings.py'
        source.write_text('# old workspace')
        before = self.snapshot(root)
        with self.assertRaisesRegex(ValueError, 'compatibility update'):
            self.manager.open_project(root)
        self.assertEqual(self.snapshot(root), before)
        self.assertFalse(any(p.get('external') for p in self.manager.list_projects()))
        with self.assertRaises(ValueError):
            self.manager.open_project(self.base / 'random')

    def test_corrupt_managed_manifest_does_not_fall_back_to_workspace(self):
        root = self.workspace()
        (root / projects.MANIFEST).write_text('{broken')
        with self.assertRaises(ValueError):
            self.manager.open_project(root)
        self.assertFalse(any(p.get('external') for p in self.manager.list_projects()))

    def test_existing_workspace_refuses_namespace_change_before_provision(self):
        root = self.workspace('My mod', 'MyMod')
        meta = self.manager.open_project(root)
        (root / 'deusedix.json').write_text(json.dumps(dict(package='Changed', target='vanilla')))
        (root / 'src/Changed/Classes').mkdir(parents=True)
        before = self.snapshot(root)
        with self.assertRaisesRegex(ValueError, 'identity changed'):
            self.manager.provision(meta['id'])
        self.assertEqual(self.snapshot(root), before)

    def test_external_worker_retains_original_runtime_settings(self):
        root = self.workspace()
        meta = self.manager.open_project(root)
        file = root / 'tools/mapkit/settings.py'
        spec = importlib.util.spec_from_file_location('external_settings_test', file)
        env = dict(DEUSEDIX_APP_ROOT=str(self.app), DEUSEDIX_PROJECT_WORKER='1',
                   DEUSEDIX_PROJECT_ID=meta['id'], DEUSEDIX_WORKSPACE_ID=meta['id'])
        with patch.dict(os.environ, env):
            worker = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(worker)
        self.assertEqual(worker.current(), meta)
        self.assertFalse(worker.MANAGED_PROJECT)
        self.assertFalse(worker.STANDALONE)
        self.assertEqual(worker.PACKAGE, DEV['package'])
        self.assertEqual(worker.MAPS_DIR_NAME, DEV['mapsDir'])
        self.assertEqual(worker.ANIMS_PACKAGE, DEV['animsPackage'])
        self.assertEqual(worker.MODELS_PACKAGE, DEV['modelsPackage'])
        self.assertEqual(worker.SOUNDS_PACKAGE, DEV['soundsPackage'])
        self.assertEqual(worker.GAME_CACHE, root / 'tools/mapkit/editor/cache')
        with patch.dict(os.environ, dict(env, DEUSEDIX_WORKSPACE_ID='workspace-wrong')):
            with self.assertRaisesRegex(ValueError, 'different existing workspace'):
                spec.loader.exec_module(importlib.util.module_from_spec(spec))

    def test_registered_workspace_paths_cannot_overlap_and_forged_id_is_rejected(self):
        root = self.workspace()
        meta = self.manager.open_project(root)
        with self.assertRaises(ValueError):
            self.manager.create('Nested', root / 'nested')
        registry = json.loads(self.manager.registry.read_text())
        next(p for p in registry['projects'] if p['id'] == meta['id'])['id'] = 'workspace-wrong'
        self.manager.registry.write_text(json.dumps(registry))
        with self.assertRaisesRegex(ValueError, 'workspace identity'):
            self.manager.list_projects()

    def test_worker_settings_use_immutable_project_identity(self):
        meta = self.manager.create('Worker')
        file = Path(meta['path']) / 'tools/mapkit/settings.py'
        spec = importlib.util.spec_from_file_location('project_settings_test', file)
        module = importlib.util.module_from_spec(spec)
        with patch.dict(os.environ, {'DEUSEDIX_APP_ROOT': str(self.app)}):
            spec.loader.exec_module(module)
        self.assertTrue(module.MANAGED_PROJECT)
        self.assertTrue(module.INDEPENDENT_PROJECT)
        self.assertFalse(module.ALLOW_ORIGINAL_MAPS)
        self.assertEqual(module.current(), meta)
        self.assertEqual(module.SOUNDS_PACKAGE, meta['package'] + 'Sounds')
        self.assertEqual(module.MAPS_DIR, self.game / 'Revision/DeusEdixProjects' / meta['id'])
        wrong = importlib.util.module_from_spec(spec)
        with patch.dict(os.environ, {'DEUSEDIX_PROJECT_WORKER': '1', 'DEUSEDIX_PROJECT_ID': 'another'}):
            with self.assertRaises(ValueError):
                spec.loader.exec_module(wrong)
        cfg = Path(meta['path']) / 'deusedix.json'
        value = json.loads(cfg.read_text())
        value['mapsDir'] = 'DeusEdixProjects/another'
        cfg.write_text(json.dumps(value))
        invalid = importlib.util.module_from_spec(spec)
        with self.assertRaises(ValueError):
            spec.loader.exec_module(invalid)


if __name__ == '__main__':
    unittest.main()
