"""Fault injection against real persistence functions, using temporary private data only.

Usage: python test_persistence.py --source-root <mapkit folder>
AST extraction avoids importing the engine or reading application/game configuration.
"""
import argparse
import ast
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import traceback
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

parser = argparse.ArgumentParser()
parser.add_argument('--source-root', type=Path, default=Path(__file__).resolve().parents[1])
parser.add_argument('--server-source', type=Path)
parser.add_argument('--apply-server-patch', action='store_true')
args, remaining = parser.parse_known_args()
SOURCE = args.source_root


def story_functions(folder):
    tree = ast.parse((SOURCE / 'story.py').read_text(encoding='utf-8'))
    selected = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in {'path', 'load', 'save'}]
    namespace = dict(STORY=folder, json=json)
    if (SOURCE / 'atomicfile.py').exists():
        spec = importlib.util.spec_from_file_location('atomicfile_under_test', SOURCE / 'atomicfile.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        namespace['atomicfile'] = module
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(SOURCE / 'story.py'), 'exec'), namespace)
    return namespace


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='deusedix-persistence-', dir=Path(__file__).resolve().parent)
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        self.story = story_functions(self.folder)
        self.target = self.folder / '01_Test.json'
        self.original = {'route': 'always', 'dialogues': [{'id': 'important', 'steps': [{'text': 'Saved work'}]}], 'events': []}
        self.target.write_text(json.dumps(self.original), encoding='utf-8')

    def test_interrupted_story_write_preserves_previous_saved_bytes(self):
        original_bytes = self.target.read_bytes()
        real_open = Path.open

        class InterruptedWriter:
            def __init__(self, stream): self.stream = stream
            def __enter__(self): return self
            def __exit__(self, *args): return self.stream.__exit__(*args)
            def write(self, content):
                self.stream.write(content[:max(1, len(content) // 3)])
                self.stream.flush()
                raise OSError('Simulated disk full during write')

        def failing_open(path, mode='r', *args, **kwargs):
            stream = real_open(path, mode, *args, **kwargs)
            return InterruptedWriter(stream) if 'w' in mode or 'x' in mode else stream

        with patch.object(Path, 'open', failing_open), self.assertRaisesRegex(OSError, 'disk full'):
            self.story['save']('01_Test', {'dialogues': [{'text': 'New draft'}]})
        self.assertEqual(self.target.read_bytes(), original_bytes, 'A failed save must not truncate the last good version')
        self.assertEqual(sorted(p.name for p in self.folder.iterdir()), ['01_Test.json'])

    def test_corrupt_story_is_not_silently_replaced_with_empty_story(self):
        corrupt = b'{"dialogues": [{"id": "important"}'
        self.target.write_bytes(corrupt)
        with self.assertRaisesRegex(ValueError, r'(?i)(cannot|invalid|could not|corrupt).*story'):
            self.story['load']('01_Test')
        self.assertEqual(self.target.read_bytes(), corrupt)

    def test_missing_story_still_starts_empty(self):
        self.assertEqual(self.story['load']('02_New'), dict(route='unatco', dialogues=[], events=[]))

    def test_successful_story_save_round_trips_unicode(self):
        draft = {'dialogues': [{'text': 'Caffè, già!'}], 'events': []}
        self.story['save']('01_Test', draft)
        self.assertEqual(self.story['load']('01_Test'), draft)
        self.assertEqual(sorted(p.name for p in self.folder.iterdir()), ['01_Test.json'])

    def test_story_shape_must_be_an_object(self):
        self.target.write_text('[]', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, r'(?i)story'):
            self.story['load']('01_Test')

    def test_replace_failure_preserves_saved_story_and_cleans_temporary_file(self):
        if 'atomicfile' not in self.story:
            self.skipTest('Atomic helper not implemented in baseline')
        original_bytes = self.target.read_bytes()
        with patch.object(self.story['atomicfile'].os, 'replace', side_effect=PermissionError('Map is locked')):
            with self.assertRaisesRegex(PermissionError, 'locked'):
                self.story['save']('01_Test', {'dialogues': [{'text': 'New draft'}]})
        self.assertEqual(self.target.read_bytes(), original_bytes)
        self.assertEqual(sorted(p.name for p in self.folder.iterdir()), ['01_Test.json'])

    def test_json_serialization_failure_does_not_touch_destination(self):
        original_bytes = self.target.read_bytes()
        with self.assertRaises(TypeError):
            self.story['save']('01_Test', {'bad': object()})
        self.assertEqual(self.target.read_bytes(), original_bytes)


class MapSaveRouteTests(unittest.TestCase):
    # Reuse the isolated file fixture without inheriting/repeating the Story tests.
    setUp = PersistenceTests.setUp

    def test_map_partial_write_returns_error_without_losing_prior_draft(self):
        original_bytes = self.target.read_bytes()
        real_open = Path.open

        class InterruptedWriter:
            def __init__(self, stream): self.stream = stream
            def __enter__(self): return self
            def __exit__(self, *args): return self.stream.__exit__(*args)
            def write(self, content):
                self.stream.write(content[:max(1, len(content) // 3)])
                self.stream.flush()
                raise OSError('Simulated disk full during map save')

        def failing_open(path, mode='r', *args, **kwargs):
            stream = real_open(path, mode, *args, **kwargs)
            return InterruptedWriter(stream) if 'w' in mode or 'x' in mode else stream

        with patch.object(Path, 'open', failing_open):
            status, body = self.route({'moved': {'Crate0': {'loc': [1, 2, 3]}}})
        self.assertEqual(status, 409, body)
        self.assertEqual(self.target.read_bytes(), original_bytes)
        self.assertEqual(sorted(p.name for p in self.folder.iterdir()), ['01_Test.json'])
    def route(self, draft):
        source = args.server_source or SOURCE / 'editor' / 'server.py'
        if not source.exists():
            self.skipTest('Provide --server-source to test the save-route hunk')
        text = source.read_text(encoding='utf-8')
        if args.apply_server_patch:
            old = "                edits_path(q['script']).write_text(json.dumps(body, indent=1), encoding='utf-8')"
            new = "                import atomicfile\n                atomicfile.write_json(edits_path(q['script']), body)"
            self.assertIn(old, text)
            text = text.replace(old, new, 1)
        tree = ast.parse(text)
        handler_class = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'Handler')
        function = next(node for node in handler_class.body if isinstance(node, ast.FunctionDef) and node.name == '_project_POST')
        noop = SimpleNamespace(names=lambda *args, **kwargs: [], commands=lambda *args, **kwargs: [], validate=lambda *args, **kwargs: [], validate_travel=lambda *args, **kwargs: [],
                               validate_edits=lambda *args, **kwargs: [])
        namespace = dict(json=json, urlparse=urlparse, parse_qs=parse_qs, activation=noop, surfaces=noop,
                         documents=noop, maplinks=noop, object_tags=noop, player_profiles=noop,
                         edits_path=lambda script: self.target, traceback=traceback,
                         project_server=SimpleNamespace(error_payload=lambda exc: dict(error=str(exc))))
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), 'exec'), namespace)
        raw = json.dumps(draft).encode('utf-8')
        handler = SimpleNamespace(path='/api/edits?script=my_map', headers={'Content-Length': str(len(raw))},
                                  rfile=io.BytesIO(raw), _send=lambda status, body: (status, body))
        modules = {'atomicfile': self.story['atomicfile']} if 'atomicfile' in self.story else {}
        with patch.dict('sys.modules', modules):
            return namespace['_project_POST'](handler)

    def test_map_save_replacement_failure_preserves_previous_edits(self):
        if 'atomicfile' not in self.story:
            self.skipTest('Requires atomic helper')
        original_bytes = self.target.read_bytes()
        with patch.object(self.story['atomicfile'].os, 'replace', side_effect=OSError('Simulated disk full')):
            status, body = self.route({'moved': {'Crate0': {'loc': [1, 2, 3]}}})
        self.assertEqual(status, 409, body)
        self.assertEqual(self.target.read_bytes(), original_bytes)
        self.assertEqual(sorted(p.name for p in self.folder.iterdir()), ['01_Test.json'])

    def test_map_save_success_persists_complete_draft(self):
        draft = {'moved': {'Crate0': {'loc': [1, 2, 3]}}, 'deleted': {}, 'added': []}
        status, body = self.route(draft)
        self.assertEqual(status, 200, body)
        self.assertEqual(json.loads(self.target.read_bytes()), draft)


if __name__ == '__main__':
    unittest.main(argv=[__file__, *remaining])
