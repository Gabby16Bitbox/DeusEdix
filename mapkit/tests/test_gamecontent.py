"""Synthetic content only: shipped tests contain no original game text or source."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT / 'editor'), str(KIT), str(KIT.parent)]
import documents
import gamecontent
import gamecons
from scene import Scene


class MissionFlags(unittest.TestCase):
    def test_comments_strings_and_dynamic_names_are_not_suggestions(self):
        source = '''function BeginPlay()
{
  // flags.GetBool('Comment');
  s = "flags.GetBool('String')";
  /* flags.SetBool('Block', true); */
  if (flags.GetBool('Ready')) flags.SetBool('Done', true);
  flags.SetInt('Count', 2);
  flags.GetBool('Prefix' $ index);
}
function bool Finished()
{
  return flags.GetBool('Done');
}'''
        result = gamecontent.scan_flags(dict(path='Test.Mission', text=source))
        self.assertEqual(set(result), {'Ready', 'Done', 'Count'})
        self.assertEqual(result['Done'][1]['function'], 'Finished')
        self.assertEqual(result['Ready'][0]['line'], 6)
        self.assertEqual(result['Count'][0]['type'], 'int')

    def test_map_names_cannot_escape_cache(self):
        with self.assertRaises(ValueError): gamecontent.mission_flags('../Other')


class Documents(unittest.TestCase):
    def test_original_lookup_is_case_insensitive_and_rejects_ambiguity(self):
        rows = [dict(path='Test.Mission01.A', text='<P>Test')]
        with patch.object(gamecontent, 'exported', return_value=rows):
            self.assertEqual(gamecontent.text('Test', 'a')['text'], '<P>Test')
            self.assertFalse(gamecontent.text('Test', 'missing')['found'])
            rows.append(dict(path='Test.Mission02.A', text='Other'))
            with self.assertRaises(ValueError): gamecontent.text('Test', 'A')
            self.assertTrue(gamecontent.text('Test', 'Test.Mission01.A')['found'])

    def test_long_markup_round_trip_and_property_command_precedence(self):
        raw = '<P><DC=20,30,40>Quote " \\ é <PLAYERNAME>\n' * 1000
        edits = {'documents': {'DataCube0': {'text': raw}}, 'props': {'DataCube0': {'textTag': 'Old'}}}
        block = documents.blocks(edits, 'TestMap')[0]
        commands = documents.commands(edits, 'TestMap')
        restored = ''.join(bytes.fromhex(c.split(' ',3)[3]).decode('utf-8') for c in commands if c.startswith('UC_TEXTHEX '))
        self.assertEqual(restored, documents.game_text(raw))
        t3d = Scene._block(block['cls'], tuple(block['loc']), block['name'], (0,0,0), '', block['props'])
        self.assertLess(max(map(len, t3d.splitlines())), 4096)
        self.assertLess(max(map(len, commands)), 8192)
        self.assertIn('TextPackage', '\n'.join(documents.commands(edits, 'TestMap')))
        self.assertNotEqual(documents.tag('TestMap','DataCube0'), documents.tag('OtherMap','DataCube0'))

    def test_restore_does_not_change_other_property_overrides(self):
        edits = {'props': {'DataCube0': {'Tag':'MissionEvent','textTag':'Original'}}, 'documents': {}}
        self.assertEqual(documents.blocks(edits,'Map'), [])
        self.assertEqual(documents.commands(edits,'Map'), [])
        self.assertEqual(edits['props']['DataCube0']['Tag'], 'MissionEvent')

    def test_deleted_device_does_not_leave_a_text(self):
        edits = {'documents': {'DataCube0': {'text':'Test'}}, 'deleted': {'DataCube0':{}}}
        self.assertEqual(documents.blocks(edits,'Map'), [])
        self.assertEqual(documents.commands(edits,'Map'), [])

    def test_input_limits_are_explicit(self):
        for actor,text in [('DataCube0','a'*55001),('DataCube0','\0'),('../Bad','Test')]:
            with self.assertRaises(ValueError): documents.validate({'documents':{actor:{'text':text}}})
        with self.assertRaises(ValueError): documents.validate({'documents':{'A':{'text':'…'*20000}}})
        commands=documents.commands({'documents':{'A':{'text':'a'*55000}}},'Map')
        self.assertEqual(len([c for c in commands if c.startswith('UC_TEXTHEX ')]),65)
        self.assertIn('TextMore(63)',commands[-4])


class BarkFilter(unittest.TestCase):
    def test_noninteractive_and_aibarks_filters_keep_pagination(self):
        def con(name,group,noninteractive):
            return dict(path=name,name=name,group=group,properties={'bnoninteractive':noninteractive},
                owner='NPC', speakers=['NPC'], mission=1, missions=[1], events=[dict(type='Speech',path=name+'.line',text='Synthetic',speaker='NPC')])
        data = dict(conversations=[con('A','AIBarks','False'),con('B','Other','True'),con('C','Other','False')], missions=[])
        with patch.object(gamecons,'catalog',return_value=data),patch.object(gamecons,'packages',return_value=[]):
            bark=gamecons.search(kind='barks',limit=1,offset=1)
            self.assertEqual(bark['total'],2)
            self.assertEqual(bark['lines'][0]['conversation'],'B')
            self.assertEqual(gamecons.search(kind='conversations')['total'],1)
            self.assertEqual(gamecons.search(kind='barks',mission=2)['total'],0)


if __name__ == '__main__': unittest.main()
