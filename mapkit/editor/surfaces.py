"""Validated, ordered face edits, replayed once on the source copy of every build.

Targets are source brush names and polygon indices, never transient BSP surface indices.
Relative operations remain in order so subsequent texture changes and alignments are reproducible.
"""
import math
import re
from pathlib import Path

def _package_command(name, kit, settings):
    """Resolve only the current target's configured packages, never a client file path.

    Private runs link SDK, project and configured extra .u files into System. Load those
    by name so an existing package is not loaded again from a different file. Other
    installed game/texture paths are explicit to avoid stale SDK INI search paths.
    """
    linked = {getattr(settings, key, '') for key in
              ('PACKAGE', 'MODELS_PACKAGE', 'SOUNDS_PACKAGE', 'SCRIPTS_PACKAGE')}
    linked.add(getattr(settings, 'VOICES_PACKAGE', ''))
    own = any(name.casefold() == p.casefold() for p in linked if p)
    code = None
    if own:
        path = Path(kit.PROJECT) / 'dist' / (name + '.u')
        if path.is_file():
            code = (path, True)
    else:
        path = Path(kit.DEV) / (name + '.u')
        if path.is_file():
            code = (path, True)
    if code is None:
        for entry in kit.extra_packages():
            if str(entry.get('name', '')).casefold() != name.casefold() or not entry.get('path'):
                continue
            path = Path(entry['path'])
            if path.suffix.lower() == '.u' and path.stem.casefold() == name.casefold() and path.is_file():
                code = (path, True)
                break
    if code is None and not own:
        for directory in settings.SYSTEM_DIRS:
            path = Path(directory) / (name + '.u')
            if path.is_file():
                code = (path, False)
                break
    texture = None
    for directory in settings.TEXTURE_DIRS:
        path = Path(directory) / (name + '.utx')
        if path.is_file():
            texture = path
            break
    if code and texture:
        raise ValueError('Texture package %s is ambiguous (.u and .utx); choose an unambiguous package.' % name)
    if code:
        filename = name + '.u' if code[1] else str(code[0].resolve())
    elif texture:
        filename = str(texture.resolve())
    else:
        raise ValueError('Texture package %s is not installed for this project. Add its package in Packages, '
                         'or import a PNG for a texture local to another map.' % name)
    if '"' in filename or any(ord(c) < 32 for c in filename):
        raise ValueError('The texture package path contains unsupported characters.')
    return kit.load_cmd(filename)


def load_commands(edits, local_package=None):
    """Load native UTexture packages before replaying face texture edits.

    A mesh Skin/MultiSkins UTexture can be used on BSP without converting its PNG.
    UC_SURFACE intentionally finds an already loaded object, so packages unused by
    the destination map must be loaded on every rebuild. MyLevel/imported textures
    and legacy unqualified names are already in the map and need no package load.
    local_package is the current loaded source map's stem, supplied by the builder,
    never the source object's map supplied by a texture drag request.
    Does not change the operation order, targets, mapping or polygon flags.
    """
    commands(edits)  # Validate the entire request before any path lookup/command.
    if local_package is not None and (not isinstance(local_package, str) or
                                     not re.fullmatch(r'[A-Za-z0-9_-]{1,127}', local_package)):
        raise ValueError('Invalid local map package name.')
    local_names = {'mylevel'}
    if local_package:
        local_names.add(local_package.casefold())
    names = {}
    for row in edits.get('surfaces') or []:
        if row['op'] == 'texture' and '.' in row['args'][0]:
            name = row['args'][0].split('.', 1)[0]
            if name.casefold() not in local_names:
                names.setdefault(name.casefold(), name)
    if not names:
        return []
    import kit
    import settings
    return [_package_command(name, kit, settings) for name in names.values()]


MODES = {'floor', 'wall', 'tile', 'tile-u', 'tile-v', 'cylinder', 'pan', 'scale',
         'rotate', 'flip-u', 'flip-v', 'texture', 'shadows', 'flags'}
# flags [set, clear]: the Surface panel's Look (UnrealEd's surface properties: the engine's EPolyFlags, the Deus Ex
# SDK's UnObj.h; the original maps' cloud banks and some of their water pan by themselves: auto_u_pan, auto_v_pan)
FLAGS = {'invisible': 0x1, 'masked': 0x2, 'translucent': 0x4, 'modulated': 0x40, 'fake_backdrop': 0x80, 'two_sided': 0x100,
         'auto_u_pan': 0x200, 'auto_v_pan': 0x400, 'no_smooth': 0x800, 'special_lit': 0x100000,
         'unlit': 0x400000, 'mirror': 0x8000000}
FLAG_MASK = sum(FLAGS.values())
# the Look bits the host's UC_SURFACE flags does not write yet, by their names in the Surface panel (the `allowed` of
# host/UCEngineBridge.cpp editSurface: it refuses a line with any other bit; tests/test_surface_flags.py checks the two
# agree): the edits keep them, a build leaves them out of the host's line and says so (left_out). None since 1 Nov 2026,
# when the host took Auto U Pan and Auto V Pan too.
NOT_IN_HOST = {}
HOST_FLAGS = FLAG_MASK & ~sum(NOT_IN_HOST)


def commands(edits):
    rows = edits.get('surfaces') or []
    if not isinstance(rows, list) or len(rows) > 4096:
        raise ValueError('Surface edits must be a list (up to 4096 operations).')
    out = []
    for row in rows:
        if not isinstance(row, dict) or row.get('op') not in MODES:
            raise ValueError('Unknown surface operation.')
        mode = row['op']
        targets = row.get('targets')
        if not isinstance(targets, list) or not 1 <= len(targets) <= 8192:
            raise ValueError('Select one or more source faces.')
        args = row.get('args', [])
        if not isinstance(args, list):
            raise ValueError('Invalid surface arguments.')
        if mode in ('pan', 'scale'):
            if len(args) != 2 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in args):
                raise ValueError('U and V must be finite numbers.')
            if mode == 'scale' and any(not .001 <= v <= 1000 for v in args):
                raise ValueError('Scale factors must be between 0.001 and 1000.')
            if mode == 'pan' and any(v != int(v) or abs(v) > 32767 for v in args):
                raise ValueError('Pan uses whole texels, between -32767 and 32767.')
        elif mode == 'shadows':
            if len(args) != 1 or args[0] not in ('ultra-low', 'low', 'normal', 'high'):
                raise ValueError('Shadow detail must be Ultra Low, Low, Normal or High.')
        elif mode == 'flags':
            if (len(args) != 2 or any(isinstance(v, bool) or not isinstance(v, int) or v < 0 for v in args)
                    or (args[0] | args[1]) & ~FLAG_MASK or args[0] & args[1]):
                raise ValueError('Surface flags: set and clear are bits of the Look list, never the same one.')
            args = [v & HOST_FLAGS for v in args]       # what the host writes (the rest: left_out)
        elif mode == 'texture':
            if len(args) != 1 or not isinstance(args[0], str) or not re.fullmatch(r'[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*', args[0]) or len(args[0]) > 240:
                raise ValueError('Choose a loaded texture by its package and name.')
        elif args:
            raise ValueError('This surface operation takes no arguments.')
        for target in targets:
            if not isinstance(target, dict):
                raise ValueError('Invalid source face target.')
            brush, poly = target.get('brush'), target.get('poly')
            if not isinstance(brush, str) or not re.fullmatch(r'[A-Za-z0-9_]{1,127}', brush):
                raise ValueError('Invalid source brush name.')
            if poly != '*' and (type(poly) is not int or not 0 <= poly <= 65535):
                raise ValueError('Invalid source face index.')
            if mode == 'cylinder' and poly != '*':
                raise ValueError('Cylinder alignment applies to all the brush side faces.')
            if mode == 'flags' and not any(args):
                continue                                # only bits the host does not write: no line (left_out)
            out.append('UC_SURFACE %s %s %s%s' % (brush, poly, mode, ''.join(' ' + str(a) for a in args)))
    return out


def _faces(targets, most=3):
    """A row's faces as a build report names them: 'Brush3 face 1, Brush5 all faces and 2 more'."""
    named = ['%s %s' % (t['brush'], 'all faces' if t['poly'] == '*' else 'face %d' % t['poly']) for t in targets[:most]]
    return ', '.join(named) + (' and %d more' % (len(targets) - most) if len(targets) > most else '')


def left_out(edits):
    """The build report's lines for the Look bits of the edits that the host does not write yet (NOT_IN_HOST): a line
    for each such bit a row turns on or off, with the row's faces."""
    lines = []
    for row in edits.get('surfaces') or []:
        if row['op'] != 'flags':
            continue
        for bit, label in NOT_IN_HOST.items():
            for value, word in zip(row['args'], ('on', 'off')):
                if value & bit:
                    lines.append('  EDIT skipped %s (%s) for %s: the host that builds the map cannot write it yet'
                                 % (label, word, _faces(row['targets'])))
    return lines


def needs_lighting(edits):
    return any(r['op'] != 'texture' for r in edits.get('surfaces') or [])


def report(text):
    stats = [tuple(map(int, m)) for m in re.findall(r'UCMapKit\|lightstats\|(\d+)\|(\d+)\|(\d+)', text)]
    if len(stats) < 2:
        return []
    before, after = stats[0], stats[-1]
    delta = after[2] - before[2]
    return ['Surface lighting rebuilt: %s -> %s lightmap samples (%+d); shadow storage %.2f -> %.2f KiB (%+d bytes).'
            % (format(before[1], ','), format(after[1], ','), after[1] - before[1],
               before[2] / 1024, after[2] / 1024, delta)]
