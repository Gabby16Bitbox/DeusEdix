"""The player's field of view in the game: the editor's 3D view uses it until Settings > Camera changes it, so what
the view frames is what the player sees (View in game, Play from here, a cutscene's first key).

The game keeps it with the player's settings, [Engine.PlayerPawn] DefaultFOV (the game's "fov" command writes it
with DesiredFOV): RevisionUser.ini for Revision, User.ini for the original game (settings.USER_INI). Without the
file or the key, the game's own default (what its DefUser.ini has): 86 degrees in Revision, 75 in the original game.
Degrees across the width of the screen, as the game's.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import settings  # noqa: E402

SECTION = 'Engine.PlayerPawn'
KEYS = ('DefaultFOV', 'DesiredFOV')                  # the first one the file has
GAME_DEFAULT = {'revision': 86.0, 'vanilla': 75.0}
LIMITS = (1.0, 170.0)                                # what the game's fov command accepts


def ini_value(text, section, key):
    """A key's value in one section of an ini file's text, or None. Section and key names are read as the engine
    reads them (any case); a key given twice: the last one."""
    found, inside = None, False
    for line in text.splitlines():
        line = line.strip()
        if line.startswith('['):
            inside = line.lower() == '[%s]' % section.lower()
        elif inside and '=' in line:
            name, value = line.split('=', 1)
            if name.strip().lower() == key.lower():
                found = value.strip()
    return found


def player_fov(user_ini=None, target=None):
    """{'fov': degrees, 'file': the name of the ini file it was read from, None for the game's default}."""
    user_ini = Path(user_ini or settings.USER_INI)
    try:
        text = user_ini.read_bytes().decode('latin1')
    except OSError:
        text = ''
    for key in KEYS:
        try:
            fov = float(ini_value(text, SECTION, key) or 'nan')
        except ValueError:
            continue
        if LIMITS[0] <= fov <= LIMITS[1]:
            return dict(fov=round(fov, 2), file=user_ini.name)
    return dict(fov=GAME_DEFAULT[target or settings.TARGET], file=None)
