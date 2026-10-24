"""Private editor-worker boundary. Does not publish into the shared editor.

The controller imports no native/compiler module. A verified bundle is prepared
in a fresh directory; an editor adapter must still commit its generation under
the project's lock and rebuild lighting/paths before Play or Install.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parent


class Rejected(ValueError):
    pass


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    with temporary.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def validate_changes(changes):
    if not isinstance(changes, dict) or not changes:
        raise Rejected('No brush changes supplied.')
    for name, edit in changes.items():
        if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*', name):
            raise Rejected('Invalid brush identity.')
        if not isinstance(edit, dict) or set(edit)-{'move', 'scale', 'rotation'}:
            raise Rejected('Only brush transforms are supported.')
        for field, values in edit.items():
            if not isinstance(values, list) or len(values) != 3 or any(type(v) not in (int, float) or not math.isfinite(v) or abs(v) > 65536 for v in values):
                raise Rejected('Malformed transform.')
            if field == 'scale' and any(v < .05 or v > 20 for v in values):
                raise Rejected('Unsupported scale.')


def validate_mode(validation, changes):
    if validation not in ('full', 'certified_box', 'certified_convex', 'certified_detail'):
        raise Rejected('Unsupported worker mode.')
    if validation == 'certified_detail' and len(changes) != 1:
        raise Rejected('Select one semisolid detail expansion.')
    if validation == 'certified_box':
        if len(changes) != 1:
            raise Rejected('Select one isolated box.')
        change = next(iter(changes.values()))
        if len(change) != 1 or next(iter(change)) not in ('move', 'scale'):
            raise Rejected('Certified boxes support one translation or axial resize.')


def fingerprint(validation='full'):
    # This inventory module contains only string constants. In particular, do
    # not import local_geometry/selected_rebuild into the editor server.
    from implementation import CODE, BOX_CODE, CONVEX_CODE, DETAIL_CODE
    extra = BOX_CODE if validation == 'certified_box' else CONVEX_CODE if validation == 'certified_convex' else DETAIL_CODE if validation == 'certified_detail' else ()
    return {name:sha(ROOT/name) for name in (*CODE, *extra, 'worker_bridge.py')}


def unchanged(snapshots):
    for name, digest in snapshots.items():
        path = Path(name)
        if path.exists() and not path.is_file():
            raise Rejected('An editor state path is no longer a file: '+name)
        if (sha(path) if path.is_file() else None) != digest:
            raise Rejected('A source or editor state file changed: '+name)


def private_job(path):
    path = Path(path).resolve()
    base = (ROOT/'worker-jobs').resolve()
    if path.parent != base or not re.fullmatch('[0-9a-f]{32}', path.name) or path.is_symlink():
        raise Rejected('Not a private worker job.')
    return path


def prepare(source, expected_sha, changes, context_paths=(), validation='full'):
    validate_changes(changes)
    validate_mode(validation, changes)
    source = Path(source).resolve()
    if source.suffix.lower() != '.dx' or not source.is_file() or sha(source) != expected_sha:
        raise Rejected('Source map changed since inspection.')
    snapshots = {str(source):expected_sha}
    for item in context_paths:
        path = Path(item).resolve()
        if path.exists() and not path.is_file():
            raise Rejected('Editor state snapshots require files: '+str(path))
        snapshots[str(path)] = sha(path) if path.is_file() else None
    jobs = ROOT/'worker-jobs'
    jobs.mkdir(exist_ok=True)
    job = jobs/uuid.uuid4().hex
    job.mkdir()
    request = dict(version=1, job=job.name, source=str(source), source_sha256=expected_sha,
                 changes=changes, context_sha256=snapshots, implementation_sha256=fingerprint(validation), validation=validation)
    atomic_json(job/'request.json', request)
    return job, sha(job/'request.json')


def validate_request(job, request_sha):
    job = private_job(job)
    if sha(job/'request.json') != request_sha:
        raise Rejected('Worker request changed.')
    request = read(job/'request.json')
    if set(request) != {'version', 'job', 'source', 'source_sha256', 'changes', 'context_sha256', 'implementation_sha256', 'validation'}:
        raise Rejected('Unsupported worker request fields.')
    if request['version'] != 1 or request['job'] != job.name:
        raise Rejected('Unsupported worker request.')
    validate_changes(request['changes'])
    validate_mode(request['validation'], request['changes'])
    if request['implementation_sha256'] != fingerprint(request['validation']):
        raise Rejected('Compiler changed during this operation.')
    if request['context_sha256'].get(request['source']) != request['source_sha256']:
        raise Rejected('Source is not in the frozen context.')
    unchanged(request['context_sha256'])
    return job, request


def stage_result(job, request, result):
    if result.get('success') is not True or result.get('source_sha256') != request['source_sha256'] or result.get('changes') != request['changes']:
        raise Rejected('Result does not match the requested source and edits.')
    expected = {n:h for n, h in request['implementation_sha256'].items() if n != 'worker_bridge.py'}
    if result.get('implementation_sha256') != expected:
        raise Rejected('Unrecognized compiler result.')
    checks = result.get('checks') or {}
    if request['validation'] == 'certified_detail':
        proof = result.get('certificate') or {}
        if (result.get('accepted') is not True or result.get('full_reference_used') is not False or
                proof.get('status') != 'pass' or proof.get('eligible') is not True or proof.get('full_reference_used') is not False or
                proof.get('certificate') != 'occluded_detail_source_rings_retained_collision_zonepool_vertices_v1'):
            raise Rejected('Missing complete no-Full detail certificate.')
        if result.get('controller_sha256') != request['implementation_sha256'].get('worker_bridge.py'):
            raise Rejected('Changed detail controller validation.')
        if (any((proof.get(k) or {}).get('status') != 'pass' for k in ('surfaces', 'vertices', 'reload')) or
                any((proof.get(k) or {}).get('valid') is not True for k in ('collision', 'zones')) or
                (proof.get('surfaces', {}).get('source_target') or {}).get('status') != 'pass' or
                proof.get('zones', {}).get('slots') != 64):
            raise Rejected('Incomplete detail source, surface, collision, pool or reload proof.')
        profiles = result.get('profiles', {})
        if set(profiles) != {'before', 'edited', 'after', 'reloaded'}:
            raise Rejected('Missing native detail snapshots.')
        from stratified_csg import verify_profile
        from native_axial_bounds import EDITOR_SHA256
        for profile in profiles.values():
            if profile.get('editor_sha256') != EDITOR_SHA256:
                raise Rejected('Unsupported native editor profile.')
            try:
                verify_profile(profile)
            except ValueError as error:
                raise Rejected('Unsupported native arithmetic profile.') from error
        execution = result.get('execution')
        if not execution or any(e.get('full_commands_excluded') is not True for e in execution):
            raise Rejected('Missing no-Full execution guard.')
    elif request['validation'] == 'certified_convex':
        proof = result.get('certificate') or {}
        if (result.get('accepted') is not True or result.get('full_reference_used') is not False or
                proof.get('status') != 'pass' or proof.get('eligible') is not True or proof.get('full_reference_used') is not False or
                proof.get('certificate') != 'convex_region_exact_source_native_routing_scope_hulls'):
            raise Rejected('Missing complete no-Full convex-region certificate.')
        if result.get('controller_sha256') != request['implementation_sha256'].get('worker_bridge.py'):
            raise Rejected('Changed convex controller validation.')
        if any((proof.get(k) or {}).get('status') != 'pass' for k in ('world', 'scope', 'hulls', 'reload', 'caches')):
            raise Rejected('Incomplete convex source, scope, hull, reload or light cache proof.')
        profiles = result.get('profiles', {})
        if set(profiles) != {'before', 'edited', 'after', 'reloaded'}:
            raise Rejected('Missing actual native arithmetic profiles.')
        from stratified_csg import verify_profile
        from native_axial_bounds import EDITOR_SHA256
        for profile in profiles.values():
            if profile.get('editor_sha256') != EDITOR_SHA256:
                raise Rejected('Unsupported native bounds-builder profile.')
            try:
                verify_profile(profile)
            except ValueError as error:
                raise Rejected('Unsupported native arithmetic profile.') from error
        execution = result.get('execution')
        if not execution or any(e.get('full_commands_excluded') is not True for e in execution):
            raise Rejected('Missing no-Full execution guard.')
    elif request['validation'] == 'certified_box':
        if result.get('full_reference_used') is not False:
            raise Rejected('Certified box unexpectedly used Full.')
        for key in ('certificate', 'reloaded_certificate'):
            proof = result.get(key) or {}
            if (proof.get('status') != 'pass' or proof.get('eligible') is not True or
                proof.get('full_reference_used') is not False or
                proof.get('certificate') != 'isolated_integer_axis_box_exact_source_routing_surfaces_hulls'):
                raise Rejected('Missing complete isolated-box certificate.')
    elif result.get('full_reference_used') is False:
        if checks.get('serialized_collision_and_visibility_exact') is not True:
            raise Rejected('Missing non-solid certificate.')
    elif not result.get('precise_full_reference') or checks.get('full_collision_rays', 0) <= 0:
        raise Rejected('Missing mandatory Full validation.')
    output = Path(result['output']).resolve()
    run = Path(result['run']).resolve()
    if not output.is_relative_to((ROOT/'results').resolve()) or not run.is_relative_to((ROOT/'runs').resolve()):
        raise Rejected('Result escaped the private compiler directories.')
    if not output.is_file() or sha(output) != result['output_sha256']:
        raise Rejected('Result map changed.')
    if request['validation'] == 'certified_convex':
        for tag, profile in result['profiles'].items():
            if sha(run/'Output'/(tag+'.cert')) != profile.get('certificate_sha256'):
                raise Rejected('Native convex certificate evidence changed.')
    if request['validation'] == 'certified_detail':
        for tag, profile in result['profiles'].items():
            for suffix, key in (('cert', 'certificate_sha256'), ('zones', 'zone_pool_sha256'), ('verts', 'vertex_pool_sha256')):
                if sha(run/'Output'/(tag+'.'+suffix)) != profile.get(key):
                    raise Rejected('Native detail certificate/pool evidence changed.')
    if result.get('verified_candidate_sha256') != result['output_sha256']:
        raise Rejected('Result is not the reload-verified map.')
    expected_exports = result.get('verified_exports_sha256', {})
    if set(expected_exports) != {'reloaded.t3d', 'reloaded.tree'}:
        raise Rejected('Missing verified reload export hashes.')
    if any(not (run/'Output'/name).is_file() or sha(run/'Output'/name) != digest for name, digest in expected_exports.items()):
        raise Rejected('Verified reload exports changed.')
    unchanged(request['context_sha256'])
    if fingerprint(request['validation']) != request['implementation_sha256']:
        raise Rejected('Compiler changed before staging.')
    bundle = job/'bundle'
    bundle.mkdir()
    for source, name in ((output, 'map.dx'), (run/'Output/reloaded.t3d', 'map.t3d'), (run/'Output/reloaded.tree', 'preview.tree')):
        shutil.copy2(source, bundle/name)
    if sha(bundle/'map.dx') != result['output_sha256']:
        raise Rejected('Candidate copy changed.')
    if sha(bundle/'map.t3d') != expected_exports['reloaded.t3d'] or sha(bundle/'preview.tree') != expected_exports['reloaded.tree']:
        raise Rejected('Verified reload exports changed during copy.')
    atomic_json(bundle/'evidence.json', result)
    unchanged(request['context_sha256'])
    receipt = dict(status='ready', job=request['job'], request_sha256=sha(job/'request.json'),
        files={name:sha(bundle/name) for name in ('map.dx', 'map.t3d', 'preview.tree', 'evidence.json')},
        lighting='stale', paths='stale', play_ready=False, published=False)
    atomic_json(job/'receipt.json', receipt)
    return receipt


def accept(job, request_sha):
    job, request = validate_request(job, request_sha)
    receipt = read(job/'receipt.json')
    if receipt.get('status') != 'ready' or receipt.get('job') != job.name or receipt.get('request_sha256') != request_sha or receipt.get('published') is not False:
        raise Rejected('No matching verified worker bundle.')
    if set(receipt.get('files', {})) != {'map.dx', 'map.t3d', 'preview.tree', 'evidence.json'}:
        raise Rejected('Incomplete worker bundle.')
    if any(sha(job/'bundle'/name) != digest for name, digest in receipt['files'].items()):
        raise Rejected('Worker bundle changed.')
    return dict(receipt, bundle=str(job/'bundle'))


def run(source, expected_sha, changes, context_paths=(), timeout=1800, validation='full'):
    job, request_sha = prepare(source, expected_sha, changes, context_paths, validation)
    flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    with (job/'worker.log').open('wb') as log:
        runner = ([str(Path(sys.executable).with_name('deusedix-cli.exe')), '--run']
                if getattr(sys, 'frozen', False) else [sys.executable, '-I'])
        process = subprocess.Popen(runner+[str(ROOT/'worker_bridge.py'), '--job', str(job), '--request-sha', request_sha],
            cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, creationflags=flags, start_new_session=os.name != 'nt')
        try:
            code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)
            else:
                import signal
                os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=10)
            raise Rejected('Local rebuild timed out. The previous build was not replaced.')
    if code != 0:
        error = read(job/'error.json').get('error') if (job/'error.json').is_file() else 'Worker exited without a complete result.'
        raise Rejected(str(error))
    return accept(job, request_sha)


def worker(job, request_sha):
    job, request = validate_request(job, request_sha)
    # These imports and their legacy kit overrides stay in this child only.
    import local_geometry as core
    try:
        if request['validation'] == 'certified_detail':
            import certified_detail_rebuild as detail
            result = detail.rebuild(request['source'], request['changes'], request['source_sha256'], progress=print)
        elif request['validation'] == 'certified_convex':
            import certified_convex_rebuild as convex
            result = convex.rebuild(request['source'], request['changes'], request['source_sha256'], progress=print)
        elif request['validation'] == 'certified_box':
            import isolated_box_rebuild as box
            selected, change = next(iter(request['changes'].items()))
            result = box.rebuild(request['source'], selected, change, request['source_sha256'], progress=print)
            result['changes'] = request['changes']
        else:
            result = core.rebuild(request['source'], request['changes'], expected_sha=request['source_sha256'], validate_full=True, progress=print)
        validate_request(job, request_sha)
        stage_result(job, request, result)
    except Exception as error:
        atomic_json(job/'error.json', dict(status='refused', error=str(error), published=False))
        return 2
    return 0


if __name__ == '__main__':
    # -I deliberately omits the script directory; add only this owned directory.
    sys.path.insert(0, str(ROOT))
    parser = argparse.ArgumentParser()
    parser.add_argument('--job', required=True)
    parser.add_argument('--request-sha', required=True)
    args = parser.parse_args()
    raise SystemExit(worker(args.job, args.request_sha))
