"""Release guard: original content references are strings; installed-game exports never ship."""
import re
import sys
from pathlib import Path

FORBIDDEN = re.compile(r'ConAudio|Conversations', re.I)
CACHE_DIRS = {'_gamecontent', '_gamecons', '_gamevoices'}
SOURCE_PACKAGES = re.compile(r'^(?:F?DeusExText|F?RevisionText|RevisionMission)\.u$', re.I)
GAME_MAP_EXTENSIONS = {'.dx', '.unr', '.utx'}
DERIVED_CATALOGS = {'objects.json', 'library.json', 'sizes.json', 'texusage.json'}
USER_ASSET_DIRS = {'prefabs', 'anims', 'models', 'textures', 'sounds', 'dubs', 'characters',
                   'maps', 'story', 'runs', 'out', 'workspace', 'devinstall'}


def derived_payload(relative):
    """Runtime mapkit data must never enter either recursive installer payload.

    Only mapkit's direct data folders are rejected: our project-template and
    runtime artwork, and dependency folders named cache, remain legitimate.
    """
    if relative.suffix.lower() in GAME_MAP_EXTENSIONS:
        return True
    parts = tuple(part.casefold() for part in relative.parts)
    if parts and parts[0] in {'devinstall', 'projects', 'workspace'}:
        return True
    if CACHE_DIRS.intersection(parts):
        return True
    for i, part in enumerate(parts):
        if part != 'mapkit':
            continue
        local = parts[i + 1:]
        if not local:
            continue
        if local[0] in USER_ASSET_DIRS or local[:2] == ('editor', 'cache'):
            return True
        if local[0] == 'catalog' and local[-1] in DERIVED_CATALOGS:
            return True
    return False


def check_tree(root):
    root = Path(root)
    problems = []
    for path in root.rglob('*'):
        if not path.is_file():
            continue
        if derived_payload(path.relative_to(root)) or SOURCE_PACKAGES.fullmatch(path.name):
            problems.append(str(path))
            continue
        if path.suffix.lower() in ('.wav', '.ogg', '.mp3', '.u', '.uax') and FORBIDDEN.search(path.name):
            problems.append(str(path))
            continue
        if path.suffix.lower() == '.uc':
            for line in path.read_text(encoding='latin1').splitlines():
                if re.match(r'\s*#exec\s+AUDIO\s+IMPORT\b', line, re.I) and FORBIDDEN.search(line):
                    problems.append(str(path) + ': ' + line.strip())
        if path.suffix.lower() in ('.u', '.uax'):
            sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
            import ue1pkg
            package = ue1pkg.Pkg(str(path))
            for export in package.exports:
                if package.classname(export) == 'Sound' and FORBIDDEN.search(export['name']):
                    problems.append(str(path) + ': Sound ' + export['name'])
    if problems:
        raise ValueError('Original game content and exported caches cannot be distributed:\n' + '\n'.join(problems))


if __name__ == '__main__':
    for folder in sys.argv[1:]:
        check_tree(folder)
