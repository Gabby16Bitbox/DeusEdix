"""UC_TEXDUMP's pictures are read the way the host writes them (host/PROTOCOL.md: a JSON line {width, height},
then the RGBA pixels). From 23 to 24 Oct 2026 the texture picker, the Texture Editor and the conversion still read
the older 'texdump w h' line: every picture failed, and the picker listed whole packages as unreadable for ever."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import kit  # noqa: E402
from editor import convert, texpicker  # noqa: E402


def dump(path, w=4, h=2, rgba=(200, 30, 10, 255)):
    """A file as the host writes it."""
    Path(path).write_bytes(json.dumps(dict(width=w, height=h)).encode() + b'\n' + bytes(rgba) * (w * h))


class FakeSession:
    """The SDK host: UC_TEXDUMP writes its picture (an unknown texture writes nothing)."""
    def __init__(self, folder, unknown=()):
        self.folder, self.unknown = Path(folder), set(unknown)
        (self.folder / 'Output').mkdir(parents=True, exist_ok=True)

    def batch(self, cmds, timeout=0):
        for c in cmds:
            _cmd, tex, out, _size = c.split()
            if tex not in self.unknown:
                dump(self.folder / 'Output' / Path(out.replace('\\', '/')).name)

    def close(self):
        pass


class TexDump(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='.texdump-', dir=Path(__file__).parent)
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def test_reads_the_hosts_picture(self):
        dump(self.root / 'a.raw', 3, 2)
        w, h, pixels = kit.texdump(self.root / 'a.raw')
        self.assertEqual((w, h, len(pixels)), (3, 2, 24))
        self.assertEqual(pixels[:4], bytes((200, 30, 10, 255)))

    def test_refuses_other_files(self):
        (self.root / 'old.raw').write_bytes(b'texdump 2 2\n' + bytes(16))
        (self.root / 'short.raw').write_bytes(b'{"width": 4, "height": 4}\n' + bytes(10))
        for name in ('old.raw', 'short.raw'):
            with self.assertRaises(ValueError):
                kit.texdump(self.root / name)

    def test_conversion_makes_a_pcx_of_a_true_colour_texture(self):
        dump(self.root / 'own_Sign.raw', 8, 4)
        (self.root / 'out').mkdir()
        made = convert._picture(self.root / 'own_Sign.raw', self.root / 'out')
        self.assertIsNotNone(made)
        with Image.open(made) as im:
            self.assertEqual((im.size, im.mode), ((8, 4), 'P'))

    def _thumbs(self, textures, unknown=()):
        entry = dict(name='Pkg', textures=[[t, 'Pkg.Group.' + t, 64, 64] for t in textures])
        session = FakeSession(self.root / 'run', ['Pkg.Group.' + t for t in unknown])
        with patch.object(texpicker, 'THUMBS', self.root / 'thumbs'), \
                patch.object(texpicker, 'index', lambda: dict(packages=[entry])), \
                patch.object(kit, 'Session', lambda *_a, **_k: session):
            return texpicker.thumbs('Pkg')

    def test_picker_makes_the_pictures_and_keeps_the_unreadable_ones(self):
        r = self._thumbs(['A', 'B', 'C'], unknown=['C'])
        self.assertEqual(sorted(r['thumbs']), ['A', 'B'])
        saved = json.loads((self.root / 'thumbs/Pkg/_unreadable.json').read_text(encoding='utf-8'))
        self.assertEqual(saved, dict(version=texpicker.UNREADABLE, unreadable=['C']))
        with patch.object(texpicker, '_make', side_effect=AssertionError('asked again')):
            self.assertEqual(sorted(self._thumbs(['A', 'B', 'C'])['thumbs']), ['A', 'B'])

    def test_picker_tries_again_a_list_of_the_older_kind(self):
        folder = self.root / 'thumbs/Pkg'
        folder.mkdir(parents=True)
        (folder / '_unreadable.json').write_text(json.dumps(['A', 'B']), encoding='utf-8')
        self.assertEqual(sorted(self._thumbs(['A', 'B'])['thumbs']), ['A', 'B'])


if __name__ == '__main__':
    unittest.main()
