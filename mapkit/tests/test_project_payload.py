"""Every module of tools/mapkit that a project's code imports is copied into the project (projects.PYTHON): one left
out stops every new project at its start (24 Oct 2026: classtree and vec3 were missing)."""
import ast
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(KIT))
import projects  # noqa: E402


def imported(path):
    """The top-level names a file imports (absolute imports, also those inside functions)."""
    names = set()
    for node in ast.walk(ast.parse(path.read_text(encoding='utf-8'))):
        if isinstance(node, ast.Import):
            names |= {a.name.split('.')[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            names.add(node.module.split('.')[0])
    return names


class ProjectPayload(unittest.TestCase):
    def test_every_module_the_project_imports_is_copied(self):
        top = {p.stem for p in KIT.glob('*.py')}
        shipped = {Path(n).stem for n in projects.PYTHON}
        sources = [KIT / n for n in sorted(projects.PYTHON)] + sorted((KIT / 'editor').glob('*.py'))
        missing = {}
        for f in sources:
            for name in imported(f) & top - shipped:
                missing.setdefault(name, []).append(f.name)
        self.assertEqual(missing, {}, 'tools/mapkit modules imported by a project but not in projects.PYTHON')


if __name__ == '__main__':
    unittest.main()
