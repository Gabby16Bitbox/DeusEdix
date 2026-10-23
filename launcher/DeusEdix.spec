# PyInstaller: DeusEdix.exe (the window) and deusedix-cli.exe (its console twin) sharing one folder.
#   .venv\Scripts\pyinstaller launcher\DeusEdix.spec --distpath build\pyi --workpath build\pyi-work --noconfirm
# The editor's code is not frozen: it stays as files next to the program (dev\stage.py), so the program
# carries every module that code imports, found here by reading it.
import ast
import sys
from pathlib import Path

HERE = Path(SPECPATH).resolve().parent
CODE = [HERE / 'mapkit', HERE / 'ue1pkg.py']
local = {p.stem for root in CODE for p in ([root] if root.is_file() else root.rglob('*.py'))}
wanted = set()
for root in CODE:
    for f in ([root] if root.is_file() else root.rglob('*.py')):
        for node in ast.walk(ast.parse(f.read_text(encoding='utf-8', errors='replace'))):
            if isinstance(node, ast.Import):
                wanted |= {a.name for a in node.names}
            elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                wanted.add(node.module)
wanted = sorted(m for m in wanted if m.split('.')[0] not in local and m.split('.')[0] not in ('mcp',))
print('modules for the editor:', ', '.join(wanted))

a = Analysis([str(HERE / 'launcher' / 'deusedix.py')], pathex=[], binaries=[], datas=[],
             hiddenimports=wanted + ['PIL.Image', 'PIL.ImageDraw', 'PIL.ImageFont', 'PIL.ImageFilter', 'PIL.ImageOps',
                                     'PIL.PngImagePlugin', 'PIL.JpegImagePlugin', 'PIL.BmpImagePlugin',
                                     'PIL.PcxImagePlugin', 'PIL.TgaImagePlugin', 'PIL.GifImagePlugin',
                                     'webview', 'webview.platforms.edgechromium', 'webview.platforms.winforms',
                                     'clr_loader', 'pythonnet', 'runpy', 'importlib', 'socket'],
             excludes=['tkinter', 'matplotlib', 'numpy', 'scipy', 'pandas', 'IPython', 'pytest'], noarchive=False)
pyz = PYZ(a.pure)
icon = str(HERE / 'launcher' / 'deusedix.ico')


def info(name):
    """The EXE's name, description and version (written by dev\\build_installer.py)."""
    f = HERE / 'build' / ('version_%s.txt' % name)
    return str(f) if f.exists() else None


gui = EXE(pyz, a.scripts, [], exclude_binaries=True, name='DeusEdix', console=False, icon=icon,
          version=info('DeusEdix'), upx=False)
cli = EXE(pyz, a.scripts, [], exclude_binaries=True, name='deusedix-cli', console=True, icon=icon,
          version=info('deusedix-cli'), upx=False)
coll = COLLECT(gui, cli, a.binaries, a.datas, name='DeusEdix', upx=False)
