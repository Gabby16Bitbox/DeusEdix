"""The Rebuild in the background (editor/build_job.py): its stages read from the host's log as it is written, the
counts of the Build report, Cancel stopping only the build's own processes (a map script's host too) and putting the
previous build back, one build at a time, and the routes the page uses (server.py). The host is a stand-in: a Python
script behind a batch file that writes a host's log line by line (kit._execute runs it as it runs the real one)."""
import ast
import json
import os
import sys
import tempfile
import threading
import time
import types
import unittest
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import Mock, patch

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import build_job  # noqa: E402
import kit  # noqa: E402
import rebuild  # noqa: E402
import test_tutorial_routes as routes  # noqa: E402

# the stand-in host: the commands of its command file, each with what the engine prints for it, a pause per command
# (FAKE_HOST_PAUSE seconds) and FAKE_HOST_HOLD: a command it runs for a minute, printing a line every tenth of a second
FAKE_HOST = r'''
import os, sys, time
out = sys.stdout
def say(line):
    out.write(line + '\n'); out.flush()
say('UCMapKit|initializing SDK')
say('UCMapKit|ready')
pause, hold = float(os.environ.get('FAKE_HOST_PAUSE', '0.02')), os.environ.get('FAKE_HOST_HOLD', '')
for command in open(sys.argv[1], encoding='utf-8').read().splitlines():
    if not command.strip():
        continue
    say('UCMapKit|command|' + command)
    start = time.time()
    if command == hold:
        for _ in range(600):
            say('Lightsource Light0: 12 leaves')
            time.sleep(0.1)
    time.sleep(pause)
    if command == 'MAP REBUILD':
        say('Found 3 zones')
    if command == 'UC_WORLD finish':
        say('UCMapKit|world|120 nodes|80 surfs|4 zones')
    if command == 'PATHS DEFINE':
        for name in ('PathNode0', 'PathNode1'):
            say('Added reachspecs to ' + name)
        say('Added 6 reachspecs')
        say('Pruned 2 reachspecs')
    if command == 'UC_KEEPPATHS restore':
        say('UCMapKit|keeppaths|1 of 3 put back|2 made again|0 moved or gone|0 blocked|0 no room')
    if command == 'LIGHT APPLY':
        say('5 Lights, 40 Polys, 12 Pairs, 4096 Rays')
    say('UCMapKit|complete|%d ms' % int((time.time() - start) * 1000))
say('UCMapKit|done')
'''
COMMANDS = ['MAP LOAD FILE="..\\Input\\Fixture.dx"', 'UC_KEEPPATHS save', 'UC_PROP Light0 LightBrightness 99',
            'MAP REBUILD', 'BSP REBUILD OPTIMAL BALANCE=15', 'UC_WORLD finish', 'UC_NAVDROP temp', 'PATHS DEFINE',
            'UC_NAVLIFT', 'UC_KEEPPATHS restore', 'LIGHT APPLY', 'UC_CAMERAS clear', 'MAP SAVE FILE="..\\Output\\Fixture.dx"',
            'MAP EXPORT FILE="..\\Output\\Fixture.t3d"']


def wait_for(test, condition, seconds=15, what='the condition'):
    end = time.time() + seconds
    while time.time() < end:
        if condition():
            return
        time.sleep(0.05)
    test.fail('timed out waiting for ' + what)


class Stand(unittest.TestCase):
    """A private out\\ with the map's previous build, a run folder whose System has the stand-in host."""

    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='build-job-', dir=KIT / 'tests')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.out = self.root / 'out'
        self.out.mkdir()
        (self.out / 'Fixture.dx').write_bytes(b'previous build')
        (self.out / 'Fixture.t3d').write_text('previous export')
        (self.out / 'Other.dx').write_bytes(b'another map')
        host = self.root / 'fake_host.py'
        host.write_text(FAKE_HOST, encoding='utf-8')
        self.run_folder = self.root / 'run'
        (self.run_folder / 'System').mkdir(parents=True)
        (self.run_folder / 'Output').mkdir()
        (self.run_folder / 'System' / 'FakeHost.bat').write_text('@"%s" "%s" %%1\n' % (sys.executable, host), encoding='ascii')
        p = patch.object(kit, 'HOST', Path('FakeHost.bat'))
        p.start()
        self.addCleanup(p.stop)
        env = patch.dict(os.environ, {'FAKE_HOST_PAUSE': '0.02', 'FAKE_HOST_HOLD': ''})
        env.start()
        self.addCleanup(env.stop)
        self.addCleanup(self.settle)

    def settle(self):
        """Every test leaves no job running behind it (the module keeps one at a time)."""
        wait_for(self, lambda: not build_job.running(), 30, 'the job to end')

    def dx_build(self, script, options, watch=None):
        """A build of an existing map as dxmaps.build makes it: the host run, then its output copied into out\\."""
        kit.execute(self.run_folder, COMMANDS, 'build.log', timeout=120, watch=watch)
        (self.out / 'Fixture.dx').write_bytes(b'new build')
        (self.out / 'Fixture.t3d').write_text('new export')
        (self.out / 'Fixture.groups.json').write_text('{}')
        return True, ['built Fixture in 1.0s', '  IN SOLID: Light|Light3|0 0 0']

    def start(self, build=None, turn=nullcontext, options=None):
        return build_job.start('dx:Fixture', 'Fixture', options or {'mode': 'auto'}, build=build or self.dx_build,
                               out=self.out, turn=turn, operation=nullcontext)

    def finished(self):
        self.settle()
        return build_job.status()


class StagesAndCounts(unittest.TestCase):
    def test_commands_go_to_their_stage(self):
        expect = {'MAP LOAD FILE="..\\Input\\X.dx"': 'load', 'MAP NEW': 'load', 'OBJ LOAD FILE="X.u"': 'load',
                  'UC_KEEPPATHS save': 'load', 'UC_PROP X Health 5': 'edits', 'MAP IMPORTADD FILE="a.t3d"': 'edits',
                  'BRUSH ADD FLAGS=8': 'edits', 'MAP REBUILD': 'bsp', 'BSP REBUILD OPTIMAL BALANCE=15': 'bsp',
                  'UC_WORLD finish': 'bsp', 'UC_NAVDROP temp': 'paths', 'PATHS DEFINE': 'paths', 'UC_KEEPPATHS restore': 'paths',
                  'LIGHT APPLY': 'lights', 'UC_CAMERAS clear': 'lights', 'MAP SAVE FILE="o.dx"': 'write', 'MAP EXPORT FILE="o.t3d"': 'write'}
        for command, stage in expect.items():
            self.assertEqual(build_job.stage_of(command), stage, command)
        self.assertEqual([s for s, _ in build_job.STAGES], ['prepare', 'load', 'edits', 'bsp', 'paths', 'lights', 'write'])

    def test_progress_reads_a_growing_log_with_its_clock(self):
        p = build_job.Progress()
        self.assertEqual(p.stage, 'prepare')
        p.host_started(10.0)
        self.assertEqual(p.stage, 'load')
        p.feed('UCMapKit|initializing SDK\r\nUCMapKit|ready\r\nUCMapKit|comm', 12.0)
        self.assertEqual(p.stage, 'load')                       # half a line: nothing yet
        p.feed('and|MAP LOAD FILE="x"\r\nUCMapKit|complete|500 ms\r\nUCMapKit|command|MAP REBUILD\r\n', 13.0)
        self.assertEqual(p.stage, 'bsp')
        p.feed('UCMapKit|complete|4000 ms\r\nUCMapKit|command|LIGHT APPLY\r\n', 17.0)
        self.assertEqual(p.stage, 'lights')
        p.close(27.0)                                           # stopped in the middle of the lighting
        self.assertEqual(p.seconds, {'load': 3.5, 'bsp': 4.0, 'lights': 10.0})

    def test_after_the_host_the_files_copied_are_writing(self):
        p = build_job.Progress()
        p.host_started(0.0)
        p.feed('UCMapKit|command|MAP SAVE FILE="o.dx"\nUCMapKit|complete|200 ms\nUCMapKit|done\n', 1.0)
        self.assertEqual(p.stage, 'write')
        p.close(3.0)
        self.assertEqual(p.seconds, {'load': 1.0, 'write': 2.2})
        p.host_started(5.0)                                     # a run made again starts loading again
        self.assertEqual(p.stage, 'load')

    def test_counts_are_what_the_output_says(self):
        log = ('Found 1 zones\r\nUCMapKit|world|2577 nodes|1803 surfs|2 zones\r\nFound 2 zones\r\n'
               'Added reachspecs to PathNode0\r\nAdded reachspecs to PathNode1\r\nAdded reachspecs to PlayerStart0\r\n'
               'Added 9 reachspecs\r\nPruned 4 reachspecs\r\n'
               'UCMapKit|keeppaths|5 of 7 put back|1 made again|1 moved or gone|0 blocked|0 no room\r\n'
               '54 Lights, 1726 Polys, 3841 Pairs, 1119424 Rays\r\n')
        self.assertEqual(build_job.counts(log), dict(nodes=2577, surfaces=1803, zones=2, lights=54, points=3,
                                                     reachspecs=9, pruned=4, kept=5))
        self.assertEqual(build_job.counts('UCMapKit|command|UC_PROP X Health 5\n'), {})


class KeepAndPutBack(Stand):
    def test_the_previous_build_comes_back_and_what_was_made_goes(self):
        kept = build_job.keep(self.out, 'Fixture', self.root / 'before')
        self.assertEqual(kept, ['Fixture.dx', 'Fixture.t3d'])
        (self.out / 'Fixture.dx').write_bytes(b'half written')
        (self.out / 'Fixture.groups.json').write_text('{}')
        (self.out / 'Fixture.t3d').unlink()
        (self.out / 'Other.dx').write_bytes(b'another map, changed by someone else')
        build_job.put_back(self.out, 'Fixture', self.root / 'before', kept)
        self.assertEqual((self.out / 'Fixture.dx').read_bytes(), b'previous build')
        self.assertEqual((self.out / 'Fixture.t3d').read_text(), 'previous export')
        self.assertFalse((self.out / 'Fixture.groups.json').exists())
        self.assertEqual((self.out / 'Other.dx').read_bytes(), b'another map, changed by someone else')


class HostRuns(Stand):
    """kit.execute with a watch, on the stand-in host."""

    def test_a_watched_run_names_its_log_and_finishes(self):
        seen = []
        watch = types.SimpleNamespace(stopped=False, started=lambda process, log: seen.append((process.pid, log)))
        text, _ = kit.execute(self.run_folder, COMMANDS, 'build.log', timeout=60, watch=watch)
        self.assertEqual(len(seen), 1)
        self.assertEqual(seen[0][1], self.run_folder / 'build.log')
        self.assertIn('UCMapKit|done', text)

    def test_a_cancelled_lighting_is_not_run_again(self):
        os.environ['FAKE_HOST_HOLD'] = 'LIGHT APPLY'           # the run kit.execute would retry after a driver crash
        job = build_job.Job('dx:Fixture', 'Fixture', 'auto', self.root / 'job')
        (self.root / 'job').mkdir()
        result, runs, started_run = {}, [], job.started
        job.started = lambda process, log: (runs.append(process.pid), started_run(process, log))

        def run():
            try:
                kit.execute(self.run_folder, COMMANDS, 'build.log', timeout=60, watch=job)
            except BaseException as exc:                        # noqa: B902 - the test looks at what came out
                result['error'] = exc
        thread = threading.Thread(target=run)
        thread.start()
        wait_for(self, lambda: (job.poll(), job.progress.stage)[1] == 'lights', what='the lighting')
        started = time.time()
        job.cancel()
        thread.join(20)
        self.assertFalse(thread.is_alive())
        self.assertIsInstance(result.get('error'), kit.Stopped)
        self.assertEqual(len(runs), 1)                          # not run again, as a lighting crashed in the driver is
        self.assertLess(time.time() - started, 5)               # (that waits 3 s first)
        self.assertIsNotNone(job.process.poll())

    def test_a_run_started_after_cancel_is_stopped_at_once(self):
        job = build_job.Job('dx:Fixture', 'Fixture', 'auto', self.root / 'job')
        job.stopped = True
        with self.assertRaises(kit.Stopped):
            kit.execute(self.run_folder, COMMANDS, 'build.log', timeout=60, watch=job)
        self.assertIsNotNone(job.process.poll())


class Jobs(Stand):
    def test_a_build_reports_its_stages_counts_and_keeps_its_time(self):
        os.environ['FAKE_HOST_PAUSE'] = '0.15'
        first = self.start()
        self.assertEqual(first['state'], 'running')
        self.assertIsNone(first['estimate'])
        self.assertTrue(first['token'])
        end = self.finished()
        self.assertEqual(end['state'], 'done', end)
        self.assertTrue(end['ok'])
        self.assertEqual(end['lines'][0], 'built Fixture in 1.0s')
        stages = [s['id'] for s in end['report']['stages']]
        self.assertEqual(stages, [s for s in ['prepare', 'load', 'edits', 'bsp', 'paths', 'lights', 'write'] if s in stages])
        for stage in ('load', 'bsp', 'paths', 'lights', 'write'):
            self.assertIn(stage, stages)
        self.assertEqual(end['report']['counts'], dict(nodes=120, surfaces=80, zones=3, lights=5, points=2, reachspecs=6,
                                                       pruned=2, kept=1))
        self.assertAlmostEqual(sum(s['seconds'] for s in end['report']['stages']), end['report']['seconds'], delta=0.6)
        self.assertEqual((self.out / 'Fixture.dx').read_bytes(), b'new build')
        kept = json.loads((self.out / 'Fixture.build-report.json').read_text())
        self.assertEqual(kept['seconds'], end['report']['seconds'])
        second = self.start()                                   # the last build's time is the next one's estimate
        self.assertEqual(second['estimate'], end['report']['seconds'])
        self.finished()

    def test_cancel_stops_the_host_and_puts_the_previous_build_back(self):
        os.environ['FAKE_HOST_HOLD'] = 'LIGHT APPLY'

        def build(script, options, watch=None):
            (self.out / 'Fixture.dx').write_bytes(b'half written by this build')
            (self.out / 'Fixture.groups.json').write_text('{}')
            return self.dx_build(script, options, watch)
        started = self.start(build)
        wait_for(self, lambda: build_job.status()['stage'] == 'lights', what='the lighting')
        self.assertEqual(build_job.status()['label'], 'Lighting')
        with self.assertRaises(RuntimeError):
            build_job.cancel('not its token')
        self.assertEqual(build_job.status()['state'], 'running')
        self.assertEqual(build_job.cancel(started['token'])['state'], 'cancelling')
        end = self.finished()
        self.assertEqual(end['state'], 'cancelled', end)
        self.assertEqual((self.out / 'Fixture.dx').read_bytes(), b'previous build')
        self.assertEqual((self.out / 'Fixture.t3d').read_text(), 'previous export')
        self.assertFalse((self.out / 'Fixture.groups.json').exists())
        self.assertFalse((self.out / 'Fixture.build-report.json').exists())
        self.assertIn('lights', [s['id'] for s in end['report']['stages']])
        self.assertEqual(end['report']['counts'], {})

    def test_settle_ends_the_time_to_cancel_and_says_whether_it_was_cancelled(self):
        """Job.settle, as the build ends (server.rebuild asks it for the map's record of Play's preparation, _work for
        the output it keeps or puts back): was it cancelled? From then on Cancel is too late, so both agree."""
        job = build_job.Job('dx:Fixture', 'Fixture', 'auto', self.root / 'job')
        self.assertFalse(job.settle())
        job.cancel()
        self.assertEqual((job.stopped, job.state, job.settle()), (False, 'running', False), 'too late')
        cancelled = build_job.Job('dx:Fixture', 'Fixture', 'lighting', self.root / 'job2')
        cancelled.cancel()
        self.assertTrue(cancelled.settle())

    def test_one_build_at_a_time(self):
        gate = threading.Event()

        def build(script, options, watch=None):
            gate.wait(10)
            return True, []
        self.start(build)
        self.assertTrue(build_job.running())
        with self.assertRaises(RuntimeError):
            self.start(build)
        gate.set()
        self.assertEqual(self.finished()['state'], 'done')
        self.assertFalse(build_job.running())

    def test_cancel_while_waiting_for_the_sdk_builds_nothing(self):
        lock, build = threading.Lock(), Mock(return_value=(True, []))
        lock.acquire()                                          # another request holds the SDK
        started = self.start(build, turn=lambda: lock)
        build_job.cancel(started['token'])
        lock.release()
        end = self.finished()
        self.assertEqual(end['state'], 'cancelled')
        build.assert_not_called()
        self.assertEqual((self.out / 'Fixture.dx').read_bytes(), b'previous build')

    def test_a_failed_build_says_why_and_leaves_the_files(self):
        def build(script, options, watch=None):
            raise ValueError('This map is not in the current project.')
        self.start(build)
        end = self.finished()
        self.assertEqual(end['state'], 'failed')
        self.assertEqual(end['lines'], ['This map is not in the current project.'])
        self.assertEqual((self.out / 'Fixture.dx').read_bytes(), b'previous build')

    def test_a_map_script_is_stopped_with_the_host_it_started(self):
        os.environ['FAKE_HOST_HOLD'] = 'LIGHT APPLY'
        child = self.root / 'map_script.py'
        child.write_text('import sys\nfrom pathlib import Path\nsys.path[:0] = [%r]\nimport kit\nkit.HOST = Path("FakeHost.bat")\n'
                         'kit.execute(Path(%r), %r, "build.log", timeout=120)\n' % (str(KIT), str(self.run_folder), COMMANDS),
                         encoding='utf-8')

        def build(script, options, watch=None):
            """As server.build runs a map script: a process of its own told where to name its host's log."""
            import subprocess
            env = dict(os.environ, **{kit.HOST_LOG_ENV: str(watch.note)})
            process = subprocess.Popen([sys.executable, str(child)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       creationflags=subprocess.CREATE_NO_WINDOW)
            watch.started(process, None)
            process.communicate(timeout=120)
            return process.returncode == 0, []
        started = self.start(build)
        wait_for(self, lambda: build_job.status()['stage'] == 'lights', 30, 'the script host lighting')
        build_job.cancel(started['token'])
        self.assertEqual(self.finished()['state'], 'cancelled')
        log = self.run_folder / 'build.log'
        size = log.stat().st_size
        time.sleep(0.6)                                          # the host printed a line every tenth of a second
        self.assertEqual(log.stat().st_size, size, 'the host the map script started is still running')


class BuildRoutes(unittest.TestCase):
    """server.py's routes for the page, on the real handler (test_tutorial_routes' bench) and the real job module."""
    request = routes.TutorialRouteTests.request

    def setUp(self):
        routes.TutorialRouteTests.setUp(self)
        self.session.enabled = False
        self.gate = threading.Event()
        self.addCleanup(lambda: wait_for(self, lambda: not build_job.running(), 30, 'the job to end'))
        self.addCleanup(self.gate.set)                          # (cleanups run last first: the build let go, then waited for)

        def build(script, options, watch=None):
            self.gate.wait(10)
            return True, ['built %s' % script]
        # server.rebuild, the job's build: a Rebuild goes through play_prepare.rebuilt
        self.recorded = []

        def rebuilt(script, map_name, files, action, mode, cancelled=lambda: None):
            result = action()
            self.recorded.append((script, mode, cancelled()))       # cancelled: asked as the build ends
            return result
        recorder = types.SimpleNamespace(rebuilt=rebuilt)
        # player_profiles.blocks as the real one decides: a player character only for edits that name one, read by the
        # real load_edits (test_play_routes; re-test 4 of 31 Oct 2026, #6)
        player = lambda edits: ([dict(cls='UCPlayerMap', name='UCPlayerMap0')]
                                if (edits.get('level') or {}).get('player') else [])
        self.namespace.update(build_job=build_job, rebuild_options=rebuild, build=build, play_prepare=recorder,
                              map_source=lambda script: self.root / (script + '.py'),
                              edits_path=lambda script: self.root / (script + '.edits.json'),
                              player_profiles=types.SimpleNamespace(blocks=player, validate_edits=Mock()))
        tree = ast.parse(routes.SOURCE.read_text(encoding='utf-8-sig'))
        exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef)
                                      and n.name in ('rebuild', 'play_files', 'compile_for_player', 'load_edits')],
                                type_ignores=[]), str(routes.SOURCE), 'exec'), self.namespace)

    def test_a_rebuild_is_recorded_for_play(self):
        """The job builds with server.rebuild, in any mode through play_prepare.rebuilt: the next Play then leaves the
        build out (fix-back2, 30 Oct 2026; game re-test #2: a forced mode only adds stages to Play's build)."""
        for mode, recorded in (('auto', [('my_room', 'auto', False)]), ('full', [('my_room', 'full', False)])):
            with self.subTest(mode):
                self.recorded.clear()
                self.request('/api/build_start?script=my_room', {'mode': mode})
                self.gate.set()
                wait_for(self, lambda: not build_job.running(), what='the job to end')
                self.gate.clear()
                self.assertEqual(self.request('/api/build_status', method='GET')[1]['lines'], ['built my_room'])
                self.assertEqual(self.recorded, recorded)

    def test_a_cancelled_rebuild_is_told_to_its_record(self):
        """server.rebuild gives play_prepare.rebuilt the job's settle(): a Rebuild cancelled while it builds is told so
        as its build ends, and the job puts the map's earlier output back (cross-check of 31 Oct 2026: the record kept
        the cancelled Rebuild's mode)."""
        code, started = self.request('/api/build_start?script=my_room', {'mode': 'lighting'})
        self.assertEqual(code, 200, started)
        self.request('/api/build_cancel', {'token': started['token']})
        self.gate.set()
        wait_for(self, lambda: not build_job.running(), what='the job to end')
        self.assertEqual(self.request('/api/build_status', method='GET')[1]['state'], 'cancelled')
        self.assertEqual(self.recorded, [('my_room', 'lighting', True)])

    def test_start_status_and_cancel(self):
        code, started = self.request('/api/build_start?script=my_room', {'mode': 'full'})
        self.assertEqual(code, 200, started)
        self.assertEqual((started['state'], started['map'], started['mode']), ('running', '01_MyRoom', 'full'))
        code, again = self.request('/api/build_start?script=my_room', {})
        self.assertEqual(code, 409)
        self.assertIn('Rebuild is running', again['error'])
        for path, body in (('/api/build?script=my_room', {}), ('/api/edits?script=my_room', {}), ('/api/play_prepare?script=my_room', {})):
            code, refused = self.request(path, body)
            self.assertEqual(code, 409, path)
            self.assertIn('Rebuild is running', refused['error'])
        code, status = self.request('/api/build_status', method='GET')
        self.assertEqual((code, status['state'], status['token']), (200, 'running', started['token']))
        self.assertEqual(self.request('/api/build_cancel', {'token': 'stale'})[0], 409)
        code, cancelling = self.request('/api/build_cancel', {'token': started['token']})
        self.assertEqual((code, cancelling['state']), (200, 'cancelling'))
        self.gate.set()
        wait_for(self, lambda: not build_job.running(), what='the job to end')
        self.assertEqual(self.request('/api/build_status', method='GET')[1]['state'], 'cancelled')

    def test_only_a_mode_is_accepted_and_the_map_must_exist(self):
        self.assertEqual(self.request('/api/build_start?script=my_room', {'mode': 'full', 'command': 'MAP NEW'})[0], 409)
        self.namespace['map_of'] = Mock(side_effect=ValueError('This map is not in the current project.'))
        self.assertEqual(self.request('/api/build_start?script=elsewhere', {})[0], 409)
        self.assertFalse(build_job.running())

    def test_the_build_checks_what_a_request_of_the_person_checks(self):
        self.request('/api/build_start?script=my_room', {})
        self.gate.set()
        wait_for(self, lambda: not build_job.running(), what='the job to end')
        self.project.ensure_runtime.assert_called()
        self.assertEqual(self.request('/api/build_status', method='GET')[1]['lines'], ['built my_room'])


if __name__ == '__main__':
    unittest.main()
