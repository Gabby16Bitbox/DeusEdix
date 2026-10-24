"""Settings kept as data, not code (25 Oct 2026, from a forum review: "no one wants to recompile this just to change
something"): the bridge's UCEngineBridge.ini (navigation, the WinDrvLite fix) and the editor's config/palette.json
(how the Browser sorts the game's classes). Each file must be complete and say what the code's defaults say."""
import json
import re
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
INI = KIT / 'host' / 'UCEngineBridge.ini'
BRIDGE = KIT / 'host' / 'UCEngineBridge.cpp'
PALETTE = KIT / 'editor' / 'config' / 'palette.json'


def ini_sections(path):
    """{section: [(key, value)...]}, keys repeated as the engine's config keeps them; ';' lines are comments."""
    sections, current = {}, None
    for line in path.read_text(encoding='latin1').splitlines():
        line = line.strip()
        if not line or line.startswith(';'):
            continue
        if line.startswith('['):
            current = sections.setdefault(line.strip('[]'), [])
            continue
        key, value = line.split('=', 1)
        current.append((key, value))
    return sections


class BridgeSettings(unittest.TestCase):
    def setUp(self):
        if not INI.is_file():
            self.skipTest('the host source is not here (an installed DeusEdix)')
        self.ini = ini_sections(INI)
        self.code = BRIDGE.read_text(encoding='utf-8')

    def test_comments_hold_no_key(self):
        """The engine's config reads a line with '=' as a key: a comment must not have one."""
        for line in INI.read_text(encoding='latin1').splitlines():
            if line.lstrip().startswith(';'):
                self.assertNotIn('=', line, line)

    def test_navigation_says_the_bridges_defaults(self):
        nav = dict(self.ini['Navigation'])
        for key in ('FloorSearch', 'FloorTolerance', 'MaxHeightOverFloor', 'MovedTolerance'):
            default = re.search(r'FLOAT %s = ([\d.]+)f;' % key, self.code).group(1)
            self.assertEqual(float(nav[key]), float(default), key)
        left = [v for k, v in self.ini['Navigation'] if k == 'LeftAlone']
        built_in = re.findall(r'A(\w+)::StaticClass\(\)', self.code[self.code.index('UClass* const leftAlone[]'):][:400])
        self.assertEqual(left, built_in)

    def test_winDrvLite_says_the_bridges_defaults(self):
        w = dict(self.ini['WinDrvLite'])
        code = [int(b, 16) for b in w['Code'].split()]
        table = self.code[self.code.index('static const BYTE AssertionCode[] = {'):]
        table = table[:table.index('};')]
        self.assertEqual(code, [int(b, 16) for b in re.findall(r'0x([0-9A-F]{2})', table)])
        self.assertEqual(int(w['Offset'], 0), int(re.search(r'DWORD Offset = (0x[0-9A-F]+);', self.code).group(1), 16))
        self.assertEqual(int(w['Jump']), int(re.search(r'int Jump = (\d+);', self.code).group(1)))
        self.assertEqual(code[int(w['Jump'])], 0x74)            # the je it turns into a jmp


class PaletteSettings(unittest.TestCase):
    def test_every_list_is_there_and_explained(self):
        config = json.loads(PALETTE.read_text(encoding='utf-8'))
        about = config.pop('about')
        self.assertEqual(set(about) - {'file'}, set(config))
        for key in ('mostUsed', 'noModel', 'hooks', 'skipClasses', 'skipClassPrefixes', 'skipParents', 'npcOnlyWeapons'):
            self.assertTrue(all(isinstance(v, str) and v for v in config[key]), key)
        for key in ('categories', 'subcategories'):
            self.assertTrue(all(isinstance(v, str) for v in config[key].values()), key)

    def test_data_reads_it(self):
        text = (KIT / 'editor' / 'data.py').read_text(encoding='utf-8')
        self.assertIn("HERE / 'config' / 'palette.json'", text)
        self.assertNotIn('OLD_NAMES', text)


if __name__ == '__main__':
    unittest.main()
