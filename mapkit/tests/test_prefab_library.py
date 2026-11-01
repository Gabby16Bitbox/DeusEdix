"""The project's prefab library (editor/prefab_library.py) as linked prefabs need it: a prefab's versions (Apply to
prefab saves a placed copy back as the newest one, in the prefab's own frame, its objects keeping their slots), rename,
delete (a version a map still places stays, hidden), the picture, and where the objects of a copy stand in a version
(Update instances). Each map here is a small rebuilt cache written by the test: a floor brush and a light."""
import base64
import contextlib
import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'editor'), str(ROOT)]
import classes  # noqa: E402
from classtree import ClassTree  # noqa: E402
import geom  # noqa: E402
import prefab_library  # noqa: E402
import prefab_snapshot  # noqa: E402
import prefabs  # noqa: E402
import t3d  # noqa: E402

BRUSH = '''Begin Actor Class=Brush Name={name}
    CsgOper=CSG_Add
    Location=(X={x:.6f},Y={y:.6f},Z={z:.6f})
    Brush=Model'MyLevel.{model}'
    Name={name}
    Begin Brush Name={model}
       Begin PolyList
          Begin Polygon Texture=Floor Flags=0
             Origin   +00000.000000,+00000.000000,+00000.000000
             Normal   +00000.000000,+00000.000000,+00001.000000
             TextureU +00001.000000,+00000.000000,+00000.000000
             TextureV +00000.000000,+00001.000000,+00000.000000
             Vertex   -00032.000000,-00032.000000,+00000.000000
             Vertex   +00032.000000,-00032.000000,+00000.000000
             Vertex   +00032.000000,+00032.000000,+00000.000000
             Vertex   -00032.000000,+00032.000000,+00000.000000
          End Polygon
       End PolyList
    End Brush
End Actor
'''
LIGHT = '''Begin Actor Class=Light Name={name}
    Location=(X={x:.6f},Y={y:.6f},Z={z:.6f})
    Name={name}
End Actor
'''
JPEG = 'data:image/jpeg;base64,' + base64.b64encode(b'\xff\xd8\xff\xe0 a small picture').decode()
TREE = ClassTree({'Brush': 'Actor', 'Light': 'Actor', 'Actor': 'Object'})


def write_cache(folder, blocks, structures):
    """A map's rebuilt cache (scene.t3d, brushes.json, geometry.json) of these T3D blocks: each brush's floor as two
    triangles with their texture frames, where the brush stands."""
    folder.mkdir(parents=True, exist_ok=True)
    text = 'Begin Map\n' + ''.join(b if b.endswith('\n') else b + '\n' for b in blocks) + 'End Map\n'
    (folder / 'scene.t3d').write_text(text, encoding='latin1')
    groups, faces, brushes = [], [], []
    for actor in t3d.actors(text):
        if actor['cls'] != 'Brush':
            continue
        brushes.append(dict(name=actor['name']))
        rotation = t3d.rot(actor['props'].get('Rotation'))
        for _, corners in t3d.world_verts(actor):
            a, b, c, d = corners
            u = geom.rotation_matrix(rotation)
            frame = list(t3d.vec(actor['props'].get('Location'))) + [u[0][0] / 64, u[1][0] / 64, u[2][0] / 64,
                                                                      u[0][1] / 64, u[1][1] / 64, u[2][1] / 64, 0, 0]
            groups.append(dict(tex='Floor', flags=0, pos=[*a, *b, *c, *a, *c, *d], uv=[0] * 12,
                               faces=[len(faces), len(faces)], uvFrames=[frame, frame]))
            faces.append(dict(brush=actor['name']))
    (folder / 'brushes.json').write_text(json.dumps(brushes), encoding='utf-8')
    (folder / 'geometry.json').write_text(json.dumps(dict(groups=groups, faces=faces, textures={})), encoding='utf-8')
    return structures


def place_text(entry):
    """A placed copy as the build puts it (prefabs.place): its blocks."""
    return prefabs.place(entry)[0]


def loc_of(block):
    return t3d.vec(next(t3d.actors(block))['props'].get('Location'))


class LibraryCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.root, self.maps = base / 'prefabs', base / 'maps'
        self.maps.mkdir()
        for target, name, value in ((prefab_library, 'ROOT', self.root), (prefabs, 'ROOT', self.root),
                                    (prefab_library, 'MAPS', self.maps), (classes, 'tree', lambda: TREE)):
            patcher = patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.cache = base / 'cache'
        self.desk = write_cache(self.cache / 'Office', [BRUSH.format(name='Brush3', model='Model5', x=100, y=200, z=0),
                                                       LIGHT.format(name='Light4', x=110, y=200, z=64),
                                                       LIGHT.format(name='Light7', x=90, y=180, z=64)],
                                {'Desk': {'brush_names': ['Brush3'], 'actors': ['Light4', 'Light7']}})

    def save_desk(self, picture=''):
        return prefab_library.save('Office', {'structures': ['Desk']}, 'Desk set', self.cache / 'Office', self.desk, picture)

    def copy_cache(self, entry, edit=lambda blocks: blocks, map_name='Lobby'):
        """The map the copy `entry` is placed in, rebuilt: its blocks as the build makes them (edit: what the user
        changed on them), its structure paste~<pid>."""
        blocks = edit(place_text(entry))
        names = [next(t3d.actors(b))['name'] for b in blocks]
        structures = {'paste~' + entry['pid']: {'brush_names': [n for n in names if 'B' in n[len(prefabs.member_tag(entry['pid'])):]],
                                                'actors': [n for n in names if 'B' not in n[len(prefabs.member_tag(entry['pid'])):]]}}
        return write_cache(self.cache / map_name, blocks, structures)


class VersionsTest(LibraryCase):
    def test_a_new_prefab_is_its_own_first_version_with_its_picture(self):
        item = self.save_desk(JPEG)
        self.assertEqual((item['line'], item['version']), (item['id'], 1))
        self.assertTrue(item['thumb'].startswith('/prefabs/%s/thumb.jpg?v=' % item['id']))
        self.assertEqual([i['id'] for i in prefab_library.library()], [item['id']])
        marker = json.loads((self.root / item['id'] / 'library.json').read_text(encoding='utf-8'))
        self.assertEqual((marker['line'], marker['revision'], marker['slots']), (item['id'], 1, 3))

    def test_apply_saves_the_copy_back_in_the_prefab_frame_as_the_newest_version(self):
        first = self.save_desk()
        entry = dict(pid='p1', prefab=first['id'], offset=[500, -40, 16], yaw=16384)

        def moved(blocks):                     # the user moved the light Light4 (slot 1) of this copy
            return [b.replace('Location=(X=', 'Location=(X=8') if 'UCPfp1A1' in b.split('\n')[0] else b for b in blocks]
        structures = self.copy_cache(entry, moved)
        built = {next(t3d.actors(b))['name']: loc_of(b) for b in moved(place_text(entry))}
        item = prefab_library.new_version('Lobby', entry, self.cache / 'Lobby', structures)
        self.assertEqual((item['line'], item['version'], item['label']), (first['id'], 2, 'Desk set'))
        self.assertNotEqual(item['id'], first['id'])
        self.assertEqual([i['id'] for i in prefab_library.library()], [item['id']])       # one card: the newest
        second = prefabs.load(item['id'])
        self.assertEqual([b['slot'] for b in second['blocks']], [0, 1, 2])
        self.assertEqual(second['pivot'], prefabs.load(first['id'])['pivot'])
        # the same copy built from the new version is the map the user had: the moved light where it was moved
        again = {next(t3d.actors(b))['name']: loc_of(b) for b in place_text(dict(entry, prefab=item['id']))}
        self.assertEqual(sorted(again), sorted(built))
        for name, where in built.items():
            for k in range(3):
                self.assertAlmostEqual(again[name][k], where[k], places=2)
        # its preview is back in the prefab's frame too: the floor where the first version has it, frames turned back
        old = json.loads((self.root / first['id'] / 'display.json').read_text(encoding='utf-8'))['groups'][0]
        new = json.loads((self.root / item['id'] / 'display.json').read_text(encoding='utf-8'))['groups'][0]
        for a, b in zip(old['pos'] + old['uvFrames'][0], new['pos'] + new['uvFrames'][0]):
            self.assertAlmostEqual(a, b, places=4)

    def test_slots_stay_with_their_objects_and_are_never_given_again(self):
        first = self.save_desk()
        entry = dict(pid='p4', prefab=first['id'], offset=[0, 0, 0], yaw=0)
        gone = lambda blocks: [b for b in blocks if 'UCPfp4A1' not in b.split('\n')[0]]      # noqa: E731 Light4 deleted
        structures = self.copy_cache(entry, gone)
        second = prefab_library.new_version('Lobby', entry, self.cache / 'Lobby', structures)
        self.assertEqual([b['slot'] for b in prefabs.load(second['id'])['blocks']], [0, 2])
        # a copy of the second version with an object of its own (not named as one of the copy's)
        entry = dict(pid='p5', prefab=second['id'], offset=[0, 0, 0], yaw=0)
        structures = self.copy_cache(entry, lambda blocks: blocks + [LIGHT.format(name='Light9', x=1, y=2, z=3)], 'Hall')
        third = prefab_library.new_version('Hall', entry, self.cache / 'Hall', structures)
        self.assertEqual([b['slot'] for b in prefabs.load(third['id'])['blocks']], [0, 2, 3])     # not 1: Light4's
        names = [next(t3d.actors(b))['name'] for b in place_text(dict(pid='p9', prefab=third['id']))]
        self.assertEqual(names, ['UCPfp9B0', 'UCPfp9A2', 'UCPfp9A3'])

    def test_an_older_copy_is_updated_before_it_is_applied(self):
        first = self.save_desk()
        entry = dict(pid='p1', prefab=first['id'])
        structures = self.copy_cache(entry)
        prefab_library.new_version('Lobby', entry, self.cache / 'Lobby', structures)
        with self.assertRaisesRegex(ValueError, 'version 1 of its prefab and version 2 is in the library: Update instances'):
            prefab_library.new_version('Lobby', dict(entry, pid='p2'), self.cache / 'Lobby', structures)

    def test_a_scaled_copy_or_a_deleted_prefab_is_not_applied(self):
        first = self.save_desk()
        entry = dict(pid='p1', prefab=first['id'], scale=[2, 1, 1])
        with self.assertRaisesRegex(ValueError, 'scale back to 100%'):
            prefab_library.new_version('Lobby', entry, self.cache / 'Lobby', {})
        (self.maps / 'Lobby.edits.json').write_text(json.dumps({'prefabs': [entry]}), encoding='utf-8')
        prefab_library.delete(first['line'])            # still placed: kept, hidden from the library
        with self.assertRaisesRegex(ValueError, 'no longer in the library'):
            prefab_library.new_version('Lobby', dict(entry, scale=None), self.cache / 'Lobby', {})

    def test_a_prefab_saved_before_versions_is_version_one_numbered_in_order(self):
        first = self.save_desk()
        marker_path = self.root / first['id'] / 'library.json'
        marker = json.loads(marker_path.read_text(encoding='utf-8'))
        for key in ('line', 'revision', 'slots'):
            del marker[key]
        marker_path.write_text(json.dumps(marker), encoding='utf-8')
        self.assertEqual(prefab_library.library()[0] | dict(thumb=''), dict(first, thumb=''))
        entry = dict(pid='p1', prefab=first['id'])
        structures = self.copy_cache(entry, lambda blocks: blocks + [LIGHT.format(name='Light9', x=1, y=2, z=3)])
        second = prefab_library.new_version('Lobby', entry, self.cache / 'Lobby', structures)
        self.assertEqual([b['slot'] for b in prefabs.load(second['id'])['blocks']], [0, 1, 2, 3])


class LibraryChangesTest(LibraryCase):
    def test_rename_renames_every_version(self):
        first = self.save_desk()
        entry = dict(pid='p1', prefab=first['id'])
        second = prefab_library.new_version('Lobby', entry, self.cache / 'Lobby', self.copy_cache(entry))
        item = prefab_library.rename(first['line'], '  Office desk ')
        self.assertEqual((item['label'], item['id']), ('Office desk', second['id']))
        for ident in (first['id'], second['id']):
            self.assertEqual(prefabs.load(ident)['label'], 'Office desk')
        self.assertEqual(prefab_library.library()[0]['label'], 'Office desk')
        with self.assertRaisesRegex(ValueError, '1–80 characters'):
            prefab_library.rename(first['line'], '')
        with self.assertRaisesRegex(ValueError, 'no such prefab'):
            prefab_library.rename(second['id'], 'A version is not a prefab')

    def test_the_picture_is_replaced_and_kept_with_the_first_version(self):
        first = self.save_desk()
        self.assertEqual(first['thumb'], '')
        item = prefab_library.thumbnail(first['line'], JPEG)
        self.assertEqual((self.root / first['id'] / 'thumb.jpg').read_bytes(), base64.b64decode(JPEG.split(',')[1]))
        self.assertTrue(item['thumb'].startswith('/prefabs/%s/thumb.jpg?v=' % first['id']))
        with self.assertRaisesRegex(ValueError, 'JPEG'):
            prefab_library.thumbnail(first['line'], 'data:image/png;base64,AAAA')
        with self.assertRaisesRegex(ValueError, 'Open a map'):
            prefab_library.thumbnail(first['line'], '')

    def test_delete_retires_every_version_and_takes_none_off_the_disk(self):
        first = self.save_desk()
        entry = dict(pid='p1', prefab=first['id'])
        second = prefab_library.new_version('Lobby', entry, self.cache / 'Lobby', self.copy_cache(entry))
        (self.maps / 'Lobby.edits.json').write_text(json.dumps({'prefabs': [entry, dict(entry, pid='p2')]}), encoding='utf-8')
        template = self.maps / 'templates' / '20261027-120000-Offices'
        template.mkdir(parents=True)
        (template / 'template.json').write_text(json.dumps({'name': 'Offices', 'edits': {'prefabs': [entry]}}), encoding='utf-8')
        self.assertEqual(prefab_library.usage(first['line']), dict(copies=3, places=['Lobby', 'template "Offices"']))
        result = prefab_library.delete(first['line'])
        self.assertEqual(result, dict(retired=2, places=['Lobby', 'template "Offices"']))
        self.assertEqual(prefab_library.library(), [])
        # no saved map places the second version, but the page's Undo, its clipboard or another tab may place it again:
        # it stays on disk, as the first one its copies are built from
        for ident in (first['id'], second['id']):
            self.assertEqual(prefabs.load(ident)['label'], 'Desk set')
        # nothing placed any more and another prefab deleted: still there (a later delete no longer takes them away)
        (self.maps / 'Lobby.edits.json').write_text('{}', encoding='utf-8')
        (template / 'template.json').write_text('{"edits": {}}', encoding='utf-8')
        other = self.save_desk()
        self.assertEqual(prefab_library.delete(other['line'], [other['id']]), dict(retired=1, places=['the open map']))
        for ident in (first['id'], second['id'], other['id']):
            self.assertTrue((self.root / ident / 'prefab.json').is_file(), ident)

    def test_the_project_opened_again_takes_away_what_nothing_saved_places(self):
        first = self.save_desk()
        entry = dict(pid='p1', prefab=first['id'])
        second = prefab_library.new_version('Lobby', entry, self.cache / 'Lobby', self.copy_cache(entry))
        kept = self.save_desk()                                                 # not deleted: never taken away
        (self.maps / 'Lobby.edits.json').write_text(json.dumps({'prefabs': [entry]}), encoding='utf-8')
        prefab_library.delete(first['line'])
        self.assertEqual(prefab_library.sweep(), 1)                             # the second version: placed by nothing saved
        self.assertFalse((self.root / second['id']).exists())
        self.assertEqual(prefabs.load(first['id'])['label'], 'Desk set')        # Lobby places it
        self.assertEqual([item['id'] for item in prefab_library.library()], [kept['id']])
        # a map that cannot be read: nothing goes, what it places is not known
        (self.maps / 'Lobby.edits.json').write_text('{}', encoding='utf-8')
        (self.maps / 'Broken.edits.json').write_text('{', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'Broken.edits.json cannot be read'):
            prefab_library.sweep()
        self.assertTrue((self.root / first['id']).exists())
        (self.maps / 'Broken.edits.json').write_text('{}', encoding='utf-8')
        self.assertEqual(prefab_library.sweep(), 1)
        self.assertFalse((self.root / first['id']).exists())
        self.assertTrue((self.root / kept['id']).exists())

    def test_delete_stops_when_a_map_cannot_be_read(self):
        first = self.save_desk()
        (self.maps / 'Broken.edits.json').write_text('{', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'Broken.edits.json cannot be read'):
            prefab_library.delete(first['line'])
        self.assertEqual([i['id'] for i in prefab_library.library()], [first['id']])


class MembersTest(LibraryCase):
    def test_members_are_where_the_build_puts_them(self):
        first = self.save_desk()
        entry = dict(pid='p3', prefab=first['id'], offset=[10, 20, 30], yaw=32768)
        found = prefab_library.members([entry])['p3']
        self.assertEqual(sorted(found), ['UCPfp3A1', 'UCPfp3A2', 'UCPfp3B0'])
        for block in place_text(entry):
            actor = next(t3d.actors(block))
            self.assertEqual(found[actor['name']]['cls'], actor['cls'])
            for k in range(3):
                self.assertAlmostEqual(found[actor['name']]['loc'][k], loc_of(block)[k], places=2)
        for wrong in ([dict(entry, pid='p 3')], [dict(entry, prefab='lib_Map_Piece')], [dict(entry, offset=[1, 2])], 'p3'):
            with self.assertRaises(ValueError):
                prefab_library.members(wrong)


class ServerTest(unittest.TestCase):
    """The routes' own part (editor/server.py): which library change a request makes, the copy Apply takes from the
    map's saved edits (the library and the map's checks are the tests above and prefab_snapshot's)."""
    def setUp(self):
        import server
        self.server, self.calls = server, []
        for target, name, value in ((server.tutorial, 'available', lambda: False),
                                    (prefab_library, 'rename', lambda line, label: self.calls.append(('rename', line, label))),
                                    (prefab_library, 'thumbnail', lambda line, picture: self.calls.append(('thumb', line, picture))),
                                    (prefab_library, 'delete', lambda line, also: self.calls.append(('delete', line, also))),
                                    (prefab_library, 'new_version', lambda *a: self.calls.append(('apply',) + a))):
            patcher = patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_the_browser_changes_reach_their_library_function(self):
        change = self.server.change_prefab_library
        change('/api/prefab_rename', {'line': 'L', 'label': 'Desk'})
        change('/api/prefab_thumb', {'line': 'L', 'picture': 'P'})
        change('/api/prefab_delete', {'line': 'L', 'open': ['usr_x']})
        self.assertEqual(self.calls, [('rename', 'L', 'Desk'), ('thumb', 'L', 'P'), ('delete', 'L', ['usr_x'])])
        for wrong in ([], {'line': 'L', 'open': 'usr_x'}):
            with self.assertRaises(ValueError):
                change('/api/prefab_delete', wrong)

    def test_apply_takes_the_copy_as_the_saved_map_has_it(self):
        saved = {'prefabs': [{'pid': 'p1', 'prefab': 'usr_' + 'a' * 32}, {'pid': 'p2', 'prefab': 'usr_' + 'a' * 32, 'unpacked': True}]}
        with patch.object(self.server, '_prefab_source', lambda script, body: ('Lobby', 'cache', saved)), \
                patch.object(self.server.data, 'structures', lambda name: {'paste~p1': {}}):
            self.server.apply_prefab('lobby', {'pid': 'p1', 'edits': {}})
            self.assertEqual(self.calls, [('apply', 'Lobby', saved['prefabs'][0], 'cache', {'paste~p1': {}})])
            with self.assertRaisesRegex(ValueError, 'unpacked'):
                self.server.apply_prefab('lobby', {'pid': 'p2', 'edits': {}})
            with self.assertRaisesRegex(ValueError, 'Rebuild first'):
                self.server.apply_prefab('lobby', {'pid': 'p9', 'edits': {}})


    def test_the_project_opening_takes_the_unplaced_versions_away_and_still_starts(self):
        with patch.object(prefab_library, 'sweep', lambda: 2), patch('builtins.print') as said:
            self.assertEqual(self.server.sweep_prefabs(), 2)
        self.assertIn('2 version(s)', said.call_args[0][0])

        def unreadable():
            raise ValueError('Cannot check where the prefab is placed: Broken.edits.json cannot be read.')
        with patch.object(prefab_library, 'sweep', unreadable), patch('builtins.print') as said:
            self.assertEqual(self.server.sweep_prefabs(), 0)                   # kept, said in the log; the editor starts
        self.assertIn('Broken.edits.json cannot be read', said.call_args[0][0])


class RoutesTest(unittest.TestCase):
    """The prefab routes as a page asks them (editor/server.py, its real Handler on a port of its own; this process is
    no project's editor: the hub)."""
    def setUp(self):
        from http.server import ThreadingHTTPServer
        import server
        self.server = server
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        patcher = patch.object(prefabs, 'ROOT', self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        srv = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.server_close)
        self.addCleanup(srv.shutdown)
        self.port = srv.server_port

    def ask(self, method, path, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        try:
            conn.request(method, path, body=b'{}' if method == 'POST' else None, headers=headers or {})
            response = conn.getresponse()
            return response.status, json.loads(response.read() or b'null')
        finally:
            conn.close()

    def bundle(self, ident, prefab='{"source": ""}'):
        """A version's files: its prefab.json, and its display (no groups)."""
        (self.root / ident).mkdir()
        (self.root / ident / 'prefab.json').write_text(prefab, encoding='utf-8')
        (self.root / ident / 'display.json').write_text('{"groups": []}', encoding='utf-8')

    def test_a_version_whose_files_are_gone_is_not_found_unlike_one_that_cannot_be_read(self):
        """404 is what a paste of a copy refuses (app.js refuseLostPrefabs: a deleted prefab's version taken off the
        disk when the project opened again, prefab_library.sweep); a file there that cannot be read is not "gone" (409,
        tried again later): batch 6's review, a fetch that failed once refused every later paste of that prefab."""
        there, gone, broken = 'usr_' + 'a' * 32, 'usr_' + 'b' * 32, 'usr_' + 'c' * 32
        self.bundle(there)
        self.bundle(broken, prefab='{')
        self.assertEqual(self.ask('GET', '/prefabs/%s/display.json' % there), (200, {'groups': []}))
        code, answer = self.ask('GET', '/prefabs/%s/display.json' % gone)
        self.assertEqual(code, 404)
        self.assertIn('not on disk', answer['error'])
        self.assertEqual(self.ask('GET', '/prefabs/%s/display.json' % broken)[0], 409)

    def test_the_hub_changes_no_prefab(self):
        """No version is ever retired by the hub, so it has none to take away as it starts (OpeningTest)."""
        asked, session = [], {'X-DeusEdix-Session': self.server.project_server.SESSION}
        with patch.object(prefab_library, 'delete', lambda *a: asked.append(a)):
            code, answer = self.ask('POST', '/api/prefab_delete', session)
        self.assertEqual((code, answer['error'], asked), (409, 'Choose a project first.', []))


class OpeningTest(unittest.TestCase):
    """editor/server.py main(): a project's editor (its worker) takes the versions of deleted prefabs that nothing saved
    places away as it starts, before any page of it is open (sweep_prefabs); the hub does not. The mod's own maps are a
    project too (projects.py 'legacy', opened in a worker like any other)."""
    def opening(self, worker):
        import server
        swept = []

        class NoServer:                     # the editor's HTTP server: closed as soon as it starts
            def __init__(self, address, handler):
                pass

            def serve_forever(self):
                pass

            def server_close(self):
                pass

        class NoThread:                     # watch_game's thread: never started
            def __init__(self, *args, **kwargs):
                pass

            def start(self):
                pass

        changes = ((server.project_server, 'WORKER', worker), (server.project_server, 'HOME_URL', ''),
                   (server.project_server.SUPERVISOR, 'shutdown', lambda: None), (server, 'game_running', lambda: True),
                   (server, 'sweep_prefabs', lambda: swept.append('swept')), (server, 'ThreadingHTTPServer', NoServer),
                   (server.threading, 'Thread', NoThread), (server.agent_bridge, 'register', lambda *a: None),
                   (server.agent_bridge, 'unregister', lambda *a: None), (sys, 'argv', ['server.py', '--no-browser']),
                   (Path, 'mkdir', lambda *a, **k: None))      # its folders: none made by the test
        with contextlib.ExitStack() as stack:
            for target, name, value in changes:
                stack.enter_context(patch.object(target, name, value))
            stack.enter_context(patch('builtins.print'))
            server.main()
        return swept

    def test_a_projects_editor_sweeps_as_it_starts_and_the_hub_does_not(self):
        self.assertEqual(self.opening(worker=True), ['swept'])
        self.assertEqual(self.opening(worker=False), [])


class PlaceSlotsTest(unittest.TestCase):
    def test_objects_are_named_by_their_slot_or_their_order(self):
        raw = LIGHT.format(name='Light1', x=0, y=0, z=0)
        pf = dict(pivot=[0, 0, 0], blocks=[dict(brush=False, raw=raw), dict(brush=False, raw=raw, slot=7)])
        names = [next(t3d.actors(b))['name'] for b in prefabs.place(dict(pid='p2', _prefab=pf))[0]]
        self.assertEqual(names, ['UCPfp2A0', 'UCPfp2A7'])
        self.assertEqual(prefabs.member_slot('p2', 'UCPfp2A7'), 7)
        self.assertIsNone(prefabs.member_slot('p2', 'UCPfp21A7'))


class BuildReceiptTest(unittest.TestCase):
    def test_a_copys_link_is_not_built(self):
        placed = {'prefabs': [{'pid': 'p1', 'prefab': 'usr_' + 'a' * 32, 'offset': [1, 2, 3]}]}
        linked = {'prefabs': [dict(placed['prefabs'][0], line='usr_' + 'a' * 32, version=1)]}
        unpacked = {'prefabs': [dict(placed['prefabs'][0], unpacked=True)]}
        self.assertEqual(prefab_snapshot.engine_edits(linked), prefab_snapshot.engine_edits(placed))
        self.assertEqual(prefab_snapshot.engine_edits(unpacked), prefab_snapshot.engine_edits(placed))
        moved = {'prefabs': [dict(placed['prefabs'][0], offset=[1, 2, 4])]}
        self.assertNotEqual(prefab_snapshot.engine_edits(moved), prefab_snapshot.engine_edits(placed))


if __name__ == '__main__':
    unittest.main()
