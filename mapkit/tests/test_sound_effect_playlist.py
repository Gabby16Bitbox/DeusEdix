"""G29 on the server: a sound effect's playlist in the Properties (props.py: More sounds and the parts its row draws,
editable before the first Rebuild with the class's own defaults, written to the map with UC_PROP), an interaction can
switch a sound effect off (its repeats stop), and UCSoundFX declares every property the editor writes (both copies of
the class in step, the editor's preview picking as it does)."""
import re
import sys
import unittest
from pathlib import Path
from unittest import mock

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import logic_catalog  # noqa: E402
import props  # noqa: E402
import settings  # noqa: E402

# the editor's own classes (every project's template) and, in a mod's working copy (development mode), the mod's copy of
# them (src/<its package from devmode.json>/Classes), kept the same; none elsewhere (the DeusEdix repo, DeusEdix installed)
TEMPLATE = KIT / 'project-template' / 'src' / 'DeusEdix' / 'Classes'
MOD = None if settings.STANDALONE else settings.PROJECT / 'src' / settings.PACKAGE / 'Classes'
PARTS = ('FXOrder', 'RandomPitch', 'RandomVolume', 'RepeatMin', 'RepeatMax')


def class_text(folder, name):
    return (folder / name).read_bytes().replace(b'\r\n', b'\n').decode('latin1')


class PlaylistFields(unittest.TestCase):
    def defaults(self, own=None):
        fx = {'parents': ['Trigger', 'Triggers', 'Actor', 'Object'], 'types': {},
              'props': dict({'FXSound': ['None'], 'FXVolume': ['1.000000'], 'FXRadius': ['1024.000000'], 'FXPitch': ['1.000000'],
                             'bAtPlayer': ['False'], 'bOnTouch': ['True']}, **(own or {}))}
        return {'classes': {'UCSoundFX': fx}, 'enums': {}}

    def test_more_sounds_after_the_sound_its_parts_drawn_by_it(self):
        with mock.patch.object(props, 'defaults', return_value=self.defaults()):
            fields = props.fields_for('UCSoundFX')
        names = [f['prop'] for f in fields]
        self.assertEqual(names[names.index('FXSound'):names.index('FXSound') + 7], ['FXSound', 'FXSounds', *PARTS])
        by = {f['prop']: f for f in fields}
        self.assertEqual(by['FXSounds']['kind'], 'playlist')
        self.assertEqual(by['FXSounds']['default'], ['None'] * 7)          # 7 places: FXSounds(0)..(6)
        self.assertEqual({by[p]['kind'] for p in PARTS}, {'playlistpart'})
        self.assertEqual((by['FXOrder']['default'], by['RepeatMax']['default']), (['0'], ['0.000000']))

    def test_the_class_s_own_defaults_once_it_has_them(self):
        with mock.patch.object(props, 'defaults', return_value=self.defaults({'FXSounds': ['None'] * 7, 'RepeatMax': ['5.000000']})):
            by = {f['prop']: f for f in props.fields_for('UCSoundFX')}
        self.assertEqual(by['RepeatMax']['default'], ['5.000000'])

    def test_its_values_go_into_the_map(self):
        self.assertTrue({'FXSounds', *PARTS} <= set(props.NAMES))
        edits = {'props': {'SoundFX3': {'FXSounds(6)': "Sound'Ambient.Dogs.Bark3'", 'RandomPitch': '0.150000', 'FXOrder': '1'}}}
        self.assertEqual(props.commands(edits), ['UC_PROP SoundFX3 FXOrder 1', "UC_PROP SoundFX3 FXSounds(6) Sound'Ambient.Dogs.Bark3'",
                                                 'UC_PROP SoundFX3 RandomPitch 0.150000'])

    def test_an_interaction_can_switch_it_off(self):
        self.assertEqual(logic_catalog.FAMILIES['soundfx']['inputs'], ['on', 'off'])

    def test_each_property_has_its_own_name_the_repeats_as_their_row_says(self):
        with mock.patch.object(props, 'defaults', return_value=self.defaults({'ReTriggerDelay': ['0.000000']})):
            fields = props.fields_for('UCSoundFX')
        labels = [f['label'] for f in fields]
        self.assertEqual([label for label in labels if labels.count(label) > 1], [])
        by = {f['prop']: f['label'] for f in fields}
        self.assertEqual((by['RepeatMin'], by['RepeatMax']), ('Repeats every (from)', 'Repeats every (to)'))
        # what sends a reader to the repeats names the row's words, not the other property's (Again after: ReTriggerDelay):
        # the sound effects' note in logic.json (logic_catalog reads it) and LOGIC.md
        for text in (logic_catalog.FAMILIES['soundfx']['note'], (KIT / 'editor' / 'LOGIC.md').read_text(encoding='utf-8')):
            self.assertIn("More sounds' ", text)
            self.assertNotIn("More sounds' *Again after", text)
            self.assertNotIn("More sounds' Again after", text)
            self.assertRegex(text, r"More sounds' \*?Repeats every")

    def test_the_log_line_quoted_has_the_decimals_the_game_writes(self):
        # PlayOne builds it with `", volume" @ Vol $ ", pitch" @ Pit`: UnrealScript writes a float with six decimals
        quoted = r'volume (\d+\.\d+), pitch (\d+\.\d+)'
        texts = {'UCSoundFX.uc': class_text(TEMPLATE, 'UCSoundFX.uc')}
        guide = settings.PROJECT / 'docs' / 'tutorials' / '07-map-editor.md'
        if not settings.STANDALONE and guide.is_file():                     # a working copy's guide (editor/guide.py)
            texts[guide.name] = guide.read_text(encoding='utf-8').replace('\r\n', '\n').replace('\n  ', ' ')
        for name, text in texts.items():
            found = re.findall(quoted, text)
            self.assertTrue(found, name)
            for numbers in found:
                self.assertEqual([len(n.split('.')[1]) for n in numbers], [6, 6], name)

    def test_ucsoundfx_declares_them(self):
        text = class_text(TEMPLATE, 'UCSoundFX.uc')
        declared = {name: size for _, name, size in re.findall(r'^var\(\)\s+(\w+)\s+(\w+)(?:\[(\d+)\])?', text, re.M)}
        self.assertEqual(declared['FXSounds'], '7')
        self.assertTrue(set(PARTS) <= set(declared))
        self.assertIn('LastPick=-1', text)                                 # the first pick: none before it

    def test_touched_or_triggered_again_while_it_repeats_it_keeps_its_wait(self):
        """B6 in the game (28 Oct 2026, revision_log_run2.log:362-369): JC dropped into a zone that repeats every 1-2 s
        touched it twice (falling in, landing) and it played twice within one 0.25 s poll. While it repeats, PlayFX (which
        Touch and Trigger call) only takes who it plays for: Tick plays it again when its wait is over."""
        text = class_text(TEMPLATE, 'UCSoundFX.uc')

        def body(signature):
            found = re.search(r'^function %s\n\{\n(.*?)^\}' % re.escape(signature), text, re.M | re.S)
            self.assertIsNotNone(found, signature)
            return found.group(1)
        play = body('PlayFX(Actor Who)')
        guard = re.search(r'^    if \(bRepeating\)\n    \{\n(.*?)^    \}', play, re.M | re.S)
        self.assertIsNotNone(guard, 'PlayFX plays whether it repeats or not')
        self.assertLess(guard.start(), play.index('PlayOne('))               # before it would play
        self.assertLess(guard.start(), play.index('bPlayed = true'))
        code = [line.split('//')[0].strip() for line in guard.group(1).splitlines()]
        self.assertEqual([line for line in code if line], ['Hearer = Who;', 'return;'])   # its wait (NextPlay) kept
        self.assertIn('PlayFX(Other)', body('Touch(Actor Other)'))
        self.assertIn('PlayFX(', body('Trigger(Actor Other, Pawn EventInstigator)'))
        tick = re.search(r'^event Tick\(float DeltaTime\)\n\{\n(.*?)^\}', text, re.M | re.S).group(1)
        self.assertIn('PlayOne(Hearer)', tick)                                # the repeats play for the hearer kept

    @unittest.skipUnless(MOD and MOD.is_dir(), "not a mod's working copy: no src/<its package>/Classes beside the editor")
    def test_the_mod_s_ucsoundfx_is_the_editor_s(self):
        self.assertEqual(class_text(MOD, 'UCSoundFX.uc'), class_text(TEMPLATE, 'UCSoundFX.uc'))


if __name__ == '__main__':
    unittest.main()
