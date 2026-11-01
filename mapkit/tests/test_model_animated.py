"""Animated models in Import model (editor/models.py, 20 Oct 2026): the clips' frames checked, written into
_a.3d, kept in frames.bin and made the mesh's sequences. No engine runs: kit.Session and the package
publishing are replaced by fakes; every file goes to a temporary folder.

    tools\\mapkit\\.venv\\Scripts\\python.exe -m unittest tests.test_model_animated
"""
import array
import base64
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent), str(HERE.parent / 'editor')]
import models  # noqa: E402

NV = 4
REST = [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]


def frames_of(n):
    """n frames of the four points: frame f is the rest pose times (f + 1)."""
    out = []
    for f in range(n):
        out += [v * (f + 1) for v in REST]
    return array.array('f', out)


def b64(a):
    return base64.b64encode(a.tobytes()).decode()


def body(n=3, sequences=None, idle=''):
    return dict(name='Fan', positions=REST, indices=[0, 1, 2, 0, 2, 3], uvs=[0.0] * 12, triMaterials=[0, 0],
                materials=[dict(color=[1, 0, 0])], frames=b64(frames_of(n)),
                sequences=sequences if sequences is not None else [dict(name='Spin', start=0, count=n, rate=15)], idle=idle)


class Sequences(unittest.TestCase):
    def test_valid(self):
        data, nf, seqs, idle = models._sequences(body(4, [dict(name='Spin', start=0, count=2, rate=15),
                                                          dict(name='Stop', start=2, count=2, rate=10)], 'Stop'), NV)
        self.assertEqual(nf, 4)
        self.assertEqual(len(data), 4 * NV * 12)
        self.assertEqual([s['name'] for s in seqs], ['Spin', 'Stop'])
        self.assertEqual(idle, 'Stop')

    def test_still_model_has_no_frames(self):
        self.assertEqual(models._sequences(dict(positions=REST), NV), (None, 1, [], ''))
        self.assertEqual(models._sequences(dict(frames=b64(frames_of(2)), sequences=[]), NV), (None, 1, [], ''))

    def test_frames_must_match_the_points(self):
        with self.assertRaisesRegex(ValueError, 'do not match'):
            models._sequences(body(3), 5)

    def test_damaged_data(self):
        b = body(2)
        b['frames'] = 'not base64!!'
        with self.assertRaisesRegex(ValueError, 'damaged'):
            models._sequences(b, NV)

    def test_names(self):
        with self.assertRaisesRegex(ValueError, 'two animations'):
            models._sequences(body(2, [dict(name='Walk', start=0, count=1), dict(name='walk', start=1, count=1)]), NV)
        with self.assertRaisesRegex(ValueError, 'two animations'):
            models._sequences(body(2, [dict(name='All', start=0, count=1)]), NV)   # All is the whole mesh's
        _, _, seqs, _ = models._sequences(body(2, [dict(name='2 Run!', start=0, count=2)]), NV)
        self.assertEqual(seqs[0]['name'], 'A2Run')

    def test_frames_and_rate_in_range(self):
        for s in (dict(name='X', start=1, count=3), dict(name='X', start=0, count=0), dict(name='X', start=-1, count=1),
                  dict(name='X', start=0, count=1, rate=0), dict(name='X', start=0, count=1, rate=500)):
            with self.assertRaises(ValueError, msg=s):
                models._sequences(body(3, [s]), NV)

    def test_idle_must_be_one_of_them(self):
        self.assertEqual(models._sequences(body(2, idle='Nope'), NV)[3], '')

    def test_too_much_animation(self):
        with patch.object(models, 'MAX_FRAMES', 5):
            with self.assertRaisesRegex(ValueError, 'too much animation'):
                models._sequences(body(6, [dict(name='X', start=0, count=6)]), NV)
        with patch.object(models, 'MAX_FRAME_VERTICES', 20):
            with self.assertRaisesRegex(ValueError, 'too much animation'):
                models._sequences(body(6, [dict(name='X', start=0, count=6)]), NV)


class Files(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='.model-anim-', dir=HERE)
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def test_a3d_keeps_every_frame(self):
        m = dict(positions=REST, uvs=[0.0] * 12, indices=[0, 1, 2, 0, 2, 3], materials=[{}])
        fr = frames_of(3)
        scale = models._write_3d(m, self.dir, 'T', {}, fr)
        raw = (self.dir / 'T_a.3d').read_bytes()
        nf, size = struct.unpack('<HH', raw[:4])
        self.assertEqual((nf, size), (3, NV * 8))
        self.assertEqual(len(raw), 4 + 3 * NV * 8)
        # the biggest value of any frame is the 16-bit range: the last frame's 30 units
        self.assertAlmostEqual(scale, 30 / 32000.0)
        last = struct.unpack('<hhhh', raw[4 + (2 * NV + 1) * 8:4 + (2 * NV + 2) * 8])
        self.assertEqual(last[:3], (32000, 0, 0))
        first = struct.unpack('<hhhh', raw[4 + 8:4 + 16])
        self.assertAlmostEqual(first[0] * scale, 10, places=2)

    def test_still_a3d_unchanged(self):
        m = dict(positions=REST, uvs=[0.0] * 12, indices=[0, 1, 2, 0, 2, 3], materials=[{}])
        models._write_3d(m, self.dir, 'S', {})
        self.assertEqual(struct.unpack('<HH', (self.dir / 'S_a.3d').read_bytes()[:4]), (1, NV * 8))

    def test_frames_of(self):
        (self.dir / 'frames.bin').write_bytes(frames_of(2).tobytes())
        self.assertIsNone(models._frames_of(self.dir, dict(sequences=[])))
        self.assertEqual(list(models._frames_of(self.dir, dict(sequences=[{}]))), list(frames_of(2)))


class FakeSession:
    """kit.Session without the engine: keeps the commands, 'saves' the package."""
    last = None

    def __init__(self, maps, name):
        self.folder = Path(tempfile.mkdtemp(prefix='.fake-session-', dir=HERE))
        (self.folder / 'Input').mkdir()
        (self.folder / 'Output').mkdir()
        FakeSession.last = self

    def batch(self, cmds, timeout=0):
        self.cmds = cmds
        (self.folder / 'Output' / (models.PACKAGE + '.u')).write_bytes(b'package')
        return 'meshimport|UCM_Fan|1\nsavepkg|x|1'

    def close(self):
        import shutil
        shutil.rmtree(self.folder, ignore_errors=True)


class Pack(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='.model-pack-', dir=HERE)
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        for name, value in (('SOURCES', root / 'models'), ('DIST', root / 'dist' / 'Pkg.u'), ('CACHE', root / 'cache')):
            p = patch.object(models, name, value)
            p.start()
            self.addCleanup(p.stop)
        for target, value in (('kit.Session', FakeSession), ('live.running', lambda: True)):
            p = patch(target, value)
            p.start()
            self.addCleanup(p.stop)
        self.root = root

    def cmds(self):
        ok, lines = models.pack()
        self.assertTrue(ok, lines)
        return [c for c in FakeSession.last.cmds if 'SEQUENCE' in c]

    def test_import_keeps_frames_and_makes_sequences(self):
        with patch.object(models, 'pack', return_value=(True, ['packed'])):
            ok, lines, mesh = models.import_model(body(4, [dict(name='Spin', start=0, count=3, rate=20),
                                                            dict(name='Still', start=3, count=1, rate=15)], 'Spin'))
        self.assertTrue(ok)
        folder = models.SOURCES / 'Fan'
        m = json.loads((folder / 'model.json').read_text(encoding='utf-8'))
        self.assertEqual((m['frames'], m['idle']), (4, 'Spin'))
        self.assertEqual((folder / 'frames.bin').stat().st_size, 4 * NV * 12)
        seqs = self.cmds()
        self.assertIn('MESH SEQUENCE MESH=UCM_Fan SEQ=All STARTFRAME=0 NUMFRAMES=4', seqs)
        self.assertIn('MESH SEQUENCE MESH=UCM_Fan SEQ=Spin STARTFRAME=0 NUMFRAMES=3 RATE=20', seqs)
        self.assertIn('MESH SEQUENCE MESH=UCM_Fan SEQ=Still STARTFRAME=3 NUMFRAMES=1 RATE=15', seqs)
        self.assertEqual(sum(' SEQ=Still ' in c for c in seqs), 1)     # its own Still, not a second one
        listed = [x for x in models.imported() if x['name'] == 'Fan'][0]
        self.assertEqual((listed['frames'], listed['sequences'], listed['idle']), (4, ['Spin', 'Still'], 'Spin'))

    def test_still_model_as_before(self):
        b = body()
        del b['frames'], b['sequences']
        with patch.object(models, 'pack', return_value=(True, ['packed'])):
            models.import_model(b)
        self.assertFalse((models.SOURCES / 'Fan' / 'frames.bin').exists())
        self.assertEqual(self.cmds(), ['MESH SEQUENCE MESH=UCM_Fan SEQ=All STARTFRAME=0 NUMFRAMES=1',
                                       'MESH SEQUENCE MESH=UCM_Fan SEQ=Still STARTFRAME=0 NUMFRAMES=1'])

    def test_copy_in_the_maps_folder_is_replaced(self):
        # the game reads its maps folder before System: an old copy there hid every new model (20 Oct 2026)
        system, maps = self.root / 'System', self.root / 'ModMaps'
        system.mkdir()
        maps.mkdir()
        (maps / (models.PACKAGE + '.u')).write_bytes(b'old')
        with patch('live.running', lambda: False), patch.object(models.settings, 'PACKAGES_DIR', system), \
                patch.object(models.settings, 'MAPS_DIR', maps):
            with patch.object(models, 'pack', return_value=(True, [])):
                models.import_model(body(2))
            ok, lines = models.pack()
        self.assertTrue(ok, lines)
        self.assertEqual((maps / (models.PACKAGE + '.u')).read_bytes(), b'package')
        self.assertEqual((system / (models.PACKAGE + '.u')).read_bytes(), b'package')

    def test_no_copy_made_in_the_maps_folder(self):
        system, maps = self.root / 'System', self.root / 'ModMaps'
        system.mkdir()
        maps.mkdir()
        with patch('live.running', lambda: False), patch.object(models.settings, 'PACKAGES_DIR', system), \
                patch.object(models.settings, 'MAPS_DIR', maps):
            with patch.object(models, 'pack', return_value=(True, [])):
                models.import_model(body(2))
            models.pack()
        self.assertFalse((maps / (models.PACKAGE + '.u')).exists())

    def test_bad_animation_leaves_the_saved_model(self):
        with patch.object(models, 'pack', return_value=(True, ['packed'])):
            models.import_model(body(2))
        before = (models.SOURCES / 'Fan' / 'model.json').read_bytes()
        bad = body(2)
        bad['frames'] = b64(frames_of(2))[:-8]
        with self.assertRaises(ValueError):
            models.import_model(bad)
        self.assertEqual((models.SOURCES / 'Fan' / 'model.json').read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
