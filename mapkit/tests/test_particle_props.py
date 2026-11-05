"""The Inspector's Particles section reaches the game (5 Nov 2026): every setting of static/particles.js is one the
builds give the map (props.NAMES: UC_PROP), else a change made there (a damage, a texture, a colour) was dropped and
only the values the generator was placed with reached the game. And the presets of Objects > Effects set only those."""
import re
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import props  # noqa: E402

FIELDS = re.findall(r"\{ key: '(\w+)'", (KIT / 'editor' / 'static' / 'particles.js').read_text(encoding='utf-8'))


class ParticleProps(unittest.TestCase):
    def test_every_setting_of_the_section_is_built(self):
        self.assertGreater(len(FIELDS), 20)
        self.assertEqual([f for f in FIELDS if f not in props.NAMES], [])

    def test_a_damage_set_in_the_section_becomes_a_uc_prop(self):
        edits = {'props': {'UCEdit7': {'FxDamage': '5', 'FxDamageType': 'PoisonGas', 'FxArea': '160.000000',
                                       'particleTexture': "Texture'MyLevel.Imported.UCT_Puff_ff2010_1'"}}}
        cmds = props.commands(edits)
        for line in ('UC_PROP UCEdit7 FxDamage 5', 'UC_PROP UCEdit7 FxDamageType PoisonGas', 'UC_PROP UCEdit7 FxArea 160.000000',
                     "UC_PROP UCEdit7 particleTexture Texture'MyLevel.Imported.UCT_Puff_ff2010_1'"):
            self.assertIn(line, cmds)

    def test_the_presets_use_the_section_settings(self):
        import data
        for name, preset in data.PARTICLE_PRESETS:
            self.assertEqual([k for k in preset if k not in FIELDS], [], name)
        names = [n for n, _ in data.PARTICLE_PRESETS]
        self.assertIn('Toxic gas pool (deadly)', names)
        pool = dict(data.PARTICLE_PRESETS)['Toxic gas pool (deadly)']
        self.assertEqual(pool['FxDamageType'], 'PoisonGas')
        self.assertGreater(float(pool['FxRadius']), float(pool['FxArea']), 'it hurts all over the gas it shows')
        for name, hex_ in data.PARTICLE_COLOURS.items():          # placed in a colour of their own
            self.assertIn(name, names)
            self.assertRegex(hex_, r'^#[0-9a-f]{6}$')


if __name__ == '__main__':
    unittest.main()
