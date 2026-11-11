"""Independent campaigns do not resolve maps or gameplay state from the original campaign."""
import ast
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT / 'editor'), str(KIT), str(KIT.parent)]
import dxmaps
import gamecons
import mapfiles
import maplinks
import newmap
import play
import settings
import story

TUTORIAL = KIT / 'tutorial'         # the training map's template and its data, run as a copy (ProjectMapsTest)
# a run of a copy of that template in a fresh process, without its build: its level's properties, printed last
TEMPLATE_RUN = '''import json, runpy, sys
sys.path[:0] = [%r, %r]
import settings, t3d
settings.PROJECT_KIND = %r
module = runpy.run_path(%r)
print(json.dumps(next(a['props'] for a in t3d.actors('\\n'.join(module['s'].actors)) if a['cls'] == 'DeusExLevelInfo')))
'''


class ProjectMapsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='.project-maps-', dir=Path(__file__).parent)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.kit = self.root / 'tools/mapkit'
        self.maps = self.root / 'maps'
        self.game = self.root / 'game'
        self.originals = self.game / 'Maps'
        self.classes = self.root / 'src/Test/Classes'
        for folder in (self.kit / 'maps', self.kit / 'out', self.kit / 'story',
                       self.kit / 'editor/cache/_gamecons', self.maps, self.originals, self.classes):
            folder.mkdir(parents=True, exist_ok=True)
        patches = [patch.object(settings, 'PROJECT_KIND', 'custom', create=True),
                   patch.object(settings, 'GAME', self.game),
                   patch.object(dxmaps, 'KIT', self.kit), patch.object(dxmaps, 'OUT', self.kit / 'out'),
                   patch.object(dxmaps, 'MOD_MAPS', self.maps), patch.object(dxmaps, 'GAME_MAPS', self.originals),
                   patch.object(newmap.kit, 'PROJECT', self.root),
                   patch.object(maplinks.data, 'OUT', self.kit / 'out'),
                   patch.object(maplinks, 'CACHE', self.kit / 'editor/cache/_links.json'),
                   patch.object(maplinks, '_mem', {}),
                   patch.object(story, 'KIT', self.kit), patch.object(story, 'STORY', self.kit / 'story'),
                   patch.object(story, 'CLASSES', self.classes),
                   patch.object(gamecons, 'HERE', self.kit / 'editor')]
        for pending in patches:
            pending.start()
            self.addCleanup(pending.stop)

    def seed_maps(self):
        (self.originals / '01_Original.dx').write_bytes(b'original')
        (self.maps / '01_Mine.dx').write_bytes(b'project')
        (self.kit / 'maps/room.py').write_text("MAP = '02_Room'\n", encoding='utf-8')

    def test_custom_and_tutorial_only_list_project_maps(self):
        self.seed_maps()
        for kind in ('custom', 'tutorial'):
            with self.subTest(kind=kind), patch.object(settings, 'PROJECT_KIND', kind):
                self.assertEqual([row['map'] for row in dxmaps.listing()], ['01_Mine'])
                self.assertEqual(maplinks.all_maps(), ['01_Mine', '02_Room'])
                with self.assertRaises(FileNotFoundError):
                    dxmaps.source('01_Original')
                self.assertIsNone(maplinks.map_file('01_Original'))
                self.assertEqual(dxmaps.source('01_Mine').read_bytes(), b'project')

    def test_original_and_legacy_keep_original_map_resolution(self):
        self.seed_maps()
        for kind in ('original', 'legacy'):
            with self.subTest(kind=kind), patch.object(settings, 'PROJECT_KIND', kind):
                self.assertEqual({row['kind'] for row in dxmaps.listing()}, {'mod', 'game'})
                self.assertIn('01_Original', maplinks.all_maps())
                self.assertEqual(dxmaps.source('01_Original').read_bytes(), b'original')
        with patch.object(settings, 'PROJECT_KIND', 'legacy'):
            del settings.PROJECT_KIND
            self.assertFalse(dxmaps.isolated_project())

    def test_stale_original_build_cannot_reenter_an_independent_project(self):
        self.seed_maps()
        (self.kit / 'out/01_Original.dx').write_bytes(b'stale original preview')
        self.assertIsNone(maplinks.map_file('01_Original'))

    def generated_level_info(self, kind):
        with patch.object(settings, 'PROJECT_KIND', kind):
            script, name = newmap.create_empty(kind, 3)
        text = (self.kit / 'maps' / (script + '.py')).read_text(encoding='utf-8')
        compile(text, script, 'exec')
        tree = ast.parse(text)
        actor = next(node for node in ast.walk(tree) if isinstance(node, ast.Call)
                     and isinstance(node.func, ast.Attribute) and node.func.attr == 'actor'
                     and node.args and isinstance(node.args[0], ast.Constant)
                     and node.args[0].value == 'DeusExLevelInfo')
        return {kw.arg: ast.literal_eval(kw.value) for kw in actor.keywords}

    def test_new_independent_map_serializes_explicit_detached_hooks(self):
        from scene import Scene
        for kind in ('custom', 'tutorial'):
            with self.subTest(kind=kind):
                info = self.generated_level_info(kind)
                self.assertEqual(info['missionNumber'], 3)
                block = Scene._block('DeusExLevelInfo', (0, 0, 0), 'Info', None, '', info)
                self.assertIn('    Script=None\n', block)
                self.assertIn('    ConversationPackage="None"\n', block)
                self.assertNotIn('RevisionMission', block)

    def test_original_and_legacy_new_maps_keep_mission_hooks(self):
        for kind in ('original', 'legacy'):
            with self.subTest(kind=kind):
                info = self.generated_level_info(kind)
                self.assertEqual(info['Script'], "Class'RevisionMission.RevisionMission03'")
                self.assertEqual(info['ConversationPackage'], 'RevisionConversations')

    def test_explicit_original_copy_is_allowed_but_never_opens_original_normally(self):
        self.seed_maps()
        before = (self.originals / '01_Original.dx').read_bytes()
        with patch.object(newmap, 'copy_bytes', return_value=b'detached') as prepare:
            result = newmap.create_copy('MyCopy', 1, '01_Original')
        self.assertEqual(result, ('dx:01_MyCopy', '01_MyCopy'))
        self.assertEqual(prepare.call_args.args[0], self.originals / '01_Original.dx')
        self.assertEqual((self.maps / '01_MyCopy.dx').read_bytes(), b'detached')
        self.assertEqual((self.originals / '01_Original.dx').read_bytes(), before)
        with self.assertRaises(FileNotFoundError):
            dxmaps.source('01_Original')

    def test_copy_publishing_does_not_overwrite_a_concurrent_map(self):
        self.seed_maps()
        def prepare(*args, **kwargs):
            (self.maps / '01_Race.dx').write_bytes(b'other author')
            return b'ours'
        with patch.object(newmap, 'copy_bytes', side_effect=prepare):
            with self.assertRaises(FileExistsError):
                newmap.create_copy('Race', 1, '01_Original')
        self.assertEqual((self.maps / '01_Race.dx').read_bytes(), b'other author')

    def test_travel_accepts_only_project_destinations_and_local_teleports(self):
        self.seed_maps()
        edits = {'links': [{'do': [{'verb': 'travel', 'a': '02_room', 'b': 'Start'}]}],
                 'props': {'Local': {'URL': 'InsideDoor'}, 'LocalHash': {'URL': '"#InsideDoor"'},
                           'Other': {'URL': '01_Mine/Entry'}, 'Exit': {'DestMap': '01_Mine'}}}
        authored = {'events': [{'do': [{'type': 'travel', 'map': '01_Mine', 'tag': 'Start'}]}]}
        original = json.dumps([edits, authored], sort_keys=True)
        maplinks.validate_travel(edits, authored)
        self.assertEqual(json.dumps([edits, authored], sort_keys=True), original)
        for invalid in ({'links': [{'do': [{'verb': 'travel', 'a': '01_Original'}]}]},
                        {'props': {'Exit': {'DestMap': '01_Original'}}},
                        {'added': [{'props': {'URL': '01_Original#Start'}}]}):
            with self.subTest(payload=invalid), self.assertRaisesRegex(ValueError, '01_Original'):
                maplinks.validate_travel(edits=invalid)
        with self.assertRaisesRegex(ValueError, '01_Original'):
            maplinks.validate_travel(story_data={'dialogues': [{'steps': [{'type': 'do', 'do': [
                {'type': 'travel', 'map': '01_Original'}]}]}]})
        maplinks.validate_travel(story_data={'events': [{'do': [{'type': 'travel', 'map': ''}]}]})

    def test_legacy_travel_remains_unrestricted(self):
        with patch.object(settings, 'PROJECT_KIND', 'legacy'):
            maplinks.validate_travel(story_data={'events': [{'do': [{'type': 'travel', 'map': 'External'}]}]})

    def test_links_report_unknown_exits_without_warning_about_local_tags(self):
        self.seed_maps()
        points = [dict(name='Exit', cls='MapExit', url='01_Original#Start', tag=''),
                  dict(name='Local', cls='Teleporter', url='InsideDoor', tag=''),
                  dict(name='LocalHash', cls='Teleporter', url='#InsideDoor', tag=''),
                  dict(name='Start', cls='PlayerStart', url='', tag='')]
        with patch.object(maplinks, 'points', side_effect=lambda name, *args: points if name == '01_Mine' else []):
            result = maplinks.links('01_Mine')
        self.assertEqual([p['name'] for p in result['unresolved']], ['Exit'])
        self.assertEqual(len(result['warnings']), 1)

    def test_custom_flags_do_not_mix_runtime_route_or_cached_original_flags(self):
        (self.classes / 'UCRouteKeeper.uc').write_text("GetF('OriginalRoute');", encoding='latin1')   # a class of a legacy mod
        (self.classes / 'UCEd_01_Mine.uc').write_text("SetF('MyCompiledFlag', True);", encoding='latin1')
        (self.kit / 'story/01_Mine.json').write_text('{"events":[{"flag":"MyAuthoredFlag"}]}', encoding='utf-8')
        (self.kit / 'editor/cache/_gamecons/game.json').write_text('{"flags":{"OriginalMission":{}}}', encoding='utf-8')
        self.assertEqual(story.known_flags(), ['MyAuthoredFlag', 'MyCompiledFlag'])
        with patch.object(settings, 'PROJECT_KIND', 'legacy'):
            self.assertEqual(story.known_flags(), ['MyAuthoredFlag', 'MyCompiledFlag', 'OriginalMission', 'OriginalRoute'])

    def test_custom_play_does_not_implicitly_set_the_unatco_route(self):
        self.assertEqual(play.flags_text(True, 'MyFlag=1,Other=0'), 'MyFlag=1,Other=0')
        with patch.object(settings, 'PROJECT_KIND', 'legacy'):
            self.assertEqual(play.flags_text(True, ''), 'UNATCORouteCommitted=1')

    def test_detached_map_has_no_original_conversations_or_global_flags(self):
        scene = self.kit / 'editor/cache/01_Mine/scene.t3d'
        scene.parent.mkdir(parents=True)
        for package in ('"None"', '""'):
            scene.write_text('Begin Actor Class=DeusExLevelInfo Name=Info\nmissionNumber=1\nConversationPackage=%s\nEnd Actor\n' % package,
                             encoding='latin1')
            with self.subTest(package=package), patch.object(gamecons, 'catalog', side_effect=AssertionError('must not read original catalogue')):
                result = gamecons.for_map('01_Mine', [{'name': 'Alex', 'bind': 'AlexJacobson'}])
                self.assertEqual(result['conversations'], [])
                self.assertEqual(result['actors'], {})
                self.assertEqual(result['flags'], {})

    def test_tutorial_template_detaches_only_the_training_project(self):
        # Execute the authored template without building it, then inspect its actual T3D actors. Each run is a fresh
        # process from a copy of the template in this test's kit, as build_cached.py runs a map's script: the textures
        # it makes go there, never into the kit's own (textures\_tutorial, which every map's record of Play's
        # preparation counts), and made again they keep their files (re-test 3 of 31 Oct 2026, #8).
        (self.kit / 'tutorial').mkdir()
        for path in TUTORIAL.glob('*'):
            if path.suffix in ('.py', '.json'):
                shutil.copy2(path, self.kit / 'tutorial' / path.name)
        stats = lambda folder: sorted((p.name, p.stat().st_size, p.stat().st_mtime_ns) for p in folder.glob('*'))
        own, made = stats(KIT / 'textures' / '_tutorial'), []
        for kind in ('tutorial', 'legacy'):
            with self.subTest(kind=kind):
                run = subprocess.run([sys.executable, '-B', '-c', TEMPLATE_RUN % (
                    str(KIT), str(KIT / 'editor'), kind, str(self.kit / 'tutorial' / 'tutorial_map.py'))],
                    capture_output=True, text=True, encoding='utf-8', errors='replace',
                    env=dict(os.environ, PYTHONIOENCODING='utf-8'))
                self.assertEqual(run.returncode, 0, run.stderr[-2000:])
                info = json.loads(run.stdout.splitlines()[-1])
                self.assertEqual(info['Script'], 'None')
                self.assertEqual(info['ConversationPackage'], '"None"' if kind == 'tutorial' else 'RevisionConversations')
            made.append(stats(self.kit / 'textures' / '_tutorial'))
        self.assertTrue(made[0], 'its signs, carpet and crate')
        self.assertEqual(made[1], made[0], 'made again: every file as the first run left it')
        self.assertEqual(stats(KIT / 'textures' / '_tutorial'), own, "the kit's own textures untouched")


if __name__ == '__main__':
    unittest.main()
