"""The big text files of the map cache, kept compressed on disk.

A map the editor has read keeps its T3D text and its polygons as JSON in its cache folder (editor/data.py prepare):
scene.t3d, geometry.json and polys.json. They were three quarters of the cache (2.8 of the 3.6 GB of Revision's 89
maps, 14 Nov 2026) and they are text: packed they are a tenth or less, and reading one back takes a few hundredths
of a second.

Two forms, the same name with a suffix after it, in the same folder:
- .zst (Zstandard) when the zstd module is there (python-zstd, PyPI "zstd"): what the editor writes as a rule. On a
  map of 79 MB, measured 16 Nov 2026: 4.9 MB at level 9, packed in 0.8 s and read back in 0.06 s;
- .gz (gzip, in Python itself) when it is not: 5.8 MB at level 6, packed in 1.1 s and read back in 0.13 s.
A .gz is read wherever it is. A .zst cannot be read without the module: it is then as if the file were not there,
and the editor makes it again (data.prepare), as .gz.

A packed file has the plain file's date and keeps the size of what it holds, so what was stamped with them
(signature) still matches after packing.

A reader goes through this module and never cares which form is there: the plain file wins when both are (it was
written after the packed one), and a file packed between the look and the read is read packed. A writer writes the
plain file as before; pack or pack_folder compress it afterwards (data.prepare, at its end; the Pieces scan, for the
caches made before).
"""
import gzip
import io
import os
import struct
import uuid
import zlib
from pathlib import Path

try:
    import zstd                 # python-zstd; optional: without it everything works with gzip
except ImportError:             # (an environment the module was not installed in)
    zstd = None

NAMES = ('scene.t3d', 'geometry.json', 'polys.json')      # what pack_folder packs in a map's cache folder
ZST, GZ = '.zst', '.gz'
# how hard to pack, as (zstd level, gzip level): a map read for the library, in the background, and the map shown,
# packed while its Rebuild waits (79 MB: zstd 3 in 0.15 s, gzip 1 in 0.34 s). Reading back does not depend on it.
SMALL = (9, 6)
FAST = (3, 1)
LEVEL = SMALL
ZSTD_MAGIC = b'\x28\xb5\x2f\xfd'


def suffix():
    """The form pack writes here: .zst with the zstd module, else .gz."""
    return ZST if zstd is not None else GZ


def packed_path(path, form=None):
    """Where path's packed form is (form: ZST or GZ; None: the one pack writes here)."""
    return Path(str(path) + (form or suffix()))


def _forms():
    """The packed forms that can be read here, the one written here first."""
    return (ZST, GZ) if zstd is not None else (GZ,)


def real(path):
    """The file that holds path's content now: the plain one, else a packed one that can be read here; path itself
    when there is neither."""
    path = Path(path)
    if path.is_file():
        return path
    for form in _forms():
        other = packed_path(path, form)
        if other.is_file():
            return other
    return path


def form_of(file):
    """ZST or GZ for a packed file (real's answer), None for a plain one."""
    name = str(file)
    return ZST if name.endswith(ZST) else GZ if name.endswith(GZ) else None


def exists(path):
    """Whether path is there, plain or packed in a form that can be read here."""
    return real(path).is_file()


def _unpack(file, form):
    """What a packed file holds. A damaged one is an OSError, as a file that cannot be read is to every reader."""
    if form == ZST:
        data = file.read_bytes()
        try:
            return zstd.decompress(data)
        except zstd.Error as exc:
            raise OSError('Damaged packed file %s: %s' % (file, exc)) from exc
    try:
        with gzip.open(file, 'rb') as stream:
            return stream.read()
    except (EOFError, zlib.error) as exc:
        raise OSError('Damaged packed file %s: %s' % (file, exc)) from exc


def read_bytes(path):
    path = Path(path)
    for _ in range(2):                  # packed between the look and the read: once more
        try:
            return path.read_bytes()
        except FileNotFoundError:
            pass
        for form in _forms():
            try:
                return _unpack(packed_path(path, form), form)
            except FileNotFoundError:
                pass
    raise FileNotFoundError(2, 'No such file, plain or packed', str(path))


def read_text(path, encoding='utf-8', errors='strict'):
    """path's text, plain or packed, as Path.read_text gives it (its arguments, and its line ends: the engine's
    T3D ends its lines with CR LF, and every reader of it expects the LF alone that text mode gives)."""
    return read_bytes(path).decode(encoding, errors).replace('\r\n', '\n').replace('\r', '\n')


def _zstd_size(file):
    """The size of what a .zst holds, from its frame header (RFC 8878, 3.1.1); None when the header does not say."""
    with file.open('rb') as stream:
        head = stream.read(18)
    if len(head) < 6 or head[:4] != ZSTD_MAGIC:
        return None
    descriptor = head[4]
    flag, single, dictionary = descriptor >> 6, (descriptor >> 5) & 1, descriptor & 3
    at = 5 + (0 if single else 1) + (0, 1, 2, 4)[dictionary]
    width = (1 if single else 0, 2, 4, 8)[flag]
    if not width or len(head) < at + width:
        return None
    value = int.from_bytes(head[at:at + width], 'little')
    return value + 256 if width == 2 else value


def signature(path):
    """(date in ns, size) of path's content, the same before and after packing: what a cache made from it is stamped
    with. OSError when it is not there (plain or in a form that can be read here)."""
    path = Path(path)
    try:
        st = path.stat()
        return st.st_mtime_ns, st.st_size
    except FileNotFoundError:
        pass
    file = real(path)
    st = file.stat()                                # (FileNotFoundError when there is no packed form either)
    if form_of(file) == ZST:
        size = _zstd_size(file)
        if size is None:                            # a frame that does not say its size: unpacked to know it
            size = len(_unpack(file, ZST))
    else:
        with file.open('rb') as stream:             # gzip's last four bytes: the size of what it holds (mod 4 GB)
            stream.seek(-4, os.SEEK_END)
            size = struct.unpack('<I', stream.read(4))[0]
    return st.st_mtime_ns, size


def _packed_bytes(data, level):
    if zstd is not None:
        return zstd.compress(data, level[0], 1)     # one thread: the scan of the library is background work
    raw = io.BytesIO()
    with gzip.GzipFile(filename='', mode='wb', fileobj=raw, compresslevel=level[1], mtime=0) as stream:
        stream.write(data)
    return raw.getvalue()


def pack(path, level=LEVEL):
    """Compress the plain file path into its packed form (.zst, or .gz without the zstd module) and remove it, and a
    packed form of the other kind with it. A reader meanwhile finds one or the other; a file written again while it
    was being packed stays plain (and wins). level: SMALL or FAST. -> whether it is packed now."""
    path = Path(path)
    try:
        before = path.stat()
        data = path.read_bytes()
    except OSError:
        return False
    target = packed_path(path)
    pending = Path(str(target) + '.pending-' + uuid.uuid4().hex)
    try:
        pending.write_bytes(_packed_bytes(data, level))
        os.utime(pending, ns=(before.st_atime_ns, before.st_mtime_ns))
        os.replace(pending, target)
    except OSError:
        pending.unlink(missing_ok=True)
        return False
    try:
        now = path.stat()
        if (now.st_mtime_ns, now.st_size) != (before.st_mtime_ns, before.st_size):
            target.unlink(missing_ok=True)      # written again meanwhile: what was packed is the old one
            return False
        path.unlink()
        for form in (ZST, GZ):                  # the same file packed the other way, by an editor without (or with)
            if form != suffix():                # the zstd module: an old one now
                packed_path(path, form).unlink(missing_ok=True)
    except OSError:
        return False
    return True


def pack_folder(folder, level=LEVEL, names=NAMES):
    """Pack the big text files of a map's cache folder that are plain. -> how many it packed."""
    folder = Path(folder)
    return sum(1 for name in names if (folder / name).is_file() and pack(folder / name, level))
