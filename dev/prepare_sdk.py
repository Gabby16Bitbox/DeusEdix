"""The engine's C++ headers and import libraries the headless host is compiled against, into build_tools\\sdk
(what mapkit\\host\\build_host.ps1 reads). Nothing of it is in the repository:

- the headers come from the official Deus Ex SDK 1112f (Headers\\DxHeaders.zip), which you download yourself;
- the import libraries (Core/Engine/Editor/Window/Extension/ConSys.lib) are made from the exports of your own
  game's DLLs.

    python dev\\prepare_sdk.py --headers C:\\path\\to\\DxHeaders.zip --game "C:\\...\\steamapps\\common\\Deus Ex"

Needs Visual Studio (or the Build Tools) with the x86 C++ tools: its lib.exe makes the .lib files.
"""
import argparse
import re
import struct
import subprocess
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
PACKAGES = ('Core', 'Engine', 'Editor', 'Window', 'Extension', 'ConSys')


def extract_headers(archive_path, out):
    root = out / 'headers'
    root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_path) as archive:
        for entry in archive.infolist():
            target = (root / entry.filename).resolve()
            if not target.is_relative_to(root.resolve()):
                raise SystemExit('Unsafe path in the SDK archive: ' + entry.filename)
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(entry))
    # a syntax-only change for a modern MSVC parser
    template = root / 'Core' / 'Inc' / 'UnTemplate.h'
    text = template.read_text(encoding='latin1')
    text = re.sub(r'(?<!typename )TTypeInfo<([^>]+)>::ConstInitType', r'typename TTypeInfo<\1>::ConstInitType', text)
    template.write_text(text, encoding='latin1')


def exports(dll):
    """The names a DLL exports, ' DATA' after the ones that are not code."""
    raw = dll.read_bytes()
    pe = struct.unpack_from('<I', raw, 60)[0]
    count = struct.unpack_from('<H', raw, pe + 6)[0]
    optional = struct.unpack_from('<H', raw, pe + 20)[0]
    sections = [struct.unpack_from('<8s8I', raw, pe + 24 + optional + 40 * i) for i in range(count)]

    def section(rva):
        return next(s for s in sections if s[2] <= rva < s[2] + max(s[1], s[3]))

    def offset(rva):
        s = section(rva)
        return s[4] + rva - s[2]

    directory = offset(struct.unpack_from('<I', raw, pe + 24 + 96)[0])
    _, _, _, _, _, _, _, names, functions_rva, names_rva, ordinals_rva = struct.unpack_from('<IIHH7I', raw, directory)
    out = []
    for i in range(names):
        name_at = offset(struct.unpack_from('<I', raw, offset(names_rva) + i * 4)[0])
        name = raw[name_at:raw.index(b'\0', name_at)].decode('ascii')
        ordinal = struct.unpack_from('<H', raw, offset(ordinals_rva) + i * 2)[0]
        address = struct.unpack_from('<I', raw, offset(functions_rva) + ordinal * 4)[0]
        data = not section(address)[8] & 0x20000000
        out.append(name + (' DATA' if data else ''))
    return out


def lib_exe():
    vswhere = Path(r'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe')
    if not vswhere.exists():
        raise SystemExit('Visual Studio (or the Build Tools) with the C++ tools is needed')
    root = Path(subprocess.check_output([str(vswhere), '-latest', '-products', '*', '-property',
                                         'installationPath']).decode().strip())
    version = sorted((root / 'VC' / 'Tools' / 'MSVC').iterdir())[-1]
    return version / 'bin' / 'Hostx64' / 'x86' / 'lib.exe'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--headers', type=Path, required=True, help="the SDK's Headers\\DxHeaders.zip")
    ap.add_argument('--game', type=Path, required=True, help='the Deus Ex folder (the one with System\\)')
    ap.add_argument('--out', type=Path, default=HERE / 'build_tools' / 'sdk')
    a = ap.parse_args()
    out = a.out.resolve()
    extract_headers(a.headers, out)
    lib = lib_exe()
    for package in PACKAGES:
        dll = a.game / 'System' / (package + '.dll')
        if not dll.exists():
            raise SystemExit('Not found: ' + str(dll))
        definition = out / (package + '.def')
        definition.write_text('LIBRARY %s.dll\nEXPORTS\n%s\n' % (package, '\n'.join(exports(dll))), encoding='ascii')
        subprocess.run([str(lib), '/nologo', '/machine:x86', '/def:' + str(definition),
                        '/out:' + str(out / (package + '.lib'))], check=True, capture_output=True)
    print('headers and %d import libraries in %s' % (len(PACKAGES), out))


if __name__ == '__main__':
    main()
