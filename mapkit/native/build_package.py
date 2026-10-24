"""DeusEdixNav.u, the package of UCNavNative (native/DeusEdixNav/Classes), into mapkit/bin next to DeusEdixNav.dll
(build_native.ps1 first: the engine binds the class's native function to the DLL while it compiles it).

It is compiled by the editor's engine (UCMapKitHost --make) in a private run of its own (kit.new_run): nothing of the
game's folder or of the project's packages is written. The package depends on Core alone, so the one file serves
every project, the original game and Revision.

    python native/build_package.py
"""
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import kit  # noqa: E402

PACKAGE = 'DeusEdixNav'
BIN = HERE.parent / 'bin'


def build(log=print):
    dll = BIN / (PACKAGE + '.dll')
    if not dll.is_file():
        raise SystemExit('%s is missing: run native\\build_native.ps1 first' % dll)
    folder = kit.new_run(label='native-make')
    system = folder / 'System'
    (system / (PACKAGE + '.u')).unlink(missing_ok=True)       # a copy linked from the game's System: made again
    (system / dll.name).unlink(missing_ok=True)
    shutil.copy2(dll, system / dll.name)
    shutil.copytree(HERE / PACKAGE, folder / PACKAGE)
    ini = system / 'DeusEx.ini'
    lines = ini.read_text(encoding='latin1').splitlines()
    last = max(i for i, line in enumerate(lines) if line.startswith('EditPackages='))
    lines.insert(last + 1, 'EditPackages=' + PACKAGE)
    ini.write_text('\n'.join(lines) + '\n', encoding='latin1')
    r = subprocess.run([str(system / kit.HOST.name), '--make', ini.name], cwd=str(system), capture_output=True,
                       text=True, encoding='utf-8', errors='replace', timeout=600, stdin=subprocess.DEVNULL)
    text = (r.stdout or '') + (r.stderr or '')
    (folder / 'make.log').write_text(text, encoding='utf-8')
    built = system / (PACKAGE + '.u')
    if r.returncode != 0 or not built.is_file():
        problems = [l for l in text.splitlines() if 'error' in l.lower() or "can't" in l.lower()][-10:]
        raise SystemExit('%s.u was not built (exit code %s):\n  %s\nThe whole output: %s'
                         % (PACKAGE, r.returncode, '\n  '.join(problems), folder / 'make.log'))
    shutil.copy2(built, BIN / built.name)
    log('built %s' % (BIN / built.name))
    return BIN / built.name


if __name__ == '__main__':
    build()
