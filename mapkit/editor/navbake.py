"""The walkable area in the game (navmesh phase 3, Gabby 17 Oct 2026): the navigation mesh the editor makes with
Recast (static/navmesh.js, View > Walkable area) goes into the map as a UCNavMesh actor of the mod, so that the
game's scripts find their way on it (src/UnatcoContinues/Classes/UCNavMesh.uc, UCNavRoute.uc): characters sent
somewhere "on the walkable area" walk the way a man would, without path nodes.

The editor's page makes the polygons (navmesh.js bakePolys) just before a Rebuild, when needed() says the map
uses them, and saves them in the edits:

edits['navmesh'] = {'v': 1, 'key': '<the geometry they were made from>', 'polys': ['nv x y z ... n ...', ...]}

each polygon its nv corners (Unreal units, on the floor) and, for each edge, the polygon across it or -1. In the
map they are UCNavMesh's arrays of numbers (fields()): Sides(p), CornerX/Y/Z(p * 6 + k), Across(p * 6 + k).
Only maps that use it get it: characters sent with Walk / Run to a place "on the walkable area" (Interactions,
or a Story action), or Map settings > "Walkable area in the game" (for Tools > Scripts).
"""
import re

MAX_POLYS = 2048                  # UCNavMesh.Sides[2048]
CORNERS = 6                       # the most corners a polygon has: polygon p's start at p * CORNERS
_POLY = re.compile(r'^-?\d+( -?\d+)*$')


def _nav_act(a):
    return isinstance(a, dict) and bool(a.get('nav')) and (a.get('verb') in ('goto', 'run') or a.get('act') in ('goto', 'run'))


def _walk(value):
    """Every dict inside a story (events, dialogues, their steps and actions)."""
    if isinstance(value, dict):
        yield value
        for v in value.values():
            yield from _walk(v)
    elif isinstance(value, list):
        for v in value:
            yield from _walk(v)


def needed(edits, map_name):
    """Does the map use the walkable area in the game?"""
    if (edits.get('level') or {}).get('navmesh'):
        return True
    for link in edits.get('links') or []:
        if any(_nav_act(a) for a in link.get('do') or []):
            return True
    try:
        import story
        tale = story.load(map_name)
    except (ImportError, ValueError, OSError):
        return False
    return any(d.get('type') == 'npc' and _nav_act(d) for d in _walk(tale))


def polys(edits):
    """The baked polygons, checked (only digits, signs and spaces)."""
    nav = edits.get('navmesh') or {}
    out = [str(p) for p in nav.get('polys') or [] if _POLY.match(str(p))]
    return out[:MAX_POLYS]


def fields(ps):
    """The polygons as UCNavMesh's properties: Sides(p) the number of corners (3 to 6), corner k at
    CornerX/Y/Z(p * 6 + k) and Across(p * 6 + k) the polygon across its edge from corner k to k + 1 (-1: none). A
    polygon of another shape keeps its place with Sides 0 (the game leaves it out; the others' numbers stay right)."""
    props = {}
    for p, text in enumerate(ps):
        nums = [int(v) for v in text.split()]
        n = nums[0]
        if not 3 <= n <= CORNERS or len(nums) != 1 + 4 * n:
            props['Sides(%d)' % p] = '0'
            continue
        props['Sides(%d)' % p] = str(n)
        for k in range(n):
            at = p * CORNERS + k
            props['CornerX(%d)' % at], props['CornerY(%d)' % at], props['CornerZ(%d)' % at] = \
                (str(v) for v in nums[1 + 3 * k:4 + 3 * k])
            props['Across(%d)' % at] = str(nums[1 + 3 * n + k])
    return props


def blocks(edits, map_name):
    """The UCNavMesh actor of the map ([] when it does not use the walkable area or it was not baked yet)."""
    if not needed(edits, map_name):
        return []
    ps = polys(edits)
    if not ps:
        return []
    first = [int(v) for v in ps[0].split()]
    loc = [first[1], first[2], first[3] + 64]           # over its first polygon (an Info: it is not seen)
    props = dict({'NumPolys': str(len(ps))}, **fields(ps))
    return [dict(cls='UCNavMesh', name='UCNavMesh0', loc=loc, props=props)]


def report(edits, map_name):
    if not needed(edits, map_name):
        return []
    ps = polys(edits)
    if not ps:
        return ['  WARNING the map sends characters on the walkable area, but it has not been made yet: '
                'they take the AI paths (rebuild from the editor, which makes it)']
    return ['  EDIT walkable area in the game: %d polygons (UCNavMesh)' % len(ps)]
