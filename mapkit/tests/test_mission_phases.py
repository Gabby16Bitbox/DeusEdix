"""Mission phases shared by the project (P3 slice 7, editor/missionphases.py): the sets are declared once
(tools/mapkit/logic/phases.json), a Phases block of any map linked to one (edits.logic.mission) takes its phases and
its name at every build, so the phase goes on from one map to the next; the state catalog offers the sets' states to
every map; a changed set makes the linked maps' builds out of date. The page's side: tests/test_mission_phases.mjs."""
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'editor'), os.path.join(HERE, '..')]
import missionphases  # noqa: E402
import statecatalog  # noqa: E402

RAID = dict(id='MP1', name='Raid', phases=['Calm', 'Alarm', 'Escape'])


def block(name='UCBPhases0', **props):
    return dict(cls='UCBPhases', name=name, at=[0, 0, 0], props=props)


class Validate(unittest.TestCase):
    def test_cleans_names_and_phases_and_gives_ids(self):
        kept = missionphases.validate([dict(name=' Raid "x" ', phases='Calm, Alarm,, alarm ,Escape'), dict(name='Hunt', phases=['A|b'])])
        self.assertEqual(kept[0], dict(id='MP1', name='Raid x', phases=['Calm', 'Alarm', 'Escape']))
        self.assertEqual(kept[1], dict(id='MP2', name='Hunt', phases=['Ab']))

    def test_keeps_ids_and_new_ones_take_the_first_free(self):
        kept = missionphases.validate([dict(id='MP2', name='A', phases=['x']), dict(name='B', phases=['y']), dict(id='MP2', name='C', phases=['z'])])
        self.assertEqual([s['id'] for s in kept], ['MP2', 'MP1', 'MP3'])

    def test_refuses_what_cannot_be_kept(self):
        for bad, words in [('x', 'list'), ([dict(name='', phases=['a'])], 'needs a name'),
                           ([dict(name='Raid', phases=['a']), dict(name='raid', phases=['b'])], 'two phase sets'),
                           ([dict(name='Raid', phases=[])], 'at least one phase'),
                           ([dict(name='R%d' % k, phases=['a']) for k in range(33)], 'at most')]:
            with self.assertRaises(ValueError) as e:
                missionphases.validate(bad)
            self.assertIn(words, str(e.exception))


class Kept(unittest.TestCase):
    def setUp(self):
        self.kit = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.kit, ignore_errors=True)

    def test_save_and_load(self):
        self.assertEqual(missionphases.load(self.kit), [])
        kept = missionphases.save([dict(name='Raid', phases='Calm, Alarm')], self.kit)
        self.assertEqual(kept, [dict(id='MP1', name='Raid', phases=['Calm', 'Alarm'])])
        on_disk = json.loads((self.kit / 'logic' / 'phases.json').read_text(encoding='utf-8'))
        self.assertEqual(on_disk['version'], 1)
        self.assertEqual(missionphases.load(self.kit), kept)

    def test_a_file_that_cannot_be_read_is_no_sets(self):
        (self.kit / 'logic').mkdir()
        (self.kit / 'logic' / 'phases.json').write_text('{oops', encoding='utf-8')
        self.assertEqual(missionphases.load(self.kit), [])

    def test_the_catalog_offers_the_sets_states_to_every_map(self):
        missionphases.save([RAID], self.kit)
        flags = {f['flag']: f for f in statecatalog.catalog(self.kit, self.kit / 'story')['flags']}
        self.assertEqual(flags['Raid']['type'], 'int')
        for phase in ('Calm', 'Alarm', 'Escape'):
            self.assertIn('Raid_' + phase, flags)


class Apply(unittest.TestCase):
    def test_nothing_linked_is_the_same_edits(self):
        edits = dict(added=[block()])
        self.assertIs(missionphases.apply(edits, sets=[RAID]), edits)

    def test_a_linked_added_block_takes_the_set(self):
        edits = dict(added=[block('Ph', Phases='"One, Two"', StateName='"Mine"')],
                     props={'ph': {'Phases': '"Other"', 'bDebug': 'True'}}, logic=dict(mission={'Ph': 'MP1'}))
        out = missionphases.apply(edits, sets=[RAID])
        self.assertEqual(out['added'][0]['props'], dict(Phases='"Calm, Alarm, Escape"', StateName='"Raid"'))
        self.assertEqual(out['props'], {'ph': {'bDebug': 'True'}}, 'the Inspector values give way to the set')
        self.assertEqual(edits['added'][0]['props']['Phases'], '"One, Two"', 'a copy: the map\'s edits stay as saved')

    def test_a_block_of_the_map_itself_takes_it_in_its_props(self):
        out = missionphases.apply(dict(props={'UCBPhases3': {'Phases': '"x"'}}, logic=dict(mission={'UCBPhases3': 'MP1'})), sets=[RAID])
        self.assertEqual(out['props']['UCBPhases3'], dict(Phases='"Calm, Alarm, Escape"', StateName='"Raid"'))

    def test_all_properties_do_not_win_over_the_set(self):
        edits = dict(added=[block('Ph')], rawprops={'PH': {'stateName': '"Other"', 'bHidden': 'True'}}, logic=dict(mission={'Ph': 'MP1'}))
        out = missionphases.apply(edits, sets=[RAID])
        self.assertEqual(out['rawprops'], {'PH': {'bHidden': 'True'}})
        self.assertIn('stateName', edits['rawprops']['PH'])

    def test_a_set_the_project_no_longer_has_keeps_the_map(self):
        edits = dict(added=[block('Ph', Phases='"One"')], logic=dict(mission={'Ph': 'MP9'}))
        self.assertEqual(missionphases.apply(edits, sets=[RAID])['added'][0]['props'], dict(Phases='"One"'))

    def test_only_phases_blocks(self):
        edits = dict(added=[dict(cls='UCBCounter', name='Ph', props={})], logic=dict(mission={'Ph': 'MP1'}))
        self.assertEqual(missionphases.apply(edits, sets=[RAID])['added'][0]['props'], {})


class Build(unittest.TestCase):
    """dxmaps.load_edits is what the builds and their fingerprint read: a changed set makes a linked map out of date"""
    def test_load_edits_applies_the_sets(self):
        import dxmaps
        from unittest import mock
        kit = Path(tempfile.mkdtemp())
        try:
            for patch in (mock.patch.object(dxmaps, 'KIT', kit),     # (another test may leave edits_path another)
                          mock.patch.object(dxmaps, 'edits_path', lambda name: kit / 'maps' / (name + '.edits.json'))):
                patch.start()
                self.addCleanup(patch.stop)
            (kit / 'maps').mkdir()
            (kit / 'maps' / 'M.edits.json').write_text(json.dumps(dict(added=[block('Ph')], logic=dict(mission={'Ph': 'MP1'}))), encoding='utf-8')
            missionphases.save([RAID], kit)
            first = dxmaps.load_edits('M')
            self.assertEqual(first['added'][0]['props']['StateName'], '"Raid"')
            missionphases.save([dict(RAID, phases=['Calm', 'Alarm'])], kit)
            second = dxmaps.load_edits('M')
            self.assertEqual(second['added'][0]['props']['Phases'], '"Calm, Alarm"')
            self.assertNotEqual(dxmaps._edits_fingerprint(first), dxmaps._edits_fingerprint(second))
        finally:
            shutil.rmtree(kit, ignore_errors=True)


if __name__ == '__main__':
    unittest.main()
