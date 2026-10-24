"""No-Full expansion of detail geometry whose solid support is already covered.

The source contract is intentionally narrow and checked before mutation. This
does not authorize arbitrary legacy BSP reconstruction or silently use Full.
All outputs remain private pending an editor transaction and lighting/paths.
"""
from pathlib import Path
from hashlib import sha256
import json, re, time, uuid
import local_geometry as g
from implementation import CODE, DETAIL_CODE
from certified_convex_rebuild import fingerprint as convex_fingerprint
from native_certificate_profile import dump
from native_axial_bounds import EDITOR_SHA256
from stratified_csg import verify_profile
from full_exclusion import guarded_sessions
from occluded_detail_expansion import expected_selected_rings
from selected_ring_fidelity import certify_selected_rings_bytes, certify_render_bounds
from retained_collision_state import certify_retained_collision_core_bytes, certify_retained_zone_pool_bytes
from retained_vertex_pool import certify_retained_vertex_pool
from verified_output import copy_verified

Refused = g.Refused
IMPLEMENTATION = tuple(dict.fromkeys((*CODE, *DETAIL_CODE)))


def fingerprint():
    convex_fingerprint()  # Also verifies actual paths of all shared imports.
    return {name:g.base.sha(g.ROOT/name) for name in IMPLEMENTATION}


def _evidence(session, profiles):
    result = {}
    for tag, profile in profiles.items():
        verify_profile(profile)
        if profile.get('editor_sha256') != EDITOR_SHA256:
            raise Refused('Unsupported native editor profile')
        result[tag] = {}
        for suffix, key in (('cert', 'certificate_sha256'), ('zones', 'zone_pool_sha256'), ('verts', 'vertex_pool_sha256')):
            payload = (session.folder/'Output'/(tag+'.'+suffix)).read_bytes()
            if sha256(payload).hexdigest() != profile.get(key):
                raise Refused('Native evidence changed: '+tag+'.'+suffix)
            result[tag][suffix] = payload
    return result


def _rings_recipe(path, name, targets):
    rows = ['RETAINRINGS 1 '+name+' '+str(len(targets))]
    for index, ring in targets.items():
        rows.append(str(index)+' '+str(len(ring)))
        rows.extend(' '.join(format(float(v), '.9g') for v in point) for point in ring)
    path.write_text('\n'.join(rows)+'\n')


def rebuild(path, changes, expected_sha, progress=print):
    from worker_bridge import validate_changes
    validate_changes(changes)
    if len(changes) != 1:
        raise Refused('Select one semisolid detail expansion')
    name = next(iter(changes))
    if not isinstance(expected_sha, str) or not re.fullmatch('[0-9a-f]{64}', expected_sha):
        raise Refused('Pin the inspected source SHA256')
    hashes = fingerprint()
    controller = g.base.sha(g.ROOT/'worker_bridge.py')
    started = time.monotonic()
    output = None
    report = dict(success=False, accepted=False, published=False, full_reference_used=False, changes=changes,
                implementation_sha256=hashes, controller_sha256=controller, experimental=True,
                lighting='stale', paths='stale', validation_mode='occluded detail source intent, retained collision and visibility')
    with guarded_sessions(g.base) as audits:
        s, source, digest = g.base.open_map(path, 'certified-detail')
        report.update(source=str(source), source_sha256=digest, run=str(s.folder), profiles={})
        def snapshot(tag):
            data, profile = dump(s, tag, include_zone_pool=True, include_vertex_pool=True)
            report['profiles'][tag] = profile
            if profile['editor_sha256'] != EDITOR_SHA256:
                raise Refused('Unsupported native editor profile')
            return data
        try:
            if digest != expected_sha:
                raise Refused('Source changed since inspection')
            if g.base.sha(s.folder/'System/UCMapKitHost.exe') != hashes['bin/UCMapKitHost.exe']:
                raise Refused('Unexpected native host copy')
            before = snapshot('before')
            g.base.snapshots(s, 'before')
            old, _ = g.sources(s, 'before')
            old_baked = g.base.baked(s.folder/'Input/source.dx')
            report['edit_commands'] = g.edits(s, old, changes)
            edited = snapshot('edited')
            g.base.snapshots(s, 'edited')
            progress('Proving the complete edited source domain and its finite visible faces without Full.')
            intent = expected_selected_rings(before, edited, name)
            certify_render_bounds(before, intent['targets'])
            _rings_recipe(s.folder/'Output/rings.txt', name, intent['targets'])
            ring_response = s.cmd('UC_CERT_RETAIN_RINGS ..\\Output\\rings.txt')
            uv_response = s.cmd('UC_CERT_RETAIN_UV '+name)
            if 'UCMapKit|retained rings update|' not in ring_response or 'UCMapKit|retained UV update|' not in uv_response:
                raise Refused('Missing native ring/mapping acknowledgement')
            report['native_update'] = [ring_response, uv_response]
            after = snapshot('after')
            g.base.snapshots(s, 'after')
            authored = g.authored_snapshot(s.folder/'Output/edited.t3d')
            if g.authored_snapshot(s.folder/'Output/after.t3d') != authored:
                raise Refused('Compiled update altered authored actors')
            s.cmd('MAP SAVE FILE="..\\Output\\candidate.dx"')
            candidate = s.folder/'Output/candidate.dx'
            candidate_sha = g.base.sha(candidate)
            s.cmd('MAP LOAD FILE="..\\Output\\candidate.dx"')
            snapshot('reloaded')
            g.base.snapshots(s, 'reloaded')
            exports = {n:g.base.sha(s.folder/'Output'/n) for n in ('reloaded.t3d', 'reloaded.tree')}
            if g.authored_snapshot(s.folder/'Output/reloaded.t3d') != authored:
                raise Refused('Reload altered authored actors')
            evidence = _evidence(s, report['profiles'])
            b, e, a, r = (evidence[t] for t in ('before', 'edited', 'after', 'reloaded'))
            if a != r:
                raise Refused('Complete native certificate/pools changed after save and reload')
            progress('Checking every native polygon, collision input, zone slot and vertex-pool reference.')
            surfaces = certify_selected_rings_bytes(b['cert'], e['cert'], a['cert'], name)
            collision = certify_retained_collision_core_bytes(b['cert'], a['cert'], r['cert'], engine_path=s.folder/'System/Engine.dll')
            zones = certify_retained_zone_pool_bytes(b['zones'], a['zones'], r['zones'])
            vertices = certify_retained_vertex_pool(b['verts'], a['verts'], r['verts'], surfaces['source_target']['targets'])
            # Source edits must not have mutated any pool before construction.
            if b['verts'] != e['verts'] or b['zones'] != e['zones']:
                raise Refused('Source transform unexpectedly changed native pools')
            baked = g.base.baked(candidate)
            if any(baked[k] != old_baked[k] for k in ('lightmaps', 'bits', 'sources')):
                raise Refused('Stored baked lighting data changed')
            execution = [audit.report() for audit in audits]
            if not execution or any(not audit['full_commands_excluded'] for audit in execution):
                raise Refused('No-Full execution guard missing')
            report['certificate'] = dict(status='pass', eligible=True, full_reference_used=False,
                certificate='occluded_detail_source_rings_retained_collision_zonepool_vertices_v1',
                surfaces=surfaces, collision=collision, zones=zones, vertices=vertices,
                reload=dict(status='pass', comparison='complete CERT2, all64 zones and complete vertex pool bytes'))
            if (g.base.sha(source) != digest or fingerprint() != hashes or g.base.sha(g.ROOT/'worker_bridge.py') != controller or
                    g.base.sha(s.folder/'System/UCMapKitHost.exe') != hashes['bin/UCMapKitHost.exe']):
                raise Refused('Source or implementation changed during the operation')
            for profile in report['profiles'].values():
                if (g.base.sha(s.folder/'System/Engine.dll') != profile['engine_sha256'] or
                        g.base.sha(s.folder/'System/Editor.dll') != profile['editor_sha256']):
                    raise Refused('Native implementation changed')
            _evidence(s, report['profiles'])
            if g.base.sha(candidate) != candidate_sha:
                raise Refused('Verified candidate changed')
            if any(g.base.sha(s.folder/'Output'/n) != h for n, h in exports.items()):
                raise Refused('Reload exports changed during validation')
            report['verified_candidate_sha256'] = candidate_sha
            report['verified_exports_sha256'] = exports
            destination = g.ROOT/'results'
            destination.mkdir(exist_ok=True)
            output = destination/(source.stem+'-certified-detail-'+uuid.uuid4().hex[:8]+'.dx')
            output_sha = copy_verified(candidate, output, candidate_sha)
            report.update(success=True, accepted=True, output=str(output), output_sha256=output_sha,
                          seconds=round(time.monotonic()-started, 3), execution=execution)
            return json.loads(json.dumps(report, default=str))
        except Exception as error:
            report['error'] = str(error)
            error.local_report = report
            raise
        finally:
            report['execution'] = [audit.report() for audit in audits]
            s.close()
            text = json.dumps(report, indent=2, default=str)
            (s.folder/'report.json').write_text(text)
            if output and report['success']:
                output.with_suffix('.json').write_text(text)
