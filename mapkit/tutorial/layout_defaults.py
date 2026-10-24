"""Published tutorial arrangement, independent of disposable recruit edits.

Only our numeric placement recipe and references to installed game objects are distributed.
Extracted game brushes, textures and completed exercise data remain local caches.
"""
import copy
import json
from pathlib import Path
import re
import tempfile


def read_layout(folder):
    path=Path(folder)/'layout_defaults.json'
    if not path.is_file():return {}
    data=json.loads(path.read_text(encoding='utf-8'))
    if data.get('version')!=1 or data.get('map')!='00_DeusEdix_Tutorial':
        raise ValueError('Invalid published tutorial arrangement.')
    return data


def merge_edits(defaults, exercise):
    """Absolute actor poses / source-relative piece poses: later edits win, never add twice."""
    stock=defaults.get('edits',{})
    result=copy.deepcopy(stock)
    exercise=copy.deepcopy(exercise or {})
    for key,value in exercise.items():
        if isinstance(value,dict):
            previous=result.get(key,{})
            result[key]={**previous,**value}
            if key in ('moved','groups','anims'):
                for name,change in value.items():
                    if isinstance(change,dict):result[key][name]={**previous.get(name,{}),**change}
        elif key in ('unnest',):result[key]=list(dict.fromkeys(result.get(key,[])+value))
        elif key in ('added','copies','prefabs','nests'):
            ident={'added':'name','copies':'id','prefabs':'pid','nests':'id'}[key]
            entries={row[ident]:row for row in result.get(key,[])}
            entries.update({row[ident]:row for row in value})
            result[key]=list(entries.values())
        else:result[key]=value
    # The editor's new baseline is the published placement, while the script's
    # safety match still uses the original authoring position.
    for name,change in exercise.get('moved',{}).items():
        original=stock.get('moved',{}).get(name)
        if original and change.get('cls')==original.get('cls'):
            if max(abs(a-b) for a,b in zip(change.get('orig',original['loc']),original['loc']))<=2:
                result['moved'][name]['orig']=copy.deepcopy(original.get('orig'))
    for name,change in exercise.get('deleted',{}).items():
        original=stock.get('moved',{}).get(name)
        if original and change.get('cls')==original.get('cls'):
            if max(abs(a-b) for a,b in zip(change.get('orig',original['loc']),original['loc']))<=2:
                result['deleted'][name]['orig']=copy.deepcopy(original.get('orig'))
    # Published pasted scenery is still editable in subsequent exercises.
    # Its Hierarchy transform is a prefab pose, not a scripted brush-group pose.
    for entry in result.get('prefabs',[]):
        key='paste~'+entry['pid']
        pose=result.get('groups',{}).pop(key,None)
        if pose:
            for field in ('offset','yaw','scale','stretch','deleted'):
                if field in pose:entry[field]=copy.deepcopy(pose[field])
    # Published new decorations are now baseline actors in the editor, not
    # recruit-added objects; moving/deleting them must still work next session.
    remaining=[]
    for entry in result.get('added',[]):
        name=entry['name']
        if name in result.get('deleted',{}):continue
        pose=result.get('moved',{}).get(name)
        if pose and pose.get('cls',entry['cls'])==entry['cls']:
            for field in ('loc','rot','scale'):
                if field in pose:entry[field]=copy.deepcopy(pose[field])
        remaining.append(entry)
    if 'added' in result:result['added']=remaining
    return result


def _original_piece(recipe):
    """Re-extract a chosen scenery brush from the user's own target game, never ship it."""
    import refscan,polys,t3d
    refscan.export(recipe['source'])
    actors=[a for a in t3d.actors(polys.ref_text(recipe['source'])) if a['cls']=='Brush']
    expected=recipe['size']
    import settings
    wanted=set(recipe['textures'])
    if not settings.IS_REVISION and 'h_noise_a00' in wanted:
        wanted.remove('h_noise_a00');wanted.add('whitenoise_b01')
    def suitable(actor):
        lo,hi=t3d.bounds(actor)
        if not lo:return False
        textures=sorted({p['texture'].split('.')[-1].lower() for p in t3d.polys(actor['body']) if p.get('texture')})
        return (max(abs((hi[k]-lo[k])-expected[k]) for k in range(3))<=.25 and
                wanted.issubset(set(textures)|{'marker'}))
    candidates=[a for a in actors if suitable(a)]
    same=next((a for a in candidates if a['name']==recipe['actor']),None)
    if same is None:
        def distance(actor):
            lo,hi=t3d.bounds(actor);p=[(lo[0]+hi[0])/2,(lo[1]+hi[1])/2,lo[2]]
            return sum((a-b)**2 for a,b in zip(p,recipe['pivot']))
        same=min(candidates,key=distance) if candidates else None
    if same is None:
        if recipe['source']=='02_NYC_Bar' and set(recipe['textures'])&{'art_a','western_c'}:
            return _picture_frame(recipe)
        raise ValueError('The installed game has no compatible tutorial scenery: '+recipe['source']+'/'+recipe['actor'])
    import prefabs,geom
    raw=prefabs._clean_block(same['raw'])
    lo,hi=t3d.bounds(same);pivot=[(lo[0]+hi[0])/2,(lo[1]+hi[1])/2,lo[2]]
    offset=[recipe['pivot'][k]-pivot[k] for k in range(3)]
    if any(abs(v)>.001 for v in offset):raw=prefabs.xf_block(raw,geom.XForm(pivot,offset,0))
    return dict(name=recipe['actor'],cls='Brush',brush=True,raw=raw)


def _brush_block(name,shape):
    raw='Begin Actor Class=Brush Name='+name+'\n    CsgOper=CSG_Add\n    PolyFlags=32\n'
    raw+='    '+shape.t3d().strip().replace('\n','\n    ')+'\n    Brush=Model\'MyLevel.'+name+'Model\'\nEnd Actor\n'
    raw=re.sub(r'Begin Brush(?: Name=\w+)?','Begin Brush Name='+name+'Model',raw,count=1)
    return dict(name=name,cls='Brush',brush=True,raw=raw)


def _picture_frame(recipe):
    """Revision-only framed pictures: ordinary authored frame + the base game's Art_A texture.

    Same bounds and placement, no imported Revision geometry or asset dependency in vanilla.
    """
    from geom import box,Mat
    x,y,z=recipe['pivot'];w,d,h=recipe['size'];left,right=x-w/2,x+w/2;back,front=y-d/2,y+d/2
    middle=z+h/2;inner_left,inner_right=x-16,x+16;low,high=middle-16,middle+16
    wood=Mat('un_woodfloor_a')
    picture=next(t for t in recipe['textures'] if t not in ('marker','un_woodfloor_a'))
    parts=[box((left,back,z),(inner_left,front,z+h),wood),
           box((inner_right,back,z),(right,front,z+h),wood),
           box((inner_left,back,z),(inner_right,front,low),wood),
           box((inner_left,back,high),(inner_right,front,z+h),wood),
           box((inner_left,back,low),(inner_right,front,high),{'+y':Mat(picture,(32,32)),'all':wood})]
    return [_brush_block('TutorialPicture'+str(i),shape) for i,shape in enumerate(parts)]


def _own_piece(recipe):
    """Our authored hazard stripe, reconstructed with the same texture alignment as its script."""
    import geom
    from geom import box,Mat
    b=box(recipe['lo'],recipe['hi'],Mat('Heli_LiftMetl_A'))
    width=recipe['width']
    for f in b.faces:
        ext=[max(p[i] for p in f.verts)-min(p[i] for p in f.verts) for i in range(3)]
        rot=(90 if ext[0]>=ext[1] else 0) if abs(f.normal[2])>.7 else (0 if ext[2]>=max(ext[:2]) else 90)
        f.mat=Mat('WarnYeloStrip_A',(width,4*width),rot=rot)
        u=geom.mapping(f,False)[0]
        f.mat=f.mat.with_(align=min(f.verts,key=u.dot))
    return _brush_block('TutorialStripe',b)


def materialize_prefabs(defaults,kit):
    import prefabs
    for key,recipe in defaults.get('prefabSources',{}).items():
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,240}',key):raise ValueError('Invalid tutorial scenery identity.')
        path=Path(kit)/'prefabs'/key/'prefab.json'
        # A recruit's existing local cache is authoritative and never overwritten.
        if path.is_file():continue
        block=_own_piece(recipe) if recipe['kind']=='authored-stripe' else _original_piece(recipe)
        data=dict(id=key,label=recipe['label'],source=recipe['source'],structure=recipe.get('structure','__object__'),
                  pivot=recipe['pivot'],blocks=block if isinstance(block,list) else [block],packages=recipe['packages'],rotatable=True,facing=recipe.get('facing'))
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps(data,indent=1)+'\n',encoding='utf-8')


def build(scene,out_map,edits,folder,base_build,**kwargs):
    defaults=read_layout(folder)
    if not defaults:return base_build(out_map,edits=edits,**kwargs)
    changes=json.loads(Path(edits).read_text(encoding='utf-8')) if edits and Path(edits).is_file() else {}
    # The frozen launcher also has the hub's editor on sys.path. Training must
    # resolve copied scenery in its own worker, not silently skip the hub's missing cache.
    import prefabs
    kit = Path(folder).parent.resolve()
    if prefabs.ROOT.resolve() != kit / 'prefabs':
        raise RuntimeError('Training scenery resolved outside its project folder.')
    materialize_prefabs(defaults,kit)
    merged=merge_edits(defaults,changes)
    output=Path(out_map).parent;output.mkdir(parents=True,exist_ok=True)
    # Never rewrite the recruit's scratch edits, or leave merged defaults there.
    with tempfile.TemporaryDirectory(prefix='tutorial-layout-',dir=output) as temporary:
        path=Path(temporary)/'build.edits.json';path.write_text(json.dumps(merged),encoding='utf-8')
        return base_build(out_map,edits=path,**kwargs)
