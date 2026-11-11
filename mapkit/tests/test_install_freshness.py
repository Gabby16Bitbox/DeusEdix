"""Install must never consume edits that are newer than the playable build."""
import ast
import hashlib
import json
from pathlib import Path
import shutil
import sys
from unittest.mock import patch
import tempfile
import time
import types
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'editor' / 'dxmaps.py'
sys.path[:0] = [str(SOURCE.parents[1]), str(SOURCE.parent)]     # load_edits imports logicruntime, missionphases

class InstallFreshnessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.players = types.SimpleNamespace(build_dependency=lambda _: None, blocks=lambda _: [])
        module = patch.dict(sys.modules, {'player_profiles': self.players})
        module.start(); self.addCleanup(module.stop)
        self.mods, self.out = self.root / 'maps', self.root / 'out'
        self.mods.mkdir(); self.out.mkdir(); (self.root / 'kit' / 'maps').mkdir(parents=True)
        self.source = self.mods / 'Fixture.dx'
        self.source.write_bytes(b'original editable map')
        (self.out / 'Fixture.dx').write_bytes(b'playable build A')
        names = {'stamp', 'edits_path', 'load_edits', '_info_path', 'built_current', 'install', '_edits_fingerprint',
                 'has_logic'}
        tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
        self.scope = dict(hashlib=hashlib, json=json, Path=Path, shutil=shutil, time=time,
                          KIT=self.root / 'kit', OUT=self.out, MOD_MAPS=self.mods,
                          source=lambda _: self.source, _authoring=lambda _: None,
                          _authoring_path=lambda _: self.root / 'editable' / 'Fixture.dx',
                          activation=types.SimpleNamespace(names=lambda _: set()))
        exec(compile(ast.Module(body=[node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names],
                                type_ignores=[]), str(SOURCE), 'exec'), self.scope)
        self.edits = self.scope['edits_path']('Fixture')
        self.old = {'moved': {'Chair1': {'loc': [1, 2, 3]}}}
        self.edits.write_text(json.dumps(self.old))
        self.info = {'built': {'source': self.scope['stamp'](self.source),
                               'edits': self.fingerprint(self.old)}}
        self.write_info()

    def fingerprint(self, edits):
        return hashlib.sha256(json.dumps(edits, sort_keys=True, separators=(',', ':')).encode('utf-8')).hexdigest()

    def write_info(self):
        self.scope['_info_path']('Fixture').write_text(json.dumps(self.info))

    def test_newer_saved_edits_are_not_archived_or_installed(self):
        newer = {'moved': {'Chair1': {'loc': [9, 8, 7]}}}
        self.edits.write_text(json.dumps(newer))
        before = self.edits.read_bytes()
        ok, lines = self.scope['install']('Fixture')
        self.assertFalse(ok, lines)
        self.assertIn('rebuild', ' '.join(lines).lower())
        self.assertEqual(self.source.read_bytes(), b'original editable map')
        self.assertEqual(self.edits.read_bytes(), before)
        self.assertFalse((self.mods / 'backup').exists())

    def test_matching_edits_install_and_archive_normally(self):
        ok, lines = self.scope['install']('Fixture')
        self.assertTrue(ok, lines)
        self.assertEqual(self.source.read_bytes(), b'playable build A')
        self.assertFalse(self.edits.exists())
        self.assertEqual(len(list(self.edits.parent.glob('Fixture.edits.installato_*.json'))), 1)

    def test_json_formatting_and_key_order_do_not_invalidate_build(self):
        self.edits.write_text(json.dumps(self.old, indent=4, sort_keys=True))
        self.assertTrue(self.scope['install']('Fixture')[0])

    def test_legacy_build_without_edits_provenance_requires_rebuild(self):
        del self.info['built']['edits']; self.write_info()
        self.assertFalse(self.scope['install']('Fixture')[0])
        self.assertTrue(self.edits.exists())
        self.assertEqual(self.source.read_bytes(), b'original editable map')

    def test_private_build_stays_displayable_while_new_edits_are_pending(self):
        self.edits.write_text(json.dumps({'added': [{'name': 'NewChair'}]}))
        self.assertTrue(self.scope['built_current']('Fixture'))

    def test_player_override_stays_editable_after_install(self):
        self.players.blocks = lambda _: [{'cls': 'UCPlayerMap'}]
        self.players.build_dependency = lambda _: {'appearance': 'hero-a'}
        self.old['level'] = {'player': 'hero-a'}
        self.edits.write_text(json.dumps(self.old))
        self.info['built']['edits'] = self.scope['_edits_fingerprint'](self.old)
        self.write_info()
        ok, lines = self.scope['install']('Fixture')
        self.assertTrue(ok, lines)
        self.assertEqual(json.loads(self.edits.read_text())['level']['player'], 'hero-a')
        self.assertEqual(self.scope['_authoring_path']('Fixture').read_bytes(), b'original editable map')
        self.assertEqual(self.source.read_bytes(), b'playable build A')

    def test_changed_character_appearance_blocks_stale_install(self):
        self.players.build_dependency = lambda _: {'skin': 'A'}
        self.info['built']['edits'] = self.scope['_edits_fingerprint'](self.old)
        self.write_info()
        self.players.build_dependency = lambda _: {'skin': 'B'}
        self.assertFalse(self.scope['install']('Fixture')[0])
        self.assertTrue(self.edits.exists())
        self.assertEqual(self.source.read_bytes(), b'original editable map')

    def use_edits(self, edits):
        """Saved edits the last build was made from."""
        self.edits.write_text(json.dumps(edits))
        self.info['built']['edits'] = self.scope['_edits_fingerprint'](self.scope['load_edits']('Fixture'))
        self.write_info()

    def test_logic_rules_stay_editable_after_install(self):
        # 10 Nov 2026: Install baked a map copy's rules into the map and archived its edits, so the Logic window
        # showed none while they still ran in the game, and no rebuild reached them
        rules = dict(self.old, links=[{'id': 'KR_Use', 'src': 'KR_Button', 'when': 'used', 'do': [{'verb': 'flag', 'a': 'KR_A', 'b': '1'}]}],
                     logic={'watch': ['KR_A']})
        self.use_edits(rules)
        ok, lines = self.scope['install']('Fixture')
        self.assertTrue(ok, lines)
        self.assertEqual(json.loads(self.edits.read_text())['links'][0]['id'], 'KR_Use')
        self.assertEqual(list(self.edits.parent.glob('Fixture.edits.installato_*.json')), [])
        self.assertEqual(self.scope['_authoring_path']('Fixture').read_bytes(), b'original editable map')   # rebuilt from this
        self.assertEqual(self.source.read_bytes(), b'playable build A')
        info = json.loads(self.scope['_info_path']('Fixture').read_text())
        self.assertEqual(info['built']['source']['sha1'], info['authoring']['source']['sha1'])

    def test_each_kind_of_logic_keeps_the_source(self):
        for key, value in (('logic', {'groups': [{'id': 'g1', 'name': 'Guards', 'members': ['Guard1']}]}),
                           ('logic', {'start': {'KR_A': True}}), ('usable', {'Bomb': {'text': 'Defuse'}}),
                           ('objectTags', {'Guard1': 'Patrol'}), ('cutscenes', {'UCCutscene0': {'keys': [{'t': 0}]}}),
                           ('fpmoments', {'Shake': {'clips': [{'seq': 'Shoot'}]}})):
            with self.subTest(key=key):
                self.assertTrue(self.scope['has_logic'](dict(self.old, **{key: value})))

    def test_empty_logic_still_installs_into_the_map(self):
        self.use_edits(dict(self.old, links=[], logic={'watch': [], 'start': {}}, usable={}))
        self.assertFalse(self.scope['has_logic'](self.scope['load_edits']('Fixture')))
        ok, lines = self.scope['install']('Fixture')
        self.assertTrue(ok, lines)
        self.assertFalse(self.edits.exists())
        self.assertEqual(len(list(self.edits.parent.glob('Fixture.edits.installato_*.json'))), 1)


class BakedRuleActors(unittest.TestCase):
    """A rebuild never leaves a second actor for a rule an earlier Install put into the map (under another name)."""
    def setUp(self):
        tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
        scope = {}
        exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'baked_rule_actors'],
                                type_ignores=[]), str(SOURCE), 'exec'), scope)
        self.baked = scope['baked_rule_actors']
        self.blocks = [dict(cls='UCRuleAlso', name='UCRuleAlso_KR_Use_1', props={'Main': '"UCLink_KR_Use"'}),
                       dict(cls='UCLink', name='UCLink_KR_Use', props={'Rule': '"KR_Use"'}),
                       dict(cls='UCRule', name='UCLink_KR_Watch', props={'Rule': '"KR_Watch"'})]

    def test_copies_of_the_rules_built_now_are_removed(self):
        in_map = [dict(cls='UCLink', name='UCLink0', props={'Rule': '"KR_Use"'}),
                  dict(cls='DXP_x.UCLink', name='UCLink1', props={'Rule': '"KR_Watch"'}),     # the runtime changed since
                  dict(cls='UCRuleAlso', name='UCRuleAlso3', props={'Main': '"UCLink_KR_Use"'}),
                  dict(cls='UCLink', name='UCLink_KR_Use', props={'Rule': '"KR_Use"'})]       # its own name
        self.assertEqual(self.baked(in_map, self.blocks), ['UCLink0', 'UCLink1', 'UCRuleAlso3', 'UCLink_KR_Use'])

    def test_other_actors_stay(self):
        in_map = [dict(cls='UCLink', name='UCLink5', props={'Rule': '"Old_Rule"'}),           # not in the edits any more
                  dict(cls='Button1', name='Button0', props={'Rule': '"KR_Use"'}),
                  dict(cls='UCRuleAlso', name='UCRuleAlso9', props={'Main': '"UCLink_Other"'}),
                  dict(cls='UCLogicHub', name='UCLogicHub0', props={})]
        self.assertEqual(self.baked(in_map, self.blocks), [])
        self.assertEqual(self.baked(in_map, []), [])


if __name__ == '__main__': unittest.main()
