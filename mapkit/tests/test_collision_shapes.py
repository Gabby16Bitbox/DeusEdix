import json, math, sys, unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
sys.path[:0] = [str(HERE/'staged'), str(KIT/'editor'), str(KIT)]
import props, motions

LEGACY = {'classes': {'UCTriggerBox': {'parents':['Trigger','Actor'], 'props':{
    'Tag':['UCTriggerBox'], 'Event':['None'], 'BoxX':['64.000000'], 'BoxY':['64.000000'], 'BoxZ':['64.000000'],
    'bSolidBox':['False'], 'bAnyPawn':['False'], 'CollisionRadius':['40'], 'CollisionHeight':['40']}, 'types':{}}}, 'enums':{}}

def edits(cylinder=None, solid='True', scale=1):
    p = dict(BoxX='80', BoxY='50', BoxZ='40', bSolidBox=solid)
    if cylinder is not None: p.update(bCylinder=cylinder, CylinderRadius='36', CylinderHeight='50')
    return {'added':[dict(name='Volume0', cls='UCTriggerBox', loc=[100,200,300], scale=scale, props=p)]}

def bounds(brush):
    vertices = [v for f in brush.faces for v in f.verts]
    return tuple(tuple(fn(v[k] for v in vertices) for k in range(3)) for fn in (min,max))

class CollisionTests(unittest.TestCase):
    def test_old_map_stays_box(self):
        op, brush, flags = motions.wall_ops(edits())[0]
        self.assertEqual(op,'add'); self.assertEqual(flags,33)
        self.assertEqual(len(brush.faces),6)
        self.assertEqual(bounds(brush),((20,150,260),(180,250,340)))

    def test_solid_cylinder_geometry(self):
        _, brush, _ = motions.wall_ops(edits('True'))[0]
        self.assertEqual(len(brush.faces),34)
        self.assertEqual(bounds(brush),((64,164,250),(136,236,350)))
        for face in brush.faces:
            self.assertEqual(face.mat.flags,1)
            for x,y,z in face.verts:
                self.assertAlmostEqual(math.hypot(x-100,y-200),36)
        self.assertIn('UCWall_Volume0',brush.t3d())

    def test_properties_override_added_shape(self):
        e=edits();e['props']={'Volume0':{'bCylinder':'True','CylinderRadius':'24','CylinderHeight':'12'}}
        self.assertEqual(bounds(motions.wall_ops(e)[0][1]),((76,176,288),(124,224,312)))
        e['props']['Volume0']['bCylinder']='False'
        self.assertEqual(len(motions.wall_ops(e)[0][1].faces),6)

    def test_dimensions_scale_both_shapes(self):
        self.assertEqual(bounds(motions.wall_ops(edits('True',scale=2))[0][1]),((28,128,200),(172,272,400)))
        self.assertEqual(bounds(motions.wall_ops(edits(scale=2))[0][1]),((-60,100,220),(260,300,380)))

    def test_sensor_has_no_solid_brush(self):
        for cylinder in (None,'False','True'):
            self.assertEqual(motions.wall_ops(edits(cylinder,solid='False')),[])

    def test_old_cached_schema_gets_shape_without_sdk(self):
        with patch.object(props,'defaults',return_value=LEGACY):
            fields={f['prop']:f for f in props.fields_for('UCTriggerBox')}
        self.assertEqual(fields['bCylinder']['kind'],'collision_shape')
        self.assertEqual(fields['bCylinder']['default'],['False'])
        self.assertEqual(fields['CylinderRadius']['default'],['64.000000'])
        self.assertEqual(fields['CylinderHeight']['kind'],'half')
        self.assertNotIn('CollisionRadius',fields)
        self.assertNotIn('CollisionHeight',fields)

    def test_shape_commands_and_import_roundtrip(self):
        p={'bCylinder':'True','CylinderRadius':'36.000000','CylinderHeight':'50.000000','Tag':'RoomA','Event':'DoorA'}
        self.assertEqual(props.t3d_props(p),p)
        commands=props.commands({'props':{'Volume0':p}})
        for key,value in p.items():self.assertIn('UC_PROP Volume0 '+key+' '+value,commands)

    def test_legacy_trigger_does_not_get_custom_shape(self):
        d={'classes':{'Trigger':{'parents':['Actor'],'props':{'CollisionRadius':['40'],'CollisionHeight':['40']},'types':{}}},'enums':{}}
        with patch.object(props,'defaults',return_value=d):
            names={f['prop'] for f in props.fields_for('Trigger')}
        self.assertEqual(names,{'CollisionRadius','CollisionHeight'})

    def test_compiled_defaults_take_precedence(self):
        d=json.loads(json.dumps(LEGACY));d['classes']['UCTriggerBox']['props']['CylinderRadius']=['80.000000']
        with patch.object(props,'defaults',return_value=d):
            f=next(f for f in props.fields_for('UCTriggerBox') if f['prop']=='CylinderRadius')
        self.assertEqual(f['default'],['80.000000'])

if __name__=='__main__':
    if (HERE/'staged').exists():
        with patch.object(props,'defaults',return_value=LEGACY):
            (HERE/'schema.json').write_text(json.dumps(props.fields_for('UCTriggerBox')),encoding='utf-8')
    unittest.main()
