"""Synthetic animation data only; validation never needs game models or packages."""
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT / 'editor'), str(KIT), str(KIT.parent)]
import anims


def animation():
    return dict(name='SyntheticMotion', frames=12, fps=15, loop=True, interp='smooth', source='made',
                keys=[dict(f=0, rot={'head': [0, 0.2, 0, 0.9797959]}, root=[0, 0, 0]),
                      dict(f=11, rot={}, root=[1, 2, 3])])


def channels():
    return {axis: [dict(f=0, v=0, mode='smooth'), dict(f=11, v=30, mode='linear')] for axis in ('x', 'y', 'z')}


class StudioValidation(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='studio-validation-', dir=Path(__file__).parent)
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name) / 'anims'
        self.redirect = patch.object(anims, 'STUDIO', self.root)
        self.redirect.start()
        self.addCleanup(self.redirect.stop)

    def assert_rejected_without_changes(self, invalid, message):
        before = {p.name: p.read_bytes() for p in self.root.iterdir()} if self.root.exists() else None
        with self.assertRaisesRegex(ValueError, message):
            anims.studio_save(invalid)
        after = {p.name: p.read_bytes() for p in self.root.iterdir()} if self.root.exists() else None
        self.assertEqual(after, before)

    def test_legacy_metadata_and_rounded_quaternions_round_trip_without_normalizing(self):
        value = animation()
        value.update(made_on='Synthetic.Model', interp='legacy-custom', extra={'label': 'Original note', 'revision': 3})
        value['keys'][0]['extra'] = ['legacy key metadata']
        before = copy.deepcopy(value)
        self.assertTrue(anims.studio_save(value))
        self.assertEqual(anims.studio_get(value['name']), before)
        self.assertEqual(value, before)
        self.assertEqual([p.name for p in self.root.iterdir()], ['SyntheticMotion.json'])

    def test_copied_one_frame_and_long_legacy_animations_keep_native_length_and_rate(self):
        for frames, fps in ((1, 2.5), (601, 29.97), (1200, 90.5)):
            with self.subTest(frames=frames, fps=fps):
                value = animation()
                value.update(frames=frames, fps=fps, source='copy:Synthetic')
                value['keys'] = [dict(f=0, rot={})]  # The legacy evaluator supplies a missing root.
                anims.studio_save(value)
                self.assertEqual(anims.studio_get(value['name']), value)

    def test_complete_xyz_curves_for_all_bones_and_root_round_trip(self):
        value = animation()
        value['curves'] = {bone: channels() for bone in anims._STUDIO_BONES | {'$root'}}
        value['curves']['head']['z'][0]['mode'] = 'hold'
        value['curves']['$root']['y'][1]['v'] = -0.125
        anims.studio_save(value)
        self.assertEqual(anims.studio_get(value['name']), value)
        value['curves'] = {}
        anims.studio_save(value)
        self.assertEqual(anims.studio_get(value['name'])['curves'], {})

    def test_invalid_header_never_creates_output_directory(self):
        for field, invalid, message in (
            ('name', '../Escape', 'name of letters'), ('name', 5, 'name of letters'),
            ('frames', 0, 'frame count'), ('frames', True, 'frame count'),
            ('frames', 2.5, 'frame count'), ('frames', 2147483648, 'frame count'),
            ('fps', 0, 'greater than zero'), ('fps', -1, 'greater than zero'),
            ('fps', True, 'finite number'), ('fps', float('nan'), 'finite number'),
            ('fps', float('inf'), 'finite number'), ('loop', 'yes', 'true or false'),
        ):
            with self.subTest(field=field, invalid=invalid):
                value = animation()
                value[field] = invalid
                self.assert_rejected_without_changes(value, message)
        self.assert_rejected_without_changes([], 'Animation must be an object')
        self.assertFalse(self.root.exists())

    def test_invalid_pose_order_range_or_shape_preserves_existing_file(self):
        anims.studio_save(animation())
        cases = [([], 'at least one key'), ([dict(f=0, rot={}), dict(f=0, rot={})], 'sorted, unique'),
                 ([dict(f=5, rot={}), dict(f=0, rot={})], 'sorted, unique'),
                 ([dict(f=12, rot={})], 'integers'), ([dict(f=-1, rot={})], 'integers'),
                 ([dict(f=True, rot={})], 'integers'), ([dict(f=1.5, rot={})], 'integers'),
                 ([dict(f=0, rot=None)], 'rotations'), ([dict(f=0, rot={'unknown': [0, 0, 0, 1]})], 'Unknown pose bone'),
                 ([dict(f=0, rot={'head': [0, 0, 1]})], '4 numbers'),
                 ([dict(f=0, rot={}, root=[0, 1])], '3 numbers'), ([None], 'must be objects')]
        for keys, message in cases:
            with self.subTest(keys=keys):
                value = animation()
                value['keys'] = keys
                self.assert_rejected_without_changes(value, message)

    def test_nonfinite_or_non_numeric_pose_values_preserve_existing_file(self):
        anims.studio_save(animation())
        for bad in (float('nan'), float('inf'), -float('inf'), True, '5', 10 ** 400):
            for field in ('rot', 'root'):
                with self.subTest(bad=str(bad), field=field):
                    value = animation()
                    if field == 'rot':
                        value['keys'][0]['rot']['head'][1] = bad
                    else:
                        value['keys'][0]['root'][1] = bad
                    self.assert_rejected_without_changes(value, 'finite number')

    def test_unknown_incomplete_or_empty_curve_channels_preserve_existing_file(self):
        anims.studio_save(animation())
        for curves, message in ((None, 'curves must be an object'),
                                ({'unknown': channels()}, 'Unknown curve bone'),
                                ({'head': {'x': channels()['x']}}, 'x, y and z'),
                                ({'head': dict(channels(), w=[])}, 'x, y and z'),
                                ({'head': dict(channels(), x=[])}, 'at least one key')):
            with self.subTest(curves=curves):
                value = animation()
                value['curves'] = curves
                self.assert_rejected_without_changes(value, message)

    def test_invalid_curve_values_modes_order_or_range_preserve_existing_file(self):
        anims.studio_save(animation())
        for field, bad, message in (('v', float('nan'), 'finite number'), ('v', float('inf'), 'finite number'),
                                    ('v', True, 'finite number'), ('v', '30', 'finite number'),
                                    ('f', 12, 'integers'), ('f', 2.5, 'integers'), ('f', -1, 'integers'),
                                    ('mode', 'bezier', 'interpolation'), ('mode', None, 'interpolation')):
            with self.subTest(field=field, bad=bad):
                value = animation()
                value['curves'] = {'head': channels()}
                value['curves']['head']['x'][0][field] = bad
                self.assert_rejected_without_changes(value, message)
        for frames in ((0, 0), (11, 0)):
            value = animation()
            value['curves'] = {'$root': channels()}
            for key, frame in zip(value['curves']['$root']['z'], frames):
                key['f'] = frame
            self.assert_rejected_without_changes(value, 'sorted, unique')

    def test_invalid_extra_json_data_is_rejected_before_overwriting(self):
        anims.studio_save(animation())
        for bad in (float('nan'), {'a', 'set'}):
            value = animation()
            value['extra'] = bad
            self.assert_rejected_without_changes(value, 'valid JSON data')

    def test_independent_tracks_round_trip_without_normalizing_or_touching_legacy_keys(self):
        value = animation()
        value['tracks'] = {bone: {'keys': [dict(f=0, q=[0, 0.2, 0, 0.9797959]),
                                         dict(f=11, q=[0, 0, 0, 1], mode='hold')]}
                           for bone in anims._STUDIO_BONES}
        value['tracks']['$root'] = {'keys': [dict(f=3, v=[1, -2.5, 3], mode='linear'),
                                            dict(f=9, v=[0, 1, 0], mode='smooth')],
                                    'extra': 'Preserved track note'}
        before = copy.deepcopy(value)
        anims.studio_save(value)  # No curves: validates before the legacy early return.
        self.assertEqual(anims.studio_get(value['name']), before)
        self.assertEqual(value, before)
        value['tracks']['head']['keys'] = []  # Explicit rest, not legacy fallback.
        value['tracks']['$root']['keys'] = []
        anims.studio_save(value)
        self.assertEqual(anims.studio_get(value['name']), value)
        value['tracks'] = {}
        anims.studio_save(value)
        self.assertEqual(anims.studio_get(value['name']), value)

    def test_invalid_track_shape_names_and_frames_never_replace_saved_file(self):
        anims.studio_save(animation())
        cases = [
            (None, 'tracks must be an object'),
            ([], 'tracks must be an object'),
            ({'unknown': {'keys': []}}, 'Unknown track bone'),
            ({'head': []}, 'track must be an object'),
            ({'head': {}}, 'keys must be an array'),
            ({'head': {'keys': None}}, 'keys must be an array'),
            ({'head': {'keys': [None]}}, 'keys must be objects'),
        ]
        for frames, message in (((0, 0), 'sorted, unique'), ((7, 2), 'sorted, unique'),
                                ((-1,), 'integers'), ((12,), 'integers'),
                                ((True,), 'integers'), ((2.5,), 'integers')):
            cases.append(({'head': {'keys': [dict(f=f, q=[0, 0, 0, 1]) for f in frames]}}, message))
        for tracks, message in cases:
            with self.subTest(tracks=tracks):
                value = animation()
                value['tracks'] = tracks
                self.assert_rejected_without_changes(value, message)

    def test_invalid_track_values_and_modes_never_replace_saved_file(self):
        anims.studio_save(animation())
        for bone, field, vector in (('head', 'q', [0, 0, 0, 1]), ('$root', 'v', [0, 0, 0])):
            for invalid in (None, vector[:-1], vector + [0], 'not a vector'):
                with self.subTest(bone=bone, invalid=invalid):
                    value = animation()
                    value['tracks'] = {bone: {'keys': [dict(f=0, **{field: invalid})]}}
                    self.assert_rejected_without_changes(value, '%d numbers' % len(vector))
            for bad in (float('nan'), float('inf'), -float('inf'), True, '5', 10 ** 400):
                with self.subTest(bone=bone, bad=str(bad)):
                    invalid = vector.copy()
                    invalid[0] = bad
                    value = animation()
                    value['tracks'] = {bone: {'keys': [dict(f=0, **{field: invalid})]}}
                    self.assert_rejected_without_changes(value, 'finite number')
            for mode in ('bezier', None, True, []):
                with self.subTest(bone=bone, mode=mode):
                    value = animation()
                    value['tracks'] = {bone: {'keys': [dict(f=0, mode=mode, **{field: vector})]}}
                    self.assert_rejected_without_changes(value, 'interpolation')

    def test_tracks_do_not_relax_legacy_keys_validation(self):
        value = animation()
        value['tracks'] = {'head': {'keys': []}}
        value['keys'] = []
        self.assert_rejected_without_changes(value, 'at least one key')
        self.assertFalse(self.root.exists())

    def test_failed_atomic_replace_leaves_saved_animation_and_no_temporary_file(self):
        anims.studio_save(animation())
        before = (self.root / 'SyntheticMotion.json').read_bytes()
        value = animation()
        value['fps'] = 24
        with patch.object(Path, 'replace', side_effect=OSError('synthetic replacement failure')):
            with self.assertRaisesRegex(OSError, 'synthetic replacement failure'):
                anims.studio_save(value)
        self.assertEqual((self.root / 'SyntheticMotion.json').read_bytes(), before)
        self.assertEqual([p.name for p in self.root.iterdir()], ['SyntheticMotion.json'])


if __name__ == '__main__':
    unittest.main()
