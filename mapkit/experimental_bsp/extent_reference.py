"""Private-session collector for the narrow native-extent preservation proof."""
from pathlib import Path
import hashlib, json
import native_extent_scope as scope


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def collect(session, tag, map_relative, tree_reference, indices, probes, trace_reference):
    if tag not in ('original', 'local'):
        raise scope.Refused('Invalid extent evidence stage')
    engine = session.folder/'System/Engine.dll'
    engine_hash = sha(engine)
    if engine_hash not in scope.KNOWN_ENGINES:
        raise scope.Refused('Unknown Engine binary before instrumentation')
    path = (session.folder/'System'/map_relative).resolve()
    if not path.is_relative_to(session.folder.resolve()) or not path.is_file():
        raise scope.Refused('Extent evidence needs a private saved map')
    map_hash = sha(path)
    tree_hash = sha(tree_reference)
    session.cmd('MAP LOAD FILE="'+map_relative+'"')
    dumped = session.folder/f'Output/extent-{tag}.tree'
    session.cmd('UC_SELECTED_DUMP ..\\Output\\extent-'+tag+'.tree')
    if sha(dumped) != tree_hash:
        raise scope.Refused('Extent evidence map differs from the validated BSP snapshot')
    inventory = session.cmd('UC_EXTENT_HULLS ALL')
    model = scope.parse_model_evidence(inventory, engine)
    rows = {}
    outputs = {}
    for index in indices:
        probe = probes[index]
        output = session.cmd('UC_EXTENT_EVIDENCE '+' '.join(format(x, '.9g') for x in probe))
        evidence = scope.parse_evidence(output, probe, engine)
        expected = tuple(scope.f32(float(x)) for x in trace_reference[index].split())
        if evidence.result != expected:
            raise scope.Refused('Extent instrumentation trace differs from the original validated trace')
        rows[index] = evidence
        outputs[index] = output
    # Detect accidental or concurrent model/file substitution during collection.
    final_dump = session.folder/f'Output/extent-{tag}-after.tree'
    session.cmd('UC_SELECTED_DUMP ..\\Output\\extent-'+tag+'-after.tree')
    if sha(final_dump) != tree_hash or sha(path) != map_hash or sha(engine) != engine_hash:
        raise scope.Refused('Extent evidence inputs changed during collection')
    audit = dict(stage=tag, map=str(path), map_sha256=map_hash, tree_sha256=tree_hash, engine_sha256=engine_hash,
               inventory=inventory, traces=outputs)
    artifact = session.folder/f'Output/extent-{tag}-evidence.json'
    artifact.write_text(json.dumps(audit, indent=2))
    return model, rows, dict(path=str(artifact), sha256=sha(artifact), map_sha256=map_hash, tree_sha256=tree_hash)


def certify_differences(session, differences, probes, local_traces, original_traces,
                        local_occupancy, full_occupancy, original_occupancy, old, new, selected):
    indices = []
    untouched = []
    audits = []
    if len(selected) != 1:
        return differences, []
    # Source proof is mandatory before any native instrumentation cost.
    try:
        dependency = scope.source_edit_certificate(old, new, selected)
        if not dependency['valid']:
            return differences, []
        for name in selected:
            scope._box(old[name])
            scope._box(new[name])
    except scope.Refused:
        return differences, []
    positions = {p:i for i, p in enumerate(probes)}
    for d in differences:
        p = tuple(d['ray'])
        index = positions[p]
        point = (*p[:3], *p[6:])
        if (d['reference'] != 'full' or any(values[point] != '1 1' for values in (local_occupancy, full_occupancy, original_occupancy)) or
            min(p[6:]) <= 0 or local_traces[index] == 'clear' or original_traces[index] != local_traces[index]):
            untouched.append(d)
            continue
        indices.append(index)
    if not indices:
        return differences, []
    try:
        am, a, aa = collect(session, 'original', r'..\Input\source.dx', session.folder/'Output/before.tree', indices, probes, original_traces)
        bm, b, ba = collect(session, 'local', r'..\Output\candidate.dx', session.folder/'Output/reloaded.tree', indices, probes, local_traces)
    except scope.Refused as error:
        for d in differences:
            d['extent_certificate_refusal'] = str(error)
        return differences, []
    accepted = set()
    for index in indices:
        try:
            proof = scope.certify(a[index], b[index], am, bm, old, new, selected)
        except scope.Refused as error:
            next(d for d in differences if tuple(d['ray']) == tuple(probes[index]))['extent_certificate_refusal'] = str(error)
            continue
        accepted.add(index)
        audits.append(dict(probe_index=index, ray=probes[index], original_evidence=aa, local_evidence=ba, **proof))
    return [d for d in differences if positions[tuple(d['ray'])] not in accepted], audits
