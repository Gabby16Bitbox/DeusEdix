import sys, importlib.util, unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
LIVE=ROOT
sys.path[:0]=[str(LIVE),str(LIVE/'editor')]
spec=importlib.util.spec_from_file_location('preview_scene',ROOT/'scene.py')
scene=importlib.util.module_from_spec(spec);spec.loader.exec_module(scene)

class Ownership(unittest.TestCase):
    def test_rotated_hollow_and_deleted_group_keep_exact_brush_ownership(self):
        with patch('texcat.ensure_index',return_value=False): s=scene.Scene('PreviewTest')
        s.auto_groups=False
        boxes=[dict(name='Cube',lo=[0,0,0],hi=[128,64,96],tex='X',rot=[8192,16384,4096]),
               dict(name='Hollow',lo=[300,0,0],hi=[428,128,128],tex='X',shape='cylinder',hollow=8,sides=8)]
        s._apply_box_edits({'boxes':boxes});s._apply_groups({})
        groups=s.structures()
        self.assertEqual(groups['block~Cube']['brushes'],[0])
        self.assertGreater(len(groups['block~Hollow']['brushes']),1)
        self.assertEqual(groups['block~Cube']['previewBox'],boxes[0])
        boxes[0]['lo'][0]=999
        self.assertEqual(groups['block~Cube']['previewBox']['lo'][0],0)
        self.assertEqual(sorted(i for x in groups.values() for i in x['brushes']),list(range(len(s.ops))))
    def test_holes_and_movers_are_not_solid_live_surfaces(self):
        with patch('texcat.ensure_index',return_value=False): s=scene.Scene('PreviewTest')
        s.auto_groups=False
        s._apply_box_edits({'boxes':[dict(name='Hole',lo=[0,0,0],hi=[128,64,96],tex='X',hole=True)]})
        s._apply_groups({});self.assertEqual(s.structures(),{})
    def test_drawn_wall_has_its_own_surface_owner(self):
        with patch('texcat.ensure_index',return_value=False): s=scene.Scene('PreviewTest')
        s.auto_groups=False
        wall=dict(name='Wall',kind='wall',pts=[[0,0],[256,0]],z=0,height=128,thick=16,tex='X')
        s._apply_box_edits({'drawn':[wall]});s._apply_groups({})
        group=s.structures()['drawn~Wall']
        self.assertEqual(group['previewDrawn'],wall)
        self.assertEqual(len(group['brushes']),len(s.ops))
if __name__=='__main__': unittest.main()
