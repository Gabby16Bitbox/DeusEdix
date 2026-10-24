"""Install map compiles the map's saved Story first, as Play does (24 Oct 2026: a dialogue saved in the Story
never reached the game installed with Install map: only "Apply in game" or Play generated its class)."""
import ast
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock

SOURCE = Path(__file__).resolve().parents[1] / 'editor' / 'server.py'


class InstallStory(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='.install-story-', dir=Path(__file__).parent)
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        (root / 'out').mkdir()
        (root / 'maps').mkdir()
        (root / 'out' / '01_Room.dx').write_bytes(b'built')
        self.events = []
        self.workspace = types.SimpleNamespace(
            needs_build=Mock(side_effect=lambda: self.events.append('needs_build') or self.changed),
            install=Mock(side_effect=lambda: self.events.append('install') or (True, ['installed'])))
        self.run_ps = Mock(side_effect=lambda *a: self.events.append(a) or (self.built, ['compiled']))
        story = types.SimpleNamespace(write_all=Mock(side_effect=lambda: self.events.append('story') or ['story of 01_Room']))
        self.ns = {'__name__': 'install_story_fixture', 'shutil': __import__('shutil'), 'subprocess': None,
                   'settings': types.SimpleNamespace(STANDALONE=True), 'PROJECT': root,
                   'data': types.SimpleNamespace(OUT=root / 'out'), 'story': story, 'run_ps': self.run_ps,
                   'is_dx': lambda script: False, 'map_of': lambda script: '01_Room'}
        tree = ast.parse(SOURCE.read_text(encoding='utf-8-sig'))
        fn = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'install_map'],
                        type_ignores=[])
        exec(compile(fn, str(SOURCE), 'exec'), self.ns)
        import sys
        self.addCleanup(sys.modules.pop, 'workspace', None)
        sys.modules['workspace'] = self.workspace
        self.changed, self.built = True, True

    def test_a_changed_story_is_compiled_before_installing(self):
        ok, lines = self.ns['install_map']('room')
        self.assertTrue(ok)
        self.assertEqual(self.events, ['story', 'needs_build', ('build.ps1', '-Isolated'), 'install'])
        self.assertIn('story of 01_Room', lines)

    def test_nothing_changed_installs_without_compiling(self):
        self.changed = False
        ok, _lines = self.ns['install_map']('room')
        self.assertTrue(ok)
        self.assertEqual(self.events, ['story', 'needs_build', 'install'])

    def test_a_failed_compile_installs_nothing(self):
        self.built = False
        ok, lines = self.ns['install_map']('room')
        self.assertFalse(ok)
        self.workspace.install.assert_not_called()
        self.assertIn('compiled', lines)


if __name__ == '__main__':
    unittest.main()
