"""Build the two new exercises on a private copy and inspect the serialized runtime actors."""
import base64
import copy
import importlib.util
import io
import json
import sys
import tempfile
from pathlib import Path
from PIL import Image
KIT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(KIT),str(KIT/'editor'),str(KIT/'tutorial')]
import kit,t3d,textures
spec=importlib.util.spec_from_file_location('training',KIT/'tutorial'/'tutorial_map.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory(prefix='tutorial-lessons-',dir=Path(__file__).parent) as tmp:
    root=Path(tmp)
    # Confine generated paint files and map outputs to the fixture.
    textures.ROOT=root
    im=Image.new('RGB',(64,64),'#265b79'); buf=io.BytesIO();im.save(buf,format='PNG')
    tex=textures.import_png('fixture','data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode(),'Crate')
    scene=copy.deepcopy(m.s)
    edits={'textures':{tex['name']:tex},'retexture':[dict(kind='actor',name='TutorialTextureCrate',slot=0,tex=tex['name'])],
       'added':[dict(cls='UCCutscene',name='TutorialTestCamera',loc=[-1104,-300,80],rot=[0,0,0],props={})],
       'cutscenes':{'TutorialTestCamera':dict(title='The Last Cup',keys=[
           dict(t=0,p=[-1216,-344,80],r=[0,13000,0],fov=75,s=0),
           dict(t=4,p=[-1140,-176,64],r=[0,14000,0],fov=55,s=0)])},
       'links':[dict(id='screen',src='TutorialFilmButton',when='used',do=[dict(verb='cutplay',target='TutorialTestCamera')])]}
    file=root/'exercise.edits.json';file.write_text(json.dumps(edits))
    _,built=scene.build(root/'exercise.dx',edits=file,paths=False)
    run=kit.new_run([built],'tutorial-lessons-read')
    kit.execute(run,['MAP LOAD FILE="..\\Input\\'+built.name+'"','MAP EXPORT FILE="..\\Output\\exercise.t3d"'])
    actors={a['name']:a for a in t3d.actors((run/'Output'/'exercise.t3d').read_text(encoding='latin1'))}
    painted=actors['TutorialTextureCrate']['props']
    assert tex['name'] in painted['MultiSkins(0)'],painted
    assert 'HaleMoraleCrate' in actors['TutorialHaleCrate']['props']['MultiSkins(0)']
    camera=actors['TutorialTestCamera']['props']
    assert camera['NumKeys']=='2' and float(camera['KeyT(1)'])==4 and float(camera['KeyF(1)'])==55,camera
    rule=actors['UCLink_screen']['props']
    assert '|cutplay|TutorialTestCamera|' in rule['Act(0)'],rule
    assert len([a for a in actors.values() if a['name'].startswith('TutorialBook')])==6
    print('PASS real SDK build: only recruit crate repainted; Hale skin retained; two camera keys/FOV and screening rule survive export; six books retained')
