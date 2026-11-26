"""What the Blackout Protocol test mission (26 Nov 2026) found wrong on the Python and game side of the scripting:
a NanoKey condition (the key goes on the keyring, the pickup is destroyed: UCEditorStory.HasItem reads the keyring,
the key of a Key ID or any key) and a gate opened by a "while" that never closed again (inversePorts). The page's
side: tests/test_blackout_fixes.mjs. Write-up: backup/20261126_blackout/README.md"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'editor'), os.path.join(HERE, '..')]
import conditions  # noqa: E402
import links  # noqa: E402
import props  # noqa: E402

TEMPLATE = os.path.join(HERE, '..', 'project-template', 'src', 'DeusEdix', 'Classes', 'UCEditorStory.uc')


class NanoKeyCondition(unittest.TestCase):
    def test_written_with_its_key_id(self):
        c = {'type': 'item', 'item': 'DeusEx.NanoKey', 'has': True, 'keyId': 'EastCage'}
        conditions.check([c])
        self.assertEqual(conditions.encode(c), 'item|DeusEx.NanoKey|1|EastCage')
        self.assertEqual(conditions.encode(conditions.negate(c)), 'item|DeusEx.NanoKey|0|EastCage')
        self.assertEqual(conditions.encode(dict(c, keyId='')), 'item|DeusEx.NanoKey|1')
        self.assertEqual(conditions.encode({'type': 'item', 'item': 'DeusEx.Multitool', 'has': True}), 'item|DeusEx.Multitool|1')

    def test_a_bad_key_id_is_refused(self):
        for bad in ('two words', 'a' * 64, 'None', 'key-1'):
            with self.assertRaises(ValueError, msg=bad):
                conditions.check([{'type': 'item', 'item': 'DeusEx.NanoKey', 'has': True, 'keyId': bad}])

    def test_the_game_reads_the_keyring(self):
        with open(TEMPLATE, encoding='latin-1') as f:
            uc = f.read()
        self.assertIn('return HasItem(Field(c, 1), Field(c, 3)) == (Field(c, 2) != "0");', uc)
        self.assertIn("if (ClassIsChildOf(cls, class'NanoKey'))", uc)
        self.assertIn('P.KeyRing.HasKey(StringToName(keyId))', uc)
        self.assertIn('return P.KeyList != None;', uc)


class GateWhile(unittest.TestCase):
    def test_a_gate_opened_while_is_closed_again(self):
        step = {'verb': 'input', 'target': 'UCEdit14', 'a': 'Open', 'delay': 0}
        undo = links.undo_of(step)
        self.assertIsNotNone(undo)
        self.assertEqual((undo['verb'], undo['target'], undo['a']), ('input', 'UCEdit14', 'Close'))
        self.assertEqual(links.undo_of(dict(step, a='On'))['a'], 'Off')      # the climbable area's, as before
        self.assertIsNone(links.undo_of(dict(step, a='Pass')))                # going through has no opposite


class LevelExitEvent(unittest.TestCase):
    """A teleporter to another map, a map exit: the travel never sends their Event, so a rule on "it triggers its
    event" never ran (the exit of the plant). UCLink takes its touch: the exit's collision off, the player walking in
    watched every tick (no Trigger: it ignores a player with bDetectable off), the rules, then the exit's Touch."""

    def test_the_link_hooks_a_touch_of_its_own(self):
        for path in (os.path.join(HERE, '..', 'project-template', 'src', 'DeusEdix', 'Classes', 'UCLink.uc'),
                     os.path.join(HERE, '..', '..', 'runtime', 'DeusEdix', 'Classes', 'UCLink.uc')):
            if not os.path.exists(path):
                continue                                   # (an installed app has no runtime folder)
            with open(path, encoding='latin-1') as f:
                uc = f.read().replace('\r\n', '\n')
            self.assertIn("if (When == 'any' && IsLevelExit(A))", uc, path)
            self.assertIn('return InStr(T.URL, "#") >= 0 || InStr(T.URL, "/") >= 0;', uc, path)
            self.assertIn("return A.IsA('MapExit');", uc, path)
            self.assertLess(uc.index('IsLevelExit(A))'), uc.index('else if (A.Event != Tag)'), path)
            # the exit's own touch is the link's: its collision off, the player watched, its Touch after the rules
            self.assertIn('A.SetCollision(False, A.bBlockActors, A.bBlockPlayers);', uc, path)
            self.assertIn('X.Trigger(ExitOf, P);', uc, path)
            self.assertIn('ExitAt = Level.TimeSeconds + 0.25;', uc, path)
            self.assertIn('ExitOf.Touch(W);', uc, path)
            self.assertIn('if (ExitOf != None)\n\t\tWatchExit();', uc, path)
            self.assertNotIn("Spawn(class'Trigger'", uc, path)


class OtherMapsInstalled(unittest.TestCase):
    def test_an_install_says_which_other_maps_are_older_than_their_rebuild(self):
        import tempfile
        import data
        import server
        with tempfile.TemporaryDirectory() as tmp:
            project, out = os.path.join(tmp, 'p'), os.path.join(tmp, 'out')
            os.makedirs(os.path.join(project, 'maps'))
            os.makedirs(out)
            for name, installed, built in (('05_A', 100, 100), ('05_B', 100, 500), ('05_C', 100, None)):
                path = os.path.join(project, 'maps', name + '.dx')
                open(path, 'wb').close()
                os.utime(path, (installed, installed))
                if built:
                    path = os.path.join(out, name + '.dx')
                    open(path, 'wb').close()
                    os.utime(path, (built, built))
            saved = server.PROJECT, data.OUT
            from pathlib import Path
            server.PROJECT, data.OUT = Path(project), Path(out)
            try:
                lines = server.older_installed('05_A')
                self.assertEqual(server.older_installed('05_b'), [])           # the one being installed: not said
            finally:
                server.PROJECT, data.OUT = saved
        self.assertEqual(len(lines), 1)
        self.assertTrue(lines[0].startswith('05_B was rebuilt after it was installed'))


class AddedObjectStrings(unittest.TestCase):
    """An added object's strings go into its T3D block quoted: unquoted, the import stopped at a comma, a space or a #
    (the game got the phase Infiltrate alone, the key's description "Maintenance", the exit's URL without its #)."""

    def setUp(self):
        self.saved = props.cached_defaults

    def tearDown(self):
        props.cached_defaults = self.saved

    def test_by_the_class_types(self):
        props.cached_defaults = lambda: {'classes': {'UCBPhases': {'types': {
            'Phases': 'StrProperty', 'StateName': 'StrProperty', 'Need': 'IntProperty'}}}}
        out = props.block_strings('DeusEdix.UCBPhases', {'Phases': 'Infiltrate, Sabotage, Blackout, Escape',
                                                         'StateName': '"Blackout"', 'Need': '2'})
        self.assertEqual(out, {'Phases': '"Infiltrate, Sabotage, Blackout, Escape"', 'StateName': '"Blackout"', 'Need': '2'})
        out = props.block_strings('UCBPhases', {'Phases': 'say "go", now'})
        self.assertEqual(out['Phases'], '"say \'go\', now"')

    def test_without_the_class_defaults(self):
        props.cached_defaults = lambda: None
        out = props.block_strings('NanoKey', {'Description': 'Maintenance key', 'KeyID': 'EastCage', 'bHidden': 'True'})
        self.assertEqual(out['Description'], '"Maintenance key"')
        self.assertEqual(out['bHidden'], 'True')

    def test_a_new_maps_added_blocks(self):
        props.cached_defaults = lambda: {'classes': {
            'UCBPhases': {'types': {'Phases': 'StrProperty', 'StateName': 'StrProperty'}},
            'Teleporter': {'types': {'URL': 'StrProperty'}}}}
        from scene import Scene
        s = Scene('t_blackout_quotes')
        s._apply_actor_edits({'added': [
            {'name': 'UCEdit1', 'cls': 'DeusEdix.UCBPhases', 'loc': [0, 0, 0], 'props': {'Phases': 'A, B, C', 'StateName': 'Ph'}},
            {'name': 'UCEdit2', 'cls': 'Teleporter', 'loc': [0, 0, 0], 'props': {'URL': '05_X#'}}]})
        text = ''.join(s.actors)
        for line in ('Phases="A, B, C"', 'StateName="Ph"', 'URL="05_X#"'):
            self.assertIn(line, text)

    def test_the_build_quotes_them(self):
        with open(os.path.join(HERE, '..', 'editor', 'dxmaps.py'), encoding='utf-8') as f:
            self.assertIn("props_a = props.block_strings(a['cls'], props_a)", f.read())
        with open(os.path.join(HERE, '..', 'scene.py'), encoding='utf-8') as f:     # a new map's added objects
            self.assertIn("props = _editor_props().block_strings(a['cls'], props)", f.read())


if __name__ == '__main__':
    unittest.main()
