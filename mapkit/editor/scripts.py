"""The scripts written in the map editor (Tools > Scripts): UnrealScript classes of their own package,
settings.SCRIPTS_PACKAGE (UCScripts for the mod, DeusEdixScripts / <project>Scripts for DeusEdix), kept in
src\\<package>\\Classes and compiled apart from the editor's own package, in a few seconds.

A script extends UCScript (an invisible actor of the editor's package: Started / Triggered / Repeat, Input /
Output and helpers); it is placed in a map like any object. A rule sets it off by its name (Switch on), or calls one
of the inputs it declares; its outputs start rules (editor/LOGIC.md, "Scripts as blocks").

  names()            the scripts there are
  new(name, kind)    a new script from a template, saved
  read / save / delete
  compile(log)       the package with the host (--make), errors by script and line, then into dist\\ and
                     the game (not while it runs: then at the next Play / install)
  ports(name)        the inputs and outputs it declares in its defaultproperties
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
import atomicfile  # noqa: E402
import gametext  # noqa: E402
import props  # noqa: E402

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
    'triggered': ('When triggered', """// %(name)s: a rule sets it off (Switch on, from a button, a trigger, a timer...).
class %(name)s extends UCScript;

function Triggered(Actor Other, Pawn EventInstigator)
{
	Say("Something happened.");
	log("%(name)s triggered by" @ Other);
}
"""),
    'block': ('A block (inputs and outputs)', """// %(name)s: a block the rules use like a door or a keypad. Its inputs are what a rule can make it do,
// its outputs what it tells the rules: both are declared in defaultproperties, at the end.
class %(name)s extends UCScript;

var() float Seconds;    // a setting: shown in the Inspector, under Script settings
var float Wait;

function Input(string InputName, string Args, Actor Caller)
{
	switch (InputName)
	{
	case "Start":
		Wait = ArgFloat(Args, "Seconds", Seconds);    // the rule's value, else the setting
		Say("Started for" @ Wait @ "seconds.");
		GotoState('Counting');
		break;
	default:
		Super.Input(InputName, Args, Caller);     // logs that the script has no such input
	}
}

state Counting
{
Begin:
	Sleep(Wait);
	Output("Done");         // the rules on "it says Done" run
	GotoState('');
}

defaultproperties
{
	Inputs(0)=(Id="Start",Label="Start it",Args="Seconds")
	Outputs(0)=(Id="Done",Label="it is done")
	Seconds=10.0
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


def names(generated=False):
    # the weapons' and ammunition's classes (Tools > Weapons, weapons.py) live here too: made again at each Save, not
    # listed (generated: with them, for what they are in the map: their family, server.class_io_parts)
    if not CLASSES.is_dir():
        return []
    return sorted(p.stem for p in CLASSES.glob('*.uc') if generated or not p.stem.startswith(('UCW_', 'UCA_')))


def _classes():
    return sorted(CLASSES.glob('*.uc')) if CLASSES.is_dir() else []


def read(name):
    return _path(name).read_text(encoding='latin1')


def save(name, text):
    """The script's text; its class line must name it (UnrealScript: one class per file, same name). The file is
    Latin-1, as the game reads it: typographic punctuation is made plain (gametext), any other letter outside
    Latin-1 refused, naming its line. Returns the path; the text saved is what read() gives back."""
    path = _path(name)
    text = _plain_script(str(text or ''))
    for number, line in enumerate(text.splitlines(), 1):
        bad = next((c for c in line if ord(c) > 255), None)
        if bad:
            raise ValueError('Line %d: "%s" is not a letter the game can read (Latin-1); write it another way.'
                             % (number, bad))
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


# _TOKENS, with a string in curly quotes as one token (a // or /* inside it is not a comment)
_PLAIN_TOKENS = re.compile('"(?:[^"\\\\\n]|\\\\.)*"|[\u201c\u201d][^"\u201c\u201d\n]*[\u201c\u201d]|//[^\n]*|/\\*.*?\\*/|[^"/\u201c\u201d]+|/',
                           re.S)


def _plain_script(text):
    """Typographic punctuation made plain for the compiler (gametext.PLAIN). A curly double quote inside a string or
    a comment becomes ' (a " would end the string); in the code it was the string's own quote, pasted from a page."""
    out, pos = [], 0
    for m in _PLAIN_TOKENS.finditer(text):
        out.append(''.join(gametext.PLAIN.get(c, c) for c in text[pos:m.start()]))     # (a quote never closed)
        token = m.group(0)
        if token[0] in '\u201c\u201d':                  # a string in curly quotes: its own quotes, the rest as in one
            token = '"' + token[1:-1].replace('\u201c', "'").replace('\u201d', "'") + '"'
        elif token.startswith(('"', '//', '/*')):
            token = token.replace('\u201c', "'").replace('\u201d', "'")
        out.append(''.join(gametext.PLAIN.get(c, c) for c in token))
        pos = m.end()
    out.append(''.join(gametext.PLAIN.get(c, c) for c in text[pos:]))
    return ''.join(out)


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


# A script's ports, declared in its defaultproperties (the place UnrealScript keeps a class's data):
#   Inputs(0)=(Id="Sabotage",Label="Sabotage it",Args="Seconds,Mode")
#   Outputs(0)=(Id="Sabotaged",Label="it is sabotaged")
_TOKENS = re.compile(r'"(?:[^"\\\n]|\\.)*"|//[^\n]*|/\*.*?\*/|[^"/]+|/', re.S)
_PORT = re.compile(r'(?i)^\s*(Inputs|Outputs)\s*\(\s*(\d+)\s*\)\s*=\s*\((.*)\)\s*$')
_PORT_FIELD = re.compile(r'(\w+)\s*=\s*(?:"([^"]*)"|([^,)]*))')
_CLASS_LINE = re.compile(r'(?im)^\s*class\s+(\w+)\s+(?:extends|expands)\s+(\w+)')     # (expands: the old word)


def _code(text):
    """The text without its comments (// and /* */, not inside quotes): what the compiler reads."""
    return ''.join(t if not t.startswith(('//', '/*')) else '\n' * t.count('\n') for t in _TOKENS.findall(text or ''))


def _defaults_block(code):
    """The inside of the class's defaultproperties { } (braces inside quotes do not count), or ''."""
    m = re.search(r'(?im)^\s*defaultproperties\s*\{', code)
    if not m:
        return ''
    depth, quoted = 1, False
    for i in range(m.end(), len(code)):
        ch = code[i]
        if ch == '"':
            quoted = not quoted
        elif not quoted and ch in '{}':
            depth += 1 if ch == '{' else -1
            if not depth:
                return code[m.end():i]
    return code[m.end():]


def ports(name, text=None):
    """{'inputs': [{'id', 'label', 'args': [names]}], 'outputs': [{'id', 'label'}]}: what the script itself declares,
    in the order of their indexes. A port without a valid Id is left out; its label is its Id when it has none."""
    text = read(name) if text is None else text
    found = {'inputs': {}, 'outputs': {}}
    for line in _defaults_block(_code(text)).splitlines():
        m = _PORT.match(line)
        if not m:
            continue
        # a value in quotes or bare (Id=Open): finditer, since findall gives '' for the alternative not taken
        fields = {f.group(1).lower(): f.group(2) if f.group(2) is not None else f.group(3).strip()
                  for f in _PORT_FIELD.finditer(m.group(3))}
        port_id = fields.get('id', '')
        if not re.fullmatch(r'[A-Za-z_]\w{0,40}', port_id, re.ASCII):
            continue
        entry = dict(id=port_id, label=fields.get('label') or port_id)
        if m.group(1).lower() == 'inputs':
            entry['args'] = [a.strip() for a in fields.get('args', '').split(',') if re.fullmatch(r'\w+', a.strip(), re.ASCII)]
        found[m.group(1).lower()][int(m.group(2))] = entry
    return {kind: [found[kind][i] for i in sorted(found[kind])] for kind in found}


def is_script_class(cls, generated=False):
    """A class of the scripts' package ('<package>.<Name>') written in Tools > Scripts (generated: or by Tools >
    Weapons)."""
    pkg, _, short = str(cls or '').rpartition('.')
    return (pkg.lower() == PACKAGE.lower() and bool(NAME.match(short))
            and short.lower() in {n.lower() for n in names(generated)})


def lineage(name, generated=False):
    """([the script, the scripts it extends...], the first game or editor class above them): 'class B extends A;',
    'class A extends UCScript;' -> (['B', 'A'], 'UCScript'). generated: the weapons' classes too (names)."""
    known = {n.lower(): n for n in names(generated)}
    chain, current = [], known.get(str(name).lower())
    while current and current not in chain:
        chain.append(current)
        m = _CLASS_LINE.search(_code(read(current)))
        parent = m.group(2) if m else 'Actor'
        current = known.get(parent.lower())
        if not current:
            return chain, parent
    return chain, 'Actor'


def ports_of(chain):
    """The ports of a script and of the scripts it extends (lineage): a parent's first, a child's own replacing one
    with the same Id."""
    merged = {'inputs': {}, 'outputs': {}}
    for name in reversed(chain):
        for kind, entries in ports(name).items():
            for entry in entries:
                merged[kind][entry['id'].lower()] = entry
    return {kind: list(entries.values()) for kind, entries in merged.items()}


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
    atomicfile.write_text(SYS / MAKE_INI, '\r\n'.join(lines) + '\r\n', encoding='latin1')


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
    # the scripts extend the editor's package: the compiler reads its newest build. The workspace's System is mostly
    # hard links to the game's files: a write there replaces a name (atomicfile), never writes into one
    main = DIST / (settings.PACKAGE + '.u')
    if main.is_file() and (not (SYS / main.name).is_file() or main.stat().st_mtime > (SYS / main.name).stat().st_mtime + 1):
        atomicfile.copy_file(main, SYS / main.name)
    link = DEV / PACKAGE
    if not os.path.lexists(link):
        import workspace
        workspace._junction(link, SRC)
    _make_ini()
    target = SYS / (PACKAGE + '.u')
    target.unlink(missing_ok=True)
    host = SYS / HOST.name
    bridge = HOST.with_name('UCEngineBridge.dll')       # the host's engine bridge (host/README.md)
    atomicfile.copy_file(HOST, host)
    if bridge.is_file():
        atomicfile.copy_file(bridge, SYS / bridge.name)
    import workspace
    workspace._copy_native()            # the editor's package uses DeusEdixNav: the compiler loads it with its DLL
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
    props.forget_classes(names())               # their settings (Inspector) are read again from the new package
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
