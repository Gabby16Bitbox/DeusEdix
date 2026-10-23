"""DeusEdix's own build of PyInstaller's bootloader (the small program at the start of DeusEdix.exe and
deusedix-cli.exe), compiled here from PyInstaller's source with Visual Studio's C compiler.

Why: the bootloaders that come with PyInstaller are the same bytes in every program made with it,
malware included, so some antivirus engines flag any program that has them (Avira and WithSecure
called the 0.1.0 installer "TR/W64.Malware", 14 Oct 2026). One compiled here is our own.

    .venv\\Scripts\\python dev\\make_bootloader.py

It takes the source of the PyInstaller installed in .venv (same version) from PyPI, checks it against
PyPI's SHA-256, builds the 64-bit Windows bootloaders with waf and keeps them in
build_tools\\pyinstaller-bootloader\\<version>\\. dev\\build_installer.py puts them into .venv's
PyInstaller before every build. Run it again after upgrading PyInstaller.

Needs Visual Studio Build Tools (C++), the ones that build the host (mapkit\\host\\build_host.ps1).
"""
import hashlib
import json
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
KEEP = HERE / 'build_tools' / 'pyinstaller-bootloader'
NAMES = ('run.exe', 'run_d.exe', 'runw.exe', 'runw_d.exe')


def pyinstaller_version():
    import PyInstaller
    return PyInstaller.__version__


def main():
    version = pyinstaller_version()
    dest = KEEP / version / 'Windows-64bit-intel'
    info = json.load(urllib.request.urlopen('https://pypi.org/pypi/pyinstaller/%s/json' % version))
    sdist = next(u for u in info['urls'] if u['packagetype'] == 'sdist')
    with tempfile.TemporaryDirectory(prefix='deusedix-bootloader-') as tmp:
        tmp = Path(tmp)
        archive = tmp / sdist['filename']
        print('downloading %s (%.1f MB) from PyPI' % (sdist['filename'], sdist['size'] / 1e6))
        with urllib.request.urlopen(sdist['url']) as r, archive.open('wb') as f:
            shutil.copyfileobj(r, f)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        if digest != sdist['digests']['sha256']:
            raise SystemExit('the download does not match PyPI\'s SHA-256: not using it')
        with tarfile.open(archive) as t:
            for m in t.getmembers():                  # nothing outside the folder
                if m.name.startswith(('/', '\\')) or '..' in Path(m.name).parts:
                    raise SystemExit('unexpected path in the archive: %s' % m.name)
            t.extractall(tmp)
        src = tmp / ('pyinstaller-%s' % version)
        r = subprocess.run([sys.executable, 'waf', 'distclean', 'all', '--target-arch=64bit'],
                           cwd=str(src / 'bootloader'), capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stdout[-3000:], r.stderr[-3000:])
            raise SystemExit('the bootloader did not compile (Visual Studio Build Tools installed?)')
        built = src / 'PyInstaller' / 'bootloader' / 'Windows-64bit-intel'
        dest.mkdir(parents=True, exist_ok=True)
        for name in NAMES:
            shutil.copy2(built / name, dest / name)
    print('bootloaders for PyInstaller %s in %s' % (version, dest))


if __name__ == '__main__':
    main()
