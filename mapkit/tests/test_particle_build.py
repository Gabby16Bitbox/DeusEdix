"""Particles that hurt and switch (UCParticles, Objects > Effects): its class is the same in the runtime and in a new
project's sources, every setting the browser's effects give it is declared there or is the game's ParticleGenerator's
(as the editor's Particles section has them), and a Rebuild loads the texture packages the objects' properties name."""
import json
import re
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
ROOT = KIT.parent
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import data  # noqa: E402
import dxmaps  # noqa: E402

RUNTIME = ROOT / 'runtime' / 'DeusEdix' / 'Classes' / 'UCParticles.uc'
TEMPLATE = KIT / 'project-template' / 'src' / 'DeusEdix' / 'Classes' / 'UCParticles.uc'
# the game's ParticleGenerator's settings the editor sets (static/particles.js, UCEffect.uc sets them too)
GAME = {'particletexture', 'frequency', 'checktime', 'numperspawn', 'ejectspeed', 'riserate', 'particlelifespan',
        'particledrawscale', 'brandomeject', 'bgravity', 'bscale', 'bfade', 'bparticlesunlit', 'bmodulated'}


class ParticleClass(unittest.TestCase):
    def test_same_in_the_runtime_and_a_new_project(self):
        self.assertEqual(RUNTIME.read_text(encoding='utf-8'), TEMPLATE.read_text(encoding='utf-8'))

    def test_every_setting_of_the_effects_is_declared(self):
        own = {m.lower() for m in re.findall(r'(?m)^var\(\)\s+\w+\s+(\w+);', RUNTIME.read_text(encoding='utf-8'))}
        with patch.object(data, 'catalog', return_value=[]):
            effects = next(c for c in data.palette() if c['category'] == 'Effects')['items']
        self.assertTrue(effects)
        for item in effects:
            self.assertEqual(item['cls'], 'UCParticles')
            for key in item['preset']:
                self.assertIn(key.lower(), own | GAME, '%s: %s' % (item['name'], key))
        page = (KIT / 'editor' / 'static' / 'particles.js').read_text(encoding='utf-8')
        for key in re.findall(r"key: '(\w+)'[^\n]*own: 'UCParticles'", page):
            self.assertIn(key.lower(), own, 'the Particles section sets %s' % key)


class TexturePackages(unittest.TestCase):
    def test_the_packages_the_properties_name(self):
        edits = {'added': [{'props': {'particleTexture': "Texture'Effects.Smoke.SmokePuff1'", 'riseRate': '9'}}],
                 'props': {'A': {'Skin': "Texture'MyLevel.Imported.mine'"}},
                 'rawprops': {'B': {'Tex': "Texture'CoreTexMetal.Panels.MtlPnl3'"}, 'C': 'not a dict'}}
        self.assertEqual(dxmaps.property_texture_packages(edits), ['CoreTexMetal', 'Effects'])
        self.assertEqual(dxmaps.property_texture_packages({}), [])


if __name__ == '__main__':
    unittest.main()
