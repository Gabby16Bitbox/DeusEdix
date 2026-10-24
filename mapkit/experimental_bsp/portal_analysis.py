"""Read-only portal/cell diagnostics for the isolated geometry prototype.

The strict exclusion test uses every source face, not the brush AABB. It never
declares a portal safe merely because its surviving face is small. A face that
lies on a retained BSP ancestor is reported separately, not silently excluded.
"""
from pathlib import Path
import argparse
import copy
import itertools
import json
import math

PORTAL = 0x04000000


def read_sources(path):
    result = {}
    root = None
    for line in Path(path).read_text().splitlines():
        row = line.split()
        if row[0] == 'ROOT':
            root = int(row[1])
        elif row[0] == 'B':
            brush = dict(name=row[1], operation=int(row[2]), flags=int(row[3]),
                         location=list(map(float, row[4:7])),
                         rotation=list(map(int, row[7:10])), points=[], faces=[], face_normals=[])
            result[brush['name']] = brush
        elif row[0] == 'F':
            face = [tuple(map(float, row[2+i*3:5+i*3])) for i in range(int(row[1]))]
            brush['faces'].append(face)
            brush['points'].extend(face)
        elif row[0] == 'N':
            if len(row) != 5 or int(row[1]) != len(brush['face_normals']) or len(brush['faces']) != int(row[1])+1:
                raise ValueError('Malformed or reordered authoritative source normal')
            brush['face_normals'].append(tuple(map(float, row[2:5])))
    return result, root


def distance(point, plane):
    return sum(point[i] * plane[i] for i in range(3)) - plane[3]


def clip_face(face, plane):
    if not face:
        return []
    result = []
    previous = face[-1]
    previous_distance = distance(previous, plane)
    for current in face:
        current_distance = distance(current, plane)
        if (previous_distance >= 0) != (current_distance >= 0):
            fraction = previous_distance / (previous_distance - current_distance)
            result.append(tuple(previous[i] + fraction * (current[i] - previous[i]) for i in range(3)))
        if current_distance >= 0:
            result.append(current)
        previous, previous_distance = current, current_distance
    return result


def area(face):
    # Newell's formula works on planar polygons independent of winding/axis.
    normal = [0., 0., 0.]
    for a, b in zip(face, face[1:] + face[:1]):
        normal[0] += (a[1]-b[1]) * (a[2]+b[2])
        normal[1] += (a[2]-b[2]) * (a[0]+b[0])
        normal[2] += (a[0]-b[0]) * (a[1]+b[1])
    return math.sqrt(sum(x*x for x in normal)) / 2


def portal_relation(faces, planes, boundary_tolerance=.01):
    """Return exact clipped area and a conservative exclusion certificate.

    "outside" requires each face to be separated by a single cell plane, with
    strictly negative signed distances. Other empty intersections stay
    "uncertain" because an arbitrary nonconvex face can need triangulation.
    "boundary" is a diagnostic, not authorization to drop a portal.
    "intersects" includes arbitrarily small positive area; no sliver filtering.
    """
    if not faces or any(len(f) < 3 or area(f) == 0 for f in faces):
        return dict(relation='uncertain', reason='missing or degenerate source face')
    total_area = 0.
    separators = []
    boundary_planes = []
    for face in faces:
        if any(not math.isfinite(x) for p in face for x in p):
            return dict(relation='uncertain', reason='non-finite source face')
        separating = [i for i, plane in enumerate(planes) if max(distance(p, plane) for p in face) < 0]
        separators.append(separating)
        clipped = face
        for plane in planes:
            clipped = clip_face(clipped, plane)
        clipped_area = area(clipped)
        total_area += clipped_area
        boundary_planes.append([i for i, plane in enumerate(planes)
                                if clipped and max(abs(distance(p, plane)) for p in clipped) <= boundary_tolerance])
    if all(separators):
        relation = 'outside'
    elif total_area > 0:
        relation = 'boundary' if all(separators[i] or boundary_planes[i] for i in range(len(faces))) else 'intersects'
    else:
        relation = 'uncertain'
    return dict(relation=relation, clipped_area=total_area,
                separating_planes=separators, boundary_planes=boundary_planes)


def retained_portal_certificate(data, brush, planes, owned, tolerance=.01):
    """Certify a source portal belongs wholly to an unchanged ancestor plane.

    This certificate is useful only with the existing invariant that *all*
    outside compiled polygons survive unchanged. It never certifies a portal
    which has even one node in the replaced subtree.
    """
    points = brush.get('points', [])
    if not points or any(not math.isfinite(x) for p in points for x in p):
        return dict(safe=False, reason='missing or invalid source geometry')
    candidates = [i for i, plane in enumerate(planes)
                  if max(abs(distance(p, plane)) for p in points) <= tolerance]
    nodes = [(i, node) for i, node in data['nodes'].items() if node['actor'] == brush['name']]
    if not candidates or not nodes:
        return dict(safe=False, reason='portal is not a compiled boundary sheet')
    if any(i in owned for i, _ in nodes):
        return dict(safe=False, reason='portal has a node in the changed subtree')
    for plane_index in candidates:
        plane = planes[plane_index]
        valid = True
        for i, _ in nodes:
            poly = data['polys'][i]
            compiled = [tuple(map(float, poly[7+j*3:10+j*3])) for j in range(int(poly[6]))]
            if len(compiled) < 3 or max(abs(distance(p, plane)) for p in compiled) > tolerance:
                valid = False
                break
        if valid:
            return dict(safe=True, plane=plane_index, retained_nodes=[i for i, _ in nodes],
                        source_max_deviation=max(abs(distance(p, plane)) for p in points))
    return dict(safe=False, reason='source and compiled portal planes differ')


def audit(run, epsilon):
    import local_geometry as geometry
    run = Path(run)
    data = geometry.base.tree(run/'Output/before.tree')
    old, outside = read_sources(run/'Output/before.sources')
    new, _ = read_sources(run/'Output/edited.sources')
    report = json.loads((run/'report.json').read_text())
    # Plan discovery only: strip portal flags in private dictionaries so that
    # all portal intersections can be inspected, including the refused ones.
    neutral_data, neutral_new = copy.deepcopy(data), copy.deepcopy(new)
    for surface in neutral_data['surfs'].values():
        surface[2] = str(int(surface[2]) & ~PORTAL)
    for brush in neutral_new.values():
        brush['flags'] &= ~PORTAL
    saved = geometry.EPS
    try:
        geometry.EPS = epsilon
        plan = geometry.plan(neutral_data, old, neutral_new, set(report['changes']), outside)
    finally:
        geometry.EPS = saved
    rows = []
    for name, brush in new.items():
        if not brush['flags'] & PORTAL:
            continue
        points = brush['points']
        corners = list(itertools.product(*zip([min(p[k] for p in points) for k in range(3)],
                                             [max(p[k] for p in points) for k in range(3)])))
        broad = not any(max(distance(p, plane) for p in corners) <= epsilon for plane in plan['planes'])
        owned = [i for i in plan['old_nodes'] if data['nodes'][i]['actor'] == name]
        relation = portal_relation(brush['faces'], plan['planes'])
        if broad or owned or relation['relation'] != 'outside':
            certificate = retained_portal_certificate(data, brush, plan['planes'], set(plan['old_nodes']))
            rows.append(dict(name=name, broad_phase=broad, owned_nodes=owned,
                             retained_boundary=certificate, **relation))
    zones = {}
    for name in ('before', 'after', 'full-reference'):
        path = run/'Output'/f'{name}.tree'
        if path.exists():
            tree = geometry.base.tree(path)
            zones[name] = tree['zones']
    return dict(run=str(run), epsilon=epsilon, root=plan['root'],
                changed_nodes=len(plan['old_nodes']), portals=rows, zones=zones)


def tests():
    assert portal_relation([[(-2, 0, 0), (-1, 0, 0), (-1, 1, 0)]], [(1, 0, 0, 0)])['relation'] == 'outside'
    assert portal_relation([[(-1, 0, 0), (1, 0, 0), (1, 1, 0)]], [(1, 0, 0, 0)])['relation'] == 'intersects'
    assert portal_relation([[(0, 0, 0), (0, 1, 0), (0, 1, 1)]], [(1, 0, 0, 0)])['relation'] == 'boundary'
    # AABB overlaps this diagonal plane, while every triangle vertex is outside.
    triangle = [[(-2, 0, 0), (0, -2, 0), (-2, -2, 0)]]
    assert portal_relation(triangle, [(1, 1, 0, -1)])['relation'] == 'outside'
    # A tiny crossing is never outside. It can be diagnosed as boundary drift,
    # but that alone does not authorize skipping it.
    assert portal_relation([[(-1, 0, 0), (1e-10, 0, 0), (1e-10, 1, 0)]], [(1, 0, 0, 0)])['relation'] != 'outside'
    face = [(0, 0, 0), (0, 1, 0), (0, 1, 1)]
    brush = dict(name='Portal', points=face)
    tree = dict(nodes={0:dict(actor='Portal')}, polys=[['0', '1', '0', '0', '0', '0', '3']+[str(x) for p in face for x in p]])
    assert retained_portal_certificate(tree, brush, [(1, 0, 0, 0)], set())['safe']
    assert not retained_portal_certificate(tree, brush, [(1, 0, 0, 0)], {0})['safe']
    assert not retained_portal_certificate(tree, brush, [(1, 0, 0, 1)], set())['safe']
    # Regression evidence from a real original-map run, without loading/saving
    # the engine or changing any file. Fail rather than silently skip if missing.
    fixture = json.loads((Path(__file__).parent/'fixtures/retained-portal.json').read_text())
    actual = {name:{int(i):value for i, value in fixture[name].items()} for name in ('nodes', 'polys')}
    cert = retained_portal_certificate(actual, fixture['brush'], fixture['planes'], set(fixture['old_nodes']))
    assert cert['safe'] and cert['retained_nodes'] == [7930] and cert['plane'] == 5
    assert not retained_portal_certificate(actual, fixture['brush'], fixture['planes'], {7930})['safe']
    print('portal diagnostics: 10 tests passed')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('run', nargs='?')
    parser.add_argument('--epsilon', type=float, default=.01)
    args = parser.parse_args()
    if args.run:
        print(json.dumps(audit(args.run, args.epsilon), indent=2))
    else:
        tests()
