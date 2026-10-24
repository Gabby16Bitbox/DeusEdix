"""Light and visibility caches across one regional graft: the separate certificate the convex region proof leaves
to them (ordered_convex_csg.validate_world checks only their shape).

The graft never relights. It keeps every cache of the retained world, gives the rebuilt surfaces no lightmap and
appends the replacement leaves' light lists after the world's (source/region_bsp.h). This proves exactly that, from
the native dumps and the two saved packages, so a lit map needs no Full and the result still says lighting='stale':
- every surface's lightmap index is none (-1) or a stored LightMap, in both maps, and the saved bindings are the
  dumped ones;
- a rebuilt node's surface has no lightmap; a retained node keeps its surface's lightmap, or has none when that
  surface also carries rebuilt geometry;
- the original Lights array is the start of the new one, actor for actor (export numbers change with a save);
- every leaf list (iPermeating, iVolumetric) starts inside Lights and ends with its None before the array does, and
  names only actors the original lists name;
- every leaf sees all zones (validate_world): the zone visibility the graft copies is the trivial one.
The stored LightMap records and LightBits themselves are compared by the controller (selected_rebuild.baked).
Retained leaves are the same leaves: certify_scope compares the retained terminals.
"""
import convex_cells as c

Refused = c.Refused
ALL_ZONES = 2**64-1


def _actors(model):
    """Model.lights as (name, class) per entry, None for the list terminator; imports are refused."""
    out = []
    for ref in model.lights:
        if ref == 0:
            out.append(None)
        elif 0 < ref <= len(model.p.exports):
            e = model.p.exports[ref-1]
            out.append((e['name'], model.p.classname(e)))
        else:
            raise Refused('A light list names an object outside the map')
    return out


def _lists(data, actors, known):
    """Every leaf list starts in Lights and is terminated before its end; -> leaves checked."""
    for i, leaf in data['leaves'].items():
        if leaf['visible'] != ALL_ZONES:
            raise Refused('Leaf zone visibility requires a separate certificate')
        for key in ('permeating', 'volumetric'):
            start = leaf[key]
            if type(start) is not int or start < -1 or start >= len(actors):
                raise Refused('Leaf light list outside Lights')
            if start == -1:
                continue
            at = start
            while at < len(actors) and actors[at] is not None:
                if known is not None and actors[at] not in known:
                    raise Refused('A rebuilt leaf names a light the original lists never did')
                at += 1
            if at == len(actors):
                raise Refused('Unterminated leaf light list')
    return len(data['leaves'])


def _lightmaps(data, model, label):
    stored = len(model.lightmaps)
    if set(data['surfs']) != set(range(len(data['surfs']))):
        raise Refused('Incomplete native surface inventory (%s)' % label)
    if any(type(s['lightmap']) is not int or not -1 <= s['lightmap'] < stored for s in data['surfs'].values()):
        raise Refused('Surface lightmap outside the stored LightMap records (%s)' % label)
    bindings = [s['iLightMap'] for s in model.surfs]
    if bindings != [data['surfs'][i]['lightmap'] for i in range(len(data['surfs']))]:
        raise Refused('Saved lightmap bindings differ from the native dump (%s)' % label)


def certify_caches(before, after, scope, source_model, candidate_model):
    """before/after: native certificate data; scope: certify_scope's result; *_model: lightbits.Model of the
    original map and of the saved candidate."""
    _lightmaps(before, source_model, 'original')
    _lightmaps(after, candidate_model, 'result')
    owned = set(scope['after_owned'])
    rebuilt_surfs = {after['nodes'][j]['surf'] for j in owned}
    if any(after['surfs'][s]['lightmap'] != -1 for s in rebuilt_surfs):
        raise Refused('Rebuilt geometry kept a previous lightmap')
    kept = invalidated = 0
    for i, j in scope['outside_map'].items():
        old = before['surfs'][before['nodes'][i]['surf']]['lightmap']
        new_surf = after['nodes'][j]['surf']
        new = after['surfs'][new_surf]['lightmap']
        if new == old:
            kept += 1
        elif new == -1 and new_surf in rebuilt_surfs:
            invalidated += 1
        else:
            raise Refused('A retained surface changed lightmap')
    original, result = _actors(source_model), _actors(candidate_model)
    if result[:len(original)] != original:
        raise Refused('The original light lists were not kept')
    named = {a for a in original if a is not None}
    _lists(before, original, None)
    _lists(after, result, named)
    return dict(status='pass', certificate='retained_light_caches_rebuilt_unlit_terminated_lists',
                retained_nodes_lightmap_kept=kept, retained_nodes_lightmap_invalidated=invalidated,
                rebuilt_surfaces_without_lightmap=len(rebuilt_surfs), original_lights=len(original),
                appended_lights=len(result)-len(original), leaves=len(after['leaves']), lighting='stale')
