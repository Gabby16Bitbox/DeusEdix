"""Build DeusEdix's installer: build\\installer\\DeusEdix-Setup-<v>.exe.

    .venv\\Scripts\\python dev\\build_installer.py [--version 0.1.0] [--no-sync]

1-2. (the maintainer's own copy step, skipped with --no-sync or when its scripts are absent)
3. dev\\make_icon.py           the icon from the DE mark
4. dev\\stage.py --clean       build\\release: what gets installed next to the program
5. PyInstaller                 build\\pyi\\DeusEdix: DeusEdix.exe and deusedix-cli.exe, with our own
                               bootloader (dev\\make_bootloader.py, once) and version information
6. Inno Setup (ISCC)           the installer
"""
import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path
from check_original_assets import check_tree

HERE = Path(__file__).resolve().parents[1]
PY = HERE / '.venv' / 'Scripts' / 'python.exe'
ISCC = HERE / 'build_tools' / 'InnoSetup6' / 'ISCC.exe'
PUBLISHER = 'Gabby'
VERSION_INFO = """VSVersionInfo(
  ffi=FixedFileInfo(filevers={nums}, prodvers={nums}, mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1,
                    subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('040904B0', [
      StringStruct('CompanyName', {publisher!r}),
      StringStruct('FileDescription', {description!r}),
      StringStruct('FileVersion', {version!r}),
      StringStruct('InternalName', {name!r}),
      StringStruct('LegalCopyright', {copyright!r}),
      StringStruct('OriginalFilename', {exe!r}),
      StringStruct('ProductName', 'DeusEdix'),
      StringStruct('ProductVersion', {version!r})])]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
"""


def own_bootloader():
    """Our build of PyInstaller's bootloader into .venv's PyInstaller (dev\\make_bootloader.py)."""
    version = run([PY, '-c', 'import PyInstaller; print(PyInstaller.__version__)']).strip()
    src = HERE / 'build_tools' / 'pyinstaller-bootloader' / version / 'Windows-64bit-intel'
    if not src.is_dir():
        raise SystemExit('no bootloader of ours for PyInstaller %s: run .venv\\Scripts\\python dev\\make_bootloader.py' % version)
    dst = HERE / '.venv' / 'Lib' / 'site-packages' / 'PyInstaller' / 'bootloader' / 'Windows-64bit-intel'
    for f in src.glob('*.exe'):
        if not (dst / f.name).exists() or (dst / f.name).read_bytes() != f.read_bytes():
            shutil.copy2(f, dst / f.name)
    print('bootloader: our own build for PyInstaller %s' % version)


def version_files(version):
    """build\\version_<exe>.txt: the version information of the two EXEs (read by launcher\\DeusEdix.spec)."""
    nums = tuple((list(map(int, re.findall(r'\d+', version))) + [0, 0, 0, 0])[:4])
    out = HERE / 'build'
    out.mkdir(exist_ok=True)
    for name, description in (('DeusEdix', 'DeusEdix map editor'), ('deusedix-cli', 'DeusEdix map editor (command line)')):
        (out / ('version_%s.txt' % name)).write_text(VERSION_INFO.format(
            nums=nums, publisher=PUBLISHER, description=description, version=version, name=name, exe=name + '.exe',
            copyright='Copyright (c) 2026 %s' % PUBLISHER), encoding='utf-8')


def run(args, **kw):
    print('>', ' '.join(str(a) for a in args[:3]), '...', flush=True)
    r = subprocess.run([str(a) for a in args], cwd=str(HERE), capture_output=True, text=True, **kw)
    if r.returncode != 0:
        print(r.stdout[-3000:], r.stderr[-3000:])
        raise SystemExit('failed: %s' % args[:3])
    return r.stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--version', default='0.1.0')
    ap.add_argument('--no-sync', action='store_true')
    a = ap.parse_args()
    if not a.no_sync and (HERE / 'dev' / 'sync_from_unatco.py').exists():
        print(run([PY, 'dev/sync_from_unatco.py']).strip())
        print(run([PY, 'dev/make_runtime.py']).strip())
        print(run([PY, 'dev/make_guide.py']).strip())
    print(run([PY, 'dev/make_icon.py']).strip())
    check_tree(HERE / 'runtime')
    print(run([PY, 'dev/stage.py', '--clean', '--out', HERE / 'build' / 'release']).strip())
    check_tree(HERE / 'build' / 'release')
    launcher = HERE / 'launcher' / 'deusedix.py'
    text = launcher.read_text(encoding='utf-8')
    launcher.write_text(re.sub(r"VERSION = '[^']*'", "VERSION = '%s'" % a.version, text), encoding='utf-8')
    own_bootloader()
    version_files(a.version)
    run([HERE / '.venv' / 'Scripts' / 'pyinstaller.exe', 'launcher/DeusEdix.spec', '--distpath', 'build/pyi',
         '--workpath', 'build/pyi-work', '--noconfirm'])
    # Both folders are recursively included by Inno Setup. Frozen dependencies
    # must obey the same no-game-assets boundary as the loose application code.
    check_tree(HERE / 'build' / 'pyi' / 'DeusEdix')
    out = run([ISCC, '/Q', '/DAppVersion=%s' % a.version, 'installer/DeusEdix.iss'])
    setup = HERE / 'build' / 'installer' / ('DeusEdix-Setup-%s.exe' % a.version)
    print(out.strip()[-500:])
    print('installer: %s (%.1f MB)' % (setup, setup.stat().st_size / 1e6))


if __name__ == '__main__':
    main()
