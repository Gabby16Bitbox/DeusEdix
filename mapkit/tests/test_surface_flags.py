"""A face's Look flags (editor/surfaces.py FLAGS) are the engine's own bits, and a build sends them to the host. Auto U
Pan and Auto V Pan (PF_AutoUPan 0x200 and PF_AutoVPan 0x400 in the Deus Ex SDK's UnObj.h; the original maps' cloud banks
and some of their water have them) were not in the Look (B6 in the game, 28 Oct 2026: a face given 0x200 by a map script
panned 35 texels a second; judgement.md #8). The host's UC_SURFACE flags refuses a line with a bit outside its own list
(host/UCEngineBridge.cpp editSurface, `allowed`): until 1 Nov 2026 that list did not have the two, so a build left them
out of the host's line and said so (left_out, NOT_IN_HOST); now the host takes them, the line carries them like the
other bits and the report leaves nothing out. No game and no host: the builds' runs are stopped where the host would
start (as in test_echo_gains_build.py), and only temporary folders under tests/ are written; the SDK header and the
host's source are read where they are."""
import contextlib
import io
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import dxmaps  # noqa: E402
import geom  # noqa: E402
import kit  # noqa: E402
import player_profiles  # noqa: E402
import scene  # noqa: E402
import surfaces  # noqa: E402

# the SDK headers the host is compiled with (host/build_host.ps1), read only; and the host's source
HEADER = KIT.parent / 'editor_bridge' / 'editor_lab' / 'headers' / 'Engine' / 'Inc' / 'UnObj.h'
HOST = KIT / 'host' / 'UCEngineBridge.cpp'
# the page's copy of the Look mask (FLAG_MASK: the rows it queues; closed since 29 Oct 2026, only read here)
SLIP = KIT / 'editor' / 'static' / 'texture-slip.js'
# the Look's names and the engine's for the same bits (EPolyFlags)
ENGINE_NAMES = {'invisible': 'PF_Invisible', 'masked': 'PF_Masked', 'translucent': 'PF_Translucent',
                'modulated': 'PF_Modulated', 'fake_backdrop': 'PF_FakeBackdrop', 'two_sided': 'PF_TwoSided',
                'auto_u_pan': 'PF_AutoUPan', 'auto_v_pan': 'PF_AutoVPan', 'no_smooth': 'PF_NoSmooth',
                'special_lit': 'PF_SpecialLit', 'unlit': 'PF_Unlit', 'mirror': 'PF_Mirrored'}
U, V, UNLIT = 0x200, 0x400, 0x400000
WHY = ': the host that builds the map cannot write it yet'


def row(on, off, targets=(('Brush3', 1),)):
    """A Look row of the edits: the bits turned on and off on these faces (source brush, polygon or '*')."""
    return dict(op='flags', args=[on, off], targets=[dict(brush=b, poly=p) for b, p in targets])


def engine_flags():
    """{PF_ name: its bit} of the SDK header's EPolyFlags."""
    block = re.search(r'enum EPolyFlags\s*\{(.*?)\};', HEADER.read_text(encoding='latin1'), re.S).group(1)
    return {m.group(1): int(m.group(2), 16) for m in re.finditer(r'\b(PF_\w+)\s*=\s*0x([0-9A-Fa-f]+)', block)}


# a face turned Unlit and auto-panning in U, another auto-panning in V: the host's lines carry all their bits
EDITS = {'surfaces': [row(U | UNLIT, 0), row(V, 0, [('Brush3', 2)])]}
HOST_LINES = ['UC_SURFACE Brush3 1 flags %d 0' % (U | UNLIT), 'UC_SURFACE Brush3 2 flags %d 0' % V]


class LookFlagsTest(unittest.TestCase):
    def test_auto_u_and_v_pan_are_look_flags_with_the_engines_bits(self):
        self.assertEqual((surfaces.FLAGS['auto_u_pan'], surfaces.FLAGS['auto_v_pan']), (U, V))
        if not HEADER.is_file():
            self.skipTest('no Deus Ex SDK headers beside the kit (tools/editor_bridge/editor_lab/headers)')
        engine = engine_flags()
        self.assertEqual({name: engine[ENGINE_NAMES[name]] for name in surfaces.FLAGS}, surfaces.FLAGS)

    def test_the_bits_said_to_reach_the_host_are_those_it_writes(self):
        if not (HEADER.is_file() and HOST.is_file()):
            self.skipTest('no host source or no Deus Ex SDK headers here')
        allowed = re.search(r'const DWORD allowed\s*=\s*([^;]*);', HOST.read_text(encoding='utf-8', errors='replace'))
        engine = engine_flags()
        written = 0
        for name in re.findall(r'PF_\w+', allowed.group(1)):
            written |= engine[name]
        self.assertEqual(surfaces.HOST_FLAGS, written)
        self.assertEqual(surfaces.HOST_FLAGS | sum(surfaces.NOT_IN_HOST), surfaces.FLAG_MASK)

    def test_the_pages_copy_of_the_mask_is_what_the_host_writes(self):
        """The page queues a Look row only with the bits of its copy of the mask, and at a map's opening calls a row
        with any other bit one Save refuses (texture-slip.js queueProblem, app.js). Save keeps NOT_IN_HOST's bits too (a
        row written another way: the build leaves them out and says so), so for those that message is not true (part
        B's #16). The difference is only NOT_IN_HOST, empty since the host writes Auto U / V Pan and the page's copy
        took them in the same step (1 Nov 2026)."""
        found = re.search(r'const FLAG_MASK = ([^;]*);', SLIP.read_text(encoding='utf-8'))
        page = 0
        for bit in re.findall(r'0x[0-9A-Fa-f]+', found.group(1)):
            page |= int(bit, 16)
        self.assertEqual(page, surfaces.HOST_FLAGS)
        self.assertEqual(surfaces.FLAG_MASK & ~page, sum(surfaces.NOT_IN_HOST))

    def test_a_row_with_them_goes_to_the_host_whole(self):
        self.assertEqual(surfaces.commands({'surfaces': [row(U | UNLIT, V)]}),
                         ['UC_SURFACE Brush3 1 flags %d %d' % (U | UNLIT, V)])
        self.assertEqual(surfaces.commands({'surfaces': [row(0, V)]}), ['UC_SURFACE Brush3 1 flags 0 %d' % V])
        self.assertEqual(surfaces.commands({'surfaces': [row(U | V, 0, [('Brush3', 1), ('Brush5', '*')])]}),
                         ['UC_SURFACE Brush3 1 flags %d 0' % (U | V), 'UC_SURFACE Brush5 * flags %d 0' % (U | V)])
        # a bit that is no Look flag (BigWavy), one turned on and off at once, a face that is no source face
        for wrong in (row(0x1000, 0), row(U, U), row(U, 0, [('Brush 3', 1)]), row(V, 0, [('Brush3', 70000)])):
            with self.assertRaises(ValueError):
                surfaces.commands({'surfaces': [wrong]})

    def test_the_build_report_leaves_nothing_out(self):
        edits = {'surfaces': [row(U | UNLIT, 0),
                              dict(op='pan', args=[16, 0], targets=[dict(brush='Brush3', poly=1)]),
                              row(0, U | V, [('Brush5', '*'), ('Brush6', 0), ('Brush6', 1), ('Brush7', 2)])]}
        self.assertEqual(surfaces.left_out(edits), [])                          # the host writes every Look bit
        # a bit the host would not write is still named, with its row's faces
        many = 'Brush5 all faces, Brush6 face 0, Brush6 face 1 and 1 more'
        with patch.object(surfaces, 'NOT_IN_HOST', {U: 'Auto U Pan', V: 'Auto V Pan'}):
            self.assertEqual(surfaces.left_out(edits), [
                '  EDIT skipped Auto U Pan (on) for Brush3 face 1' + WHY,
                '  EDIT skipped Auto U Pan (off) for %s%s' % (many, WHY),
                '  EDIT skipped Auto V Pan (off) for %s%s' % (many, WHY)])
            self.assertEqual(surfaces.left_out({'surfaces': [row(UNLIT, 0)]}), [])
            self.assertEqual(surfaces.left_out({}), [])


class BuildsTest(unittest.TestCase):
    def test_an_original_maps_build(self):
        ran = {}

        def execute(folder, cmds, *args, **kwargs):
            ran['cmds'] = cmds
            raise RuntimeError('stopped before the game\'s editor runs')

        with tempfile.TemporaryDirectory(dir=KIT / 'tests', prefix='surface-flags-') as temp:
            root = Path(temp)
            (root / 'run' / 'T3D').mkdir(parents=True)
            (root / 'out').mkdir()
            (root / 'SurfaceFlagsFixture.dx').write_bytes(b'a map')
            editfile = root / 'SurfaceFlagsFixture.edits.json'
            editfile.write_text(json.dumps(EDITS), encoding='utf-8')
            with patch.object(dxmaps, 'MOD_MAPS', root), patch.object(dxmaps, 'OUT', root / 'out'), \
                    patch.object(dxmaps, 'edits_path', lambda _: editfile), \
                    patch.object(dxmaps.kit, 'new_run', lambda *a, **k: root / 'run'), \
                    patch.object(dxmaps.kit, 'execute', execute), \
                    patch.object(dxmaps, 'source_scene', lambda *a, **k: ''):      # a source without objects
                ok, lines = dxmaps.build('SurfaceFlagsFixture')
        self.assertFalse(ok)                                                    # the run stopped
        self.assertEqual([c for c in ran['cmds'] if c.startswith('UC_SURFACE')], HOST_LINES)
        self.assertEqual([line for line in lines if 'EDIT skipped Auto' in line], [])   # nothing said left out

    def test_a_script_maps_build(self):
        ran = {}

        def execute(folder, cmds, *args, **kwargs):
            ran['cmds'] = list(cmds)
            return '', None

        with tempfile.TemporaryDirectory(dir=KIT / 'tests', prefix='surface-flags-') as temp:
            root = Path(temp)
            run = root / 'run'
            for sub in ('Input', 'Output', 'T3D'):
                (run / sub).mkdir(parents=True)
            editfile = root / 'SurfaceFlagsScript.edits.json'
            editfile.write_text(json.dumps(EDITS), encoding='utf-8')
            with patch('texcat.ensure_index', return_value=False):
                s = scene.Scene('SurfaceFlagsScript')
            s.sub(geom.box((-256, -256, 0), (256, 256, 256), 'ClenGreyCncrt_A'))
            said = io.StringIO()
            with patch.object(kit, 'new_run', lambda *a, **k: run), patch.object(kit, 'execute', execute), \
                    patch.object(player_profiles, 'FILE', root / 'players.json'), contextlib.redirect_stdout(said):
                s._build_ready(None, light=False, paths=False, edits=editfile)
        self.assertEqual([c for c in ran['cmds'] if c.startswith('UC_SURFACE')], HOST_LINES)
        self.assertEqual([line for line in said.getvalue().splitlines() if 'EDIT skipped Auto' in line], [])


if __name__ == '__main__':
    unittest.main()
