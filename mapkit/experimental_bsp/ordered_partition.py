"""Optional native splitter ordering, with a mandatory command acknowledgement."""
import re
from selected_rebuild import Refused


def prioritize(polys,scratch,before,planned):
    priority={}
    for node in sorted(planned['old_nodes']):
        surf=before['surfs'][before['nodes'][node]['surf']]
        priority.setdefault((surf[0],surf[3]),node)
    def key(item):
        surf=scratch['surfs'][int(scratch['polys'][item[0]][0])]
        return priority.get((surf[0],surf[3]),float('inf'))
    return sorted(polys,key=key)


def compile_ordered(session,root,count):
    if type(root) is not int or root<=0 or type(count) is not int or not 1<=count<=65536:
        raise Refused('Invalid original-partition compiler request.')
    response=session.cmd('UC_REGION_CLIP_ORDERED '+str(root)+r' ..\Output\clipped.txt')
    built=re.findall(r'UCMapKit\|ordered builder\|root (\d+)\|(\d+) input\|(\d+) nodes',response)
    clipped=re.findall(r'UCMapKit\|region clipped\|(\d+) polys\|(\d+) nodes',response)
    if len(built)!=1 or len(clipped)!=1 or tuple(map(int,built[0][:2]))!=(root,count) or int(built[0][2])<1 or tuple(map(int,clipped[0]))!=(count,int(built[0][2])):
        raise Refused('Original-partition native compiler refused; no previous scratch model can be used.')
    return response
