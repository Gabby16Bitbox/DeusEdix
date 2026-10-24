"""Narrow non-solid update with unchanged BSP planes and certified clipping.

This is not a replacement for volumetric CSG: it only changes polygon extents
in a pure non-solid subtree. New portions outside that subtree must be hidden
in the original solid world, checked by exhaustive polygon/BSP clipping.
"""
from fractions import Fraction
import math
import struct

NOT_SOLID = 8
PORTAL = 0x04000000


def f32(x):
    return struct.unpack('<f', struct.pack('<f', float(x)))[0]


def rational(x):
    if not math.isfinite(float(x)):
        raise ValueError('Non-finite BSP data')
    return Fraction(f32(x))


def area_exists(poly):
    if len(poly) < 3:
        return False
    a = poly[0]
    for b, c in zip(poly[1:], poly[2:]):
        u = [b[k]-a[k] for k in range(3)]
        v = [c[k]-a[k] for k in range(3)]
        if any(u[i]*v[j]-u[j]*v[i] for i, j in ((0, 1), (0, 2), (1, 2))):
            return True
    return False


def cut(poly, plane):
    result = []
    if not poly:
        return result
    a = poly[-1]
    da = sum(a[k]*plane[k] for k in range(3))-plane[3]
    for b in poly:
        db = sum(b[k]*plane[k] for k in range(3))-plane[3]
        if (da >= 0) != (db >= 0):
            t = da/(da-db)
            result.append(tuple(a[k]+t*(b[k]-a[k]) for k in range(3)))
        if db >= 0:
            result.append(b)
        a, da = b, db
    return list(dict.fromkeys(result))


def hidden_in_solid(poly, data, root_outside, budget=200000):
    """Every positive-area fragment must terminate in solid, never a sample."""
    stack = [(0, bool(root_outside), poly)]
    processed = 0
    while stack:
        i, outside, face = stack.pop()
        if not area_exists(face):
            continue
        processed += 1
        if processed > budget:
            raise ValueError('Non-solid certificate complexity limit')
        if i < 0:
            if outside:
                return False
            continue
        n = data['nodes'][i]
        plane = tuple(rational(x) for x in data['polys'][i][1:5])
        ds = [sum(p[k]*plane[k] for k in range(3))-plane[3] for p in face]
        # A collision-only invisible hull must not hide a rendered foliage
        # fragment. Use the visibility splitter mask as well as NF_NotCsg.
        csg = n['vertices'] > 0 and not n['flags'] & (0x21|0x04)
        if not any(ds) and csg:
            return False  # Ambiguous coincident solid boundary is unsupported.
        for side in (0, 1):
            fragment = cut(face, plane if side == 0 else tuple(-x for x in plane))
            child_outside = (outside or csg) if side == 0 else (outside and not csg)
            stack.append((n['children'][side], child_outside, fragment))
    return True


def plan(data, old, new, names, root_outside):
    import local_geometry as g
    if len(names) != 1:
        return None
    name = next(iter(names))
    a, b = old[name], new[name]
    if not a['flags'] & NOT_SOLID or a['flags'] & PORTAL:
        return None
    if a['flags'] != b['flags'] or a['operation'] != 1 or b['operation'] != 1:
        raise g.Refused('Non-solid update needs unchanged additive non-solid flags.')
    selection = g.base.plan(data, names)
    if len(selection['roots']) != 1:
        raise g.Refused('Non-solid update needs one pure subtree.')
    root = selection['roots'][0]
    owned = g.descendants(data, root)
    if any(not data['nodes'][i]['flags'] & 1 or data['nodes'][i]['vertices'] < 3 for i in owned):
        raise g.Refused('Non-solid subtree has structural or empty nodes.')
    if len(a['faces']) != len(b['faces']) or any(len(x) != len(y) for x, y in zip(a['faces'], b['faces'])):
        raise g.Refused('Non-solid source topology changed.')
    maps = [{} for _ in range(3)]
    for old_point, new_point in zip(a['points'], b['points']):
        for k in range(3):
            x, y = f32(old_point[k]), f32(new_point[k])
            if x in maps[k] and maps[k][x] != y:
                raise g.Refused('Non-solid transform is not coordinate-separable.')
            maps[k][x] = y
    changed = [k for k in range(3) if any(x != y for x, y in maps[k].items())]
    if len(changed) != 1:
        raise g.Refused('Non-solid fast path supports one changed coordinate axis.')
    axis = changed[0]
    if any(float(data['polys'][i][1+axis]) != 0 for i in owned):
        raise g.Refused('Non-solid update would move a BSP partition plane.')
    parents = {c:(i, k) for i, n in data['nodes'].items() for k, c in enumerate(n['children']) if c >= 0}
    chain = []
    i = root
    while i:
        parent, side = parents[i]
        if side == 2:
            raise g.Refused('Non-solid root is in a coplanar chain.')
        chain.append((parent, side))
        i = parent
    planes = []
    outside = bool(root_outside)
    for i, side in reversed(chain):
        p = g.plane(data, i)
        planes.append(p if side == 0 else g.negate(p))
        n = data['nodes'][i]
        csg = n['vertices'] > 0 and not n['flags']&0x21
        outside = (outside or csg) if side == 0 else (outside and not csg)
    if not outside:
        raise g.Refused('Non-solid subtree must occupy empty world space.')
    exact_planes = [tuple(rational(x) for x in p) for p in planes]
    hidden_fragments = 0
    expected = []
    for face_index, source_face in enumerate(b['faces']):
        remaining = [tuple(rational(x) for x in p) for p in source_face]
        for p in exact_planes:
            discarded = cut(remaining, tuple(-x for x in p))
            # On-plane portions belong to both halfspaces; only consider a
            # discarded polygon with a strictly negative signed-distance point.
            if area_exists(discarded) and any(sum(v[k]*p[k] for k in range(3))-p[3] < 0 for v in discarded):
                if not hidden_in_solid(discarded, data, root_outside):
                    raise g.Refused('New non-solid face reaches another empty BSP branch.')
                hidden_fragments += 1
            remaining = cut(remaining, p)
        expected.append(dict(face=face_index, vertices=[[float(x) for x in v] for v in remaining]))
    rows = []
    for i in sorted(owned):
        vertices = g.vertices(data['polys'][i])
        mapped = []
        for v in vertices:
            if f32(v[axis]) not in maps[axis]:
                raise g.Refused('Compiled vertex has no exact transformed source coordinate.')
            q = list(v)
            q[axis] = maps[axis][f32(v[axis])]
            mapped.append(q)
        for p in planes:
            mapped = g.clip_polygon(mapped, p)
        if not 3 <= len(mapped) <= 16:
            raise g.Refused('Non-solid clipping changed the structural node validity.')
        if max(abs(g.distance(v, g.plane(data, i))) for v in mapped) > .01:
            raise g.Refused('Updated non-solid face is not on its retained plane.')
        rows.append(dict(node=i, vertices=mapped))
    points = [v for brush in new.values() for v in brush['points']]
    lo = [min(v[k] for v in points)-1024 for k in range(3)]
    hi = [max(v[k] for v in points)+1024 for k in range(3)]
    cell = g.box_faces(lo, hi)
    for p in planes:
        cell = g.clip_cell(cell, p)
    return dict(root=root, old_nodes=sorted(owned), total_nodes=len(data['nodes']), planes=planes,
                cell=cell, contributors=[name], total_brushes=len(new), root_outside=int(outside),
                selected=[name], retained_portals=[], expanded_parents=0, non_solid_rows=rows,
                non_solid_expected=expected,
                non_solid_certificate=dict(axis=axis, unchanged_partition_planes=True,
                                           discarded_solid_fragments=hidden_fragments))


def validate_surface_coverage(data, planned):
    """Compare every selected compiled fragment with the clipped authored face."""
    import local_geometry as g
    name = planned['selected'][0]
    actual = {'polys':[]}
    expected = {'polys':[]}
    planes = {}
    for i, node in data['nodes'].items():
        if node['actor'] != name:
            continue
        if i not in planned['old_nodes']:
            raise g.Refused('Non-solid geometry escaped its preserved subtree.')
        p = list(data['polys'][i])
        face = int(data['surfs'][node['surf']][3])
        p[0] = str(face)
        actual['polys'].append(p)
        planes.setdefault(face, p[1:6])
    for face in planned['non_solid_expected']:
        vertices = face['vertices']
        index = face['face']
        if len(vertices) < 3:
            continue
        if index not in planes:
            raise g.Refused('Missing non-solid source face.')
        expected['polys'].append([str(index), *planes[index], str(len(vertices)),
                                 *[str(x) for v in vertices for x in v]])
    return g.polygon_validation.coverage(actual, expected)


def apply(session, planned):
    lines = [str(len(planned['non_solid_rows']))]
    for row in planned['non_solid_rows']:
        lines.append(f"{row['node']} {len(row['vertices'])}")
        lines.extend(' '.join(format(x, '.9g') for x in v) for v in row['vertices'])
    (session.folder/'Output/non-solid.txt').write_text('\n'.join(lines)+'\n')
    result = session.cmd(r'UC_NONSOLID_UPDATE ..\Output\non-solid.txt')
    if f"UCMapKit|non-solid update|{len(planned['non_solid_rows'])} nodes|unchanged planes links leaves zones" not in result:
        raise ValueError('Native non-solid update did not acknowledge all invariants.')
    return result


def structural_state(session, tag):
    from pathlib import Path
    path = session.folder/'Output'/f'{tag}.non-solid-state'
    result = session.cmd('UC_NONSOLID_STATE ..\\Output\\'+path.name)
    if 'UCMapKit|non-solid state|complete' not in result:
        raise ValueError('Native collision state was not exported.')
    return path.read_bytes()
