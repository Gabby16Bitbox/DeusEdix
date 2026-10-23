"""Where the game is, and the names the editor gives to its own things in it.

The editor runs in two ways:
 - inside the UNATCO Continues working copy (no deusedix.json): the mod's package (UnatcoContinues),
   the maps folder the mod adds to Revision (UnatcoMaps), the game where Steam put it;
 - as DeusEdix, installed: deusedix.json at the top of the install folder (the installer writes it)
   says so, with the game folder found or picked there. The package is then DeusEdix, compiled on
   the user's PC, and the maps go to Revision\\DeusEdixMaps.

The game folder is the one holding Deus Ex's System and Revision (Steam: steamapps\\common\\Deus Ex).

Two games can be the target, one per project (TARGET, fixed when the project is made): Deus Ex: Revision
('revision', in the game folder's Revision\\ with its own System, Maps, ini files) and the original Deus Ex,
Game of the Year Edition 1112fm ('vanilla', the game folder itself). Everything that depends on the game
comes from TARGETS below: GAME_ROOT is the targeted game's own folder (REVISION, its older name, is the
same folder, so for the original game it is the Deus Ex folder itself). The UNATCO Continues working copy
is always Revision.
"""
import json
import os
import re
import hashlib
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
CONFIG = PROJECT / 'deusedix.json'
APP_ROOT = Path(os.environ.get('DEUSEDIX_APP_ROOT') or PROJECT).resolve()
PROJECT_FILE = PROJECT / 'deusedix-project.json'
STEAM_DEFAULT = Path(r'C:\Program Files (x86)\Steam')
APPS = {'6910': 'Deus Ex: Game of the Year Edition', '397550': 'Deus Ex: Revision'}
# the games a project can be made for: where each one lives in the Deus Ex folder (root), its program, its
# ini files and their sections with the folders the game reads (Paths), its Steam app
TARGETS = {
    'revision': dict(name='Deus Ex: Revision', short='Revision', root='Revision', exe='Revision.exe',
                     ini='Revision.ini', user_ini='RevisionUser.ini', app='397550',
                     sections=('Core.System', 'RevisionInternal.LaunchSystem')),
    'vanilla': dict(name='Deus Ex (original game)', short='Deus Ex', root='', exe='DeusEx.exe', ini='DeusEx.ini',
                    user_ini='User.ini', app='6910', sections=('Core.System',)),
}
DEFAULT_TARGET = 'revision'


def _config():
    try:
        return json.loads(CONFIG.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def _project():
    if not PROJECT_FILE.exists():
        return None
    try:
        value = json.loads(PROJECT_FILE.read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        raise ValueError('Cannot read this project manifest: %s' % PROJECT_FILE) from exc
    ident = value.get('id', '') if isinstance(value, dict) else ''
    if (not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,47}', ident)
            or value.get('version') != 1 or value.get('kind') not in ('custom', 'original', 'tutorial')
            or not isinstance(value.get('name'), str) or not value['name'].strip()):
        raise ValueError('Invalid DeusEdix project manifest: %s' % PROJECT_FILE)
    package = 'DXP_' + ident.replace('-', '_')
    if value.get('package') != package:
        raise ValueError('The project package does not match its immutable ID.')
    if value.get('target', DEFAULT_TARGET) not in TARGETS:
        raise ValueError('Unknown game in the project manifest: %s' % PROJECT_FILE)
    # "target" only for the original game: absent means Revision (as in projects.py)
    return {key: value[key] for key in ('id', 'name', 'kind', 'package', 'target') if key in value} | {'path': str(PROJECT), 'legacy': False}


def steam_libraries():
    """The Steam library folders of this PC: the Steam folder from the registry, then the ones in
    steamapps\\libraryfolders.vdf."""
    roots = []
    try:
        import winreg
        for hive, key, value in ((winreg.HKEY_CURRENT_USER, r'Software\Valve\Steam', 'SteamPath'),
                                 (winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\WOW6432Node\Valve\Steam', 'InstallPath'),
                                 (winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\Valve\Steam', 'InstallPath')):
            try:
                with winreg.OpenKey(hive, key) as k:
                    roots.append(Path(winreg.QueryValueEx(k, value)[0]))
            except OSError:
                pass
    except ImportError:
        pass
    roots.append(STEAM_DEFAULT)
    out = []
    for root in roots:
        for lib in [root] + _vdf_paths(root / 'steamapps' / 'libraryfolders.vdf'):
            lib = Path(str(lib).replace('/', '\\'))
            if lib.is_dir() and all(lib.resolve() != o.resolve() for o in out):
                out.append(lib)
    return out


def _vdf_paths(vdf):
    try:
        text = vdf.read_text(encoding='utf-8', errors='replace')
    except OSError:
        return []
    return [Path(m.replace('\\\\', '\\')) for m in re.findall(r'"path"\s+"([^"]+)"', text)]


def check_game(folder, target=DEFAULT_TARGET):
    """What is missing for the editor in a game folder to make maps for `target`: [] when it is good.
    Both need the original game (its Editor.dll is the editor's engine, Revision reads some of its files)."""
    folder = Path(folder)
    missing = []
    if not (folder / 'System' / 'Editor.dll').is_file():
        missing.append('Deus Ex (System\\Editor.dll)')
    if target == 'vanilla':
        if not (folder / 'System' / 'DeusEx.exe').is_file():
            missing.append('Deus Ex (System\\DeusEx.exe)')
    elif not (folder / 'Revision' / 'System' / 'Revision.exe').is_file():
        missing.append('Deus Ex: Revision (Revision\\System\\Revision.exe)')
    return missing


def games_in(folder):
    """The targets a game folder can be used for, Revision first: [] when it is not a Deus Ex folder."""
    return [t for t in TARGETS if folder and not check_game(folder, t)]


# the original game from GOG (GOG Galaxy or its offline installer): no Steam, its DeusEx.exe starts by itself
GOG_FOLDERS = (r'C:\GOG Games\Deus Ex GOTY', r'C:\GOG Games\Deus Ex',
               r'C:\Program Files (x86)\GOG Galaxy\Games\Deus Ex GOTY', r'C:\Program Files (x86)\GOG Galaxy\Games\Deus Ex',
               r'C:\Program Files (x86)\GOG.com\Deus Ex GOTY', r'C:\Program Files (x86)\GOG.com\Deus Ex')


def gog_games():
    """Deus Ex folders installed by GOG: the ones in GOG's registry (named Deus Ex), then the usual folders."""
    out = []
    try:
        import winreg
        for root in (r'SOFTWARE\WOW6432Node\GOG.com\Games', r'SOFTWARE\GOG.com\Games'):
            try:
                games = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, root)
            except OSError:
                continue
            with games:
                for i in range(winreg.QueryInfoKey(games)[0]):
                    try:
                        with winreg.OpenKey(games, winreg.EnumKey(games, i)) as game:
                            name = str(winreg.QueryValueEx(game, 'gameName')[0])
                            path = Path(winreg.QueryValueEx(game, 'path')[0])
                    except OSError:
                        continue
                    if 'deus ex' in name.lower():
                        out.append(path)
    except ImportError:
        pass
    out += [Path(p) for p in GOG_FOLDERS]
    return [p for i, p in enumerate(out) if p.is_dir() and all(str(p).lower() != str(o).lower() for o in out[:i])]


def find_game(target=DEFAULT_TARGET):
    """The Deus Ex folder good for `target` (with Revision in it, for Revision), from Steam's manifests
    (apps 6910 and 397550 both install into steamapps\\common\\Deus Ex), then GOG's (the original game), or None."""
    for lib in steam_libraries():
        for app in APPS:
            manifest = lib / 'steamapps' / ('appmanifest_%s.acf' % app)
            try:
                m = re.search(r'"installdir"\s+"([^"]+)"', manifest.read_text(encoding='utf-8', errors='replace'))
            except OSError:
                continue
            folder = lib / 'steamapps' / 'common' / m.group(1) if m else None
            if folder and not check_game(folder, target):
                return folder
    for folder in gog_games():
        if not check_game(folder, target):
            return folder
    return None


def from_steam(folder):
    """True when Steam installed this game folder (one of its libraries holds it): Steam's DeusEx.exe has
    Steam's launch check, so it starts through Steam; a GOG (or any other) copy starts by itself."""
    try:
        folder = Path(folder).resolve()
        return any(folder.is_relative_to((lib / 'steamapps' / 'common').resolve()) for lib in steam_libraries())
    except OSError:
        return False


def game_command(args, target=None, folder=None):
    """How to start the game with these arguments: (argv, working folder). Through Steam for a Steam copy
    (it adds the player's own launch options), the game's own program for GOG and other copies."""
    target = target or TARGET
    profile = TARGETS[target]
    folder = Path(folder or GAME)
    if from_steam(folder):
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Valve\Steam') as key:
            steam = str(Path(winreg.QueryValueEx(key, 'SteamExe')[0]).resolve())
        return [steam, '-applaunch', profile['app']] + list(args), None
    system = (folder / profile['root'] if profile['root'] else folder) / 'System'
    return [str(system / profile['exe'])] + list(args), str(system)


def workspace_id(path):
    """Stable UI/session identity, without renaming an existing mod's packages."""
    key = os.path.normcase(str(Path(path).resolve()))
    return 'workspace-' + hashlib.sha256(key.encode('utf-8')).hexdigest()[:32]


CFG = _config()
PROJECT_META = _project()
MANAGED_PROJECT = PROJECT_META is not None
EXTERNAL_WORKSPACE = os.environ.get('DEUSEDIX_WORKSPACE_ID', '')
if EXTERNAL_WORKSPACE and (MANAGED_PROJECT or os.environ.get('DEUSEDIX_PROJECT_WORKER') != '1'
                           or EXTERNAL_WORKSPACE != workspace_id(PROJECT)):
    raise ValueError('This worker was started for a different existing workspace.')
PROJECT_ID = PROJECT_META['id'] if MANAGED_PROJECT else EXTERNAL_WORKSPACE or 'legacy'
if (os.environ.get('DEUSEDIX_PROJECT_WORKER') == '1'
        and os.environ.get('DEUSEDIX_PROJECT_ID', PROJECT_ID) != PROJECT_ID):
    raise ValueError('This worker was started for a different project identity.')
PROJECT_KIND = PROJECT_META['kind'] if MANAGED_PROJECT else 'legacy'
INDEPENDENT_PROJECT = MANAGED_PROJECT and PROJECT_KIND != 'original'
ALLOW_ORIGINAL_MAPS = not MANAGED_PROJECT or PROJECT_KIND == 'original'
STANDALONE = bool(CFG) or MANAGED_PROJECT
# the editor's own package (stories, interactions, cutscenes... are compiled into it)
PACKAGE = CFG.get('package', 'DeusEdix') if STANDALONE else 'UnatcoContinues'
# the folder in Revision that the game reads first: the built maps (and, installed, the package)
MAPS_DIR_NAME = 'DeusEdixMaps' if STANDALONE else 'UnatcoMaps'
if MANAGED_PROJECT:
    PACKAGE = PROJECT_META['package']
    MAPS_DIR_NAME = 'DeusEdixProjects/' + PROJECT_ID
    if CFG.get('package', PACKAGE) != PACKAGE or str(CFG.get('mapsDir', MAPS_DIR_NAME)).replace('\\', '/') != MAPS_DIR_NAME:
        raise ValueError('Project settings point to another package or install folder.')
elif CFG.get('mapsDir'):
    candidate = str(CFG['mapsDir']).replace('\\', '/')
    if not re.fullmatch(r'[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*', candidate):
        raise ValueError('Invalid mapsDir setting.')
    MAPS_DIR_NAME = candidate
# the game the maps are made for: a project's own (its manifest), the installed editor's (deusedix.json),
# Revision for the UNATCO Continues working copy
if MANAGED_PROJECT:
    TARGET = PROJECT_META.get('target', DEFAULT_TARGET)
    if CFG.get('target', TARGET) != TARGET:
        raise ValueError('Project settings point to another game.')
else:
    TARGET = CFG.get('target', DEFAULT_TARGET) if STANDALONE else DEFAULT_TARGET
    if TARGET not in TARGETS:
        raise ValueError('Invalid target setting: %r' % TARGET)
PROFILE = TARGETS[TARGET]
# Caches made from the game itself (its maps for the Pieces, the models of its objects and their pictures, its
# textures, conversations, voices, animations and characters) are the same in every project made for that game:
# a managed project keeps them once per game, in the app's editor cache (17 Oct 2026: about 3.7 GB, and the slow
# first scans and previews, were made again in every project). The working copy and the app's own workspace keep
# theirs where they were. A project's own maps and models stay in its own cache (editor/data.py CACHE).
EDITOR_CACHE = Path(__file__).resolve().parent / 'editor' / 'cache'
GAME_CACHE = (APP_ROOT / 'tools' / 'mapkit' / 'editor' / 'cache' / ('game-' + TARGET)) if MANAGED_PROJECT else EDITOR_CACHE
IS_REVISION = TARGET == 'revision'
GAME_NAME = PROFILE['name']
_default = Path(r'C:\Program Files (x86)\Steam\steamapps\common\Deus Ex')
GAME = Path(CFG['game']) if CFG.get('game') else (_default if not check_game(_default, TARGET)
                                                 else (find_game(TARGET) or _default))
# the targeted game's own folder: Revision\ for Revision, the Deus Ex folder itself for the original game
GAME_ROOT = GAME / PROFILE['root'] if PROFILE['root'] else GAME
REVISION = GAME_ROOT                    # its older name (the editor began with Revision only)
GAME_SYSTEM = GAME_ROOT / 'System'
GAME_EXE = GAME_SYSTEM / PROFILE['exe']
GAME_INI = GAME_SYSTEM / PROFILE['ini']             # its folders (Paths), its save folder, its engine
USER_INI = GAME_SYSTEM / PROFILE['user_ini']        # its config(User) settings (the editor's runner)
INI_SECTIONS = PROFILE['sections']                  # the sections of GAME_INI with a Paths list
STEAM_APP = PROFILE['app']
ORIGINAL_MAPS = GAME_ROOT / 'Maps'                  # the game's own maps (Revision's are rebuilt copies)
REVISION_MAPS = ORIGINAL_MAPS
MAPS_DIR = GAME_ROOT / MAPS_DIR_NAME
# where the game finds its packages and textures, in the order it looks (Revision first, then what it
# reads from the original game); the original game never reads Revision's
SYSTEM_DIRS = ([GAME / 'System', GAME_ROOT / 'System', GAME_ROOT / 'HDTP' / 'System'] if IS_REVISION
               else [GAME / 'System'])
TEXTURE_DIRS = ([GAME_ROOT / 'Textures', GAME_ROOT / 'NewVision' / 'Textures', GAME / 'Textures'] if IS_REVISION
                else [GAME / 'Textures'])
# what the game adds to the engine's packages: loaded by every editor session (EditPackages), loaded with
# the maps (OBJ LOAD: the mission scripts of the levels)
GAME_EDIT_PACKAGES = ('Revision',) if IS_REVISION else ()
GAME_LOADS = ('RevisionMission.u',) if IS_REVISION else ()
# the conversations of the original story (gamecons.SETS) and what a new map's DeusExLevelInfo names
CONVERSATIONS = 'RevisionConversations' if IS_REVISION else 'DeusExConversations'
# what only Revision has: music as OGG files (DXOgg), rain and snow zones (Precipitation), the text a
# book or datacube shows set on the object itself (SpecialText), HDTP's models
FEATURES = frozenset(('ogg_music', 'weather', 'special_text', 'hdtp')) if IS_REVISION else frozenset()
# the original game's mission scripts (DeusEx.u: no 07 and no 13, as in the campaign)
_VANILLA_MISSIONS = {0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 14, 15}


def mission_script(mission):
    """The Script of a level of mission `mission` (DeusExLevelInfo), as UC_PROP writes it: 'None' when the
    game has no script for that mission."""
    mission = int(mission)
    if IS_REVISION:
        return "Class'RevisionMission.RevisionMission%02d'" % mission
    return "Class'DeusEx.Mission%02d'" % mission if mission in _VANILLA_MISSIONS else 'None'


def game_running(target=None):
    """Is the game (`target`'s, this process's by default; 'any': either) running on this PC?"""
    import subprocess
    names = [TARGETS[t]['exe'] for t in TARGETS] if target == 'any' else [TARGETS[target or TARGET]['exe']]
    for name in names:
        r = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq ' + name], capture_output=True, text=True,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if name.lower() in (r.stdout or '').lower():
            return True
    return False
# the Animation Studio's and the imported models' packages: other names for DeusEdix, so that a PC with
# both never loads one in place of the other
ANIMS_PACKAGE = 'DeusEdixAnims' if STANDALONE else 'UCAnims'
MODELS_PACKAGE = 'DeusEdixModels' if STANDALONE else 'UCModels'
SOUNDS_PACKAGE = 'DeusEdixSounds' if STANDALONE else 'UCSounds'     # the sounds imported in the editor's browser
SCRIPTS_PACKAGE = 'DeusEdixScripts' if STANDALONE else 'UCScripts'  # the scripts written in the editor (editor/scripts.py)
if MANAGED_PROJECT:
    ANIMS_PACKAGE, MODELS_PACKAGE, SOUNDS_PACKAGE = (PACKAGE + suffix for suffix in ('Anims', 'Models', 'Sounds'))
    SCRIPTS_PACKAGE = PACKAGE + 'Scripts'
    for key, expected in (('animsPackage', ANIMS_PACKAGE), ('modelsPackage', MODELS_PACKAGE), ('soundsPackage', SOUNDS_PACKAGE)):
        if CFG.get(key, expected) != expected:
            raise ValueError('Project resource package setting does not match its ID: ' + key)
# where those packages go in the game: the mod's into Revision\System (install.ps1), DeusEdix's into its
# maps folder (read by the game through Revision.ini's Paths: workspace.install)
PACKAGES_DIR = MAPS_DIR if STANDALONE else REVISION / 'System'


def current():
    """Identity of this process; fixed before any project-dependent backend is imported."""
    if EXTERNAL_WORKSPACE:
        return dict(id=PROJECT_ID, name=PROJECT.name, kind='workspace', path=str(PROJECT),
                    legacy=False, external=True, package=PACKAGE,
                    **({'target': TARGET} if TARGET != DEFAULT_TARGET else {}))
    return dict(PROJECT_META) if PROJECT_META else dict(id='legacy', name='Existing workspace', kind='legacy',
        path=str(PROJECT), legacy=True, package=PACKAGE, **({'target': TARGET} if TARGET != DEFAULT_TARGET else {}))


def python():
    """The command that runs one of the editor's Python scripts: this Python, or (DeusEdix installed, a
    frozen program: sys.executable is the program itself) its console twin, deusedix-cli.exe --run."""
    if getattr(sys, 'frozen', False):
        return [str(Path(sys.executable).with_name('deusedix-cli.exe')), '--run']
    return [sys.executable]


if __name__ == '__main__':
    print('standalone' if STANDALONE else 'UNATCO Continues working copy', '| package', PACKAGE, '| target', TARGET)
    print('game', GAME, check_game(GAME, TARGET) or 'ok', '| games here:', games_in(GAME))
    print('found by Steam:', find_game(TARGET))
    print('libraries:', [str(x) for x in steam_libraries()])
