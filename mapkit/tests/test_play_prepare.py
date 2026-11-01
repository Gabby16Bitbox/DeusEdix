"""Play's preparation leaves out the package's compile, the map's build and the install of the packages when nothing
they are made from, nor what they made, changed since they last succeeded (editor/play_prepare.py, startup2 of 30 Oct
2026), and does each again for any change, a missing or changed output, a failure, another project or game, another
map. A fake kit, project and game in a temporary folder; the steps are stand-ins that write what the real ones do (the
compile writes the workspace's ini files again, as a development working copy's build.ps1 does); what runs between two
preparations (the page's dump of the map, Steam, a Pieces scan) is done by the tests that need it."""
import contextlib
import hashlib
import json
import os
import shutil
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'editor'))
import play_prepare  # noqa: E402

SCRIPT, MAP = 'new_01_room', '01_Room'


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data if isinstance(data, bytes) else data.encode('utf-8'))


def touch(path):
    """The same content written again (a later time), as the editor's saves do."""
    write(path, path.read_bytes())
    stat = path.stat()
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 5_000_000_000))


class PrepareTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = self.root = Path(temp.name)
        self.kit, self.project, self.game = root / 'kit', root / 'project', root / 'game'
        system = self.project / 'DevInstall' / 'System'
        # the engine's ini: the game's own System (a Revision project's Paths) and the System of the game played (the
        # original game's: where the install puts DeusEdixNav) among its folders
        ini = '[Core.System]\r\nPaths=%s\r\nPaths=%s\r\n[Editor.EditorEngine]\r\nEditPackages=Core\r\n' % (
            self.game / 'System' / '*.u', self.game / 'Revision' / 'System' / '*.u')
        files = {
            self.kit / 'kit.py': 'code', self.kit / 'editor' / 'server.py': 'code', self.kit / 'bin' / 'host.exe': 'host',
            self.kit / 'bin' / 'DeusEdixNav.dll': 'nav', self.kit / 'bin' / 'DeusEdixNav.u': 'nav package',
            self.kit / 'maps' / (SCRIPT + '.py'): 'room script', self.kit / 'maps' / (SCRIPT + '.edits.json'): '{}',
            self.kit / 'maps' / 'new_02_other.py': 'other script', self.kit / 'prefabs' / 'crate.json': '{}',
            self.kit / 'editor' / 'config' / 'palette.json': '{}', self.kit / 'packages.json': '{"extra": []}',
            self.kit / 'editor' / 'cache' / MAP / 'scene.t3d': 'scene', self.kit / 'editor' / 'cache' / '_classes.json': '{}',
            self.kit / 'editor' / 'cache' / '_palette' / 'defaults.json': '{}', root / 'gamecache' / '_palette' / 'index.json': '{}',
            self.project / 'dist' / 'P.u': 'package', self.project / 'maps' / '01_Old.dx': 'project map',
            self.project / 'src' / 'P' / 'Classes' / 'A.uc': 'class A', self.project / 'src' / 'PVoices' / 'V.wav': 'voice',
            self.project / 'build.ps1': 'build', self.project / 'tools' / 'tex.py': 'tool',
            self.project / 'DevInstall' / 'System' / 'Engine.u': 'engine', self.project / 'DevInstall' / 'workspace.json': '{}',
            system / 'Core.dll': 'core', system / 'DeusEx.ini': ini, system / 'Default.ini': ini, system / 'DefUser.ini': 'keys',
            system / 'Engine.int': 'engine texts', system / 'Game.exe': 'game program',
            system / 'steam_autocloud.vdf': 'Steam', self.project / 'release' / 'V.u': 'voices',
            self.kit / 'players.json': '{"version": 1, "default": "jc"}', self.kit / 'catalog' / 'texusage.json': '{}',
            self.kit / 'catalog' / 'objects.json': '{"updated": 1}', self.kit / 'editor' / 'cache' / '_gamecheck.json': '{}',
            self.game / 'Revision' / 'Mine' / '01_Room.dx': 'staged map', self.game / 'Revision' / 'System' / 'Revision.exe': 'game',
            self.game / 'System' / 'DeusEx.u': 'the original game',
        }
        for path, text in files.items():
            write(path, text)
        self.settings = types.SimpleNamespace(PROJECT_ID='p1', TARGET='revision', GAME=self.game, PROJECT=self.project,
                                              PACKAGE='P', VOICES_PACKAGE='PVoices', MAPS_DIR=self.game / 'Revision' / 'Mine',
                                              GAME_SYSTEM=self.game / 'Revision' / 'System', STANDALONE=False)
        self.workspace = types.SimpleNamespace(
            SYS=self.project / 'DevInstall' / 'System', STAMP=self.project / 'DevInstall' / 'workspace.json',
            DIST=self.project / 'dist', GAME_FILES=('DeusEdixNav.u', 'DeusEdixNav.dll'), needs_build=Mock(return_value=False))
        bin_ = self.kit / 'bin'
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.multiple(
            play_prepare, KIT=self.kit, RECORD=self.kit / 'out' / '.play-prepare.json', settings=self.settings,
            workspace=self.workspace,
            data=types.SimpleNamespace(OUT=self.kit / 'out', CACHE=self.kit / 'editor' / 'cache', GAME_CACHE=root / 'gamecache'),
            player_profiles=types.SimpleNamespace(FILE=self.kit / 'players.json'), create=True))
        # the kit itself (also preview_bundle's): its packages.json read as it is (kit.extra_packages), the workspace's
        # engine and its Paths, the host and DeusEdixNav, the editor's own packages
        stack.enter_context(patch.multiple(
            play_prepare.kit, DEV=system, PROJECT=self.project, PACKAGES_FILE=self.kit / 'packages.json',
            host_files=lambda: [bin_ / 'host.exe'], native_files=lambda: [bin_ / 'DeusEdixNav.u', bin_ / 'DeusEdixNav.dll'],
            editor_packages=lambda: ('PModels', 'PSounds', 'PScripts'), create=True))
        self.runs = []
        self.modes = []                 # the rebuild mode of each build of a map
        self.fail_next = None

    def compile(self):
        """build.ps1 -Isolated: its make-ini.ps1 writes the workspace's DeusEx.ini and Default.ini again (the same text, a
        later time), then the package and its voices go into dist."""
        self.runs.append('compile')
        for name in ('DeusEx.ini', 'Default.ini'):
            touch(self.workspace.SYS / name)
        for package in ('P', 'PVoices'):
            sources = sorted(p for p in (self.project / 'src' / package).rglob('*') if p.is_file())
            write(self.project / 'dist' / (package + '.u'),
                  b'package of ' + hashlib.sha256(b''.join(p.read_bytes() for p in sources)).digest())
        return True, ['OK: dist\\P.u']

    def build(self, script=SCRIPT, map_name=MAP, mode='auto'):
        self.runs.append('map ' + script)
        self.modes.append(mode)
        if self.fail_next == 'map':
            self.fail_next = None
            return False, ['The rebuild failed']
        edits = self.kit / 'maps' / (script + '.edits.json')
        write(self.kit / 'out' / (map_name + '.dx'),
              b'built from ' + (edits.read_bytes() if edits.exists() else b'') + b' in ' + mode.encode())
        return True, ['built %s in 2.3s' % map_name]

    def install(self):
        self.runs.append('install')
        self.settings.MAPS_DIR.mkdir(parents=True, exist_ok=True)
        for f in (self.project / 'dist').glob('*.u'):
            shutil.copy2(f, self.settings.MAPS_DIR / f.name)
        for name in ('DeusEdixNav.u', 'DeusEdixNav.dll'):
            shutil.copy2(self.kit / 'bin' / name, self.settings.GAME_SYSTEM / name)
        return True, ['installed P.u', 'Done.']

    def dump(self):
        """The page's dump of the map it shows (data.prepare), made again from the build's output after a build: every
        file of editor/cache/<map> written again."""
        for path in (self.kit / 'editor' / 'cache' / MAP).iterdir():
            write(path, path.read_bytes() + b' ')

    def change(self, name, value):
        """Another value of a setting (a folder: made, as the game's are)."""
        if isinstance(value, Path):
            value.mkdir(parents=True, exist_ok=True)
        setattr(self.settings, name, value)

    def move_project(self):
        """The project in another folder, its files as they were (copytree keeps their times)."""
        moved = self.root / 'moved'
        shutil.copytree(self.project, moved)
        self.settings.PROJECT = moved

    def prepare(self, script=SCRIPT, map_name=MAP):
        self.runs = []
        files = [self.kit / 'maps' / (script + '.py'), self.kit / 'maps' / (script + '.edits.json')]
        ok, lines = play_prepare.prepare(script, map_name, files, self.compile,
                                         lambda mode='auto': self.build(script, map_name, mode), self.install)
        return ok, lines, self.runs

    def test_an_unchanged_map_is_not_built_compiled_or_installed_again_and_the_lines_say_so(self):
        self.assertEqual(self.prepare()[2], ['compile', 'map ' + SCRIPT, 'install'])
        ok, lines, runs = self.prepare()
        self.assertTrue(ok)
        self.assertEqual(runs, [])
        self.assertEqual(lines, ['Package unchanged since it was last compiled: not compiled again.',
                                 'Map unchanged since the last Play: not rebuilt.',
                                 'Packages unchanged since the last Play: not installed again.'])

    def test_each_input_changed_alone_does_its_step_again(self):
        """What each step is made from, changed alone: that step runs again (a package compiled again: the map's build
        and the install too, as they are made from it), the others are left out. The kit's code is not what a
        development working copy's compile is made from (its build.ps1 and the host are). The project's player
        character and other mods' packages feed every map's build (player_profiles.blocks; kit.new_run, kit._ini) and
        the engine's ini files are read by their text (review of 30 Oct 2026)."""
        kit, project, game = self.kit, self.project, self.game
        cases = {
            "the map's script": (lambda: write(kit / 'maps' / (SCRIPT + '.py'), 'room script, wider'), ['map']),
            'its edits': (lambda: write(kit / 'maps' / (SCRIPT + '.edits.json'), '{"moved": {}}'), ['map']),
            "another map's script (the kit's data)": (lambda: write(kit / 'maps' / 'new_02_other.py', 'x'), ['map']),
            'a prefab': (lambda: touch(kit / 'prefabs' / 'crate.json'), ['map']),
            'a character': (lambda: write(kit / 'characters' / 'guard.json', '{}'), ['map']),
            'an imported model': (lambda: write(kit / 'models' / 'barrier.json', '{}'), ['map']),
            'an animation': (lambda: write(kit / 'anims' / 'wave.json', '{}'), ['map']),
            'a sound': (lambda: write(kit / 'sounds' / 'door.wav', 'wav'), ['map']),
            'a voice': (lambda: write(kit / 'dubs' / 'line.ogg', 'ogg'), ['map']),
            "an original map's reference": (lambda: write(kit / 'refs' / '01_Map.t3d.gz', 'gz'), ['map']),
            'a story': (lambda: write(kit / 'story' / '01_Room.json', '{}'), ['map']),
            "the tutorial's": (lambda: write(kit / 'tutorial' / 'steps.json', '{}'), ['map']),
            "the textures' catalog": (lambda: touch(kit / 'catalog' / 'texusage.json'), ['map']),
            'an imported texture': (lambda: write(kit / 'textures' / MAP / 'paint.png', 'png'), ['map']),
            "the editor's settings": (lambda: touch(kit / 'editor' / 'config' / 'palette.json'), ['map']),
            "the classes' defaults": (lambda: touch(kit / 'editor' / 'cache' / '_palette' / 'defaults.json'), ['map']),
            "the kit's Python": (lambda: touch(kit / 'kit.py'), ['map', 'install']),
            "the editor's Python": (lambda: touch(kit / 'editor' / 'server.py'), ['map', 'install']),
            'the host (the compiler)': (lambda: write(kit / 'bin' / 'host.exe', 'host 2'), ['compile', 'map', 'install']),
            'DeusEdixNav': (lambda: write(kit / 'bin' / 'DeusEdixNav.dll', 'nav 2'), ['compile', 'map', 'install']),
            'the host written again, the same': (lambda: touch(kit / 'bin' / 'host.exe'), ['map', 'install']),
            'the engine': (lambda: touch(project / 'DevInstall' / 'System' / 'Engine.u'), ['compile', 'map', 'install']),
            "the workspace's record of the game": (lambda: write(project / 'DevInstall' / 'workspace.json', '{"v": 2}'),
                                                    ['compile', 'map', 'install']),
            "the engine's ini, another text": (lambda: write(project / 'DevInstall' / 'System' / 'DeusEx.ini', 'EditPackages=X'),
                                               ['compile', 'map', 'install']),
            "the project's player character": (lambda: write(kit / 'players.json', '{"version": 1, "default": "officer"}'),
                                               ['map']),
            "a package of the release folder": (lambda: touch(project / 'release' / 'V.u'), ['install']),
            "the package's sources": (lambda: write(project / 'src' / 'P' / 'Classes' / 'A.uc', 'class A 2'),
                                      ['compile', 'map', 'install']),
            "the voices' sources": (lambda: touch(project / 'src' / 'PVoices' / 'V.wav'), ['compile', 'map', 'install']),
            'a build script': (lambda: touch(project / 'build.ps1'), ['compile', 'map', 'install']),
            "the build's tools": (lambda: touch(project / 'tools' / 'tex.py'), ['compile', 'map', 'install']),
            'the packages list': (lambda: write(kit / 'packages.json', '{"extra": [{"name": "Listed", "path": ""}]}'),
                                  ['map', 'install']),
            "another mod's package": (self.another_mod, ['map', 'install']),
            'the project (another one on the same kit)': (lambda: setattr(self.settings, 'PROJECT_ID', 'p2'),
                                                          ['compile', 'map', 'install']),
            'the game targeted': (lambda: setattr(self.settings, 'TARGET', 'vanilla'), ['compile', 'map', 'install']),
            "the game's folder": (lambda: setattr(self.settings, 'GAME', self.root / 'game2'), ['compile', 'map', 'install']),
        }
        for case, (change, expected) in cases.items():
            with self.subTest(case):
                self.prepare()
                self.assertEqual(self.prepare()[2], [], 'unchanged before the change')
                change()
                self.assertEqual([r.split(' ')[0] for r in self.prepare()[2]], expected)

    def another_mod(self):
        write(self.root / 'mods' / 'Other.u', 'other mod')
        self.register(dict(name='Other', path=str(self.root / 'mods' / 'Other.u')))

    def register(self, *packages):
        """Other mods' packages kept with the project, as the Packages panel saves them (packages.json)."""
        write(self.kit / 'packages.json', json.dumps(dict(extra=list(packages))))

    def test_another_mods_package_replaced_in_place_builds_and_installs_again(self):
        """Import a mod again: packages.save writes the same packages.json and mods/<Mod>/Other.u (or its .int) is
        replaced; only the packages' own files say so (review of 30 Oct 2026, #10)."""
        mods = self.root / 'mods'
        write(mods / 'Other.u', 'other mod 1')
        write(mods / 'Other.int', 'texts 1')
        self.register(dict(name='Other', path=str(mods / 'Other.u')))
        for name, text in (('Other.u', 'other mod 2, its classes changed'), ('Other.int', 'texts 2, longer')):
            with self.subTest(name):
                self.prepare()
                self.assertEqual(self.prepare()[2], [], 'unchanged before the change')
                write(mods / name, text)
                self.assertEqual([r.split(' ')[0] for r in self.prepare()[2]], ['map', 'install'])

    def test_a_package_the_game_finds_changed_builds_the_map_again(self):
        """Another mod's package the game finds (the Packages panel keeps no path for it) is loaded by every map build
        from the game's folders (kit._ini: an EditPackage, found through the run's Paths) and installed by nobody: a new
        version of it builds the map again (review of 30 Oct 2026, #1). DeusEdixNav, which the install writes into the
        game's System (among the Paths here), is not what a build loads (its run has its own): an unchanged map is left
        out after the install put it there."""
        write(self.game / 'System' / 'Other.u', 'other mod, version 1')
        self.register(dict(name='Other', path=''))
        self.prepare()
        self.assertTrue((self.settings.GAME_SYSTEM / 'DeusEdixNav.u').is_file())
        self.assertEqual(self.prepare()[2], [], 'unchanged before the change')
        write(self.game / 'System' / 'Other.u', 'other mod, version 2: its classes changed')
        self.assertEqual([r.split(' ')[0] for r in self.prepare()[2]], ['map'])

    def test_the_editors_own_packages_written_do_not_compile_the_package_again(self):
        """A development working copy's compile (build.ps1) makes the project's package and its voices; the editor's
        own packages (its scripts, written into the workspace's System and dist; the models and sounds imported, into
        dist) are neither made nor read by it: the map and the install only (review of 30 Oct 2026, #3). Nor are the
        scripts' classes (src\\<scripts' package>: scripts.py compiles them), nor the package's and its voices'
        copies in the workspace's System, which build.ps1 never links (re-test 3 of 31 Oct 2026, #3: a script saved in
        Tools > Scripts compiled the whole package at the next Play)."""
        system, dist = self.workspace.SYS, self.project / 'dist'
        cases = {
            "the editor's scripts (System and dist)": (lambda: [write(system / 'PScripts.u', 'scripts 2'),
                                                                write(dist / 'PScripts.u', 'scripts 2')],
                                                       ['map', 'install']),
            "the imported models (dist)": (lambda: write(dist / 'PModels.u', 'models 2'), ['map', 'install']),
            "the imported sounds (dist)": (lambda: write(dist / 'PSounds.u', 'sounds 2'), ['map', 'install']),
            "a script's class saved (Tools > Scripts)": (
                lambda: write(self.project / 'src' / 'PScripts' / 'Classes' / 'Door.uc', 'class Door extends UCScript;'),
                []),
            "the scripts compiled, the package copied from dist into the System": (
                lambda: [shutil.copy2(dist / 'P.u', system / 'P.u'), write(system / 'PScripts.u', 'scripts 3'),
                         write(dist / 'PScripts.u', 'scripts 3')], ['map', 'install']),
            "a copy of the voices in the System": (lambda: write(system / 'PVoices.u', 'older voices'), ['map']),
        }
        for case, (change, expected) in cases.items():
            with self.subTest(case):
                self.prepare()
                self.assertEqual(self.prepare()[2], [], 'unchanged before the change')
                change()
                self.assertEqual([r.split(' ')[0] for r in self.prepare()[2]], expected)

    def test_the_same_text_saved_again_changes_nothing_but_a_package_compiled_again_does(self):
        """The editor saves a map's edits and the Story writes the package's classes again before every Play: by their
        content, the same text is no change. The voices and other files by size and time."""
        self.prepare()
        touch(self.kit / 'maps' / (SCRIPT + '.edits.json'))
        touch(self.kit / 'maps' / (SCRIPT + '.py'))
        touch(self.project / 'src' / 'P' / 'Classes' / 'A.uc')
        self.assertEqual(self.prepare()[2], [])

    def test_a_missing_or_changed_output_is_made_again(self):
        out, installed = self.kit / 'out' / (MAP + '.dx'), self.settings.MAPS_DIR / 'P.u'
        cases = {
            "the map's build deleted": (lambda: out.unlink(), ['map']),
            "the map's build changed (another tool)": (lambda: write(out, 'objects only'), ['map']),
            'the installed package deleted': (lambda: installed.unlink(), ['install']),
            'the installed package changed': (lambda: write(installed, 'older package'), ['install']),
            "the game's DeusEdixNav changed": (lambda: write(self.settings.GAME_SYSTEM / 'DeusEdixNav.dll', 'old'),
                                              ['install']),
            'the compiled package changed': (lambda: write(self.project / 'dist' / 'P.u', 'by hand'),
                                             ['compile', 'map', 'install']),
            # the compile makes the voices too (_compile_made: cross-check of 31 Oct 2026)
            'the compiled voices changed': (lambda: write(self.project / 'dist' / 'PVoices.u', 'by hand'),
                                            ['compile', 'map', 'install']),
            'the compiled voices deleted': (lambda: (self.project / 'dist' / 'PVoices.u').unlink(),
                                            ['compile', 'map', 'install']),
            'a map staged in the game (Play puts it back)': (lambda: write(self.settings.MAPS_DIR / '01_Room.dx', 'staged'),
                                                             []),
            "a save of the game's in the project's folder": (lambda: write(self.settings.MAPS_DIR / 'Save' / 'Save0.dxs', 's'),
                                                             []),
        }
        for case, (change, expected) in cases.items():
            with self.subTest(case):
                self.prepare()
                self.assertEqual(self.prepare()[2], [])
                change()
                self.assertEqual([r.split(' ')[0] for r in self.prepare()[2]], expected)

    def test_a_build_that_leaves_no_map_is_not_recorded(self):
        """A build that says it succeeded but left no out map (never expected: both builds fail first) is done again."""
        self.prepare()
        touch(self.kit / 'prefabs' / 'crate.json')
        (self.kit / 'out' / (MAP + '.dx')).unlink()
        with patch.object(self, 'build', return_value=(True, ['built nothing'])):
            self.assertEqual(self.prepare()[1][1], 'built nothing')
        self.assertEqual(self.prepare()[2], ['map ' + SCRIPT])

    def test_a_failed_step_is_done_again_and_ends_the_preparation(self):
        self.prepare()
        write(self.kit / 'maps' / (SCRIPT + '.edits.json'), '{"a": 1}')
        self.fail_next = 'map'
        ok, lines, runs = self.prepare()
        self.assertFalse(ok)
        self.assertEqual(runs, ['map ' + SCRIPT], 'the install does not follow a failed build')
        self.assertEqual(lines[-1], 'The rebuild failed')
        self.assertNotIn('map ' + SCRIPT, json.loads(play_prepare.RECORD.read_text(encoding='utf-8')))
        self.assertEqual(self.prepare()[2], ['map ' + SCRIPT])
        self.assertEqual(self.prepare()[2], [])

    def test_a_step_that_raises_is_done_again(self):
        self.prepare()
        touch(self.kit / 'prefabs' / 'crate.json')
        with patch.object(self, 'build', side_effect=RuntimeError('host crashed')):
            with self.assertRaisesRegex(RuntimeError, 'host crashed'):
                self.prepare()
        self.assertEqual(self.prepare()[2], ['map ' + SCRIPT])

    def test_a_change_made_while_a_step_runs_is_seen_next_time(self):
        self.prepare()
        touch(self.kit / 'prefabs' / 'crate.json')
        real = self.build

        def build(script=SCRIPT, map_name=MAP, mode='auto'):
            result = real(script, map_name, mode)
            write(self.kit / 'maps' / (SCRIPT + '.edits.json'), '{"saved while building": 1}')
            return result
        with patch.object(self, 'build', build):
            self.prepare()
        self.assertEqual(self.prepare()[2], ['map ' + SCRIPT])

    def test_another_maps_record_never_stands_for_this_one(self):
        write(self.kit / 'maps' / 'new_02_other.edits.json', '{}')
        self.prepare()
        self.assertEqual(self.prepare('new_02_other', '02_Other')[2], ['map new_02_other'])
        self.assertEqual(self.prepare()[2], [], 'each map keeps its own record')

    def test_what_cannot_be_read_is_done_again(self):
        self.prepare()
        write(self.kit / 'out' / (MAP + '.dxinfo.json'), 'not json')
        self.assertEqual(self.prepare()[2], ['map ' + SCRIPT])
        self.assertEqual(self.prepare()[2], ['map ' + SCRIPT], 'nothing recorded while it cannot be read')
        write(self.kit / 'out' / (MAP + '.dxinfo.json'), '{"structures": {}, "built": {"at": 1}}')
        self.prepare()
        write(self.kit / 'out' / (MAP + '.dxinfo.json'), '{"structures": {}, "built": {"at": 2}}')
        self.assertEqual(self.prepare()[2], [], "a .dx map's record of its last build is not what it is made from")
        write(self.kit / 'out' / (MAP + '.dxinfo.json'), '{"structures": {"Crate": {}}, "built": {"at": 2}}')
        self.assertEqual(self.prepare()[2], ['map ' + SCRIPT])
        play_prepare.RECORD.write_text('[1, 2]', encoding='utf-8')
        self.assertEqual(self.prepare()[2], ['compile', 'map ' + SCRIPT, 'install'], 'a record that is not one')

    def test_deusedix_own_workspace_compiles_only_when_it_says_so(self):
        """DeusEdix's workspace keeps its own record of its package (workspace.needs_build); a development working copy's
        build.ps1 keeps none, and compiled at every Play before."""
        self.settings.STANDALONE = True
        self.workspace.needs_build.return_value = True
        self.assertEqual(self.prepare()[2], ['compile', 'map ' + SCRIPT, 'install'])
        self.assertEqual(self.prepare()[2], ['compile', 'map ' + SCRIPT, 'install'],
                         'needs_build decides, not a record here (a package compiled again: built and installed again)')
        self.workspace.needs_build.return_value = False
        ok, lines, runs = self.prepare()
        self.assertEqual(runs, [])
        self.assertEqual(lines[0], 'Package unchanged since it was last compiled: not compiled again.')

    def test_what_changes_by_itself_or_feeds_no_build_does_nothing(self):
        """Written between two preparations by what runs anyway, and read by no build: the page's dump of the map
        (editor/cache/<map>, made again from the build's own output), Steam's steam_autocloud.vdf in the workspace's
        System (a link to the game's file: Steam rewrites it at every launch of Revision), a log there, a Pieces scan's
        catalog, the page's other caches (its check of the game, its list of classes, the game's palette, made from the
        game: by the workspace's record of it); the player character, the packages list and the engine's ini written
        again with the same text (game test of 30 Oct 2026: the map was built again at every Play; review: a development
        working copy compiled again at every Play, its build.ps1 writing the ini files again). The project's other maps
        (Install of another map writes its .dx there) and other maps' edits, which no map's build reads (re-test 4 of
        31 Oct 2026, #2: each built this unchanged map again at its next Play)."""
        kit, system = self.kit, self.workspace.SYS
        cases = {
            "another map of the project (.dx)": lambda: touch(self.project / 'maps' / '01_Old.dx'),
            'another map installed': lambda: write(self.project / 'maps' / '02_Other.dx', 'the build of another map'),
            "another map's edits saved": lambda: write(kit / 'maps' / 'new_02_other.edits.json', '{"moved": {}}'),
            "an archive of another map's edits": lambda: write(
                kit / 'maps' / 'new_02_other.edits.installato_20261031-120000.json', '{}'),
            "the page's dump of the map": self.dump,
            "Steam's file in the workspace's System": lambda: write(system / 'steam_autocloud.vdf', 'Steam, later'),
            "a log in the workspace's System": lambda: write(system / 'Revision.log', 'a log'),
            "a Pieces scan's catalog": lambda: write(kit / 'catalog' / 'objects.json', '{"updated": 2}'),
            "the editor's check of the game": lambda: write(kit / 'editor' / 'cache' / '_gamecheck.json', '{"x": 1}'),
            "the page's list of classes": lambda: touch(kit / 'editor' / 'cache' / '_classes.json'),
            "the game's palette": lambda: touch(self.root / 'gamecache' / '_palette' / 'index.json'),
            'the player character, the same text': lambda: touch(kit / 'players.json'),
            'the packages list, the same text': lambda: touch(kit / 'packages.json'),
            "the engine's ini, the same text": lambda: touch(system / 'DeusEx.ini'),
        }
        for standalone in (False, True):
            self.settings.STANDALONE = standalone
            for case, change in cases.items():
                with self.subTest(case, standalone=standalone):
                    self.prepare()
                    self.assertEqual(self.prepare()[2], [], 'unchanged before the change')
                    change()
                    self.assertEqual(self.prepare()[2], [])

    def test_the_catalog_files_a_build_makes_from_the_game_build_no_map_again(self):
        """A map script's build writes the catalog files it needs and does not find, made from the game: the size of a
        class a drop() or snap() places (sizes.query: catalog/sizes.json, written again at every build when the host has
        no size for a class) and the index of a texture package (texcat.ensure_index: catalog/<package>.txt). Like the
        Pieces' catalog they are BY_THE_GAME: the map whose build wrote one is left out at the next Play, and so is a
        map another map's build wrote one after (re-test 4 of 31 Oct 2026, #1: each write built that map and every
        other one once more)."""
        import sizes
        import texcat
        written = {'a class sized': self.kit / sizes.CACHE.relative_to(sizes.HERE),
                   "a package's index": self.kit / texcat.CATALOG.relative_to(texcat.HERE) / 'CoreTexWood.txt'}
        real = self.build
        for case, path in written.items():
            def build(script=SCRIPT, map_name=MAP, mode='auto', path=path):
                write(path, (path.read_text() if path.exists() else '') + script + '\n')     # what this build asked
                return real(script, map_name, mode)
            with self.subTest(case), patch.object(self, 'build', build):
                self.prepare()
                write(self.kit / 'maps' / (SCRIPT + '.py'), 'room script, %s' % case)
                self.assertEqual(self.prepare()[2], ['map ' + SCRIPT])
                self.assertEqual(self.prepare()[2], [], 'its build wrote it: left out next time')
                self.assertEqual(self.prepare('new_02_other', '02_Other')[2], ['map new_02_other'])
                self.assertEqual(self.prepare()[2], [], "another map's build wrote it")

    def test_in_deusedix_own_workspace_what_only_the_map_or_the_install_reads_counts_alone(self):
        """DeusEdix's workspace compiles only when needs_build says so, so what only the map's build or the install reads
        is seen alone there (review of 30 Oct 2026: in a development working copy the compile ran first and made the rest
        again, and no test saw these): the engine, the project and the game they are for, the version of the hashes."""
        self.settings.STANDALONE = True
        system, game, version = self.workspace.SYS, self.game / 'Revision', play_prepare.VERSION
        self.addCleanup(setattr, play_prepare, 'VERSION', version)
        cases = {
            'a package of the engine': (lambda: touch(system / 'Engine.u'), ['map']),
            'a library of the engine': (lambda: touch(system / 'Core.dll'), ['map']),
            'the texts of a package of the engine': (lambda: touch(system / 'Engine.int'), ['map']),
            'a program of the engine': (lambda: touch(system / 'Game.exe'), ['map']),
            "the engine's ini, another text": (lambda: write(system / 'DeusEx.ini', 'EditPackages=X'), ['map']),
            'DefUser.ini, another text': (lambda: write(system / 'DefUser.ini', 'other keys'), ['map']),
            "the project's folder in the game": (lambda: self.change('MAPS_DIR', game / 'Other'), ['map', 'install']),
            "the game's System": (lambda: self.change('GAME_SYSTEM', game / 'System2'), ['map', 'install']),
            "the project's package": (lambda: self.change('PACKAGE', 'P2'), ['map', 'install']),
            'the project moved, its files as they were': (self.move_project, ['map', 'install']),
            "the project's tools (Python)": (lambda: touch(self.settings.PROJECT / 'tools' / 'tex.py'), ['map', 'install']),
            'the version of the hashes': (lambda: setattr(play_prepare, 'VERSION', version + 1), ['map', 'install']),
        }
        for case, (change, expected) in cases.items():
            with self.subTest(case):
                self.prepare()
                self.assertEqual(self.prepare()[2], [], 'unchanged before the change')
                change()
                self.assertEqual([r.split(' ')[0] for r in self.prepare()[2]], expected)

    def test_a_rebuild_made_as_plays_build_leaves_the_maps_record(self):
        """The page's Rebuild, in any mode (server.rebuild: play_prepare.rebuilt), is always built and leaves
        the record the preparation's build leaves, so the next Play does not build the map again; a failed one leaves
        none (fix-back2, 30 Oct 2026: the first Play after a Rebuild built the map once more), and the map's script
        saved while one builds (from a text editor: the page's saves wait for it) is built by the next Play
        (cross-check of 30 Oct 2026)."""
        self.settings.STANDALONE = True
        files = [self.kit / 'maps' / (SCRIPT + '.py'), self.kit / 'maps' / (SCRIPT + '.edits.json')]
        self.prepare()
        write(files[1], '{"moved": {"Crate0": [1, 2, 3]}}')
        self.assertTrue(play_prepare.rebuilt(SCRIPT, MAP, files, self.build)[0])
        ok, lines, runs = self.prepare()
        self.assertEqual(runs, [])
        self.assertIn('Map unchanged since the last Play: not rebuilt.', lines)
        self.runs = []
        play_prepare.rebuilt(SCRIPT, MAP, files, self.build)
        self.assertEqual(self.runs, ['map ' + SCRIPT], 'a Rebuild is always built')
        self.fail_next = 'map'
        self.assertFalse(play_prepare.rebuilt(SCRIPT, MAP, files, self.build)[0])
        self.assertEqual(self.prepare()[2], ['map ' + SCRIPT], 'a failed Rebuild leaves no record')

        def saved_while_it_builds():
            result = self.build()
            write(files[0], 'room script, saved while it builds')
            return result
        self.assertTrue(play_prepare.rebuilt(SCRIPT, MAP, files, saved_while_it_builds)[0])
        self.assertEqual(self.prepare()[2], ['map ' + SCRIPT], 'a change made while a Rebuild runs is seen next time')

    def test_a_rebuilds_mode_is_the_mode_of_the_maps_next_builds(self):
        """A Rebuild in Lighting, Paths or Full keeps its mode with the map's record (rebuilt): the unchanged map is
        still left out, and a Play after any change builds it in that mode and says so, as do the next ones, until a
        Rebuild in Automatic (re-test 3 of 31 Oct 2026, #1: a Story line edited after a Lighting Rebuild, Play built the
        map in Automatic and the relighting was gone, with nothing in the log saying why). A mode that is none is
        Automatic."""
        self.settings.STANDALONE = True
        files = [self.kit / 'maps' / (SCRIPT + '.py'), self.kit / 'maps' / (SCRIPT + '.edits.json')]
        self.prepare()
        # the line names the modes as the Rebuild menu does (rebuild.NAMES; cross-check of 31 Oct 2026: 'Paths')
        said = {'lighting': 'Lighting', 'paths': 'AI paths', 'full': 'Full'}
        for mode in ('lighting', 'paths', 'full'):
            with self.subTest(mode):
                self.assertTrue(play_prepare.rebuilt(SCRIPT, MAP, files, lambda: self.build(mode=mode), mode)[0])
                self.assertEqual(self.prepare()[2], [], 'unchanged, its mode in its record')
                write(self.kit / 'story' / '01_Room.json', '{"line": "%s"}' % mode)
                ok, lines, runs = self.prepare()
                self.assertEqual((runs, self.modes[-1]), (['map ' + SCRIPT], mode))
                self.assertIn('Rebuilding the map in %s, the mode of its last Rebuild (a Rebuild in Automatic goes '
                              'back to the usual build).' % said[mode], lines)
                touch(self.kit / 'prefabs' / 'crate.json')
                self.prepare()
                self.assertEqual(self.modes[-1], mode, "kept by the Play's own build")
        play_prepare.rebuilt(SCRIPT, MAP, files, self.build, 'auto')
        write(self.kit / 'story' / '01_Room.json', '{"line": "automatic"}')
        ok, lines, runs = self.prepare()
        self.assertEqual((runs, self.modes[-1]), (['map ' + SCRIPT], 'auto'))
        self.assertFalse([line for line in lines if 'the mode of its last Rebuild' in line])
        records = json.loads(play_prepare.RECORD.read_text(encoding='utf-8'))
        records['map ' + SCRIPT]['mode'] = 'MAP NEW'
        play_prepare.RECORD.write_text(json.dumps(records), encoding='utf-8')
        self.assertEqual(self.prepare()[2], [], 'fed and made decide, not the mode')
        touch(self.kit / 'prefabs' / 'crate.json')
        self.prepare()
        self.assertEqual(self.modes[-1], 'auto', 'a mode that is none')

    def test_a_failed_build_keeps_the_maps_rebuild_mode(self):
        """The mode stays with the map's record while its build runs and after the build failed or raised: the next
        Play builds the map in it still."""
        self.settings.STANDALONE = True
        files = [self.kit / 'maps' / (SCRIPT + '.py'), self.kit / 'maps' / (SCRIPT + '.edits.json')]
        self.prepare()
        play_prepare.rebuilt(SCRIPT, MAP, files, lambda: self.build(mode='lighting'), 'lighting')
        write(files[1], '{"a": 1}')
        self.fail_next = 'map'
        self.assertFalse(self.prepare()[0])
        with patch.object(self, 'build', side_effect=RuntimeError('host crashed')):
            with self.assertRaisesRegex(RuntimeError, 'host crashed'):
                self.prepare()
        self.assertEqual(self.prepare()[2], ['map ' + SCRIPT])
        self.assertEqual(self.modes, ['auto', 'lighting', 'lighting', 'lighting'])

    def test_a_forced_rebuild_that_ran_and_failed_keeps_its_mode(self):
        """A Rebuild in a forced mode that ran and failed, not cancelled, leaves its mode in the map's record, also when
        the map had no record yet: the next Play builds the map in it."""
        self.settings.STANDALONE = True
        files = [self.kit / 'maps' / (SCRIPT + '.py'), self.kit / 'maps' / (SCRIPT + '.edits.json')]
        self.fail_next = 'map'
        self.assertFalse(play_prepare.rebuilt(SCRIPT, MAP, files, lambda: self.build(mode='lighting'), 'lighting')[0])
        self.assertEqual((self.prepare()[2][0], self.modes[-1]), ('map ' + SCRIPT, 'lighting'), 'no record before it')
        with self.assertRaisesRegex(RuntimeError, 'host crashed'):
            play_prepare.rebuilt(SCRIPT, MAP, files, Mock(side_effect=RuntimeError('host crashed')), 'paths')
        self.assertEqual((self.prepare()[2], self.modes[-1]), (['map ' + SCRIPT], 'paths'))

    def test_a_cancelled_rebuild_leaves_the_maps_record_as_it_was(self):
        """A Rebuild cancelled (build_job.cancel: its build raises kit.Stopped, or ends, returning or raising, when its
        job says it was cancelled: rebuilt's cancelled()) leaves the map's record as it was before it, as
        build_job.put_back brings back the output that record describes: the unchanged map is still left out, and no
        Play builds it in the cancelled Rebuild's mode (cross-check of 31 Oct 2026: a cancelled Lighting Rebuild left
        its mode in the record, so the next Play built the unchanged map, in Lighting, and so did every Play that built
        it)."""
        self.settings.STANDALONE = True
        files = [self.kit / 'maps' / (SCRIPT + '.py'), self.kit / 'maps' / (SCRIPT + '.edits.json')]
        output = self.kit / 'out' / (MAP + '.dx')

        def stopped():
            output.write_bytes(b'half a lighting build')
            raise play_prepare.kit.Stopped('The run was cancelled.')

        def failed():
            output.write_bytes(b'half a lighting build')
            return False, ['The rebuild failed']

        def broken():
            output.write_bytes(b'half a lighting build')
            raise RuntimeError('Native build worker exited before completing the batch.')
        with self.assertRaises(play_prepare.kit.Stopped):
            play_prepare.rebuilt(SCRIPT, MAP, files, stopped, 'lighting')
        output.unlink()                                             # build_job.put_back: there was none
        self.assertNotIn('map ' + SCRIPT, play_prepare._load(), 'no record before it, none after')
        self.prepare()
        self.assertEqual(self.modes, ['auto'])
        play_prepare.rebuilt(SCRIPT, MAP, files, lambda: self.build(mode='paths'), 'paths')     # an earlier Rebuild's
        record = play_prepare._load()['map ' + SCRIPT]
        kept = output.read_bytes()                                  # build_job.keep
        for case, build, cancelled in (('kit.Stopped', stopped, lambda: False), ('failed', failed, lambda: True),
                                       ('raised', broken, lambda: True),
                                       ('built, then cancelled', lambda: self.build(mode='lighting'), lambda: True)):
            with self.subTest(case):
                try:
                    play_prepare.rebuilt(SCRIPT, MAP, files, build, 'lighting', cancelled)
                except (play_prepare.kit.Stopped, RuntimeError):
                    pass
                output.write_bytes(kept)                            # build_job.put_back
                self.assertEqual(play_prepare._load()['map ' + SCRIPT], record)
                ok, lines, runs = self.prepare()
                self.assertEqual(runs, [])
                self.assertIn('Map unchanged since the last Play: not rebuilt.', lines)
        touch(self.kit / 'prefabs' / 'crate.json')
        self.prepare()
        self.assertEqual(self.modes[-1], 'paths', "the earlier Rebuild's mode")

    def test_a_compile_in_the_maps_build_is_recorded(self):
        """server.build compiles the package inside a map's build when the map has a player character
        (compile_for_player: play_prepare.compile_step). The map step around it writes its own record into the records
        as they are after the build, so that compile's record stays; server.rebuild compiles before the map's record
        reads what the map is made from (re-test 3 of 31 Oct 2026, #2: in a development working copy every Play of such
        a map was two compiles, a build and an install)."""
        real = self.build

        def build(script=SCRIPT, map_name=MAP, mode='auto'):            # server.build with a player character
            ok, lines = play_prepare.compile_step(self.compile)
            return real(script, map_name, mode) if ok else (ok, lines)
        files = [self.kit / 'maps' / (SCRIPT + '.py'), self.kit / 'maps' / (SCRIPT + '.edits.json')]
        source = self.project / 'src' / 'P' / 'Classes' / 'A.uc'
        with patch.object(self, 'build', build):
            self.assertEqual(self.prepare()[2], ['compile', 'map ' + SCRIPT, 'install'])
            self.assertEqual(self.prepare()[2], [], "the compile in the map's build left out too")
            write(source, 'class A 2')
            self.runs = []
            play_prepare.rebuilt(SCRIPT, MAP, files, build)             # a Rebuild compiling inside its build
            self.assertEqual(self.runs, ['compile', 'map ' + SCRIPT])
            self.assertEqual(self.prepare()[2], ['map ' + SCRIPT, 'install'], 'that compile recorded')
            write(source, 'class A 3')
            self.runs = []
            play_prepare.compile_step(self.compile)                     # server.rebuild: the compile first
            play_prepare.rebuilt(SCRIPT, MAP, files, build)
            self.assertEqual(self.runs, ['compile', 'map ' + SCRIPT], "the compile in the build left out")
            self.assertEqual(self.prepare()[2], ['install'])

    def test_story_applys_compile_is_recorded_for_the_next_play(self):
        """Story > Apply compiles the package whatever the record says (play_prepare.recompiled) and, in a development
        working copy, records it: the next Play does not compile the same sources again (re-test 3 of 31 Oct 2026, #2).
        DeusEdix's workspace keeps its own record (workspace.build)."""
        self.prepare()
        self.runs = []
        self.assertTrue(play_prepare.recompiled(self.compile)[0])
        self.assertEqual(self.runs, ['compile'], 'always run')
        self.assertEqual([r.split(' ')[0] for r in self.prepare()[2]], ['map', 'install'])
        self.settings.STANDALONE = True
        self.runs = []
        self.assertTrue(play_prepare.recompiled(self.compile)[0])
        self.assertEqual(self.runs, ['compile'])
        self.workspace.needs_build.assert_not_called()

    def test_a_build_that_makes_its_textures_again_is_left_out_next_time(self):
        """The training map's script saves its sign, carpet and crate textures into the kit's textures at every build
        (signs.plate, signs.save): only when their bytes change, so the unchanged map is left out at the next Play and
        its Rebuild stands for that Play (re-test 3 of 31 Oct 2026, #8: the same bytes at a new time, an input of the
        map's own record, built it again at every Play)."""
        import signs
        from PIL import Image
        carpet = Image.new('RGB', (8, 8), '#601b1f').quantize(colors=4)
        make = lambda: signs.save(carpet, self.kit / 'textures' / '_tutorial' / 'TrainingBurgundy.pcx')
        make()                                                          # an earlier build's
        real = self.build

        def build(script=SCRIPT, map_name=MAP, mode='auto'):
            make()
            return real(script, map_name, mode)
        files = [self.kit / 'maps' / (SCRIPT + '.py'), self.kit / 'maps' / (SCRIPT + '.edits.json')]
        with patch.object(self, 'build', build):
            self.assertEqual(self.prepare()[2], ['compile', 'map ' + SCRIPT, 'install'])
            self.assertEqual(self.prepare()[2], [])
            self.assertTrue(play_prepare.rebuilt(SCRIPT, MAP, files, build)[0])
            self.assertEqual(self.prepare()[2], [])


class EditorPackagesTests(unittest.TestCase):
    def test_a_run_takes_the_editors_own_packages_from_dist_only(self):
        """kit.editor_packages, the packages PrepareTests leaves out of a working copy's compile: the models and the
        sounds imported in the editor and the scripts written in it, which kit.new_run links from dist and never from
        the workspace's System (the editor writes its scripts into both), as it does the project's package."""
        kit, settings = play_prepare.kit, play_prepare.kit.settings
        own = (settings.MODELS_PACKAGE, settings.SOUNDS_PACKAGE, settings.SCRIPTS_PACKAGE)
        self.assertEqual(sorted(kit.editor_packages()), sorted(own))
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            dev, dist = root / 'DevInstall' / 'System', root / 'dist'
            for name in own + (settings.PACKAGE,):
                write(dev / (name + '.u'), 'an older copy in the System')
                write(dist / (name + '.u'), 'the one made by the editor')
            write(dev / 'Engine.u', 'engine')
            write(dev / 'DeusEx.ini', '[Core.System]\r\n[Editor.EditorEngine]\r\n')
            with patch.multiple(kit, DEV=dev, PROJECT=root, RUNS=root / 'runs', HOST=root / 'bin' / 'host.exe',
                                PACKAGES_FILE=root / 'packages.json', host_files=lambda: [], native_files=lambda: []):
                write(kit.HOST, 'host')
                system = kit.new_run(label='own') / 'System'
            for name in own + (settings.PACKAGE,):
                self.assertEqual((system / (name + '.u')).read_text(), 'the one made by the editor', name)
            self.assertEqual((system / 'Engine.u').read_text(), 'engine')


if __name__ == '__main__':
    unittest.main()
