"""The unified memory index must not introduce another state store or change stories."""
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import story
from editor import statecatalog


def entries(rows):
    return {row['flag']: row for row in rows}


class StateCatalog(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='.state-catalog-', dir=Path(__file__).parent)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.kit = self.root / 'current/tools/mapkit'
        for folder in ('story', 'maps', 'editor/cache/_gamecons'):
            (self.kit / folder).mkdir(parents=True)

    def write(self, relative, value):
        path = self.kit / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding='utf-8')
        return path

    def test_story_reads_writes_and_native_choice_conditions_share_one_index(self):
        value = dict(dialogues=[dict(id='d1', title='Meet the guard', owner='Guard0',
            requires=[dict(flag='Admission', **{'is': False})], steps=[
                dict(type='if', flag='AlreadyMet', **{'is': True}, goto='End'),
                dict(type='flag', flag='AlreadyMet', **{'is': True}),
                dict(type='choice', options=[dict(text='Let me pass', goto='End', flag='LegacyChoice',
                    requires=[dict(flag='Clearance', **{'is': True}, expiration=2)])]),
                dict(type='do', do=[dict(type='flag', flag='GateOpen', **{'is': True})])])],
            events=[dict(id='e1', title='Alarm', when=dict(type='flag', flag='AlarmReady'),
                         requires=[dict(flag='Admission')], do=[dict(type='flag', flag='AlarmSeen')])],
            infolinks=[dict(id='i1', title='Briefing', do=[dict(type='flag', flag='Briefed')])])
        before = copy.deepcopy(value)
        result = entries(statecatalog.collect_story(value, '01_Test'))
        self.assertEqual(value, before)
        self.assertEqual({use['kind'] for use in result['AlreadyMet']['uses']}, {'read', 'write'})
        self.assertIn('Answer: Let me pass', result['Clearance']['uses'][0]['context'])
        self.assertEqual(result['GateOpen']['uses'][0]['kind'], 'write')
        self.assertEqual(result['AlarmReady']['uses'][0]['kind'], 'read')
        self.assertEqual(result['Briefed']['uses'][0]['kind'], 'write')
        self.assertTrue(all(row['type'] == 'bool' for row in result.values()))

    def test_automatic_identifiers_match_generator_and_original_replacements(self):
        dialogue = dict(id='A strange id', title='Check-in')
        info = dict(id='i1', title='Instructions')
        value = dict(dialogues=[dialogue, dict(id='copy', title='Old conversation', replaces='OriginalCon'),
                                dict(id='off', replaces='OffCon', disabled=True)], infolinks=[info])
        result = entries(statecatalog.collect_story(value, '02_MyMap'))
        played = story.con_name('02_MyMap', dialogue) + '_Played'
        heard = story.heard_flag('02_MyMap', info)
        self.assertEqual(result[played]['label'], 'Check-in · Played')
        self.assertEqual(result[heard]['source'], 'automatic')
        self.assertEqual(result['OriginalCon_Played']['uses'][0]['kind'], 'automatic')
        self.assertNotIn('OffCon_Played', result)

    def test_native_multi_flag_steps_override_placeholder_and_preserve_expiration(self):
        value = dict(dialogues=[dict(id='copy', owner='Guard0', steps=[
            dict(type='flag', flag='IgnoredPlaceholder', requires=[dict(flag='Permanent', **{'is': True}, expiration=99),
                                                               dict(flag='MissionOnly', **{'is': False}, expiration=3)]),
            dict(type='if', flag='IgnoredCheck', goto='End', requires=[dict(flag='Ready', **{'is': False}, expiration=0)]),
            dict(type='choice', options=[dict(text='Continue', flag='LegacyCondition', goto='End',
                                             requires=[dict(flag='NativeCondition', **{'is': True}, expiration=5)])]),
            dict(type='label', name='End'), dict(type='end')])])
        untouched = copy.deepcopy(value)
        code = story.generate('01_Test', value)
        result = entries(statecatalog.collect_story(value, '01_Test'))
        self.assertNotIn('IgnoredPlaceholder', result)
        self.assertNotIn('IgnoredCheck', result)
        self.assertEqual(result['Permanent']['uses'][0]['kind'], 'write')
        self.assertEqual(result['Ready']['uses'][0]['kind'], 'read')
        self.assertEqual(value, untouched)
        self.assertEqual(code, story.generate('01_Test', value))
        self.assertIn("c.LastFlags('Permanent', True, 99, True)", code)
        self.assertIn("c.LastFlags('MissionOnly', False, 3, False)", code)
        self.assertIn("c.AnswerFlag('NativeCondition', True, 5)", code)

    def test_interaction_flags_are_found_before_compiling_and_map_script_is_not_executed(self):
        (self.kit / 'maps/room.py').write_text("MAP = '01_Workshop'\nraise RuntimeError('Do not execute')\n", encoding='utf-8')
        self.write('maps/room.edits.json', dict(links=[dict(id='L1', label='Button opens gate',
            do=[dict(verb='flag', a='DoorUnlocked', b='1'), dict(verb='message', a='NotAFlag')])]))
        result = entries(statecatalog.catalog(self.kit)['flags'])
        self.assertEqual(set(result), {'DoorUnlocked'})
        self.assertEqual(result['DoorUnlocked']['uses'], [dict(map='01_Workshop', context='Interaction: Button opens gate', kind='write')])

    def test_dx_map_edits_use_map_filename_and_duplicate_ue_names_merge(self):
        self.write('story/01_Dock.json', dict(events=[dict(id='e1', when=dict(type='flag', flag='DoorUnlocked'))]))
        self.write('maps/01_Dock.edits.json', dict(links=[dict(id='L1', do=[dict(verb='flag', a='doorunlocked', b='0')])]))
        result = statecatalog.catalog(self.kit)['flags']
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['flag'], 'DoorUnlocked')
        self.assertEqual({use['kind'] for use in result[0]['uses']}, {'read', 'write'})
        self.assertEqual({use['map'] for use in result[0]['uses']}, {'01_Dock'})

    def test_only_authored_files_in_this_project_are_read(self):
        valid = dict(events=[dict(when=dict(type='flag', flag='Mine'))])
        self.write('story/01_Mine.json', valid)
        foreign = dict(events=[dict(when=dict(type='flag', flag='Foreign'))])
        for path in ('backup/story/01_Backup.json', 'story/backup/01_Old.json',
                     'editor/cache/_gamecons/Revision.json', '../other/story/01_Other.json'):
            self.write(path, foreign)
        self.assertEqual(set(entries(statecatalog.catalog(self.kit)['flags'])), {'Mine'})

    def test_catalog_read_does_not_modify_authored_files(self):
        path = self.write('story/01_Test.json', dict(events=[dict(when=dict(type='flag', flag='Keep'))]))
        before = path.read_bytes(), path.stat().st_mtime_ns
        statecatalog.catalog(self.kit)
        self.assertEqual((path.read_bytes(), path.stat().st_mtime_ns), before)

    def test_incomplete_and_non_object_drafts_do_not_hide_valid_flags(self):
        (self.kit / 'story/00_Broken.json').write_text('{', encoding='utf-8')
        self.write('story/01_Array.json', [])
        self.write('story/02_Partial.json', dict(events=[None, dict(when=None), dict(when=dict(type='flag', flag='Valid'))],
                                                dialogues=[dict(id='d1', steps=[None, dict(type='choice', options=None)])]))
        result = entries(statecatalog.catalog(self.kit)['flags'])
        self.assertIn('Valid', result)

    def test_new_flag_names_are_not_silently_rewritten(self):
        result = entries(statecatalog.collect_edits(dict(links=[dict(do=[dict(verb='flag', a='Custom State')])]), '01_Test'))
        self.assertIn('Custom State', result)

    def test_known_flags_merges_interactions_without_changing_legacy_sources(self):
        classes = self.root / 'classes'
        classes.mkdir()
        (classes / 'UCEd_Test.uc').write_text("SetF('CompiledState', True);", encoding='latin1')
        self.write('maps/01_Test.edits.json', dict(links=[dict(do=[dict(verb='flag', a='InteractionState')])]))
        self.write('story/01_Test.json', dict(events=[dict(when=dict(type='flag', flag='AuthoredState'))]))
        with patch.object(story, 'KIT', self.kit), patch.object(story, 'STORY', self.kit / 'story'), \
             patch.object(story, 'CLASSES', classes):
            self.assertEqual(story.known_flags(), ['AuthoredState', 'CompiledState', 'InteractionState'])


if __name__ == '__main__':
    unittest.main()
