"""Full native reference with the repaired optimizer; never an oracle-free proof.

The caller has just reloaded the ORIGINAL map to sample its collision. Take
its UV snapshot before replaying the exact edit commands. Run the complete
stock MAP and BSP commands, changing only the in-process OptGeom callback.
No Full output is saved over the local candidate. Version-specific laboratory
instrumentation, not an engine patch installed into the game.
"""
import math
from pathlib import Path
import selected_rebuild as base


def recipe(data,root_outside):
    if root_outside not in (0,1):raise base.Refused('Invalid Full root classification')
    if not data.get('nodes') or len(data['nodes'])!=len(data.get('polys',[])):
        raise base.Refused('Incomplete Full source replay')
    rows=[]
    for index,p in enumerate(data['polys']):
        if index not in data['nodes']:raise base.Refused('Incomplete Full node identity')
        count=int(p[6])
        if count==0:continue
        if not 3<=count<=16 or len(p)!=7+3*count:
            raise base.Refused('Full reference polygon exceeds supported input; no truncation')
        values=list(map(float,p[7:]))
        if any(not math.isfinite(x) for x in values):raise base.Refused('Non-finite Full reference vertex')
        rows.append((index,count,values))
    if not rows:raise base.Refused('Empty Full reference')
    lines=[f'{root_outside} {len(rows)}']
    for index,count,values in rows:
        lines.append(f'{index} {count}')
        lines.extend(' '.join(format(x,'.9g') for x in values[i:i+3]) for i in range(0,len(values),3))
    return '\n'.join(lines)+'\n'


def rebuild(s,commands,root_outside):
    editor_sha=base.sha(s.folder/'System/Editor.dll')
    if editor_sha!='93e31b3e401880ab17ab4561c3fd4d2baa530fbe25ccb5154911ebad60fff035':
        raise base.Refused('Unsupported SDK Editor.dll for diagnostic precise Full hook')
    snapshot=s.cmd('UC_REGION_UV_SNAPSHOT')
    if 'UCMapKit|region UV snapshot|' not in snapshot:raise base.Refused('Missing Original UV snapshot')
    for command in commands:s.cmd(command)
    build=s.cmd('UC_REGION_DIAG_MAP_PRECISE')
    if 'UCMapKit|stock MAP hook|1 precise|1 calls|0 failed|restored' not in build:
        raise base.Refused('Incomplete precise Full stock MAP interception')
    compiled=s.batch(['BSP REBUILD OPTIMAL BALANCE=15','UC_WORLD finish','UC_REGION_DIAG_UV_RESTORE'])
    return dict(mode='mandatory Full: stock MAP REBUILD with only OptGeom intercepted, unchanged BSP command, Original UV provenance',
                editor_sha256=editor_sha,
                source_replay=build,compile=compiled,uv_snapshot=snapshot,
                spatially_clipped=False,oracle_free=False)
