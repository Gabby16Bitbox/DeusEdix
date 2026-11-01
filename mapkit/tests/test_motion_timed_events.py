"""G38 on the server: an animation's timed events (the Animation panel's Events row) given to its UCMotion (motions.py:
in time order, at most 16, one after the end at the end, a mover's on its key clock), said in the build's report, kept
by a map template, and the properties written are the ones UCMotion declares (both copies of the class in step)."""
import re
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import maptemplates  # noqa: E402
import motions  # noqa: E402
import settings  # noqa: E402

# the editor's own classes (every project's template) and, in a mod's working copy (development mode), the mod's copy of
# them (src/<its package from devmode.json>/Classes), kept the same; none elsewhere (the DeusEdix repo, DeusEdix installed)
TEMPLATE = KIT / 'project-template' / 'src' / 'DeusEdix' / 'Classes'
MOD = None if settings.STANDALONE else settings.PROJECT / 'src' / settings.PACKAGE / 'Classes'


def class_text(folder, name):
    return (folder / name).read_bytes().replace(b'\r\n', b'\n').decode('latin1')


def motion(**extra):
    return dict({'pos': [{'t': 0, 'v': [0, 0, 0]}, {'t': 1, 'v': [0, 0, 64]}, {'t': 3, 'v': [128, 0, 64]}], 'mode': 'loop'}, **extra)


class TimedEvents(unittest.TestCase):
    def test_in_time_order_a_sound_or_an_event_the_rest_left_out(self):
        m = motion(events=[{'t': 2.5, 'kind': 'event', 'tag': 'Alarm'}, {'t': 0.5, 'kind': 'sound', 'sound': 'Ambient.Machinery.Clank2'},
                           {'t': 1, 'kind': 'event', 'tag': 'two words'}, {'t': 1, 'kind': 'sound', 'sound': ''},
                           {'t': 9, 'kind': 'sound', 'sound': 'MoverSFX.Door.Stop', 'volume': 9, 'radius': 2}, 'x', {'kind': 'other'}])
        evs = motions.events(m, motions.length(m))
        self.assertEqual(evs, [dict(t=0.5, sound='Ambient.Machinery.Clank2', volume=1.0, radius=1024.0),
                               dict(t=2.5, tag='Alarm'),
                               dict(t=3.0, sound='MoverSFX.Door.Stop', volume=4.0, radius=16.0)])     # at the end; held in range
        self.assertEqual(len(motions.events({'events': [{'t': i, 'kind': 'event', 'tag': 'T%d' % i} for i in range(20)]}, 30)), 16)

    def test_an_object_s_ucmotion_gets_them(self):
        m = motion(events=[{'t': 3, 'kind': 'sound', 'sound': 'Ambient.Machinery.Clank2', 'volume': 0.5, 'radius': 800},
                           {'t': 0, 'kind': 'event', 'tag': 'CraneStarts'}])
        props = motions.blocks({'motions': {'Crane': m}})[0]['props']
        self.assertEqual({k: v for k, v in props.items() if k.startswith(('Ev', 'Num'))},
                         {'NumPos': '3', 'EvT(0)': '0.0000', 'EvTag(0)': 'CraneStarts', 'EvT(1)': '3.0000',
                          'EvSound(1)': "Sound'Ambient.Machinery.Clank2'", 'EvVolume(1)': '0.5000', 'EvRadius(1)': '800.0', 'NumEv': '2'})
        self.assertEqual(props['EvT(1)'], props['Length'])            # the same text: the clock stops right on it

    def test_without_events_the_ucmotion_is_as_before(self):
        props = motions.blocks({'motions': {'Crane': motion()}})[0]['props']
        self.assertFalse([k for k in props if k.startswith(('Ev', 'NumEv'))])

    def test_a_mover_counts_its_keys_an_event_at_a_key_is_on_it(self):
        keys = motions.mover_keys(motion())
        self.assertEqual([motions.mover_clock(keys, t) for t in (0, 0.5, 1, 2, 3, 7)], [0.0, 0.5, 1.0, 1.5, 2.0, 2.0])
        m = motion(events=[{'t': 1, 'kind': 'event', 'tag': 'LiftUp'}, {'t': 2, 'kind': 'event', 'tag': 'Half'},
                           {'t': 3, 'kind': 'sound', 'sound': 'MoverSFX.Elevator.Stop'}])
        props = motions.blocks({'motions': {'Lift': m}}, ['Lift'])[0]['props']
        self.assertEqual([props['EvT(%d)' % i] for i in range(3)], ['1.0000', '1.5000', '2.0000'])

    def test_the_report_says_how_many(self):
        self.assertEqual(motions.report({'motions': {'Crane': motion(events=[{'t': 1, 'kind': 'event', 'tag': 'A'}])}}),
                         ['  EDIT animation of Crane: 3.0 s, loop, 1 timed event'])
        self.assertEqual(motions.report({'motions': {'Crane': motion()}}), ['  EDIT animation of Crane: 3.0 s, loop'])

    def test_a_template_keeps_them_with_their_animation(self):
        source = {'motions': {'UCEdit1': motion(events=[{'t': 1, 'kind': 'event', 'tag': 'A'}])}, 'added': []}
        self.assertEqual(maptemplates.place_of(source)['motions'], source['motions'])
        self.assertIn('timed events', maptemplates.KEEP['motions'])

    def test_ucmotion_declares_what_it_is_given(self):
        declared = set(re.findall(r'^var\(\)\s+\w+\s+(\w+)', class_text(TEMPLATE, 'UCMotion.uc'), re.M))
        self.assertTrue({'EvT', 'EvSound', 'EvVolume', 'EvRadius', 'EvTag', 'NumEv'} <= declared)
        m = motion(events=[{'t': 1, 'kind': 'sound', 'sound': 'A.B'}, {'t': 2, 'kind': 'event', 'tag': 'C'}])
        written = {re.sub(r'\(\d+\)$', '', k) for k in motions.blocks({'motions': {'X': m}})[0]['props']}
        self.assertEqual(written - declared, set())

    @unittest.skipUnless(MOD and MOD.is_dir(), "not a mod's working copy: no src/<its package>/Classes beside the editor")
    def test_the_mod_s_ucmotion_is_the_editor_s(self):
        self.assertEqual(class_text(MOD, 'UCMotion.uc'), class_text(TEMPLATE, 'UCMotion.uc'))


if __name__ == '__main__':
    unittest.main()
