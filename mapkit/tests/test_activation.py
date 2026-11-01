"""Activation preserves authoring data while excluding actors from runtime commands."""
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import activation
import dxmaps
import links
from scene import Scene


class ActivationTests(unittest.TestCase):
    def test_validation_and_defaults(self):
        self.assertEqual(activation.names({}), set())
        self.assertEqual(activation.names({'disabled': {'Guard1': True, 'Guard2': False}}), {'Guard1'})
        for value in ([], None, ['Guard1'], {'Guard 1': True}, {'Guard1': 1}, {'Guard1\nMAP NEW': True}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                activation.names({'disabled': value})

    def test_commands_snapshot_before_omission(self):
        cmds = activation.commands({'disabled': {'Guard1': True, 'Crate1': True}})
        self.assertTrue(cmds[0].startswith('MAP EXPORT'))
        self.assertTrue(cmds[1].startswith('UC_MESHES'))
        self.assertEqual(cmds[2:], ['UC_DEL Crate1', 'UC_DEL Guard1'])
        self.assertEqual(activation.commands({}), [])

    def test_script_actor_configuration_is_not_removed(self):
        scene = object.__new__(Scene)
        scene.actors = [Scene._block('UNATCOTroop', (1, 2, 3), 'Guard1', (0, 0, 0), '', {'FamiliarName': '"Sam"'})]
        scene.actor_group = {}
        scene._group = None
        scene.groups = {}
        scene.explicit = set()
        scene.pieces = {}
        scene.movers = {}  # Scene now tracks movers independently of static pieces.
        scene.actor_note = {}
        scene.op_piece = []
        scene.map_name = 'ActivationFixture'
        scene._n = {}
        edits = {'disabled': {'Guard1': True, 'NewCrate': True}, 'added': [
            {'name': 'NewCrate', 'cls': 'CrateUnbreakableSmall', 'loc': [5, 6, 7], 'props': {'HitPoints': '9'}}],
            'moved': {'Guard1': {'cls': 'UNATCOTroop', 'loc': [11, 12, 13]}},
            'props': {'Guard1': {'FamiliarName': '"Preserved"'}}}
        before = copy.deepcopy(edits)
        scene._apply_actor_edits(edits)
        self.assertEqual(edits, before)
        self.assertIn('Location=(X=11.00,Y=12.00,Z=13.00)', scene.actors[0])
        self.assertIn('HitPoints=9', scene.actors[1])
        # Omitting is a final build operation, so none of the actor definitions are destroyed.
        self.assertEqual(len(scene.actors), 2)

    def test_link_sources_and_targets_excluded_without_mutation(self):
        edits = {'disabled': {'Guard1': True}, 'links': [
            {'id': 'A', 'src': 'Guard1', 'when': 'gone', 'do': [{'verb': 'message', 'a': 'Gone'}]},
            {'id': 'B', 'src': '', 'when': 'start', 'do': [
                {'verb': 'attack', 'target': 'Guard1'}, {'verb': 'message', 'a': 'Hello'}]}]}
        before = copy.deepcopy(edits)
        built = links.blocks(edits)
        self.assertEqual([a['name'] for a in built], ['UCLink_B'])
        self.assertIn('message', built[0]['props']['Act(0)'])
        self.assertNotIn('Act(1)', built[0]['props'])
        self.assertEqual(edits, before)
        del edits['disabled']['Guard1']
        self.assertEqual(len(links.blocks(edits)), 2)

    def test_sidecar_matches_runtime_and_preserves_current_actor(self):
        with tempfile.TemporaryDirectory(dir=KIT / 'tests', prefix='activation-') as temp:
            root = Path(temp)
            runtime = root / 'Fixture.dx'
            runtime.write_bytes(b'one runtime')
            old = Scene._block('UNATCOTroop', (1, 2, 3), 'Guard1', (0, 0, 0), '', {'FamiliarName': '"Old"'})
            new = Scene._block('ScientistMale', (4, 5, 6), 'Guard1', (0, 0, 0), '', {'FamiliarName': '"New"'})
            payload = {'version': 1, 'runtime_sha256': activation.digest(runtime), 'actors': [old]}
            activation.sidecar(runtime).write_text(json.dumps(payload))
            self.assertEqual(activation.load(runtime), payload)
            self.assertIn('FamiliarName="Old"', activation.editor_text('', payload))
            self.assertEqual(activation.editor_text(new, payload), new)
            runtime.write_bytes(b'another runtime')
            self.assertEqual(activation.load(runtime), {})

    def test_install_preserves_source_and_edits_rejects_external_changes(self):
        with tempfile.TemporaryDirectory(dir=KIT / 'tests', prefix='activation-install-') as temp:
            root = Path(temp)
            mods, out = root / 'maps', root / 'out'
            mods.mkdir(); out.mkdir()
            source, built = mods / 'Fixture.dx', out / 'Fixture.dx'
            source.write_bytes(b'editable source includes Guard1')
            built.write_bytes(b'runtime excludes Guard1')
            editfile = root / 'Fixture.edits.json'
            editfile.write_text(json.dumps({'disabled': {'Guard1': True}, 'props': {'Guard1': {'Health': '21'}}}))
            edits_before = editfile.read_bytes()
            original_edits = json.loads(editfile.read_text())
            info = {'built': {'source': dxmaps.stamp(source), 'disabled': ['Guard1'],
                              'edits': dxmaps._edits_fingerprint(original_edits)}}
            (out / 'Fixture.dxinfo.json').write_text(json.dumps(info))
            with patch.object(dxmaps, 'MOD_MAPS', mods), patch.object(dxmaps, 'OUT', out), \
                    patch.object(dxmaps, 'edits_path', lambda _: editfile):
                # A re-enable saved after the last build must not install a stale runtime
                # or consume the newer saved authoring document.
                pending = json.loads(editfile.read_text()); pending['disabled'] = {}
                editfile.write_text(json.dumps(pending))
                edits_before = editfile.read_bytes()
                self.assertFalse(dxmaps.install('Fixture')[0])
                self.assertEqual(source.read_bytes(), b'editable source includes Guard1')
                self.assertEqual(editfile.read_bytes(), edits_before)
                # Restore the exact built authoring state for the preserved-source install.
                editfile.write_text(json.dumps(original_edits))
                edits_before = editfile.read_bytes()
                ok, lines = dxmaps.install('Fixture')
                self.assertTrue(ok, lines)
                self.assertEqual(source.read_bytes(), built.read_bytes())
                self.assertEqual(dxmaps.source('Fixture').read_bytes(), b'editable source includes Guard1')
                self.assertEqual(editfile.read_bytes(), edits_before)
                self.assertTrue(dxmaps.built_current('Fixture'))
                # Re-enable, rebuild and install still use the immutable source, not a cumulative runtime.
                edits = json.loads(editfile.read_text()); edits['disabled'] = {}
                editfile.write_text(json.dumps(edits))
                built.write_bytes(b're-enabled runtime with preserved settings')
                info = json.loads((out / 'Fixture.dxinfo.json').read_text())
                info['built']['edits'] = dxmaps._edits_fingerprint(edits)
                (out / 'Fixture.dxinfo.json').write_text(json.dumps(info))
                self.assertTrue(dxmaps.install('Fixture')[0])
                self.assertTrue(editfile.exists())
                # Cache/uninstall cleanup may delete all of out/. Authoring source and
                # provenance live with user maps and remain discoverable without it.
                (out / 'Fixture.dxinfo.json').unlink()
                built.unlink()
                out.rmdir()
                self.assertEqual(dxmaps.source('Fixture').read_bytes(), b'editable source includes Guard1')
                self.assertEqual(dxmaps.source('Fixture').parent, mods / '.authoring')
                self.assertFalse(dxmaps.built_current('Fixture'))
                source.write_bytes(b'Claude changed this map')
                with self.assertRaisesRegex(ValueError, 'changed outside DeusEdix'):
                    dxmaps.source('Fixture')
                self.assertEqual(source.read_bytes(), b'Claude changed this map')


if __name__ == '__main__':
    unittest.main()
