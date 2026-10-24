"""Independent exact source / BSP proof for isolated convex solids and rooms.

This generalizes the box proof to coherent oblique source planes.  It never
builds or reads Full.  Every accepted compiled face is a complete authored
convex face with identical affine UVs.  Source brushes are ordinary, closed,
strictly isolated convex polyhedra.  Touching / intersecting CSG is refused.

Routing is proved over ALL signs, including exact plane boundaries.  A reduced
ternary decision diagram compares source CSG and BSP ChildOutside.  Differences
are rejected unless exact strict Fourier--Motzkin elimination proves that sign
cell empty.  This is not ray sampling and retains lower-dimensional strata.
Native PointRegion sign infeasibility uses an explicit x87 error bound, subject
to a separately verified engine / FP profile. Collision hulls remain a separate
required certificate. A return never authorizes publication.
"""
from collections import Counter
from fractions import Fraction as F
from functools import lru_cache
from itertools import combinations, product
import convex_cells as c
import certificate_evidence as evidence

Refused = c.Refused
X87_U = F(1, 2**24)
X87_GAMMA6 = 6*X87_U/(1-6*X87_U)
ENGINE_SHA256 = 'd66b689bbe95d7350b9f348da2273383c642e22e53dd56bd1bcf76ec322aa848'


def verify_profile(profile):
    """Caller obtains the two CW readings and Engine digest in the same session."""
    if not isinstance(profile, dict) or profile.get('engine_sha256') != ENGINE_SHA256:
        raise Refused('PointRegion engine implementation is not pinned')
    before, after = profile.get('control_word_before'), profile.get('control_word_after')
    if type(before) is not int or type(after) is not int or before != after or not 0 <= before <= 65535:
        raise Refused('Missing or changed x87 control word evidence')
    if (before & 0x0c00) or (before & 0x0300) not in (0, 0x0200, 0x0300) or (before & 0x003f) != 0x003f:
        raise Refused('Unsupported x87 rounding or precision control')
    return dict(status='pass', engine_sha256=ENGINE_SHA256, control_word=before,
                rounding='nearest', bound='gamma6 at PC24, extended exponent',
                domain='all finite FLOAT coordinates; no world-AABB query restriction')


@lru_cache(maxsize=20000)
def _native_sign_feasible(planes, signs):
    """Conservative feasibility of x87 PlaneDot signs for ALL finite FLOAT xyz.

    Native PointRegion evaluates Nz*z + Ny*y + Nx*x - W directly in x87,
    with three multiplies, two additions and a subtraction; no FLOAT store.
    Even PC24 retains the x87 extended exponent.  FLOAT inputs/products cannot
    underflow/overflow its exponent: min nonzero product >=2^-298, max <2^256.
    gamma6 with PC24 is conservative also for PC53/64.  Sign uncertainty is
    |error| <= gamma6*(sum |Ni*Xi|+|W|).  Eight octants make this linear; we
    prove emptiness of the relaxed CLOSED halfspaces, never pick a tolerance.
    Axis-unit x-W signs are exact (Sterbenz near W, dominant operand elsewhere).
    This is a PointRegion sign proof; native traces and hulls are separate.
    """
    for octant in product((-1, 1), repeat=3):
        rows = []
        for axis, sign in enumerate(octant):
            n = [F(0)]*3
            n[axis] = -sign
            rows.append(tuple(n)+(F(0), False))
        for index, sign in signs:
            p = planes[index]
            nonzero = [v for v in p[:3] if v]
            exact = len(nonzero) == 1 and abs(nonzero[0]) == 1
            e = (F(0),)*3 if exact else tuple(X87_GAMMA6*abs(p[k])*octant[k] for k in range(3))
            ew = F(0) if exact else X87_GAMMA6*abs(p[3])
            if sign <= 0:
                rows.append(tuple(p[k]-e[k] for k in range(3))+(p[3]+ew, exact and sign < 0))
            if sign >= 0:
                rows.append(tuple(-p[k]-e[k] for k in range(3))+(-p[3]+ew, exact and sign > 0))
        if _strict_feasible(rows):
            return True
    return False


def _strict_feasible(rows, limit=20000):
    """Rows are (a..., bound, strict), i.e. a.x <(=) bound; no epsilon."""
    rows = [(tuple(c.q(v) for v in r[:-1]), bool(r[-1])) for r in rows]
    dimensions = len(rows[0][0])-1 if rows else 3
    for count in range(dimensions, -1, -1):
        unique = {}
        for r, strict in rows:
            if not any(r[:-1]):
                if r[-1] < 0 or r[-1] == 0 and strict:
                    return False
                continue
            pivot = abs(next(v for v in r[:-1] if v))
            key = tuple(v/pivot for v in r)
            unique[key] = unique.get(key, False) or strict
        rows = list(unique.items())
        if not rows or count == 0:
            return True
        axis = min(range(count), key=lambda k:
                   sum(r[k] > 0 for r, s in rows)*sum(r[k] < 0 for r, s in rows))
        plus = [(r, s) for r, s in rows if r[axis] > 0]
        minus = [(r, s) for r, s in rows if r[axis] < 0]
        new = [(r[:axis]+r[axis+1:], s) for r, s in rows if r[axis] == 0]
        if len(plus)*len(minus)+len(new) > limit:
            raise Refused('Strict feasibility complexity budget exceeded')
        for a, sa in plus:
            for b, sb in minus:
                row = tuple(c.q(a[k]/a[axis]-b[k]/b[axis])
                            for k in range(count+1) if k != axis)
                new.append((row, sa or sb))
        rows = new
    raise AssertionError('unreachable')


def _canonical(p):
    p = c.plane(p)
    # Only sign reversal, not proportional normalization: retain native raw
    # coefficient identity.  Rounding of differently scaled planes is distinct.
    sign = 1 if next(v for v in p[:3] if v) > 0 else -1
    return tuple(sign*v for v in p), sign


class DD:
    """Reduced ordered ternary decision diagrams; variables are exact planes."""

    def __init__(self, planes, budget=200000):
        self.planes = tuple(sorted({_canonical(p)[0] for p in planes}))
        self.index = {p:i for i, p in enumerate(self.planes)}
        self.nodes = {0:None, 1:None}
        self.unique = {}
        self.budget = budget
        self.cache = {}

    def node(self, var, branches):
        branches = tuple(branches)
        if len(set(branches)) == 1:
            return branches[0]
        key = (var, branches)
        if key not in self.unique:
            if len(self.nodes) >= self.budget:
                raise Refused('Decision diagram complexity budget exceeded')
            i = len(self.nodes)
            self.unique[key] = i
            self.nodes[i] = key
        return self.unique[key]

    def literal(self, plane, signs):
        p, orientation = _canonical(plane)
        return self.node(self.index[p], tuple(int(orientation*s in signs) for s in (-1, 0, 1)))

    def apply(self, op, a, b):
        if a > b:
            a, b = b, a
        key = op, a, b
        if key in self.cache:
            return self.cache[key]
        if a < 2 and b < 2:
            answer = int((bool(a) and bool(b)) if op == 'and' else
                         (bool(a) or bool(b)) if op == 'or' else bool(a) != bool(b))
        else:
            va = self.nodes[a][0] if a >= 2 else len(self.planes)
            vb = self.nodes[b][0] if b >= 2 else len(self.planes)
            var = min(va, vb)
            aa = self.nodes[a][1] if va == var else (a,)*3
            bb = self.nodes[b][1] if vb == var else (b,)*3
            answer = self.node(var, [self.apply(op, x, y) for x, y in zip(aa, bb)])
        self.cache[key] = answer
        return answer

    def all(self, terms):
        answer = 1
        for term in terms:
            answer = self.apply('and', answer, term)
        return answer

    def any(self, terms):
        answer = 0
        for term in terms:
            answer = self.apply('or', answer, term)
        return answer

    def negate(self, value):
        return self.apply('xor', value, 1)

    def select(self, plane, back, front, ties_front):
        f = self.literal(plane, {0, 1} if ties_front else {1})
        return self.apply('or', self.apply('and', f, front),
                          self.apply('and', self.negate(f), back))

    def equal(self, left, right, max_cells=100000, native_robust=True):
        diff = self.apply('xor', left, right)
        if diff == 0:
            return dict(symbolic_identity=True, cells=0, impossible_cells=0)
        visited = 0
        impossible = 0
        stack = [(diff, (), ())]
        while stack:
            index, rows, path = stack.pop()
            visited += 1
            if visited > max_cells:
                raise Refused('Stratified routing proof budget exceeded')
            if not _strict_feasible(rows) and (not native_robust or not _native_sign_feasible(self.planes, path)):
                impossible += 1
                continue
            if index == 1:
                error = Refused('Source/BSP disagreement not excluded for native plane signs')
                error.witness = {'plane_signs':[(list(map(str, self.planes[i])), s) for i, s in path]}
                raise error
            if index == 0:
                continue
            var, children = self.nodes[index]
            plane = self.planes[var]
            for sign, child in zip((-1, 0, 1), children):
                if child == 0:
                    continue
                constraints = ((plane+(True,)),) if sign < 0 else (
                    (tuple(-v for v in plane)+(True,)),) if sign > 0 else (
                    plane+(False,), tuple(-v for v in plane)+(False,))
                stack.append((child, rows+constraints, path+((var, sign),)))
        return dict(symbolic_identity=False, cells=visited, impossible_cells=impossible,
                    native_sign_infeasibility='x87_PC24_gamma6_all_finite_FLOAT_inputs' if native_robust else None)


def _ring(points, plane):
    points = tuple(c.point(v) for v in points)
    plane = c.plane(plane)
    if not 3 <= len(points) <= 24 or len(set(points)) != len(points):
        raise Refused('Degenerate or repeated convex face corner')
    if any(c.distance(v, plane) for v in points):
        raise Refused('Source or compiled face is not exactly planar')
    for a, b in zip(points, points[1:]+points[:1]):
        side = [c.dot(c.cross(c.sub(b, a), c.sub(v, a)), plane[:3]) for v in points]
        if min(side) < 0 or max(side) <= 0:
            raise Refused('Face is nonconvex, self-intersecting or wrongly wound')
    return points


def _sources(data):
    if data.get('root_outside') != 0 or not 2 <= len(data.get('brushes', [])) <= 24:
        raise Refused('Unsupported world root or source inventory')
    brushes = {}
    prior = -1
    for b in data['brushes']:
        if b['order'] <= prior or b['name'] in brushes or not 4 <= len(b['faces']) <= 32:
            raise Refused('Source order, identity or face count invalid')
        prior = b['order']
        evidence.source_convex_brush(b)
        for index, face in enumerate(b['faces']):
            if face['index'] != index or face['link'] != index or face['normal'] != face['plane'][:3]:
                raise Refused('Source face links/normal unsupported')
            _ring(face['points'], face['plane'])
        pp = tuple(dict.fromkeys(v for f in b['faces'] for v in f['points']))
        if any(abs(x) > 16384 for v in pp for x in v):
            raise Refused('Source exceeds supported native world extent')
        brushes[b['name']] = dict(source=b, points=pp, planes=tuple(f['plane'] for f in b['faces']))
    rooms = {n:b for n, b in brushes.items() if b['source']['operation'] == 2}
    solids = {n:b for n, b in brushes.items() if b['source']['operation'] == 1}
    if not rooms or not solids:
        raise Refused('Expected subtractive room and isolated additive convex solid')
    for items in (list(rooms.values()), list(solids.values())):
        for a, b in combinations(items, 2):
            if c.halfspace_feasible(a['planes']+b['planes']):
                raise Refused('Rooms or solid source volumes touch/intersect')
    for b in solids.values():
        contained = []
        for name, r in rooms.items():
            # At least one world unit from every supporting room plane.  This
            # is an explicit eligibility gap, not a tolerance in comparisons.
            if all(c.distance(v, p) < 0 and c.distance(v, p)**2 >= c.dot(p[:3], p[:3])
                   for v in b['points'] for p in r['planes']):
                contained.append(name)
        if len(contained) != 1:
            raise Refused('Solid is not strictly isolated inside one room')
        b['room'] = contained[0]
        if rooms[b['room']]['source']['order'] >= b['source']['order']:
            raise Refused('Containing subtraction follows its solid')
    return brushes, rooms, solids


def _uv(s):
    return (s['texture'], s['flags'], s['u'], s['v'],
            F(s['pan'][0])-c.dot(s['u'], s['base']), F(s['pan'][1])-c.dot(s['v'], s['base']))


def _native_coordinates(data):
    vectors = []
    for n in data['nodes'].values():
        vectors.extend([n['plane'], *n['points']])
    for b in data['brushes']:
        for f in b['faces']:
            vectors.extend([f['plane'], f['base'], f['normal'], f['u'], f['v'], *f['points']])
    for s in data['surfs'].values():
        vectors.extend([s['base'], s['normal'], s['u'], s['v']])
    for vec in vectors:
        for x in vec:
            if not isinstance(x, F) or c.native_float(x) != x:
                raise Refused('Evidence is not reconstructed exact finite native FLOAT')


def _model(data):
    nodes = data['nodes']
    if not nodes or len(nodes) > 1024 or set(nodes) != set(range(len(nodes))):
        raise Refused('Invalid complete node inventory')
    for n in nodes.values():
        c.plane(n['plane'])
        if n['flags'] != 0 or not 3 <= n['vertices'] <= 24 or len(n['points']) != n['vertices']:
            raise Refused('Unsupported native CSG node flags/vertices')
        if len(n['children']) != 3 or n['children'][2] != -1:
            raise Refused('Coplanar chains require separate proof')
        if len(n['zones']) != 2 or any(type(v) is not int or not 0 <= v < 64 for v in n['zones']):
            raise Refused('Malformed native node zones')
    visited = set()
    stack = [(0, False, ())]
    terminals = []
    while stack:
        i, out, path = stack.pop()
        if i not in nodes or i in visited:
            raise Refused('Cyclic, shared or invalid BSP routing link')
        visited.add(i)
        n = nodes[i]
        for side in (0, 1):
            after = True if side == 0 else False  # every eligible node IsCsg
            new_path = path+((i, side),)
            child = n['children'][side]
            if child == -1:
                terminals.append(dict(node=i, side=side, path=new_path, outside=after,
                    zone=n['zones'][1-side], leaf=n['leaves'][1-side],
                    planes=tuple(tuple(-v for v in nodes[j]['plane']) if s == 0 else nodes[j]['plane']
                                 for j, s in new_path)))
            else:
                stack.append((child, after, new_path))
    if visited != set(nodes):
        raise Refused('Unreachable native nodes')
    return terminals


def validate_world(data):
    """Necessary exact surface/source/routing/zone proof, never publication."""
    _native_coordinates(data)
    brushes, rooms, solids = _sources(data)
    terminals = _model(data)
    if any(s['lightmap'] != -1 for s in data['surfs'].values()):
        raise Refused('Precomputed lightmap caches require a separate certificate')
    if any(l['permeating'] != -1 or l['volumetric'] != -1 or l['visible'] != 2**64-1
           for l in data['leaves'].values()):
        raise Refused('Nontrivial lighting/visibility leaf caches unsupported')
    counts = Counter()
    room_zones = {}
    for n in data['nodes'].values():
        s = data['surfs'][n['surf']]
        if s['actor'] not in brushes:
            raise Refused('Unknown compiled source owner')
        b = brushes[s['actor']]['source']
        if type(s['face']) is not int or not 0 <= s['face'] < len(b['faces']):
            raise Refused('Invalid compiled source face')
        f = b['faces'][s['face']]
        expected = f['plane'] if b['operation'] == 1 else tuple(-v for v in f['plane'])
        if n['plane'] != expected or s['normal'] != expected[:3]:
            raise Refused('Compiled plane or surface normal differs from source')
        _ring(n['points'], expected)
        if set(n['points']) != set(f['points']):
            raise Refused('Compiled face not the whole exact authored face')
        if _uv(s) != _uv(f):
            raise Refused('Material/affine UV differs from source')
        counts[s['actor'], s['face']] += 1
        if b['operation'] == 2:
            z = n['zones']
            if z[0] != 0 or z[1] <= 0 or room_zones.get(s['actor'], z[1]) != z[1]:
                raise Refused('Inconsistent room surface zone labels')
            room_zones[s['actor']] = z[1]
    expected = Counter((name, k) for name, b in brushes.items() for k in range(len(b['source']['faces'])))
    if counts != expected:
        raise Refused('Missing, duplicate or extra authored compiled face')
    if set(room_zones) != set(rooms) or len(set(room_zones.values())) != len(rooms):
        raise Refused('Rooms do not have distinct complete zone labels')
    if set(data['zones']) != {0, *room_zones.values()} or any(
        z['actor'] != 'None' or z['cls'] != 'None' or z['connectivity'] != 1<<index or z['visibility'] != 2**64-1
        for index, z in data['zones'].items()):
        raise Refused('Custom zone actors, portal connectivity or visibility cache unsupported')
    if any(l['zone'] not in room_zones.values() for l in data['leaves'].values()):
        raise Refused('Unassigned native leaf zone')
    planes = [p for b in brushes.values() for p in b['planes']]
    dd = DD(planes+[n['plane'] for n in data['nodes'].values()])
    comparisons = []
    for tie in (False, True):
        room_in = {name:dd.all(dd.literal(p, {-1, 0} if tie else {-1}) for p in b['planes'])
                   for name, b in rooms.items()}
        solid_in = dd.any(dd.all(dd.literal(p, {-1} if tie else {-1, 0}) for p in b['planes'])
                          for b in solids.values())
        expected_z = {room_zones[name]:dd.apply('and', inside, dd.negate(solid_in))
                      for name, inside in room_in.items()}
        expected_z[0] = dd.negate(dd.any(expected_z.values()))
        for zone, wanted in expected_z.items():
            @lru_cache(None)
            def build(i):
                n = data['nodes'][i]
                branches = []
                for side in (0, 1):
                    child = n['children'][side]
                    branches.append(build(child) if child >= 0 else int(n['zones'][1-side] == zone))
                return dd.select(n['plane'], branches[1], branches[0], tie)
            result = dd.equal(wanted, build(0))
            comparisons.append(dict(zone=zone, ties_front=tie, **result))
        # Zone zero is tied to solid classification, not just a cosmetic label.
        @lru_cache(None)
        def solid(i):
            n = data['nodes'][i]
            values = [solid(n['children'][side]) if n['children'][side] >= 0 else side
                      for side in (0, 1)]
            return dd.select(n['plane'], values[1], values[0], tie)
        comparisons.append(dict(solid_classification=True, ties_front=tie,
                                **dd.equal(expected_z[0], solid(0))))
    # Complete descendant masks/bounds and leaf labels, no sampled visibility.
    order = []
    stack = [0]
    while stack:
        i = stack.pop()
        order.append(i)
        stack.extend(j for j in data['nodes'][i]['children'] if j >= 0)
    masks = {}
    points = {}
    for i in reversed(order):
        n = data['nodes'][i]
        s = data['surfs'][n['surf']]
        b = brushes[s['actor']]
        room = s['actor'] if b['source']['operation'] == 2 else b['room']
        if n['zones'] != [0, room_zones[room]]:
            raise Refused('Physical source side zone differs')
        for side, leaf in enumerate(n['leaves']):
            if leaf != -1 and (leaf not in data['leaves'] or data['leaves'][leaf]['zone'] != n['zones'][side]):
                raise Refused('Native leaf zone disagrees')
        mask = 1<<room_zones[room]
        vv = list(n['points'])
        for child in n['children']:
            if child >= 0:
                mask |= masks[child]
                vv += points[child]
        masks[i] = mask
        points[i] = vv
        if n['zone_mask'] != mask:
            raise Refused('Incorrect descendant ZoneMask')
        bound = n['render_bound']
        if bound != -1:
            bnd = data['bounds'].get(bound)
            if not bnd or bnd['valid'] != 1 or any(not bnd['low'][k] <= v[k] <= bnd['high'][k] for v in vv for k in range(3)):
                raise Refused('Native render bound excludes geometry')
    return dict(status='pass', certificate='exact_isolated_convex_source_surface_all_strata_routing',
        brushes=len(brushes), nodes=len(data['nodes']), source_faces=sum(counts.values()),
        oblique_planes=sum(sum(v != 0 for v in p[:3]) > 1 for p in dd.planes),
        source_csg='exact closed convex ordinary isolated brushes; all authored faces complete',
        comparisons=comparisons, diagram_nodes=len(dd.nodes), terminals=terminals,
        room_zones=room_zones, native_collision='requires independent hull/routing certificate',
        native_rounding='PointRegion x87 gamma6 PC24 bound for all finite FLOAT xyz; traces require separate gate',
        required_profile=dict(engine_sha256=ENGINE_SHA256, rounding='nearest', exceptions='masked',
                              precision_bits=[24, 53, 64], profile_required_separately=True),
        full_reference_used=False, full_removable=False, publication_authorized=False)
