import ast
import copy
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
sys.path[:0] = [str(KIT/'editor'), str(KIT)]
import data, prefabs, texture_mapping, geom, t3d


class TextureScaleTests(unittest.TestCase):
    def test_frame_keeps_pan_and_per_axis_mapping(self):
        nums = [2, 3, 4, 2, 0, 0, 0, 0, -4, 16, -32, 128, 256]
        self.assertEqual(texture_mapping.frame(nums), [2, 3, 4, 2/128, 0, 0, 0, 0, -4/256, .125, -.125])

    def test_build_stretch_changes_texture_axes_not_geometry(self):
        raw = '''Begin Actor Class=Brush Name=Sign
    Location=(X=10,Y=20,Z=30)
    Begin Brush Name=Sign
        Begin PolyList
            Begin Polygon Texture=Metal
                Origin +0,+0,+0
                Normal +0,+1,+0
                TextureU +1,+0,+0
                TextureV +0,+0,+1
                Vertex +0,+0,+0
                Vertex +128,+0,+0
                Vertex +128,+0,+128
            End Polygon
        End PolyList
    End Brush
End Actor
'''
        import re
        plain = prefabs.xf_block(raw, geom.XForm((10, 20, 30), scale=[1.5, 2, 3], stretch=False))
        stretched = prefabs.xf_block(raw, geom.XForm((10, 20, 30), scale=[1.5, 2, 3], stretch=True))
        self.assertEqual(re.findall(r'Vertex[^\n]+', plain), re.findall(r'Vertex[^\n]+', stretched))
        def axis(text, name):
            return tuple(float(n) for n in re.search(name+r'\s+([^\n]+)', text).group(1).split(','))
        self.assertEqual(axis(plain, 'TextureU'), (1, 0, 0))
        self.assertAlmostEqual(axis(stretched, 'TextureU')[0], 1/1.5, places=5)
        self.assertAlmostEqual(axis(stretched, 'TextureV')[2], 1/3, places=5)

    def test_assembly_upgrade_uses_only_cached_polygons(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            nums = [0, 0, 0, 1, 0, 0, 0, 1, 0, 12, 24, 128, 128]
            values = {'polys': [['Pkg.Sign', 0, nums, [0,0,0, 128,0,0, 128,128,0], 0]],
                      'textures': {'Pkg.Sign': {}}, 'brushes': [{'name':'Brush0','ord':0}], 'pface':[0]}
            for name, value in values.items(): (folder/(name+'.json')).write_text(json.dumps(value))
            with patch.object(data, 'structures', return_value={'piece':{'brushes':[0]}}), patch.object(data.kit, 'Session', side_effect=AssertionError('No engine pass')):
                data._assemble('Fixture', folder)
            group = json.loads((folder/'geometry.json').read_text())['groups'][0]
            self.assertEqual(group['uvFrames'], [texture_mapping.frame(nums)])
            self.assertEqual(group['uv'][:2], [round(12/128, 4), round(24/128, 4)])

    def test_real_saved_signs_upgrade_without_changing_files(self):
        import os
        if os.environ.get('DEUSEDIX_REAL_SIGN_CHECKS') != '1':
            self.skipTest('Optional local integration fixture; run with DEUSEDIX_REAL_SIGN_CHECKS=1')
        entries = json.loads((KIT/'maps/hk_rooftop.edits.json').read_text())['prefabs']
        output = []
        for pid in ['p9', 'p8']:
            entry = next(e for e in entries if e['pid'] == pid)
            original = (KIT/'prefabs'/entry['prefab']/'display.json').read_bytes()
            before = time.perf_counter()
            with patch.object(prefabs, 'ROOT', KIT/'prefabs'):
                display = prefabs.display(entry['prefab'])
            frames = [f for g in display['groups'] for f in g['uvFrames']]
            self.assertTrue(frames)
            self.assertTrue(all(frames), (pid, len(frames), sum(f is None for f in frames)))
            self.assertEqual(original, (KIT/'prefabs'/entry['prefab']/'display.json').read_bytes())
            output.append(dict(entry=entry, display=display, seconds=time.perf_counter()-before))
        (HERE/'real-signs.json').write_text(json.dumps(output))

    def test_match_rejects_same_texture_wrong_plane_and_pan(self):
        group = dict(tex='T', pos=[0,0,0, 1,0,0, 0,1,0], uv=[0,0, 1,0, 0,1])
        nums = [0,0,0, 1,0,0, 0,1,0, 0,0,1,1]
        wrong = copy.deepcopy(nums); wrong[9] = 10
        texture_mapping.enrich([group], [['T',0,wrong,group['pos'],0]])
        self.assertEqual(group['uvFrames'], [None])
        texture_mapping.enrich([group], [['T',0,nums,group['pos'],0]])
        self.assertEqual(group['uvFrames'], [texture_mapping.frame(nums)])


if __name__ == '__main__':
    unittest.main(verbosity=2)
