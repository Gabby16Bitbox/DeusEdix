"""Conservative selected-BSP prototype for the user's local Deus Ex SDK.

Repartitions existing compiled geometry; it does not apply moved/source brushes.
All writes are confined to private runs and new output copies under ROOT.
"""
from collections import Counter
from pathlib import Path
import argparse
import hashlib
import json
import math
import re
import shutil
import sys
import time
import uuid

ROOT=Path(__file__).resolve().parent
KIT=ROOT.parent
sys.path.insert(0,str(KIT))
import kit
import t3d
sys.path.insert(0,str(KIT.parent))
sys.path.insert(0,str(ROOT))
from lightbits import Model

kit.HOST=ROOT/'bin/UCMapKitHost.exe'
kit.RUNS=ROOT/'runs'
kit.prune=lambda *a,**k:None
kit.os.link=shutil.copy2

class Refused(ValueError): pass

class PrivateSession(kit.Session):
    def close(self):
        try:super().close()
        finally:
            self.proc.wait(timeout=5)
            for stream in (self.proc.stdin,self.proc.stdout):
                if stream:stream.close()
            # Only this experiment's copied runtime is disposable. Retain all
            # inputs, outputs and diagnostic logs; never touch the shared SDK.
            runtime=(self.folder/'System').resolve()
            runs=(ROOT/'runs').resolve()
            if self.proc.poll() is not None and runtime.is_dir():
                if not runtime.is_relative_to(runs) or runtime.name!='System' or runtime.is_symlink():
                    raise RuntimeError('Unexpected private runtime cleanup target')
                if any(p.is_symlink() for p in runtime.rglob('*')):
                    raise RuntimeError('Unexpected link in private runtime')
                shutil.rmtree(runtime)

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def tree(path):
    nodes={}; surfs={}; polys=[]; zones=[]; meta=[]
    for row in path.read_text().splitlines():
        f=row.split()
        if f[0]=='M':meta=list(map(int,f[1:]))
        elif f[0]=='N':
            i=int(f[1]);nodes[i]=dict(children=list(map(int,f[2:5])),surf=int(f[5]),actor=f[6],
                                     vertices=int(f[7]),flags=int(f[8]))
        elif f[0]=='S':surfs[int(f[1])]=f[2:]
        elif f[0]=='P':polys.append(f[1:])
        elif f[0]=='Z':zones.append(f[1:])
    if not nodes or 0 not in nodes:raise Refused('The map has no compiled world BSP.')
    return dict(nodes=nodes,surfs=surfs,polys=polys,zones=zones,meta=meta)

def plan(data,names):
    names=set(names)
    if not names or any(not re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*',n) for n in names):
        raise Refused('Select named static brushes.')
    nodes=data['nodes'];parents={0:None};order=[];stack=[0]
    while stack:
        i=stack.pop();order.append(i)
        for c in nodes[i]['children']:
            if c==-1:continue
            if c not in nodes or c in parents:raise Refused('The BSP has invalid or shared node links.')
            parents[c]=i;stack.append(c)
    present={nodes[i]['actor'] for i in order}
    missing=names-present
    if missing:raise Refused('No compiled geometry for: '+', '.join(sorted(missing)))
    pure={};selected=[]
    for i in reversed(order):
        n=nodes[i];own=n['actor'] in names
        if own:
            selected.append(i)
            if int(data['surfs'][n['surf']][2])&0x04000000:
                raise Refused('Zone portals require a full rebuild in this prototype.')
        pure[i]=own and all(pure[c] for c in n['children'] if c!=-1)
        if own and not pure[i]:
            raise Refused(n['actor']+' shares a BSP branch with unselected geometry. Expand the selection or use Full.')
    if pure[0]:raise Refused('The selection includes the world root. Use Full rebuild.')
    roots=[i for i in order if pure[i] and not pure.get(parents[i],False)]
    if not roots:raise Refused('No isolated branch is available.')
    return dict(actors=sorted(names),roots=roots,selected_nodes=len(selected),total_nodes=len(order))

def snapshots(s,tag):
    s.cmd('UC_SELECTED_DUMP ..\\Output\\'+tag+'.tree')
    s.cmd('MAP EXPORT FILE="..\\Output\\'+tag+'.t3d"')
    return tree(s.folder/'Output'/f'{tag}.tree')

def actor_snapshot(path):
    # Leaf indices are rebuilt derived references, not authored actor edits.
    # Keep Zone and ZoneNumber, including pawn head/foot regions, in the comparison.
    def normalize(raw):
        return re.sub(r'(?m)^(    (?:HeadRegion|FootRegion|Region)=.+?)iLeaf=-?\d+',
                      r'\1iLeaf=DERIVED',raw)
    return {a['name']:normalize(a['raw']) for a in t3d.actors(path.read_text(encoding='latin1'))}

def polygon_key(p):
    # Preserve winding, but ignore the starting vertex and polygon ordering.
    count=int(p[6]);v=[tuple(p[7+3*i:10+3*i]) for i in range(count)]
    if v:v=min(tuple(v[i:]+v[:i]) for i in range(len(v)))
    return tuple(p[:7])+(tuple(v),)

def geometry(data,names=None,exclude=False):
    result=[]
    for p in data['polys']:
        actor=data['surfs'][int(p[0])][0]
        if names is None or ((actor in names)!=exclude):result.append(polygon_key(p))
    return Counter(result)

def signed_area(poly):
    if len(poly)<3:return 0.
    x,y=poly[0]
    return sum((a[0]-x)*(b[1]-y)-(b[0]-x)*(a[1]-y)
               for a,b in zip(poly,poly[1:]+poly[:1]))*.5

def intersection(subject,clip):
    result=subject
    if signed_area(clip)<0:clip=list(reversed(clip))
    for a,b in zip(clip,clip[1:]+clip[:1]):
        def distance(p):return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])
        old=result;result=[]
        if not old:break
        start=old[-1];ds=distance(start)
        for end in old:
            de=distance(end)
            if (ds>=0)!=(de>=0):
                t=ds/(ds-de)
                result.append((start[0]+t*(end[0]-start[0]),start[1]+t*(end[1]-start[1])))
            if de>=0:result.append(end)
            start,ds=end,de
    return result

def coverage(before,after,names):
    """Compare selected surface coverage, allowing different convex BSP splits.

    Each old and new polygon must be covered by its intersections with the other
    tessellation. This detects holes/overlaps even when total surface area matches.
    """
    def project(data):
        out={}
        for p in data['polys']:
            sid=int(p[0])
            if data['surfs'][sid][0] not in names:continue
            axis=max(range(3),key=lambda k:abs(float(p[k+1])))
            keep=[k for k in range(3) if k!=axis]
            poly=[tuple(float(p[7+3*i+k]) for k in keep) for i in range(int(p[6]))]
            if any(not math.isfinite(v) for point in poly for v in point):raise Refused('Non-finite BSP vertices.')
            if len(poly)<3 or abs(signed_area(poly))<1e-8:continue
            if signed_area(poly)<0:poly.reverse()
            # Clipping requires convex input; refuse malformed BSP polygons.
            for a,b,c in zip(poly,poly[1:]+poly[:1],poly[2:]+poly[:2]):
                # Measure deviation in world units, rather than area: a long
                # edge must not magnify sub-millimetric serialized float noise.
                if (b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]) < -1e-3*max(1,math.hypot(b[0]-a[0],b[1]-a[1])):
                    raise Refused('Non-convex BSP polygon; result withheld.')
            out.setdefault((sid,axis),[]).append(poly)
        return out
    a,b=project(before),project(after)
    if a.keys()!=b.keys():raise Refused('Selected surface coverage changed; result withheld.')
    compared=0
    for sid in a:
        aa,bb=a[sid],b[sid]
        overlaps=[[abs(signed_area(intersection(p,q))) for q in bb] for p in aa]
        for polys,sums in ((aa,[sum(r) for r in overlaps]),(bb,[sum(r[j] for r in overlaps) for j in range(len(bb))])):
            for poly,amount in zip(polys,sums):
                area=abs(signed_area(poly))
                if abs(amount-area)>max(.001,area*1e-6):
                    raise Refused('Selected polygon coverage changed; result withheld.')
                compared+=1
    return compared

def rays(data,names):
    groups={None:[]}
    for p in data['polys']:
        actor=data['surfs'][int(p[0])][0]
        pts=[tuple(map(float,p[7+3*i:10+3*i])) for i in range(int(p[6]))]
        groups[None].extend(pts)
        if actor in names:groups.setdefault(actor,[]).extend(pts)
    result=[]
    for name,pts in groups.items():
        if not pts:continue
        low=[min(p[k] for p in pts)-48 for k in range(3)]
        high=[max(p[k] for p in pts)+48 for k in range(3)]
        for axis in range(3):
            others=[k for k in range(3) if k!=axis]
            for u in (.1,.3,.5,.7,.9):
                for v in (.1,.3,.5,.7,.9):
                    start=list(low);end=list(low)
                    for k,t in zip(others,(u,v)):start[k]=end[k]=low[k]+(high[k]-low[k])*t
                    end[axis]=high[axis]
                    for extent in ((0,0,0),(16,16,39)):
                        result.append(tuple(start+end+list(extent)))
                        result.append(tuple(end+start+list(extent)))
    return list(dict.fromkeys(result))

def trace(s,probes):
    out=s.batch(['UC_SELECTED_TRACE '+' '.join(format(x,'.9g') for x in ray) for ray in probes])
    rows=re.findall(r'^UCMapKit\|selected trace\|(.*)$',out,re.M)
    if len(rows)!=len(probes):raise Refused('Collision probe did not finish.')
    return rows

def traces_equal(a,b):
    if len(a)!=len(b):return False
    for x,y in zip(a,b):
        if x=='clear' or y=='clear':
            if x!=y:return False
        elif len(x.split())!=len(y.split()) or any(not math.isfinite(float(i)) or not math.isfinite(float(j)) or abs(float(i)-float(j))>.002 for i,j in zip(x.split(),y.split())):return False
    return True

def baked(path):
    try:m=Model(str(path))
    except SystemExit as e:raise Refused('Cannot verify this map format: '+str(e)) from e
    return dict(lightmaps=m.lightmaps,bits=hashlib.sha256(m.p.d[m.bits_at:m.bits_at+m.bits_len]).hexdigest(),
                sources=[m.surf_lights(lm) for lm in m.lightmaps],
                bindings=[s['iLightMap'] for s in m.surfs],lights_count=len(m.lights))

def open_map(path,label):
    path=Path(path).absolute()
    if not path.is_file():raise Refused('Map file does not exist.')
    if path.suffix.lower()!='.dx':raise Refused('Choose a .dx map.')
    source_hash=sha(path)
    s=PrivateSession([],label)
    try:
        shutil.copy2(path,s.folder/'Input/source.dx')
        if sha(s.folder/'Input/source.dx')!=source_hash:raise Refused('Map changed while copying; try again.')
        s.cmd(r'MAP LOAD FILE="..\Input\source.dx"')
        return s,path,source_hash
    except BaseException:s.close();raise

def inspect(path):
    s,source,hash_before=open_map(path,'selected-audit')
    try:
        data=snapshots(s,'before');rows=[]
        for name,count in sorted(Counter(n['actor'] for n in data['nodes'].values()).items()):
            try:p=plan(data,[name]);ok=True;reason='Isolated branch';roots=p['roots']
            except Refused as e:ok=False;reason=str(e);roots=[]
            rows.append(dict(name=name,nodes=count,eligible=ok,reason=reason,roots=roots))
        points={}
        for p in data['polys']:
            name=data['surfs'][int(p[0])][0]
            points.setdefault(name,[]).extend(tuple(map(float,p[7+i*3:10+i*3])) for i in range(int(p[6])))
        for row in rows:
            pts=points.get(row['name'],[])
            row['bounds']=([min(p[k] for p in pts) for k in range(3)],
                           [max(p[k] for p in pts) for k in range(3)]) if pts else None
        result=dict(source=str(source),sha256=hash_before,nodes=data['meta'][0],brushes=rows,run=str(s.folder))
        (s.folder/'audit.json').write_text(json.dumps(result,indent=2))
        return result
    finally:s.close()

def rebuild(path,names,expected_sha=None,progress=print):
    names=sorted(set(names));started=time.monotonic()
    s,source,source_hash=open_map(path,'selected-rebuild')
    report=dict(source=str(source),source_sha256=source_hash,selected=names,run=str(s.folder),success=False)
    output=None
    try:
        if expected_sha and expected_sha!=source_hash:raise Refused('Map changed since inspection; inspect it again.')
        before=snapshots(s,'before');planned=plan(before,names);report['plan']=planned
        progress(f"Rebuilding {planned['selected_nodes']} of {planned['total_nodes']} BSP nodes.")
        probes=rays(before,names);traces_before=trace(s,probes)
        # Source-file lighting is checked, not just a freshly saved round trip.
        old_baked=baked(s.folder/'Input/source.dx')
        result=s.cmd('UC_SELECTED_REPART '+' '.join(names));report['native']=result
        after=snapshots(s,'after')
        if before['surfs']!=after['surfs']:raise Refused('Surface, UV or lighting bindings changed; result withheld.')
        if geometry(before,names,True)!=geometry(after,names,True):raise Refused('Unselected polygons changed; result withheld.')
        coverage_checks=coverage(before,after,names)
        if before['zones']!=after['zones']:raise Refused('Zone connectivity or visibility changed; result withheld.')
        if actor_snapshot(s.folder/'Output/before.t3d')!=actor_snapshot(s.folder/'Output/after.t3d'):
            raise Refused('Actor or source-brush properties changed; result withheld.')
        s.cmd(r'MAP SAVE FILE="..\Output\candidate.dx"')
        s.cmd(r'MAP LOAD FILE="..\Output\candidate.dx"')
        reloaded=snapshots(s,'reloaded');traces_after=trace(s,probes)
        if geometry(after)!=geometry(reloaded) or after['surfs']!=reloaded['surfs'] or after['zones']!=reloaded['zones']:
            raise Refused('Reload changed the rebuilt geometry or surface data; result withheld.')
        if actor_snapshot(s.folder/'Output/before.t3d')!=actor_snapshot(s.folder/'Output/reloaded.t3d'):
            raise Refused('Reload changed actor or source-brush properties; result withheld.')
        if not traces_equal(traces_before,traces_after):raise Refused('Collision probes changed; result withheld.')
        new_baked=baked(s.folder/'Output/candidate.dx')
        if any(old_baked[k]!=new_baked[k] for k in ('lightmaps','bits','sources','bindings')):
            raise Refused('Baked lighting changed; result withheld.')
        if sha(source)!=source_hash:raise Refused('Source changed during rebuilding; result withheld.')
        dest=ROOT/'results'
        dest.mkdir(exist_ok=True)
        output=dest/(source.stem+'-selected-'+uuid.uuid4().hex[:8]+'.dx')
        # Exclusive creation: no existing map can be overwritten.
        with output.open('xb') as stream:stream.write((s.folder/'Output/candidate.dx').read_bytes())
        report.update(success=True,output=str(output),output_sha256=sha(output),seconds=round(time.monotonic()-started,3),
            checks=dict(unselected_polygons=True,all_surface_uv_flags=True,baked_lightmaps=True,actor_properties=True,
                        source_brushes=True,zones=True,reload=True,source_unchanged=True,collision_rays=len(probes),
                        selected_polygon_coverage=coverage_checks),
            nodes_after=reloaded['meta'][0],lights_count_before=old_baked['lights_count'],lights_count_after=new_baked['lights_count'])
        progress('Verified copy: '+str(output))
        return report
    except Exception as e:
        report['error']=str(e);raise
    finally:
        s.close()
        (s.folder/'report.json').write_text(json.dumps(report,indent=2))
        if output and report['success']:output.with_suffix('.json').write_text(json.dumps(report,indent=2))

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('map',type=Path);p.add_argument('--select',nargs='+');p.add_argument('--expected-sha')
    a=p.parse_args()
    try:result=rebuild(a.map,a.select,a.expected_sha) if a.select else inspect(a.map)
    except (Refused,RuntimeError,OSError) as e:print('REFUSED:',e,file=sys.stderr);return 2
    print(json.dumps(result,indent=2));return 0

if __name__=='__main__':raise SystemExit(main())
