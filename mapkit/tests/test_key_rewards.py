import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'editor')]
import keyconfig
import links
import props
import story


class KeyRewards(unittest.TestCase):
    def test_numeric_and_existing_name_identity(self):
        for key in ['2', '4', 'ApartmentDoor', '01_Key_A', '0']:
            self.assertEqual(keyconfig.configured({'keyId': key}), (key, 'Key ' + key))
            self.assertIn('|' + key + '|key+|', links.act_string({'verb':'giveitem', 'a':'DeusEx.NanoKey', 'keyId':key}))

    def test_missing_and_invalid_ids_are_not_silently_rewritten(self):
        for key in [None, '', 'none', 'None', 'two doors', '2|3', 'a' * 64, "Key'bad"]:
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'Key ID'):
                links.act_string({'verb':'giveitem', 'a':'DeusEx.NanoKey', 'keyId':key})

    def test_description_cannot_become_a_group_selector(self):
        for text in ['every', 'group', 'area+', 'tag', 'members', 'Two|doors']:
            encoded = links.act_string({'verb':'giveitem','a':'deusex.NANOKEY','keyId':'2','keyDescription':text,'b':9})
            self.assertEqual(encoded.split('|')[3:7], ['deusex.NANOKEY','1','2','key+'])
            self.assertEqual(len(encoded.split('|')), 8)

    def test_regular_and_custom_items_keep_old_encoding(self):
        for cls in ['DeusEx.Medkit','DeusEx.WeaponLAM','MyMod.NanoKey']:
            self.assertEqual(links.act_string({'verb':'giveitem','a':cls,'b':2,'keyId':'old'}), '0|giveitem||'+cls+'|2|')

    def test_dialogue_grant_happens_at_the_step(self):
        lines = story.dialogue_code('01_Test', {'id':'d1','owner':'Guard1','steps':[
            {'type':'line','text':'Before'}, {'type':'give','item':'DeusEx.NanoKey','keyId':'2','keyDescription':'Roof'},
            {'type':'line','text':'After'}]}, {})
        text = '\n'.join(lines)
        self.assertLess(text.index('Before'), text.index('c.GiveKey(Self, "2", "Roof")'))
        self.assertLess(text.index('c.GiveKey'), text.index('After'))
        self.assertNotIn('c.Give("DeusEx.NanoKey"', text)

    def test_original_npc_key_transfer_is_preserved(self):
        lines = story.dialogue_code('01_Test', {'id':'d1','owner':'Guard1','steps':[
            {'type':'give','item':'DeusEx.NanoKey','from':'Guard','to':'JCDenton','fail':'full'}]}, {})
        text = '\n'.join(lines)
        self.assertIn('c.Give("DeusEx.NanoKey", 1, "full")', text)
        self.assertIn('c.LastProp("fromName", "Guard")', text)

    def test_cannot_mistake_an_npc_transfer_for_player_reward(self):
        with self.assertRaisesRegex(ValueError, 'From/To'):
            story.dialogue_code('01_Test', {'id':'d1','owner':'Guard1','steps':[
                {'type':'give','item':'DeusEx.NanoKey','keyId':'2','to':'Guard'}]}, {})

    def test_native_pickup_parameters_survive_property_serialization(self):
        edits={'props':{'Door1':{'KeyIDNeeded':'2','bLocked':'True'},'Key1':{'KeyID':'2'},
                        'Money1':{'numCredits':'250'},'Can1':{'AddAugs(0)':'AugSpeed','AddAugs(1)':'AugStealth'}}}
        commands=props.commands(edits)
        for line in ['UC_PROP Door1 KeyIDNeeded 2','UC_PROP Key1 KeyID 2','UC_PROP Money1 numCredits 250',
                     'UC_PROP Can1 AddAugs(0) AugSpeed','UC_PROP Can1 AddAugs(1) AugStealth']:
            self.assertIn(line, commands)


if __name__ == '__main__': unittest.main()
