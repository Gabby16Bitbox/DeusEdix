"""Validate the built training course with the SDK's actual BSP collision traces."""
import copy
import importlib.util
import json
import math
import sys
from pathlib import Path

KIT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(KIT),str(KIT/'tutorial')]
import kit
import t3d
spec=importlib.util.spec_from_file_location('training_map',KIT/'tutorial'/'tutorial_map.py')
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
actors={a['name']:a for a in t3d.actors('\n'.join(m.s.actors))}
# Every leaf uses the original 8x64x128 size and the floor at 0, on both corridor axes.
for name,a in actors.items():
    if a['cls']!='DeusExMover': continue
    lo,hi=t3d.bounds(a)
    assert abs(lo[2])<.01 and abs(hi[2]-128)<.01,(name,lo,hi)
    assert sorted(round(hi[k]-lo[k]) for k in (0,1))==[8,64]
    # a lesson's doors (room 2's button, the advanced wing's vault) open only by a rule
    assert a['props']['InitialState']==('TriggerOpenTimed' if a['props']['Tag'] in m.LESSON_DOORS.values() else 'TriggerToggle'),name
# A recruit's single rule opens both original leaves without modifying the saved exercise.
assert not any(a['cls']=='UCLink' for a in actors.values())
for target in ('TutorialDoor','TutorialDoorRight'):
    scene=copy.deepcopy(m.s)
    edits={'links':[{'id':'test','src':'TutorialButton','when':'used','do':[{'verb':'open','target':target}]}]}
    before=copy.deepcopy(edits)
    scene._apply_actor_edits(edits)
    links=[a for a in t3d.actors('\n'.join(scene.actors)) if a['cls'].endswith('UCLink')]
    assert len(links)==1,links
    actions=[v for k,v in links[0]['props'].items() if k.startswith('Act(')]
    assert len(actions)==2 and all(any('|open|'+n+'|' in v for v in actions) for n in ('TutorialDoor','TutorialDoorRight'))
    assert edits==before
print('PASS %d original-size leaves, both axes, paired interaction, clean lesson' % sum(a['cls']=='DeusExMover' for a in actors.values()),flush=True)
route=[(-120,-170),(0,-64),(324,-64),(528,-64),(528,-256),(800,-256),(800,-448),(800,-704),
       (800,-752),(536,-752),(352,-752),(352,-1184),(144,-1184),(-64,-1184),(-64,-752),
       (-240,-752),(-496,-752),(-752,-752),(-1104,-752),(-1104,-496),
       (-1104,-208),(-768,-208),(-496,-208)]
mapfile=KIT/'out'/'00_DeusEdix_Tutorial.dx'
session=kit.Session([mapfile],'tutorial-layout-check')
try:
    session.cmd('MAP LOAD FILE="..\\Input\\'+mapfile.name+'"')
    traces=0
    for a,b in zip(route,route[1:]):
        dx,dy=b[0]-a[0],b[1]-a[1]
        dist=math.hypot(dx,dy)
        for side in (-20,0,20):
            off=(-dy/dist*side,dx/dist*side)
            for z in (24,84):
                start=(a[0]+off[0],a[1]+off[1],z)
                end=(b[0]+off[0],b[1]+off[1],z)
                hit=session.trace(start,end)
                assert hit is None,('blocked route',a,b,side,z,hit)
                traces+=1
        for step in range(int(dist/32)+1):
            t=step/max(1,int(dist/32))
            x,y=a[0]+dx*t,a[1]+dy*t
            hit=session.trace((x,y,90),(x,y,-16))
            assert hit and -.6<=hit[0][2]<=8.6,('missing/raised floor',x,y,hit)
            traces+=1
    for name in ('TutorialGuide','TutorialObserver0','TutorialObserver1','TutorialObserver2','TutorialTrooper','TutorialScientist','TutorialCoffeeGuard0','TutorialCoffeeGuard1','TutorialCoffee'):
        a=actors[name]
        x,y,z=t3d.vec(a['props']['Location'])
        h=float(a['props'].get('CollisionHeight',m.HALF.get(a['cls'],45.13)))
        floor=session.trace((x,y,z),(x,y,z-h-8))
        assert floor and abs((z-h)-floor[0][2])<=.6,(name,z-h,floor)
    # The L's missing quadrant and the horseshoe core stay solid; no accidental shortcut.
    assert session.trace((528,80,84),(848,80,84))
    assert session.trace((352,-752,84),(-64,-752,84))
    print('PASS %d route/ground traces, eight NPC feet and the coffee mug, L and U cores, no straight shortcut' % traces,flush=True)
finally:
    session.close()
