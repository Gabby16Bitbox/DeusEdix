"""The scripts written in the map editor (Tools > Scripts): UnrealScript classes of their own package,
settings.SCRIPTS_PACKAGE (UCScripts for the mod, DeusEdixScripts / <project>Scripts for DeusEdix), kept in
src\\<package>\\Classes and compiled apart from the editor's own package, in a few seconds.

A script extends UCScript (an invisible actor of the editor's package: Started / Triggered / Repeat and
helpers); it is placed in a map like any object and set off by the Interactions through its Tag.

  names()            the scripts there are
  new(name, kind)    a new script from a template, saved
  read / save / delete
  compile(log)       the package with the host (--make), errors by script and line, then into dist\\ and
                     the game (not while it runs: then at the next Play / install)
"""
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import settings  # noqa: E402

PACKAGE = settings.SCRIPTS_PACKAGE
SRC = settings.PROJECT / 'src' / PACKAGE
CLASSES = SRC / 'Classes'
DEV = settings.PROJECT / 'DevInstall'
SYS = DEV / 'System'
DIST = settings.PROJECT / 'dist'
HOST = settings.PROJECT / 'tools' / 'mapkit' / 'bin' / 'UCMapKitHost.exe'
MAKE_INI = 'ScriptsMake.ini'
NAME = re.compile(r'^[A-Za-z][A-Za-z0-9_]{1,40}$')

TEMPLATES = {
    'started': ('When the map starts', """// %(name)s: runs once, when the map has started and JC is in it.
class %(name)s extends UCScript;

function Started()
{
	Say("Welcome to the map.");
	log("%(name)s started");
}
"""),
    'triggered': ('When triggered', """// %(name)s: give it a Tag (Inspector), then set it off with an Interaction ("triggers ...") or a trigger.
class %(name)s extends UCScript;

var() name DoorTag;     // set it in the Inspector: what to open when this script is triggered

function Triggered(Actor Other, Pawn EventInstigator)
{
	Say("Something happened.");
	if (DoorTag != '')
		TriggerTag(DoorTag);
	log("%(name)s triggered by" @ Other);
}
"""),
    'repeat': ('Every few seconds', """// %(name)s: Repeat() runs every RepeatEvery seconds (set in defaultproperties or in the Inspector).
class %(name)s extends UCScript;

function Repeat()
{
	if (Player() != None && Player().Health < 30)
		Say("You need a medkit.");
}

defaultproperties
{
	RepeatEvery=5.0
}
"""),
    'empty': ('Empty', """// %(name)s
class %(name)s extends UCScript;

function Started()
{
}

function Triggered(Actor Other, Pawn EventInstigator)
{
}
"""),
}


def _path(name):
    if not NAME.match(name or ''):
        raise ValueError('A script name has letters, digits and _ only, starts with a letter, 2 to 41 characters.')
    return CLASSES / (name + '.uc')


def names():
    # the weapons' and ammunition's classes (Tools > Weapons, weapons.py) live here too: made again at each Save, not listed
    return sorted(p.stem for p in CLASSES.glob('*.uc') if not p.stem.startswith(('UCW_', 'UCA_'))) if CLASSES.is_dir() else []


def _classes():
    return sorted(CLASSES.glob('*.uc')) if CLASSES.is_dir() else []


def read(name):
    return _path(name).read_text(encoding='latin1')


def save(name, text):
    """The script's text; its class line must name it (UnrealScript: one class per file, same name)."""
    path = _path(name)
    m = re.search(r'(?im)^\s*class\s+(\w+)', text or '')
    if not m:
        raise ValueError('The script needs its class line: "class %s extends UCScript;"' % name)
    if m.group(1).lower() != name.lower():
        raise ValueError('The class is called "%s" but the script is "%s": they must be the same.' % (m.group(1), name))
    CLASSES.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_bytes(text.replace('\r\n', '\n').replace('\n', '\r\n').encode('latin1', 'replace'))
    os.replace(tmp, path)
    return path


def new(name, kind='triggered'):
    path = _path(name)
    if any(n.lower() == name.lower() for n in names()):
        raise ValueError('There is a script called %s already.' % name)
    if name.lower() in ('ucscript', settings.PACKAGE.lower(), PACKAGE.lower()):
        raise ValueError('Choose another name: %s is taken.' % name)
    label, text = TEMPLATES.get(kind, TEMPLATES['empty'])
    save(name, text % {'name': name})
    return path.read_text(encoding='latin1')


def delete(name):
    _path(name).unlink(missing_ok=True)


def _game_running():
    try:
        import live
        return live.running()
    except Exception:
        return False


def _remove_package():
    """No script left: no package anywhere (a map placing a deleted script reports it at its build)."""
    gone = []
    places = [SYS, DIST] + ([] if _game_running() else [settings.PACKAGES_DIR])
    for folder in places:
        f = folder / (PACKAGE + '.u')
        if f.is_file():
            f.unlink()
            gone.append(str(f))
    return gone


def _make_ini():
    """The workspace's DeusEx.ini with the scripts' package compiled after the editor's own."""
    text = (SYS / 'DeusEx.ini').read_text(encoding='latin1')
    lines = text.splitlines()
    last = max((i for i, l in enumerate(lines) if l.startswith('EditPackages=')), default=None)
    if last is None:
        raise RuntimeError('The workspace has no EditPackages: build the project once first.')
    lines = [l for l in lines if l.strip() != 'EditPackages=' + PACKAGE]
    last = max(i for i, l in enumerate(lines) if l.startswith('EditPackages='))
    lines.insert(last + 1, 'EditPackages=' + PACKAGE)
    # other mods' packages kept with the project (Import a mod): their folders are searched too
    import kit
    folders = sorted({str(Path(x['path']).parent) for x in kit.extra_packages() if x.get('path')})
    at = next((i for i, l in enumerate(lines) if l.strip().lower() == '[core.system]'), None)
    if at is not None:
        lines[at + 1:at + 1] = ['Paths=%s\*%s' % (f, ext) for f in folders for ext in ('.u', '.utx', '.uax', '.umx')]
    (SYS / MAKE_INI).write_text('\r\n'.join(lines) + '\r\n', encoding='latin1', newline='')


def _problems(text):
    """The compiler's errors and warnings: [{script, line, kind, message}] (script '' when it names none)."""
    out, seen = [], set()
    own = PACKAGE.lower() + '.u'
    for raw in text.splitlines():
        line = raw.strip()
        m = re.search(r'([A-Za-z]\w*)\.uc\((\d+)\)\s*:\s*(Error|Warning)\s*,?\s*(.*)', line, re.I)
        if m:
            item = dict(script=m.group(1), line=int(m.group(2)), kind=m.group(3).lower(), message=m.group(4).strip())
        elif re.match(r'(?i)^(error|critical)\b', line) and own not in line.lower() and 'failed loading package' not in line.lower():
            item = dict(script='', line=0, kind='error', message=re.sub(r'(?i)^(error|critical)\s*:\s*', '', line))
        else:
            continue
        key = (item['script'], item['line'], item['message'])
        if key not in seen:
            seen.add(key)
            out.append(item)
    return out


def compile(log=None):
    """Compile the scripts' package: dict(ok, problems, lines, installed, note)."""
    say = log or (lambda *a: None)
    if not _classes():
        gone = _remove_package()
        return dict(ok=True, problems=[], lines=['No scripts: nothing to compile.'] + ['removed ' + g for g in gone],
                    installed=False, note='No scripts.')
    if settings.STANDALONE:
        import workspace
        if not workspace.ensure(say):
            return dict(ok=False, problems=[], lines=['The workspace is not ready (the game folder?).'], installed=False, note='')
    if not (SYS / 'DeusEx.ini').is_file():
        return dict(ok=False, problems=[], lines=['No workspace at %s: build the project once first.' % DEV], installed=False, note='')
    # the scripts extend the editor's package: the compiler reads its newest build
    main = DIST / (settings.PACKAGE + '.u')
    if main.is_file() and (not (SYS / main.name).is_file() or main.stat().st_mtime > (SYS / main.name).stat().st_mtime + 1):
        shutil.copy2(main, SYS / main.name)
    link = DEV / PACKAGE
    if not os.path.lexists(link):
        import workspace
        workspace._junction(link, SRC)
    _make_ini()
    target = SYS / (PACKAGE + '.u')
    target.unlink(missing_ok=True)
    host = SYS / HOST.name
    bridge = HOST.with_name('UCEngineBridge.dll')       # the host's engine bridge (host/README.md)
    shutil.copy2(HOST, host)
    if bridge.is_file():
        shutil.copy2(bridge, SYS / bridge.name)
    t0 = time.time()
    try:
        r = subprocess.run([str(host), '--make', MAKE_INI], cwd=str(SYS), capture_output=True, text=True, encoding='utf-8',
                           errors='replace', timeout=600, stdin=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
    finally:
        host.unlink(missing_ok=True)
        (SYS / bridge.name).unlink(missing_ok=True)
        (SYS / MAKE_INI).unlink(missing_ok=True)
    text = (r.stdout or '') + (r.stderr or '')
    (SYS.parent / 'scripts-compile.log').write_text(text, encoding='utf-8')
    problems = _problems(text)
    ok = r.returncode == 0 and target.is_file() and not any(p['kind'] == 'error' for p in problems)
    lines = ['%s: %d class(es) compiled in %.1f s' % (PACKAGE, len(_classes()), time.time() - t0)] if ok else \
            ['%s was not compiled (%d problem(s)); the whole output: %s' % (PACKAGE, len(problems), SYS.parent / 'scripts-compile.log')]
    if not ok:
        return dict(ok=False, problems=problems, lines=lines, installed=False, note='')
    DIST.mkdir(exist_ok=True)
    tmp = DIST / (PACKAGE + '.u.tmp')
    shutil.copy2(target, tmp)
    os.replace(tmp, DIST / target.name)
    installed, note = False, ''
    if _game_running():
        note = 'The game is open: the scripts reach it at the next Play.'
    else:
        dest = settings.PACKAGES_DIR / target.name
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix('.u.tmp')
        shutil.copy2(target, tmp)
        os.replace(tmp, dest)
        installed = True
        note = 'Installed: maps rebuilt from now on can use them.'
    return dict(ok=True, problems=problems, lines=lines, installed=installed, note=note)
