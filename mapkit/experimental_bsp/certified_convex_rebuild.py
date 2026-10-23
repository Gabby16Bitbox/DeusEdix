"""No-Full regional rebuild for exactly representable ordinary convex CSG.

This backend has a deliberately explicit contract. Unsupported or
legacy malformed CSG is refused before publication. It does not silently fall
back to Full. The caller may separately request the established Full mode.
"""
from pathlib import Path
import json,re,time,uuid,sys
import local_geometry as g
from implementation import CODE,CONVEX_CODE
from full_exclusion import guarded_sessions
from native_certificate_profile import dump
from stratified_csg import verify_profile
from ordered_convex_csg import validate_world
from convex_hull_certificate import certify_hulls,verify_reload
from scope_mapping import certify_scope,complete_contributors
from verified_output import copy_verified

IMPLEMENTATION=tuple(dict.fromkeys((*CODE,*CONVEX_CODE)))
Refused=g.Refused


def fingerprint():
    # Bind the actual shared read-only imports, including the binary package
    # readers, to the same paths inspected by the isolated worker controller.
    for name in CONVEX_CODE:
        if name.startswith('../') or name in ('lightbits.py','bspsurf.py'):
            module=sys.modules.get(Path(name).stem)
            if module is None or Path(module.__file__).resolve()!=(g.ROOT/name).resolve():
                raise Refused('Unexpected shared dependency import: '+name)
    return {n:g.base.sha(g.ROOT/n) for n in IMPLEMENTATION}


def rebuild(path,changes,expected_sha,progress=print):
    # Reuse the worker's typed transform boundary, without importing native
    # modules into that controller in the opposite direction.
    from worker_bridge import validate_changes
    validate_changes(changes)
    if not isinstance(expected_sha,str) or not re.fullmatch('[0-9a-f]{64}',expected_sha):
        raise Refused('Pin the inspected source SHA256')
    hashes=fingerprint();controller_sha=g.base.sha(g.ROOT/'worker_bridge.py');started=time.monotonic();output=None
    report=dict(success=False,accepted=False,full_reference_used=False,changes=changes,
        implementation_sha256=hashes,controller_sha256=controller_sha,experimental=True,lighting='stale',paths='stale',
        validation_mode='exact ordered convex CSG, all-strata native routing, retained scope and native hulls')
    with guarded_sessions(g.base) as audits:
        s,source,digest=g.base.open_map(path,'certified-convex-region')
        report.update(source=str(source),source_sha256=digest,run=str(s.folder))
        try:
            if digest!=expected_sha:raise Refused('Source changed since inspection')
            before,profile=dump(s,'before');report['profiles']={'before':profile}
            progress('Checking original convex sources, all boundary cases and native arithmetic.')
            report['original_certificate']=validate_world(before)
            before_tree=g.base.snapshots(s,'before');old,root_out=g.sources(s,'before')
            old_baked=g.base.baked(s.folder/'Input/source.dx')
            s.cmd('UC_REGION_UV_SNAPSHOT')
            report['edit_commands']=g.edits(s,old,changes)
            edited,profile=dump(s,'edited');report['profiles']['edited']=profile
            g.base.snapshots(s,'edited');new,new_root=g.sources(s,'edited')
            if new_root!=root_out:raise Refused('Edit changed world root classification')
            plan=complete_contributors(before,edited,g.plan(before_tree,old,new,set(changes),root_out));report['plan']=plan
            progress('Rebuilding the regional source subset without Full.')
            (s.folder/'Output/contributors.txt').write_text('\n'.join(plan['contributors']))
            report['native_build']=s.cmd('UC_REGION_BUILD ..\\Output\\contributors.txt')
            s.cmd('UC_REGION_DUMP ..\\Output\\scratch.tree')
            scratch=g.base.tree(s.folder/'Output/scratch.tree')
            rows=g.compile_clipped(s,scratch,plan,before_tree,old,new,False)
            g.write_recipe(s.folder/'Output/recipe.txt',plan,rows)
            report['native_graft']=s.cmd('UC_REGION_GRAFT ..\\Output\\recipe.txt')
            if 'UCMapKit|region zone transfer|' not in report['native_graft']:
                raise Refused('Missing complete native zone transfer acknowledgement')
            after,profile=dump(s,'after');report['profiles']['after']=profile
            g.base.snapshots(s,'after')
            if after['brushes']!=edited['brushes']:raise Refused('Compilation altered authoritative source data')
            progress('Verifying complete CSG, surfaces, native hulls and unchanged outside partitions.')
            world=validate_world(after)
            scope=certify_scope(before,after,plan['root'],changes,plan['contributors'])
            hulls=certify_hulls(before,after,scope['outside_map'],engine_path=s.folder/'System/Engine.dll',
                                editor_path=s.folder/'System/Editor.dll')
            authored=g.authored_snapshot(s.folder/'Output/edited.t3d')
            if g.authored_snapshot(s.folder/'Output/after.t3d')!=authored:
                raise Refused('Compilation altered authored actor properties')
            s.cmd('MAP SAVE FILE="..\\Output\\candidate.dx"')
            candidate=s.folder/'Output/candidate.dx';report['verified_candidate_sha256']=g.base.sha(candidate)
            s.cmd('MAP LOAD FILE="..\\Output\\candidate.dx"')
            reloaded,profile=dump(s,'reloaded');report['profiles']['reloaded']=profile
            reload_proof=verify_reload(after,reloaded);g.base.snapshots(s,'reloaded')
            if g.authored_snapshot(s.folder/'Output/reloaded.t3d')!=authored:
                raise Refused('Save/reload altered authored actor properties')
            baked=g.base.baked(candidate)
            if any(baked[k]!=old_baked[k] for k in ('lightmaps','bits','sources')):
                raise Refused('Stored baked-light data was damaged')
            report['verified_exports_sha256']={n:g.base.sha(s.folder/'Output'/n) for n in ('reloaded.t3d','reloaded.tree')}
            report['certificate']=dict(status='pass',eligible=True,full_reference_used=False,
                certificate='convex_region_exact_source_native_routing_scope_hulls',
                world=world,scope=scope,hulls=hulls,reload=reload_proof)
            report['execution']=[a.report() for a in audits]
            if not report['execution'] or any(not a['full_commands_excluded'] for a in report['execution']):
                raise Refused('No-Full execution guard missing')
            if g.base.sha(source)!=digest or fingerprint()!=hashes or g.base.sha(g.ROOT/'worker_bridge.py')!=controller_sha:
                raise Refused('Source or implementation changed during the operation')
            for tag,profile in report['profiles'].items():
                verify_profile(profile)
                if g.base.sha(s.folder/'Output'/(tag+'.cert'))!=profile['certificate_sha256']:
                    raise Refused('Native certificate evidence changed')
                if g.base.sha(s.folder/'System/Engine.dll')!=profile['engine_sha256']:
                    raise Refused('Native engine changed during the operation')
                if g.base.sha(s.folder/'System/Editor.dll')!=profile['editor_sha256']:
                    raise Refused('Native bounds builder changed during the operation')
            if g.base.sha(candidate)!=report['verified_candidate_sha256'] or any(
                    g.base.sha(s.folder/'Output'/n)!=h for n,h in report['verified_exports_sha256'].items()):
                raise Refused('Verified candidate or reload exports changed')
            destination=g.ROOT/'results';destination.mkdir(exist_ok=True)
            output=destination/(source.stem+'-certified-convex-'+uuid.uuid4().hex[:8]+'.dx')
            output_sha=copy_verified(candidate,output,report['verified_candidate_sha256'])
            report.update(success=True,accepted=True,output=str(output),output_sha256=output_sha,
                          seconds=round(time.monotonic()-started,3))
            # Exact rational proof values are serialized as exact strings; no
            # float conversion is allowed to weaken a stored certificate.
            report=json.loads(json.dumps(report,default=str))
            return report
        except Exception as error:
            report['error']=str(error);error.local_report=report;raise
        finally:
            report['execution']=[a.report() for a in audits]
            s.close()
            text=json.dumps(report,indent=2,default=str)
            (s.folder/'report.json').write_text(text)
            if output and report['success']:output.with_suffix('.json').write_text(text)
