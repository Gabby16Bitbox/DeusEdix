"""The program's folder as it is installed (build\\app), from this repository: the editor's code laid out
the way it expects (tools\\mapkit, tools\\ue1pkg.py), DeusEdix's UnrealScript (src\\DeusEdix) and the
compiled host. The launcher (PyInstaller) and the installer (Inno Setup) are built around it.

    python dev\\stage.py [--host path\\to\\UCMapKitHost.exe] [--game "C:\\...\\Deus Ex"]

--game writes a deusedix.json (what the installer writes) so the staged folder can be tried as it is.
Everything the editor makes at run time (caches, runs, the workspace, built maps) is made next to
the code, in the user's install folder, never here.
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / 'mapkit'))
from experimental_payload import distribution_files
APP = HERE / 'build' / 'app'
DEFAULT_HOST = HERE / 'mapkit' / 'bin' / 'UCMapKitHost.exe'   # mapkit\host\build_host.ps1
STATIC_EXT = {'.js', '.css', '.html', '.json', '.png', '.jpg', '.jpeg', '.svg', '.ico',
              '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.ogg', '.wav'}
TUTORIAL_EXT = {'.py', '.json', '.png', '.jpg', '.jpeg', '.wav', '.ogg', '.mp3', '.md'}
GENERATED = {'UCPortraits.uc', 'UCVoiceDubs.uc'}
USER_PATHS = ('Projects', 'DevInstall', 'maps', 'webview', 'deusedix.json', 'DeusEdix.exe',
              'deusedix-project.json', '.deusedix-owned.json', '.deusedix-ui.json', '.deusedix-project-ui.json',
              *('tools/mapkit/' + name for name in
                ('maps', 'story', 'sounds', 'dubs', 'models', 'textures', 'characters', 'prefabs', 'anims')))


def no_links(path):
    for part in (path, *path.parents):
        if part.exists() or part.is_symlink():
            if part.is_symlink() or getattr(part.stat(), 'st_file_attributes', 0) & 1024:
                raise SystemExit('Staging paths cannot contain links or junctions: ' + str(part))


def clean_output(out):
    no_links(out)
    out = out.resolve()
    source = HERE.resolve()
    if out == source or out in source.parents or any(
            part == out or part in out.parents for part in
            (source / 'mapkit', source / 'runtime', source / 'launcher', source / 'dev', source / 'installer')):
        raise SystemExit('Not a staging output directory: ' + str(out))
    if not out.exists():
        return
    found = [name for name in USER_PATHS if (out / name).exists()]
    if found:
        raise SystemExit('%s contains user/runtime data; --clean will not remove it: %s' % (out, ', '.join(found)))
    if any(out.iterdir()) and not all((out / name).exists() for name in
                                   ('NOTICE.md', 'tools/mapkit/editor/server.py', 'src/DeusEdix/Classes/UCBoot.uc')):
        raise SystemExit('Refusing to clean an unrecognized non-empty staging directory: ' + str(out))
    shutil.rmtree(out)


def copy_code(source, kit):
    # Copy application files explicitly. A developer's Projects, map edits,
    # recordings and caches must never become part of the installer.
    kit.mkdir(parents=True, exist_ok=True)
    for file in source.glob('*.py'):
        if file.name not in {'mcp_server.py', 'sheet.py'}:
            shutil.copy2(file, kit / file.name)
    editor = kit / 'editor'
    editor.mkdir(parents=True, exist_ok=True)
    for file in (source / 'editor').glob('*.py'):
        shutil.copy2(file, editor / file.name)
    for folder, extensions in (('editor/static', STATIC_EXT), ('tutorial', TUTORIAL_EXT)):
        for file in (source / folder).rglob('*'):
            if file.is_file() and file.suffix.lower() in extensions and '__pycache__' not in file.parts:
                target = kit / file.relative_to(source)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(file, target)
    # The optional worker has its own native host. Never recursively copy the
    # directory: the running tool keeps private map copies and evidence there.
    for file, relative in distribution_files(source / 'experimental_bsp', required=True):
        target = kit / 'experimental_bsp' / Path(relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file, target)


def copy_runtime(out):
    runtime = HERE / 'runtime' / 'DeusEdix'
    src = out / 'src' / 'DeusEdix'
    template = out / 'tools' / 'mapkit' / 'project-template' / 'src' / 'DeusEdix'
    no_links(src)
    no_links(template)
    # This is application-owned clean source, never a project or its generated
    # portraits, recordings or campaign classes.
    if template.exists():
        shutil.rmtree(template)
    for root in (src, template):
        (root / 'Classes').mkdir(parents=True, exist_ok=True)
        (root / 'Textures').mkdir(parents=True, exist_ok=True)
    for file in (src / 'Classes').glob('*.uc'):
        if not file.name.startswith('UCEd_') and file.name not in GENERATED:
            file.unlink()
    for file in (runtime / 'Classes').glob('*.uc'):
        if file.name.startswith('UCEd_'):
            continue
        clean = HERE / 'runtime' / 'extra' / file.name if file.name in GENERATED else file
        if not clean.is_file():
            raise SystemExit('Missing clean runtime seed: ' + str(clean))
        shutil.copy2(clean, template / 'Classes' / file.name)
        if file.name not in GENERATED or not (src / 'Classes' / file.name).exists():
            shutil.copy2(clean, src / 'Classes' / file.name)
    for file in (runtime / 'Textures').glob('*.pcx'):
        for root in (src, template):
            shutil.copy2(file, root / 'Textures' / file.name)
    for voice in (HERE / 'mapkit/tutorial/voices').glob('V*.wav'):
        for root in (src, template):
            target = root / 'Sounds/Doctor' / voice.name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(voice, target)
    # the classes of a project made for the original Deus Ex (dev\vanilla_runtime.py)
    vanilla = out / 'tools' / 'mapkit' / 'project-template' / 'vanilla' / 'Classes'
    no_links(vanilla)
    if vanilla.parent.exists():
        shutil.rmtree(vanilla.parent)
    vanilla.mkdir(parents=True)
    for file in (HERE / 'runtime' / 'vanilla' / 'Classes').glob('*.uc'):
        shutil.copy2(file, vanilla / file.name)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', type=Path, default=DEFAULT_HOST)
    ap.add_argument('--game', type=Path)
    ap.add_argument('--out', type=Path, default=APP)
    ap.add_argument('--clean', action='store_true', help='start from an empty folder (a release: nothing of a test run)')
    a = ap.parse_args()
    out = a.out.absolute()
    no_links(out)
    if a.clean:
        clean_output(out)
    kit = out / 'tools' / 'mapkit'
    # code: replaced as a whole (what the user made next to it stays: caches, runs, workspace...)
    for sub in ('editor/static', 'host'):
        no_links(kit / sub)
        shutil.rmtree(kit / sub, ignore_errors=True)
    for f in kit.glob('*.py') if kit.exists() else []:
        f.unlink()
    for f in (kit / 'editor').glob('*.py') if (kit / 'editor').exists() else []:
        f.unlink()
    copy_code(HERE / 'mapkit', kit)
    shutil.rmtree(kit / 'host', ignore_errors=True)               # the source of the host is not needed to run
    shutil.rmtree(kit / 'native', ignore_errors=True)             # nor DeusEdixNav's: its built files are in bin
    (kit / 'bin').mkdir(parents=True, exist_ok=True)
    shutil.copy2(a.host, kit / 'bin' / 'UCMapKitHost.exe')
    shutil.copy2(Path(a.host).with_name('UCEngineBridge.dll'), kit / 'bin' / 'UCEngineBridge.dll')   # its engine bridge
    for name in ('DeusEdixNav.u', 'DeusEdixNav.dll'):            # the walkable area's routes in C++ (native/README.md)
        shutil.copy2(Path(a.host).with_name(name), kit / 'bin' / name)
    shutil.copy2(HERE / 'ue1pkg.py', out / 'tools' / 'ue1pkg.py')
    copy_runtime(out)
    for name in ('README.md', 'NOTICE.md'):
        shutil.copy2(HERE / name, out / name)
    # the guide (dev\make_guide.py): Help > Open the full guide in the editor shows it
    (out / 'docs' / 'guide').mkdir(parents=True, exist_ok=True)
    shutil.copy2(HERE / 'docs' / 'guide' / 'guide.md', out / 'docs' / 'guide' / 'guide.md')
    shutil.copy2(HERE / 'docs' / 'guide' / 'guide.html', out / 'docs' / 'guide' / 'guide.html')
    if a.game:
        config = out / 'deusedix.json'
        cfg = json.loads(config.read_text(encoding='utf-8')) if config.exists() else {}
        cfg.update(game=str(a.game), package='DeusEdix')
        config.write_text(json.dumps(cfg, indent=1), encoding='utf-8')
    n = sum(1 for _ in out.rglob('*') if _.is_file())
    print('staged %d files in %s' % (n, out))


if __name__ == '__main__':
    main()
