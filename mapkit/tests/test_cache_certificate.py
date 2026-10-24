"""Local geometry's Convex CSG on lit maps (24 Oct 2026). Its proof refused every map the editor builds: all of them
carry leaf light lists (iPermeating), lit ones lightmaps too, and a map the light build drew keeps the renderer's
occlusion marks on its nodes. cache_certificate.py now proves what the regional graft does with the caches, and the
marks (convex_cells.RENDER_MARKS) are not geometry."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

KIT = Path(__file__).resolve().parents[1]
sys.path.append(str(KIT / 'experimental_bsp'))      # last: its modules never hide the kit's own
import cache_certificate as cc  # noqa: E402
import convex_cells  # noqa: E402

ALL = 2**64-1


class Pkg:
    def __init__(self, exports):
        self.exports = [dict(name=n, cls=k) for n, k in exports]

    def classname(self, e):
        return e['cls']


def model(lights, exports, lightmaps, bindings):
    return SimpleNamespace(lights=lights, p=Pkg(exports), lightmaps=[{}] * lightmaps,
                           surfs=[dict(iLightMap=b) for b in bindings])


def data(surfs, nodes, leaves):
    return dict(surfs={i: dict(lightmap=lm) for i, lm in enumerate(surfs)},
                nodes={i: dict(surf=s) for i, s in enumerate(nodes)},
                leaves={i: dict(zone=1, permeating=p, volumetric=-1, visible=ALL) for i, p in enumerate(leaves)})


class CacheCertificate(unittest.TestCase):
    def setUp(self):
        # before: 3 surfaces with lightmaps 0..2, nodes 0..2; node 2 is the rebuilt region
        self.before = data([0, 1, 2], [0, 1, 2], [0, 3])
        # after: node 2 replaced by nodes 3, 4 on surface 1 (shared with retained node 1) and a new surface 3
        self.after = data([0, -1, 2, -1], [0, 1, 2, 1, 3], [0, 3, 5])
        exports = [('Light0', 'Light'), ('Light1', 'Light'), ('Lamp0', 'Lamp')]
        self.source = model([1, 2, 0, 3, 0], exports, 3, [0, 1, 2])
        # a save renumbers exports: the same actors under other numbers, then the appended list
        reordered = [exports[2], exports[0], exports[1]]
        self.candidate = model([2, 3, 0, 1, 0, 3, 0], reordered, 3, [0, -1, 2, -1])
        self.scope = dict(outside_map={0: 0, 1: 1}, after_owned=[3, 4])

    def certify(self):
        return cc.certify_caches(self.before, self.after, self.scope, self.source, self.candidate)

    def test_the_graft_shape_passes(self):
        r = self.certify()
        self.assertEqual(r['status'], 'pass')
        self.assertEqual((r['retained_nodes_lightmap_kept'], r['retained_nodes_lightmap_invalidated']), (1, 1))
        self.assertEqual(r['appended_lights'], 2)

    def test_rebuilt_geometry_with_a_lightmap_is_refused(self):
        self.after['surfs'][3]['lightmap'] = 1
        self.candidate.surfs[3]['iLightMap'] = 1
        with self.assertRaisesRegex(cc.Refused, 'kept a previous lightmap'):
            self.certify()

    def test_a_retained_surface_cannot_lose_or_change_its_lightmap(self):
        for value in (2, -1):           # surface 0 carries only retained geometry
            self.after['surfs'][0]['lightmap'] = value
            self.candidate.surfs[0]['iLightMap'] = value
            with self.assertRaisesRegex(cc.Refused, 'retained surface changed lightmap'):
                self.certify()

    def test_saved_bindings_must_be_the_dumped_ones(self):
        self.candidate.surfs[0]['iLightMap'] = 2
        with self.assertRaisesRegex(cc.Refused, 'bindings differ'):
            self.certify()

    def test_lightmap_outside_the_stored_records(self):
        self.before['surfs'][0]['lightmap'] = 3
        self.source.surfs[0]['iLightMap'] = 3
        with self.assertRaisesRegex(cc.Refused, 'outside the stored LightMap'):
            self.certify()

    def test_original_lists_must_stay_first(self):
        self.candidate.lights[:2] = [3, 2]
        with self.assertRaisesRegex(cc.Refused, 'original light lists were not kept'):
            self.certify()

    def test_unterminated_list(self):
        self.candidate.lights[-1] = 2
        with self.assertRaisesRegex(cc.Refused, 'Unterminated'):
            self.certify()

    def test_a_new_leaf_cannot_name_an_unknown_light(self):
        self.candidate.p.exports.append(dict(name='Light9', cls='Light'))
        self.candidate.lights[5] = 4
        with self.assertRaisesRegex(cc.Refused, 'never did'):
            self.certify()

    def test_list_start_outside_lights(self):
        self.after['leaves'][2]['permeating'] = 7
        with self.assertRaisesRegex(cc.Refused, 'outside Lights'):
            self.certify()

    def test_zone_visibility_stays_trivial(self):
        self.after['leaves'][2]['visible'] = 3
        with self.assertRaisesRegex(cc.Refused, 'zone visibility'):
            self.certify()

    def test_render_marks_are_not_geometry(self):
        self.assertEqual(convex_cells.semantic_flags(dict(flags=0x08)), 0)
        self.assertEqual(convex_cells.semantic_flags(dict(flags=0x10)), 0)
        self.assertEqual(convex_cells.semantic_flags(dict(flags=0x19)), 1)      # NF_NotCsg stays


if __name__ == '__main__':
    unittest.main()
