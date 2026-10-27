"""Rebuild in the background (the page's Rebuild): a job the page polls for the stage the build is at, and stops with
Cancel, as Unity's long tasks in its status bar.

The build is server.build() as it always was, in a thread of its own that holds the SDK as a request of the person
does (server.UserTurn). Its stages are read from the host's log while it is written: kit.execute prints
"UCMapKit|command|<command>" before each command and "UCMapKit|complete|<n> ms" after it, so the stage is the one of
the command running (COMMAND_STAGES) and a stage's time is what its commands took. A map script builds in a process of
its own: kit.execute there names its host's log in the file this job gives it (kit.HOST_LOG_ENV).

Cancel stops the process this job started (the host, or a map script with the host it started) and nothing else, and
puts the map's files in out\\ back as they were before the build: the previous build is the map's again. One job at a
time: another Rebuild is refused while one runs (server.py refuses the other builds and the saves of edits too).
"""
import glob
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import atomicfile  # noqa: E402
import kit  # noqa: E402

# the stages of a build in their order, as the page says them
STAGES = (('prepare', 'Preparing'), ('load', 'Loading the map'), ('edits', 'Applying edits'), ('bsp', 'CSG and BSP'),
          ('paths', 'AI paths'), ('lights', 'Lighting'), ('write', 'Writing the .dx'))
LABELS = dict(STAGES)
# the stage of a host command: the first entry its text starts with (dxmaps.build's and scene.Scene.build's commands);
# any other command applies an edit (objects, properties, brushes, textures, surfaces)
COMMAND_STAGES = (
    ('MAP LOAD', 'load'), ('MAP NEW', 'load'), ('OBJ LOAD', 'load'),
    ('UC_KEEPPATHS save', 'load'),          # right after MAP LOAD: the map's own AI links noted before any change
    ('MAP REBUILD', 'bsp'), ('BSP REBUILD', 'bsp'), ('UC_WORLD', 'bsp'),
    ('UC_NAVDROP', 'paths'), ('PATHS DEFINE', 'paths'), ('UC_NAVLIFT', 'paths'), ('UC_KEEPPATHS', 'paths'),
    ('LIGHT APPLY', 'lights'), ('UC_LIGHTSTATS', 'lights'), ('UC_CAMERAS', 'lights'),
    ('MAP SAVE', 'write'), ('MAP EXPORT', 'write'),
)
# the host's own lines (kit.execute, tools\mapkit\host)
COMMAND, COMPLETE, DONE = 'UCMapKit|command|', 'UCMapKit|complete|', 'UCMapKit|done'
POLL = 0.25                 # seconds between two readings of the log while the build runs
REPORT = '.build-report.json'   # out\<map>.build-report.json: the last build's report (its time: the next one's estimate)


def stage_of(command):
    """The stage a host command belongs to (COMMAND_STAGES)."""
    command = command.strip()
    return next((stage for start, stage in COMMAND_STAGES if command.startswith(start)), 'edits')


class Progress:
    """A build's stages as its host's log tells them, read while it grows (feed, at the time `now`): the stage now and
    the seconds of each stage. A finished command's are the host's own count; the clock gives the rest: the host
    starting (its packages, before its first command: 'load'), a command stopped before it finished (its stage), the
    files copied out after the host's last command ('write'). Before the host the stage is 'prepare' (Job counts it)."""

    def __init__(self):
        self.stage = 'prepare'
        self.seconds = {}
        self.done = False
        self._running = None        # the stage of the command the host runs now (its time comes with "complete")
        self._since = None          # when that command (or the host's start, or the copying after it) was seen to begin
        self._starting = False      # the host started and has run no command yet
        self._rest = ''             # the end of what was read: a line not finished yet

    def _add(self, stage, seconds):
        self.seconds[stage] = self.seconds.get(stage, 0) + max(0.0, seconds)

    def host_started(self, now):
        """A host run starts (again, when kit.execute retries a run that crashed in the graphics driver)."""
        self.close(now)
        self.stage, self.done, self._running, self._since, self._starting, self._rest = 'load', False, None, now, True, ''

    def feed(self, text, now):
        lines = (self._rest + text).split('\n')
        self._rest = lines.pop()
        for line in (part.rstrip('\r') for part in lines):
            if line.startswith(COMMAND):
                if self._starting:
                    self._add('load', now - self._since)
                    self._starting = False
                self.stage = self._running = stage_of(line[len(COMMAND):])
                self._since = now
            elif line.startswith(COMPLETE) and self._running:
                m = re.match(r'(\d+) ms', line[len(COMPLETE):])
                if m:
                    self._add(self._running, int(m.group(1)) / 1000)
                self._running = None
            elif line == DONE:
                self.stage, self.done, self._since = 'write', True, now

    def close(self, now):
        """The build is over at `now` (or its host run is): the time still open goes to its stage."""
        if self.done:
            self._add('write', now - self._since)
        elif self._running:
            self._add(self._running, now - self._since)
        elif self._starting:
            self._add('load', now - self._since)
        self._running, self._starting, self.done = None, False, False


def counts(text):
    """What the build output already says, for the Build report: the BSP after CSG (host UC_WORLD) and the zones
    UnrealEd found, the lights LIGHT APPLY lit with, the AI paths PATHS DEFINE made (a line for each point) and the
    map's own links put back (UC_KEEPPATHS). Only what this build did."""
    text = text.replace('\r', '')
    out = {}
    world = re.findall(r'UCMapKit\|world\|(\d+) nodes\|(\d+) surfs\|', text)
    if world:
        out['nodes'], out['surfaces'] = map(int, world[-1])
    zones = re.findall(r'^Found (\d+) zones$', text, re.M)
    if zones:
        out['zones'] = int(zones[-1])
    lights = re.findall(r'^(\d+) Lights, \d+ Polys, ', text, re.M)
    if lights:
        out['lights'] = int(lights[-1])
    added = re.findall(r'^Added (\d+) reachspecs$', text, re.M)
    if added:
        out['points'] = len(re.findall(r'^Added reachspecs to ', text, re.M))
        out['reachspecs'] = int(added[-1])
        pruned = re.findall(r'^Pruned (\d+) reachspecs$', text, re.M)
        if pruned:
            out['pruned'] = int(pruned[-1])
    kept = re.findall(r'UCMapKit\|keeppaths\|(\d+) of \d+ put back', text)
    if kept:
        out['kept'] = int(kept[-1])
    return out


def map_files(out, map_name):
    """The map's files in out\\: its .dx, its .t3d and what goes with them (<map>.<anything>)."""
    return [p for p in sorted(Path(out).glob(glob.escape(map_name) + '.*')) if p.is_file()]


def keep(out, map_name, folder):
    """Copies of the map's files in out\\ in folder, before a build: their names."""
    Path(folder).mkdir(parents=True, exist_ok=True)
    for path in map_files(out, map_name):
        shutil.copy2(path, Path(folder) / path.name)
    return [path.name for path in map_files(out, map_name)]


def put_back(out, map_name, folder, names):
    """The map's files in out\\ as keep() found them: what the build made goes, what it changed comes back."""
    for path in map_files(out, map_name):
        if path.name not in names:
            path.unlink()
    for name in names:
        atomicfile.copy_file(Path(folder) / name, Path(out) / name)


def stop_process(process):
    """Stop a process this job started, with what it started itself (a map script's host): taskkill /T on its own
    id, and only while it runs (the id of a finished one may be another program's by now). Never any other process."""
    if process is None or process.poll() is not None:
        return
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True,
                       creationflags=subprocess.CREATE_NO_WINDOW)
    if process.poll() is None:
        process.kill()


def last_seconds(out, map_name):
    """How long the last build of the map took (its report), or None: the estimate the page shows."""
    try:
        return float(json.loads((Path(out) / (map_name + REPORT)).read_text(encoding='utf-8'))['seconds'])
    except (OSError, ValueError, KeyError, TypeError):
        return None


class Job:
    """One Rebuild: its token (Cancel names it, as Play's preparation token does), its map, the stage it is at, the
    process it runs. kit.execute calls started() as each host run starts; a map script's run, in a process of its own,
    is followed through the file `note` (kit.HOST_LOG_ENV), which its kit.execute writes."""

    def __init__(self, script, map_name, mode, folder, estimate=None):
        self.token = secrets.token_hex(24)
        self.script, self.map, self.mode, self.estimate = script, map_name, mode, estimate
        self.folder = Path(folder)                 # the copies of the previous build (before\), the note
        self.before = self.folder / 'before'
        self.note = self.folder / 'host-log.txt'
        self.state = 'running'                     # then 'cancelling', and at the end 'done', 'failed' or 'cancelled'
        self.stopped = False                       # Cancel pressed (kit.execute does not retry a run then)
        self.final = False                         # the build is over: too late to cancel it
        self.progress = Progress()
        self.process = None
        self.log, self.read = None, 0              # the host's log, and how much of it is read
        self.at, self.host_at, self.ended = time.time(), None, None
        self.ok, self.lines, self.report = None, [], None
        self.lock = threading.RLock()
        self.over = threading.Event()

    def started(self, process, log):
        """A process of this build started: a host run (kit.execute, with its log), a map script (server.build, no log).
        Cancelled already: it is stopped at once and the build goes no further (kit.Stopped)."""
        with self.lock:
            self.process = process
            if log is not None:
                self._follow(Path(log))
            if self.stopped:
                stop_process(process)
                raise kit.Stopped('The Rebuild was cancelled.')

    def _follow(self, log):
        self.log, self.read = log, 0
        self.host_at = self.host_at or time.time()
        self.progress.host_started(time.time())

    def poll(self):
        """What the host wrote since the last reading: the stage now."""
        with self.lock:
            named = self.note.read_text(encoding='utf-8').strip() if self.note.exists() else ''
            if named and Path(named) != self.log:
                self._follow(Path(named))
            if self.log is None or not self.log.exists():
                return
            size = self.log.stat().st_size
            if size < self.read:                   # the same log written again (kit.execute retrying the run)
                self._follow(self.log)
            if size > self.read:
                with self.log.open('rb') as stream:
                    stream.seek(self.read)
                    data = stream.read(size - self.read)
                self.read += len(data)
                self.progress.feed(data.decode('utf-8', errors='replace'), time.time())

    def cancel(self):
        """Cancel: the process running stopped (the build then raises kit.Stopped or fails); too late once it is over."""
        with self.lock:
            if self.state != 'running' or self.final:
                return
            self.stopped, self.state = True, 'cancelling'
            stop_process(self.process)

    def finish(self, state, ok, lines, keep_report=None):
        """The build is over: its report (seconds per stage in STAGES order, Preparing until the host started; the
        counts of its output), kept in keep_report when given (the next build's estimate), then its state."""
        with self.lock:
            try:
                self.poll()                        # its last lines
            except OSError:
                pass
            self.ended = time.time()
            self.progress.close(self.ended)
            seconds = dict(self.progress.seconds, prepare=(self.host_at or self.ended) - self.at)
            text = self.log.read_text(encoding='utf-8', errors='replace') if self.log and self.log.exists() else ''
            self.report = dict(seconds=round(self.ended - self.at, 1), mode=self.mode, at=self.ended,
                               stages=[dict(id=stage, label=label, seconds=round(seconds[stage], 1))
                                       for stage, label in STAGES if seconds.get(stage, 0) >= 0.05],
                               counts=counts(text) if state != 'cancelled' else {})
            if keep_report is not None:
                try:
                    atomicfile.write_json(keep_report, self.report)
                except OSError:
                    pass                           # an estimate for the next time, no more
            self.state, self.ok, self.lines = state, ok, list(lines)
        self.over.set()

    def status(self):
        with self.lock:
            out = dict(state=self.state, token=self.token, script=self.script, map=self.map, mode=self.mode,
                       stage=self.progress.stage, label=LABELS[self.progress.stage],
                       elapsed=round((self.ended or time.time()) - self.at, 1), estimate=self.estimate)
            if self.state in ('done', 'failed', 'cancelled'):
                out.update(ok=self.ok, lines=self.lines, report=self.report)
            return out


_lock = threading.Lock()
_job = None


def running():
    """Is a Rebuild running (or being cancelled)?"""
    with _lock:
        return _job is not None and _job.state in ('running', 'cancelling')


def start(script, map_name, options, *, build, out, turn, operation, guard=lambda: None):
    """Rebuild script in the background: build(script, options, watch=the job) in a thread holding turn() (the SDK)
    and operation() (the project stays open meanwhile), after guard(). Its status, with the token Cancel names.
    Refused while one runs."""
    global _job
    with _lock:
        if _job is not None and _job.state in ('running', 'cancelling'):
            raise RuntimeError('A Rebuild is running: wait for it to end, or cancel it.')
        _job = job = Job(script, map_name, options['mode'], tempfile.mkdtemp(prefix='deusedix-rebuild-'),
                         last_seconds(out, map_name))
    threading.Thread(target=_watch, args=(job,), name='rebuild-log', daemon=True).start()
    threading.Thread(target=_work, args=(job, options, build, Path(out), turn, operation, guard),
                     name='rebuild', daemon=True).start()
    return job.status()


def status():
    """The Rebuild running, or the last one with its result (state 'idle' before any)."""
    with _lock:
        job = _job
    return job.status() if job else dict(state='idle')


def cancel(token):
    """Cancel the Rebuild named by its token: its status (it ends as 'cancelled' once its process has stopped)."""
    with _lock:
        job = _job
    if job is None or not secrets.compare_digest(str(token), job.token):
        raise RuntimeError('This Rebuild has changed. Refresh its status before cancelling.')
    job.cancel()
    return job.status()


def _watch(job):
    """The host's log read while the build runs (the stage and its times)."""
    while not job.over.wait(POLL):
        try:
            job.poll()
        except OSError:
            pass                                    # the log being replaced: read at the next turn


def _work(job, options, build, out, turn, operation, guard):
    state, ok, lines = 'failed', False, []
    try:
        with operation(), turn():
            if job.stopped:                         # cancelled while it waited for the SDK: nothing built
                state = 'cancelled'
                return
            guard()
            kept = keep(out, job.map, job.before)
            try:
                ok, lines = build(job.script, options, watch=job)
            except kit.Stopped:
                pass
            finally:
                with job.lock:
                    job.final = True               # too late to cancel from here on
                if job.stopped:
                    put_back(out, job.map, job.before, kept)
                    state = 'cancelled'
            if state != 'cancelled':
                state = 'done' if ok else 'failed'
    except (ValueError, RuntimeError, OSError) as exc:   # what a build request answered with an error before
        lines = [str(exc)]
    except Exception as exc:
        lines = [str(exc), traceback.format_exc()[-1500:]]
    finally:
        job.finish(state, ok, lines, out / (job.map + REPORT) if state == 'done' else None)
        shutil.rmtree(job.folder, ignore_errors=True)
