"""Private experimental API: certify and update an isolated axial solid box.

There is deliberately no validate_full argument. Unsupported inputs refuse;
the caller may separately invoke the ordinary Full-validated rebuild. This
entry point never executes MAP REBUILD, BSP REBUILD or a Full reference.
"""
from pathlib import Path
import json
import math
import re
import time
import uuid
import local_geometry as g
from certificate_evidence import read_certificate
from isolated_box_certificate import certify, source_boxes, Refused
from phantom_normal import verify_native_backoff
from implementation import BOX_CODE
from verified_output import copy_verified

CODE = tuple(dict.fromkeys((*g.CODE,*BOX_CODE)))


def dump(session, tag):
    path=session.folder/'Output'/f'{tag}.cert'
    session.cmd('UC_CERT_DUMP ..\\Output\\'+path.name)
    return read_certificate(path)


def _change(change):
    if not isinstance(change,dict) or len(change)!=1 or next(iter(change)) not in ('move','scale'):
        raise Refused('This class supports one translation or axial resize')
    key=next(iter(change));v=change[key]
    if not isinstance(v,(list,tuple)) or len(v)!=3 or any(type(x) not in (int,float) or not math.isfinite(x) for x in v):
        raise Refused('Expected three finite numeric transform values')
    if key=='scale' and any(x<=0 for x in v):raise Refused('Box scale must be positive')


def rebuild(path, selected, change, expected_sha, progress=print):
    _change(change)
    if not isinstance(selected,str) or not re.fullmatch(r'[A-Za-z_]\w*',selected):raise Refused('Select one named static box')
    if not isinstance(expected_sha,str) or not re.fullmatch('[0-9a-f]{64}',expected_sha):raise Refused('Pin the inspected map SHA256')
    hashes={n:g.base.sha(g.ROOT/n) for n in CODE}
    started=time.monotonic();s,source,digest=g.base.open_map(path,'certified-isolated-box')
    report=dict(success=False,source=str(source),source_sha256=digest,selected=selected,change=change,
                run=str(s.folder),full_reference_used=False,implementation_sha256=hashes,
                lighting='stale: rebuild lighting',paths='stale: rebuild AI paths',experimental=True)
    output=None
    try:
        if digest!=expected_sha:raise Refused('Source changed since inspection')
        report['engine_sha256']=verify_native_backoff(s.folder/'System/Engine.dll').sha256
        before=dump(s,'original');old_sources,_=g.sources(s,'original')
        old_baked=g.base.baked(s.folder/'Input/source.dx')
        report['eligibility']=certify(before,before,selected)
        progress('Eligible isolated cuboid: exact source, boundary routing and six-plane native hull.')
        report['edit_commands']=g.edits(s,old_sources,{selected:change})
        edited=g.base.snapshots(s,'edited');edited_sources=dump(s,'edited-sources')
        # Source-only eligibility before any compiled model mutation.
        source_boxes(edited_sources)
        report['native_update']=s.cmd('UC_CERT_BOX_UPDATE '+selected)
        if 'UCMapKit|isolated box update|6 source faces|unchanged partition links' not in report['native_update']:
            raise Refused('Native isolated-box update was not acknowledged')
        after=dump(s,'candidate');after_tree=g.base.snapshots(s,'candidate')
        report['certificate']=certify(before,after,selected)
        authored=g.authored_snapshot(s.folder/'Output/edited.t3d')
        if g.authored_snapshot(s.folder/'Output/candidate.t3d')!=authored:
            raise Refused('Native box update changed authored actor state')
        s.cmd(r'MAP SAVE FILE="..\Output\candidate.dx"')
        report['verified_candidate_sha256']=g.base.sha(s.folder/'Output/candidate.dx')
        s.cmd(r'MAP LOAD FILE="..\Output\candidate.dx"')
        reloaded=dump(s,'reloaded');g.base.snapshots(s,'reloaded')
        report['reloaded_certificate']=certify(before,reloaded,selected)
        if after!=reloaded:raise Refused('Save/reload changed authoritative compiled certificate data')
        if g.authored_snapshot(s.folder/'Output/reloaded.t3d')!=authored:raise Refused('Save/reload changed authored actor state')
        report['verified_exports_sha256']={n:g.base.sha(s.folder/'Output'/n) for n in ('reloaded.t3d','reloaded.tree')}
        if g.base.sha(s.folder/'Output/candidate.dx')!=report['verified_candidate_sha256']:
            raise Refused('Saved candidate changed during reload')
        new_baked=g.base.baked(s.folder/'Output/candidate.dx')
        if any(old_baked[k]!=new_baked[k] for k in ('lightmaps','bits','sources')):
            raise Refused('Stored baked data was modified')
        if g.base.sha(source)!=digest or any(g.base.sha(g.ROOT/n)!=h for n,h in hashes.items()):
            raise Refused('Input or implementation changed during transaction')
        if verify_native_backoff(s.folder/'System/Engine.dll').sha256!=report['engine_sha256']:
            raise Refused('Native engine changed during transaction')
        destination=g.ROOT/'results';destination.mkdir(exist_ok=True)
        if g.base.sha(s.folder/'Output/candidate.dx')!=report['verified_candidate_sha256'] or any(
                g.base.sha(s.folder/'Output'/n)!=h for n,h in report['verified_exports_sha256'].items()):
            raise Refused('Verified candidate or reload exports changed before publication')
        output=destination/(source.stem+'-certified-box-'+uuid.uuid4().hex[:8]+'.dx')
        output_sha=copy_verified(s.folder/'Output/candidate.dx',output,report['verified_candidate_sha256'])
        report.update(success=True,output=str(output),output_sha256=output_sha,
                      seconds=round(time.monotonic()-started,3))
        output.with_suffix('.json').write_text(json.dumps(report,indent=2))
        return report
    except Exception as error:
        report['error']=str(error)
        if hasattr(error,'witness'):report['witness']=error.witness
        error.local_report=report
        raise
    finally:
        s.close();(s.folder/'report.json').write_text(json.dumps(report,indent=2))


if __name__=='__main__':
    source=g.ROOT/'isolated-box.dx'
    print(json.dumps(rebuild(source,'Brush3',{'move':[64,0,0]},g.base.sha(source)),indent=2))
