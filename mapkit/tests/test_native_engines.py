"""Local geometry (Experimental) accepts the Engine.dll of the original game as well as the SDK copy Revision's
DevInstall carries. Until 24 Oct 2026 every certificate was pinned to the Revision copy alone, so in a project for
the original game every local rebuild was refused ('Unknown native collision backoff implementation', 'PointRegion
engine implementation is not pinned'). The two builds differ in one byte, outside the code the certificates use
(experimental_bsp/native_engines.py); the same original map rebuilt with either engine gave the same BSP and T3D."""
import ast
import hashlib
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
LAB = KIT / 'experimental_bsp'
sys.path.append(str(LAB))      # last: its modules never hide the kit's own
import native_engines  # noqa: E402

ENGINE_PINS = ('ENGINE_SHA', 'ENGINE_SHA256', 'KNOWN_ENGINE_SHA256')
ENGINES = [KIT.parents[1] / 'DevInstall' / 'System' / 'Engine.dll']     # this workspace's SDK engine, either game


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class NativeEngines(unittest.TestCase):
    def test_two_builds_are_known(self):
        self.assertEqual(len(native_engines.KNOWN), 2)
        self.assertTrue(all(re.fullmatch('[0-9a-f]{64}', d) for d in native_engines.KNOWN))

    def test_no_module_pins_one_engine(self):
        """Every engine check reads native_engines: no module keeps its own Engine.dll hash."""
        for path in sorted(LAB.glob('*.py')):
            if path.name == 'native_engines.py':
                continue
            text = path.read_text(encoding='utf-8')
            for digest in native_engines.KNOWN:
                self.assertNotIn(digest, text, path.name)
            assigned = {t.id for n in ast.walk(ast.parse(text)) if isinstance(n, ast.Assign) for t in n.targets
                        if isinstance(t, ast.Name)}
            self.assertFalse(assigned & set(ENGINE_PINS), path.name)

    def test_shipped_and_fingerprinted(self):
        """The module goes into the installer (distribution.json) and into the compiler's fingerprint."""
        files = json.loads((LAB / 'distribution.json').read_text(encoding='utf-8'))['files']
        self.assertIn('native_engines.py', files)
        code = ast.parse((LAB / 'implementation.py').read_text(encoding='utf-8'))
        names = {n.value for n in ast.walk(code) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
        self.assertIn('native_engines.py', names)

    def test_every_local_import_is_shipped(self):
        """A module the tool imports from its own folder is in distribution.json, or the installed tool fails."""
        files = set(json.loads((LAB / 'distribution.json').read_text(encoding='utf-8'))['files'])
        own = {p.stem for p in LAB.glob('*.py')}
        for name in sorted(f for f in files if f.endswith('.py')):
            tree = ast.parse((LAB / name).read_text(encoding='utf-8'))
            for n in ast.walk(tree):
                mods = [a.name for a in n.names] if isinstance(n, ast.Import) else [n.module] if isinstance(n, ast.ImportFrom) and n.module and not n.level else []
                for m in mods:
                    if m.split('.')[0] in own:
                        self.assertIn(m.split('.')[0] + '.py', files, '%s imports %s' % (name, m))

    def test_backoff_and_profile_accept_each_engine(self):
        import phantom_normal
        import stratified_csg
        found = [p for p in ENGINES if p.is_file() and sha(p) in native_engines.KNOWN]
        if not found:
            self.skipTest('no Deus Ex engine on this computer')
        for path in found:
            evidence = phantom_normal.verify_native_backoff(path)
            self.assertEqual(evidence.sha256, sha(path))
            phantom_normal._engine(evidence)
            profile = stratified_csg.verify_profile(dict(engine_sha256=sha(path), control_word_before=0x027f, control_word_after=0x027f))
            self.assertEqual(profile['engine_sha256'], sha(path))

    def test_other_builds_are_refused(self):
        import convex_hull_certificate
        import phantom_normal
        import stratified_csg
        with tempfile.TemporaryDirectory() as tmp:
            other = Path(tmp) / 'Engine.dll'
            other.write_bytes(b'MZ another engine')
            with self.assertRaises(ValueError):
                phantom_normal.verify_native_backoff(other)
            with self.assertRaises(ValueError):
                convex_hull_certificate.verify_engine(other)
            with self.assertRaises(ValueError):
                stratified_csg.verify_profile(dict(engine_sha256=sha(other), control_word_before=0x027f, control_word_after=0x027f))
            with self.assertRaises(ValueError):
                phantom_normal.verify_native_backoff(Path(tmp) / 'missing.dll')


if __name__ == '__main__':
    unittest.main()
