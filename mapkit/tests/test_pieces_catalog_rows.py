"""The Pieces catalog (gamelib.build) reads a map again only when one of its cache files changed: its rows are kept in
its cache folder (pieces-rows.json) with what they were made from, and its preview file (_objects/<map>.json) is
written again only when what it holds changes. Rebuilt whole at the end of every scan before, with nothing changed:
66 s for Revision's 88 maps (17 Nov 2026); the same catalog in 0.8 s now."""
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import gamelib  # noqa: E402
import packed  # noqa: E402

SEMISOLID = gamelib.PF_SEMISOLID


def brush(n, lo, hi, tex):
    return dict(name='Brush%d' % n, ord=n, csg=1, lo=lo, hi=hi, flags=SEMISOLID, tex={tex: 1})


def poly(n, lo, tex):
    x, y, z = lo
    return [tex, 0, [x, y, z, 1, 0, 0, 0, 1, 0, 0, 0, 64, 64], [x, y, z, x + 32, y, z, x, y + 32, z], n]


class CatalogRows(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='rows-', dir=str(Path(__file__).parent)))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        for target, value in (('GAME_CACHE', self.tmp), ):
            p = patch.object(gamelib.data, target, value)
            p.start()
            self.addCleanup(p.stop)
        for name, value in (('CATALOG', self.tmp / 'catalog' / 'objects.json'), ('CACHE', self.tmp / '_objects')):
            p = patch.object(gamelib, name, value)
            p.start()
            self.addCleanup(p.stop)
        # a railing in both maps (listed once, at the first) and a pipe in the second only
        self.write('01_A', [(1, [0, 0, 0], [64, 8, 48], 'Pkg.Rail')])
        self.write('01_B', [(1, [500, 0, 0], [564, 8, 48], 'Pkg.Rail'), (2, [0, 900, 0], [16, 1000, 16], 'Pkg.Pipe')])
        self.read = []
        real = gamelib._rows

        def counting(folder, m):
            self.read.append(m)
            return real(folder, m)
        p = patch.object(gamelib, '_rows', counting)
        p.start()
        self.addCleanup(p.stop)

    def write(self, m, objects):
        folder = self.tmp / ('ref_' + m)
        (folder / 'tex').mkdir(parents=True, exist_ok=True)
        (folder / 'brushes.json').write_text(json.dumps([brush(n, lo, hi, t) for n, lo, hi, t in objects]), encoding='utf-8')
        (folder / 'polys.json').write_text(json.dumps([poly(n, lo, t) for n, lo, hi, t in objects]), encoding='utf-8')
        textures = {}
        for _n, _lo, _hi, t in objects:
            (folder / 'tex' / (t + '.png')).write_bytes(b'png')
            textures[t] = dict(png='tex/%s.png' % t, w=64, h=64)
        (folder / 'textures.json').write_text(json.dumps(textures), encoding='utf-8')

    def build(self):
        self.read.clear()
        items = gamelib.build(maps=['01_A', '01_B'], log=lambda *a: None)
        previews = {m: json.loads(packed.read_text(self.tmp / '_objects' / (m + '.json'))) for m in ('01_A', '01_B')}
        return {it['label']: (it['map'], it['count'], it['maps']) for it in items}, previews

    def test_nothing_changed_nothing_read_the_same_catalog(self):
        first, previews = self.build()
        self.assertEqual(self.read, ['01_A', '01_B'])
        self.assertEqual(first, {'Rail': ('01_A', 2, ['01_A', '01_B']), 'Pipe': ('01_B', 1, ['01_B'])})
        self.assertEqual(sorted(previews['01_A']['objects']), ['01_A~1'])
        self.assertEqual(sorted(previews['01_B']['objects']), ['01_B~2'])         # its railing is listed at 01_A
        self.assertEqual(previews['01_B']['textures'], {'Pkg.Pipe': '/cache/ref_01_B/tex/Pkg.Pipe.png'})
        stamps = [packed.real(self.tmp / '_objects' / f).stat().st_mtime_ns for f in ('01_A.json', '01_B.json')]
        again, previews_again = self.build()
        self.assertEqual(self.read, [])
        self.assertEqual((again, previews_again), (first, previews))
        self.assertEqual([packed.real(self.tmp / '_objects' / f).stat().st_mtime_ns for f in ('01_A.json', '01_B.json')], stamps)
        self.assertEqual(sorted(p.name for p in (self.tmp / '_objects').iterdir()), ['01_A.json' + packed.suffix(), '01_B.json' + packed.suffix()])
        self.assertTrue(packed.packed_path(self.tmp / 'ref_01_A' / gamelib.ROWS).is_file())
        catalog = json.loads(gamelib.CATALOG.read_text(encoding='utf-8'))
        self.assertEqual(sorted(catalog['objectFiles']), ['01_A', '01_B'])

    def test_a_changed_map_is_read_again_and_what_moves_with_it(self):
        self.build()
        self.write('01_A', [(3, [0, 0, 0], [8, 8, 200], 'Pkg.Column')])          # the railing gone from 01_A
        items, previews = self.build()
        self.assertEqual(self.read, ['01_A', '01_B'])        # 01_B: its railing is listed there now, with its preview
        self.assertEqual(items['Rail'], ('01_B', 1, ['01_B']))
        self.assertEqual(sorted(previews['01_B']['objects']), ['01_B~1', '01_B~2'])
        self.assertEqual(sorted(previews['01_A']['objects']), ['01_A~3'])
        self.build()
        self.assertEqual(self.read, [])

    def test_a_change_elsewhere_in_the_map_reads_only_it(self):
        self.build()
        self.write('01_B', [(1, [500, 0, 0], [564, 8, 48], 'Pkg.Rail'), (2, [0, 900, 0], [16, 1000, 16], 'Pkg.Pipe'),
                            (4, [0, 0, 300], [40, 40, 340], 'Pkg.Lamp')])
        items, previews = self.build()
        self.assertEqual(self.read, ['01_B'])
        self.assertIn('Lamp', items)

    def test_a_preview_file_gone_or_changed_is_written_again(self):
        _items, previews = self.build()
        packed.real(self.tmp / '_objects' / '01_B.json').unlink()
        self.assertEqual(self.build()[1], previews)
        self.assertEqual(self.read, ['01_B'])
        (self.tmp / '_objects' / '01_A.json').write_text('{}', encoding='utf-8')
        self.assertEqual(self.build()[1], previews)
        self.assertEqual(self.read, ['01_A'])

    def test_kept_rows_that_cannot_be_read_are_made_again(self):
        first = self.build()
        packed.real(self.tmp / 'ref_01_A' / gamelib.ROWS).write_bytes(b'{broken')
        self.assertEqual(self.build(), first)
        self.assertEqual(self.read, ['01_A'])

    def test_a_missing_texture_counts_as_a_change(self):
        self.build()
        os.remove(self.tmp / 'ref_01_B' / 'tex' / 'Pkg.Pipe.png')
        self.build()
        self.assertEqual(self.read, ['01_B'])

    def test_other_code_makes_the_rows_again(self):
        self.build()
        with patch.object(gamelib, '_code', lambda: 'another version of the code'):
            self.build()
        self.assertEqual(self.read, ['01_A', '01_B'])


if __name__ == '__main__':
    unittest.main()
