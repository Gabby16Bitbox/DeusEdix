"""Play's preparation (server.prepare_play) without the steps that would only make again what is there already: the
compile of the project's package, the build of the map played and the install of the packages into the game, each left
out when nothing it is made from has changed since it last succeeded, nor what it made (startup2, 30 Oct 2026: preparing
an unchanged 01_Feature_Lab took 3.5-3.8 s, 2.8-3.0 s of them its build and 0.5 s the install, mostly its tasklist; a
development working copy compiled its package at every Play, about 10 s).

Each step has a record (RECORD, in the kit's out folder: the project's own) of its last success: `fed`, a hash of what
it is made from, read just before it ran (the project and the game it is for, the kit's code, the files it reads), and
`made`, a hash of what it made, read just after. It is left out only when both hashes are the same now. It runs when
either differs, when it has no record (never run, or failed or cut short last time: its record goes before it runs) and
when a hash cannot be made (any doubt). What a step is made from is everything its action reads and nothing that changes
by itself (a map's build: _map_fed). The files a person changes through the editor (a map's script or .dx, its edits,
the package's sources, the project's player character, the list of other mods' packages) and the engine's ini files are
hashed by their content, so the same text written again changes nothing; the others (folders of the kit's data, its
code, the packages, the engine's programs) by their size and time, which every write changes. The caches made from the
game itself (its original maps, objects, textures: settings.GAME_CACHE) stand by the game's record in the workspace
(workspace.STAMP) and the kit's code that makes them. A map's record is that map's alone; a Rebuild, in any mode,
leaves it too, with its mode, which the builds of the map keep until a Rebuild in Automatic; a cancelled Rebuild leaves
it as it was (rebuilt).
"""
import fnmatch
import hashlib
import json
import os
from pathlib import Path

import atomicfile
import data
import kit
import player_profiles
import preview_bundle
import rebuild as rebuild_options
import settings
import workspace

VERSION = 2                                        # of the hashes: another one makes every step run once
RECORD = data.OUT / '.play-prepare.json'
KIT = data.KIT
# the kit's folders a map's build reads besides the map itself: the map scripts and their edits, prefabs, imported
# textures, characters, models, animations, sounds and voices, catalogs, the original maps' references, stories, the
# tutorial's, the editor's settings
DATA = ('maps', 'prefabs', 'textures', 'characters', 'models', 'anims', 'sounds', 'dubs', 'catalog', 'refs', 'story',
        'tutorial', 'editor/config')
# files of DATA made from the game (fnmatch patterns): the Pieces' catalog, which a Pieces scan publishes again after
# each original map it reads (pieces_library, gamelib.build; a script's Pieces paste reads it once, gamelib.prefab,
# then the object's prefab, in prefabs/), and what a build or the page writes only when it needs it and finds none: the
# classes' sizes (sizes.query: a drop() or snap() of a class with no size yet) and each texture package's index
# (texcat.ensure_index, texpicker). Those only gain what the game says of what a changed script or edit asks for
# (re-test 4 of 31 Oct 2026, #1: the build that wrote one, and every other map, were built again at their next Play).
# They stand by the game's record (workspace.STAMP) and the kit's code that makes them.
BY_THE_GAME = ('catalog/objects.json', 'catalog/sizes.json', 'catalog/*.txt')
# files of DATA no map's build reads (fnmatch patterns): the other maps' edits and their archives (a map's own edits
# are among its own files); every map script counts, as a script may import a helper from maps\ (re-test 4 of 31 Oct
# 2026, #2: saving another map built this one again at its next Play)
OTHER_MAPS = ('maps/*.edits.json', 'maps/*.edits.*.json')
# the workspace's System as a build reads it: kit.new_run links the files of the kinds kit.LINKED names (its programs,
# libraries, packages and their texts: by size and time) into the build's run and copies its ini files there
# (ENGINE_INI, by content), kit._ini reads its DeusEx.ini. Nothing else there counts: Steam rewrites
# steam_autocloud.vdf, linked from the game, at every launch of Revision (the map was built again at every Play: game
# test of 30 Oct 2026)
ENGINE_INI = '*.ini'
# what the preparation says of a step it left out
SKIPPED = {'compile': 'Package unchanged since it was last compiled: not compiled again.',
           'map': 'Map unchanged since the last Play: not rebuilt.',
           'install': 'Packages unchanged since the last Play: not installed again.'}
# what the preparation says of a map built in the mode of its last Rebuild (rebuilt): that mode and Automatic, as the
# Rebuild menu names them (rebuild.NAMES)
FORCED = 'Rebuilding the map in %s, the mode of its last Rebuild (a Rebuild in %s goes back to the usual build).'


def _hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode('utf-8')).hexdigest()


def _content(path):
    """A file's content as a hash (read in pieces: preview_bundle.digest); '' when there is no such file."""
    path = Path(path)
    return preview_bundle.digest(path) if path.is_file() else ''


def _stats(folder, pattern='**/*'):
    """[name, size, time] of the files of `folder` that match `pattern` (with '**/': in its subfolders too), in order;
    [] without the folder."""
    folder = Path(folder)
    rows = []
    for path in folder.glob(pattern):
        if path.is_file():
            stat = path.stat()
            rows.append([path.relative_to(folder).as_posix(), stat.st_size, stat.st_mtime_ns])
    return sorted(rows)


def _identity():
    """The project and the game a step is for: another project, game or game folder makes every step run."""
    return [VERSION, settings.PROJECT_ID, settings.TARGET, str(settings.GAME), str(settings.PROJECT), settings.PACKAGE,
            str(settings.MAPS_DIR), str(settings.GAME_SYSTEM)]


def _code():
    """The kit's code: its Python, the host with its engine bridge, DeusEdixNav, and the project's tools\\*.py (the
    package reader, ue1pkg.py, which the editor imports)."""
    return [_stats(KIT, '*.py'), _stats(KIT / 'editor', '*.py'), _stats(KIT / 'bin'),
            _stats(settings.PROJECT / 'tools', '*.py')]


def _engine(leave_out=()):
    """The workspace's engine as a build reads it (the files kit.new_run links, kit.LINKED, by size and time, its ini
    files by content: a development working copy's build.ps1 writes DeusEx.ini and Default.ini again at every compile,
    the same text) and its record of the game. leave_out: names of packages not counted."""
    skip = {name.lower() + '.u' for name in leave_out}
    linked = [[row for row in _stats(workspace.SYS, '*' + suffix) if row[0].lower() not in skip] for suffix in kit.LINKED]
    return [linked, _contents(workspace.SYS, ENGINE_INI), _content(workspace.STAMP)]


def _other_mods():
    """Other mods' packages kept with the project (Packages panel, Import a mod: kit.extra_packages): their list by
    content and the folder of each by size and time. A map's build reads them (kit.new_run links them into its run,
    kit._ini loads their classes), the install copies them into the game."""
    folders = [_stats(Path(p['path']).parent, '*') for p in kit.extra_packages() if p.get('path')]
    return [_content(kit.PACKAGES_FILE), folders]


def _loaded():
    """What a map's build loads through its run's Paths, as the build preview lists it (preview_bundle.dependencies:
    the packages of every Paths folder, the workspace's and dist's, other mods' with a path; the only count of another
    mod's package the game finds, which the Packages panel keeps without a path), but DeusEdixNav in the game's System:
    the install writes it there after the build (workspace.GAME_FILES), and the run has its own copy (kit.new_run)."""
    loaded = preview_bundle.dependencies()
    installed = {os.path.normcase(str((Path(settings.GAME_SYSTEM) / name).absolute())) for name in workspace.GAME_FILES}
    loaded['files'] = {path: row for path, row in loaded['files'].items() if os.path.normcase(path) not in installed}
    return loaded


def _contents(folder, pattern='**/*'):
    """[name, content hash] of the files of `folder` that match `pattern` (with '**/': in its subfolders too), in
    order."""
    folder = Path(folder)
    return sorted([path.relative_to(folder).as_posix(), _content(path)] for path in folder.glob(pattern)
                  if path.is_file())


def _compile_fed():
    """What a development working copy's compile (its build.ps1) is made from: its package's sources and the compiler
    (the host, its engine bridge, DeusEdixNav) by content (the Story's classes are written again before every Play), the
    sources of its other packages (its voices; not the editor's own, kit.editor_packages: Tools > Scripts' classes,
    which the editor compiles itself), its build scripts and tools, the engine but the packages the compile does not
    take from it (the editor's own: its scripts are written into the workspace's System too; the package and its
    voices, which it makes: the editor copies the package there from dist). Not workspace.runtime_fingerprint: it reads
    DeusEdix's own record of its workspace, which a working copy has not."""
    sources = settings.PROJECT / 'src'
    skip = {name.lower() for name in (settings.PACKAGE,) + kit.editor_packages()}
    others = [[p.name, _stats(p)] for p in sorted(sources.glob('*')) if p.is_dir() and p.name.lower() not in skip]
    compiler = [_content(f) for f in kit.host_files() + kit.native_files()]
    return [_identity(), _contents(sources / settings.PACKAGE), compiler, others, _stats(settings.PROJECT, '*.ps1'),
            _stats(settings.PROJECT / 'tools', '*.py'),
            _engine(kit.editor_packages() + (settings.PACKAGE, settings.VOICES_PACKAGE))]


def _compile_made():
    """What the compile makes (build.ps1: the project's package and its voices, in dist); not the other packages there
    (the editor's own, kit.editor_packages, and the Studio's animations), which the editor writes by itself."""
    return [_stats(workspace.DIST, name + '.u') for name in (settings.PACKAGE, settings.VOICES_PACKAGE)]


def _dxinfo(map_name):
    """What the editor found in a .dx map (its structures...), without the record of its last build."""
    path = data.OUT / (map_name + '.dxinfo.json')
    if not path.is_file():
        return None
    info = json.loads(path.read_text(encoding='utf-8'))
    info.pop('built', None)
    return info


def _kit_data(own):
    """DATA's folders by size and time, but the map's `own` files (resolved: by their content), BY_THE_GAME and
    OTHER_MAPS."""
    rows = []
    for name in DATA:
        folder = (KIT / name).resolve()
        mine = {f.relative_to(folder).as_posix() for f in own if f.is_relative_to(folder)}
        rows.append([name, [row for row in _stats(folder) if row[0] not in mine and not any(
            fnmatch.fnmatch('%s/%s' % (name, row[0]), pattern) for pattern in BY_THE_GAME + OTHER_MAPS)]])
    return rows


def _map_fed(script, map_name, files):
    """What a map's build reads (server.build: its script run by build_cached.py, or dxmaps.build; the host in a run
    made by kit.new_run), each part with how it is compared. Checked against a traced real build of 01_Feature_Lab
    (fix-back2, 30 Oct 2026: every file its two Python processes opened and its run's System). Not in it, as no build
    reads them or they stand by what is: the map's cache in the editor (editor\\cache\\<map>: the page dumps it again
    from the build's output, so it changed after every build; a .dx map's build reads its source's objects instead,
    dxmaps.source_scene, and textures.wearers its meshes.json, a dump of the map shown, which the map's own files and its
    last build decide), the editor's other caches (the page's), the game's caches (by workspace.STAMP), BY_THE_GAME,
    OTHER_MAPS, the project's maps folder (a script map's build reads none of it, a .dx map's only its own source and,
    when it is edited from its private copy, the copy installed there: both among its own files, server.play_files),
    anything else in the workspace's System (_engine)."""
    return dict(
        identity=_identity(),                        # values: the project and the game it is for
        map=[script, map_name],                      # values
        code=_code(),                                # by size and time
        own=[_content(f) for f in files],            # by content: the map's own files (server.play_files)
        dxinfo=_dxinfo(map_name),                    # a value: what the editor found in a .dx map, not its last build
        kit_data=_kit_data([Path(f).resolve() for f in files]),     # by size and time
        player=_content(player_profiles.FILE),       # by content: the project's player character (blocks: UCPlayerMap0)
        mods=[_other_mods(), _loaded()],             # the list by content, the packages by size and time
        defaults=_stats(data.CACHE / '_palette', '*'),          # by size and time: the classes' defaults (props.py)
        packages=_stats(workspace.DIST, '*'),        # by size and time: the project's packages (linked into the run)
        engine=_engine())


def _map_made(map_name):
    """The map's build, which Play stages: a missing one is never left out."""
    path = data.OUT / (map_name + '.dx')
    if not path.is_file():
        raise FileNotFoundError(path)
    return _content(path)


def _map_step(script, map_name, files):
    """The map step's record key, what it is made from (fed) and what it made (made)."""
    return 'map ' + script, lambda: _map_fed(script, map_name, files), lambda: _map_made(map_name)


def _install_fed():
    """What the install of the packages copies: the project's packages, the voices' fallback (release), other mods'
    packages kept with the project (_other_mods), DeusEdixNav (with the kit's code)."""
    return [_identity(), _code(), _stats(workspace.DIST, '*'), _stats(settings.PROJECT / 'release', '*'),
            _other_mods()]


def _install_made():
    """The packages in the game: the project's maps folder there (its maps, which Play stages and puts back, left
    out) and DeusEdixNav in the game's System."""
    packages = [row for row in _stats(settings.MAPS_DIR, '*') if not row[0].lower().endswith('.dx')]
    return [packages, [_stats(settings.GAME_SYSTEM, name) for name in workspace.GAME_FILES]]


def _load():
    try:
        records = json.loads(RECORD.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}
    return records if isinstance(records, dict) else {}


def _save(records):
    RECORD.parent.mkdir(parents=True, exist_ok=True)
    atomicfile.write_text(RECORD, json.dumps(records, indent=1, sort_keys=True))


def _read(fed):
    """The hash of what a step is made from now (fed()), or None when it cannot be made."""
    try:
        return _hash(fed())
    except (OSError, ValueError, TypeError, KeyError):            # a file that cannot be read: done, not recorded
        return None


def _run(key, before, made, action, mode=None):
    """A step run (action() -> (ok, lines)): its record (RECORD[key]) dropped first and written again only after a
    success, `fed` as read before it ran (`before`: a change made while it ran is seen next time), `made` after, into
    the records as they are then (a step run inside it, the compile in a map's build, keeps its own). mode: a map's
    rebuild mode (rebuilt), kept in its record outside the hashes, while it runs and after a failure too."""
    records = _load()
    forced = {} if mode in (None, 'auto') else dict(mode=mode)
    if records.pop(key, None) is not None or forced:
        if forced:
            records[key] = forced
        try:
            _save(records)
        except OSError:            # it stays: a success's, it stands only for these same inputs and that same output
            pass
    ok, lines = action()
    if ok and before is not None:
        try:
            records = _load()
            records[key] = dict(forced, fed=before, made=_hash(made()))
            _save(records)
        except (OSError, ValueError, TypeError, KeyError):        # not recorded: done again next time
            pass
    return ok, lines


def _put_back(key, record):
    """RECORD[key] as it was (record; None: there was none), the other records as they are now."""
    records = _load()
    if record is None:
        records.pop(key, None)
    else:
        records[key] = record
    try:
        _save(records)
    except OSError:            # kept as the cancelled Rebuild left it: it never stands for other output
        pass


def step(key, skipped, fed, made, action, mode=None):
    """One step of the preparation: (ok, lines). Left out, saying `skipped`, when its record (RECORD[key]) holds the
    hashes of what it is made from (fed()) and of what it made (made()) as they are now (a map's keeps its mode too);
    else run (_run, with `mode`)."""
    before = _read(fed)
    try:
        record = _load().get(key)
        if (before is not None and isinstance(record, dict) and record.get('fed') == before
                and record.get('made') == _hash(made())):
            return True, [skipped]
    except (OSError, ValueError, TypeError, KeyError):            # what it made is missing or unreadable: made again
        pass
    return _run(key, before, made, action, mode)


def rebuilt(script, map_name, files, build, mode='auto', cancelled=lambda: False):
    """The page's Rebuild of a map in any mode (server.rebuild: a forced mode only adds stages to what the edits need,
    rebuild.plan): always built (build() -> (ok, lines)), and recorded as the preparation's map step records its build,
    so the next Play does not build the map again (before, the first Play after a Rebuild built it once more: fix-back2,
    30 Oct 2026; after a Lighting Rebuild it built it in Automatic, without its lighting: game re-test of 30 Oct 2026).
    Its mode (rebuild.MODES) is kept with the record: a Play that builds the map again builds it in that mode, as do the
    next ones, until a Rebuild in Automatic (re-test 3 of 31 Oct 2026, #1: once anything the map is made from changed,
    Play built it in Automatic and a Lighting Rebuild's lighting was gone). A cancelled Rebuild (build raised
    kit.Stopped, or cancelled(), asked as it ends, says so: build_job.put_back brings back the map's earlier output)
    leaves the record as it was before it, which that output matches; one that ran and failed keeps its mode
    (cross-check of 31 Oct 2026: a cancelled Lighting Rebuild left its mode, and the next Plays built the unchanged
    map in Lighting)."""
    key, fed, made = _map_step(script, map_name, files)
    record, stopped = _load().get(key), False
    try:
        return _run(key, _read(fed), made, build, mode)
    except kit.Stopped:
        stopped = True
        raise
    finally:
        if cancelled() or stopped:
            _put_back(key, record)


def compile_step(action):
    """The compile of the project's package (action: build.ps1 -Isolated, or DeusEdix's own workspace.build): DeusEdix's
    workspace knows when it is needed (workspace.needs_build: its sources and tools by content, against the package it
    made); a development working copy's build.ps1 keeps no such record, and ran at every Play: its record here."""
    if settings.STANDALONE:
        return action() if workspace.needs_build() else (True, [SKIPPED['compile']])
    return step('compile', SKIPPED['compile'], _compile_fed, _compile_made, action)


def recompiled(action):
    """Story > Apply's compile of the package (action: build.ps1 -Isolated): always run, and in a development working
    copy recorded as compile_step records it, so the next Play does not compile the same sources again (re-test 3 of 31
    Oct 2026, #2; rebuilt does the same for a map's Rebuild). DeusEdix's workspace.build keeps its own record."""
    if settings.STANDALONE:
        return action()
    return _run('compile', _read(_compile_fed), _compile_made, action)


def _mode(key):
    """The rebuild mode a map's record keeps (rebuilt), 'auto' without one."""
    record = _load().get(key)
    mode = record.get('mode') if isinstance(record, dict) else None
    return mode if mode in rebuild_options.MODES else 'auto'


def _built_in(mode, build):
    """The map's build in `mode` (build(mode) -> (ok, lines)), its lines led by FORCED for a forced mode."""
    ok, lines = build(mode)
    names = rebuild_options.NAMES
    return ok, ([FORCED % (names[mode], names['auto'])] if mode != 'auto' else []) + lines


def prepare(script, map_name, files, compile_package, build, install):
    """server.prepare_play's steps after the Story's classes are written, in order: the package's compile
    (compile_package), the build of the map played (build(mode); `files`: the map's own, as the editor keeps them: its
    script or .dx, its edits; mode: its record's, 'auto' or its last Rebuild's: _mode), the install of the packages
    (install), each action() -> (ok, lines). -> (ok, the lines of the steps run and of those left out); the first that
    fails ends it."""
    lines = []
    key, fed, made = _map_step(script, map_name, files)
    mode = _mode(key)
    for run in (lambda: compile_step(compile_package),
                lambda: step(key, SKIPPED['map'], fed, made, lambda: _built_in(mode, build), mode),
                lambda: step('install', SKIPPED['install'], _install_fed, _install_made, install)):
        ok, out = run()
        lines += out
        if not ok:
            return False, lines
    return True, lines
