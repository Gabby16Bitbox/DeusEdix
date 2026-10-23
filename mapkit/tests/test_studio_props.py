import copy, json, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
HERE = Path(__file__).resolve().parent
KIT = HERE.parent
sys.path[:0] = [str(HERE / 'staged'), str(KIT / 'editor'), str(KIT)]
import anim_props as props
import anims

def attachment():
    return dict(id='prop_bottle', cls='Liquor40oz', bone='r_hand', position=[0,0,0], rotation=[0,0,0], scale=1, enabled=True)

def animation():
    return dict(name='Drink', frames=130, fps=15, keys=[dict(f=0,rot={},root=[0,0,0])], props=[attachment()])

def track():
    p = attachment()
    return dict(id=p['id'], cls=p['cls'], scale=1, samples=[dict(position=[f,2,3],rotation=[0,123,0]) for f in range(130)])

INFO = {'Liquor40oz': dict(mesh='DeusExItems.Liquor40oz', pkg='DeusEx', parents=['Pickup','Inventory'])}

class TestProps(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='prop-unit-', dir=HERE); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for target, value in [('STUDIO',self.root), ('load',lambda mesh: {'counts':{'frameVerts':2}}), ('class_info',lambda: INFO)]:
            p = patch.object(anims,target,value);p.start();self.addCleanup(p.stop)

    def save_bake(self):
        anims.studio_save(animation())
        anims.bake_save('DeusExCharacters.GM_Suit','Drink',130,15,b'\0'*1560,props=[track()])

    def test_roundtrip_bake_chunk_and_variant(self):
        self.save_bake()
        self.assertEqual(anims.studio_get('Drink'),animation())
        result = anims.blocks({'anims': {'Bob':dict(idle='Drink',own=True)}})
        tracks = [a for a in result if a['cls']=='UCAnimPropTrack']
        self.assertEqual(len(tracks),3)
        self.assertEqual(tracks[0]['props']['NextName'],tracks[1]['name'])
        self.assertEqual(tracks[-1]['props']['SampleCount'],'2')
        self.assertNotIn('NextName',tracks[-1]['props'])
        self.assertEqual(tracks[0]['props']['PropClass'],'"DeusEx.Liquor40oz"')
        self.assertEqual(tracks[0]['props']['ModelPackage'],anims.settings.ANIMS_PACKAGE)
        self.assertEqual(len(anims.baked_for('DeusExCharacters.GM_Suit')),1)
        self.assertNotIn('props',anims.baked_for('DeusExCharacters.GM_Suit')[0])

    def test_unrelated_map_no_controllers(self):
        self.save_bake(); self.assertEqual(props.blocks(self.root,{'anims':{'Bob':{'idle':'Other'}}},lambda:INFO,'UCAnims'),[])

    def test_invalid_schema_without_partial_save(self):
        for key,value in [('bone','missing'),('scale',float('nan')),('scale',-1),('position',[1,2]),('rotation',[0,float('inf'),0]),('cls',"Bottle'Injected"),('enabled','yes')]:
            with self.subTest(key=key,value=value):
                a=animation();a['props'][0][key]=value
                with self.assertRaises(ValueError): anims.studio_save(a)
                self.assertFalse((self.root/'Drink.json').exists())

    def test_duplicate_ids_and_capacity(self):
        a=animation();a['props']*=2
        with self.assertRaisesRegex(ValueError,'Duplicate'):anims.studio_save(a)
        with self.assertRaisesRegex(ValueError,'eight'):props.validate([attachment()]*9,130)

    def test_malformed_sample_rejected_before_write(self):
        anims.studio_save(animation());t=track();t['samples'].pop()
        with self.assertRaisesRegex(ValueError,'sample count'):anims.bake_save('DeusExCharacters.GM_Suit','Drink',130,15,b'\0'*1560,props=[t])
        self.assertFalse((self.root/'baked').exists())

    def test_no_ai_or_missing_class(self):
        with self.assertRaises(ValueError):props.class_paths([track()],{})
        with self.assertRaises(ValueError):props.class_paths([track()],{'Liquor40oz':dict(mesh='Foo',pkg='DeusEx',parents=['Pawn'])})

    def test_stale_props_require_save(self):
        self.save_bake();a=animation();a['props'][0]['position'][0]=10;anims.studio_save(a)
        with self.assertRaisesRegex(ValueError,'Save Drink'):props.blocks(self.root,{'anim':'Drink'},lambda:INFO,'UCAnims')

    def test_disable_then_remove_clears_tracks(self):
        self.save_bake();a=animation();a['props'][0]['enabled']=False;anims.studio_save(a)
        anims.bake_save('DeusExCharacters.GM_Suit','Drink',130,15,b'\0'*1560,props=[])
        self.assertEqual(props.blocks(self.root,{'anim':'Drink'},lambda:INFO,'UCAnims'),[])
        anims.studio_delete('Drink');self.assertFalse(list((self.root/'baked').rglob('Drink*')))

    def test_old_animations_need_no_new_fields(self):
        a=animation();del a['props'];anims.studio_save(a)
        anims.bake_save('DeusExCharacters.GM_Suit','Drink',130,15,b'\0'*1560)
        self.assertEqual(anims.studio_get('Drink'),a)

if __name__ == '__main__': unittest.main(verbosity=2)
