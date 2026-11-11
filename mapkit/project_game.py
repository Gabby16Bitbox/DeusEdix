"""Activate one project's map search paths and save folder in its game (Revision.ini, or the original
game's DeusEx.ini: settings.GAME_INI), and write the copies of the game's ini files that a launch starts it on.

The original settings are recorded before the first activation, the player's SavePaths again at each one (a folder
they chose since: _player_save_paths). An Install activates; a Play never does (29 Oct 2026): it starts the game on
launch copies (write_launch_inis), so nothing the game saves while it plays reaches the player's files. A Play of
DeusEdix 0.1.58 or older did activate, with its own save folder, and recorded what the game would write over in its
user ini, the map and chapter played last, with the maps that Play could make the game write there: a close still
gives back what such a Play cut short left, its save folder (_play_save_back) and that record, only while the ini names
one of those maps (_last_played_back). Content stays in separate project directories; changing projects never deletes
another build.
"""
import json
import ntpath
import os
import re
import stat
import time
from pathlib import Path

import settings

# the sections with the game's folders (Paths): Revision.ini has two, the original DeusEx.ini only the first
SECTIONS = {'core.system', 'revisioninternal.launchsystem'}
# what Revision's game writes into its user ini (RevisionUser.ini) when a map starts: the map and the chapter played
# last (Human.uc lastPlayedMap / lastPlayedChapter, globalconfig; MissionScript sets them to the level's MapName, for a
# map of a mission), which its animated main menu picks its scene by. After a Play they would name a project's map, one
# the player's own game does not have (28 Oct 2026); since 29 Oct 2026 the game writes them into a Play's own copy. A
# Play of DeusEdix 0.1.58 or older let the game write them into the player's: its start recorded the player's two values
# (or that they had none) and 'played', the maps that Play could make the game write (its own, a setup's launch map,
# every map of its folder it could travel to). One rule, no guess at the close from the files on disk (fix-a3, 28 Oct
# 2026): a close writes the record back only when lastPlayedMap names one of them then, else drops it unwritten
# (_last_played_back). With no record nothing is written: a project's map started by hand from the game's own menu
# after an Install is left alone (no record; cosmetic, that menu only)
LAST_PLAYED_SECTION = '[deusex.human]'
LAST_PLAYED = ('lastPlayedMap', 'lastPlayedChapter')


# how long a replace of a game's file is tried again while Windows refuses it: another program holding one of the two
# files open for a moment (an antivirus scanning it, the game reading its command file) is a sharing violation
REPLACE_WAIT = 2.0


def replace(tmp, path, wait=REPLACE_WAIT):
    """os.replace(tmp, path), tried again every 0.05 s while Windows refuses it (PermissionError: Kaspersky's hook is in
    the game on this PC, 29 Oct 2026), for `wait` seconds at most, then the error."""
    end = time.monotonic() + wait
    while True:
        try:
            return os.replace(tmp, path)
        except PermissionError:
            if time.monotonic() >= end:
                raise
            time.sleep(0.05)


def write_file(path, data, wait=REPLACE_WAIT):
    """`data` (bytes) as the whole of a game's file: written beside it first, then put in its place at once (replace):
    a full disk never leaves it cut short, and a replace that still fails leaves nothing beside it. A file the player
    made read-only stays so: the replace fails on it (only DeusEdix's own are made writable: _writable)."""
    tmp = path.with_name(path.name + '.deusedix-tmp')
    tmp.write_bytes(data)
    try:
        replace(tmp, path, wait)
    except OSError:
        tmp.unlink(missing_ok=True)
        raise


def remove(path, wait=REPLACE_WAIT):
    """One of DeusEdix's own files in the game gone (a launch's copies of the game's ini files, the runner's and the
    Console's files; never a player's), and the game's own Running.ini that a launch of DeusEdix's left (the session's
    cleanup only): made writable first (_writable), then removed, tried again every 0.05 s while Windows refuses it (a
    scanner reading what the game wrote as it closed), as replace, for `wait` seconds at most, then the error. -> it
    was there"""
    end = time.monotonic() + wait
    while True:
        try:
            _writable(path)
            path.unlink()
            return True
        except FileNotFoundError:
            return False
        except PermissionError:
            if time.monotonic() >= end:
                raise
            time.sleep(0.05)


def _writable(path):
    """One of DeusEdix's own files in the game made writable again when it is read-only: a Play before 29 Oct 2026
    copied the player's user ini with its attributes (shutil.copy2), a read-only one too, and Windows refuses to replace
    or remove a read-only file, so every later Play of that project failed on the copy it left."""
    try:
        mode = path.stat().st_mode
    except FileNotFoundError:
        return
    if not mode & stat.S_IWRITE:
        os.chmod(path, mode | stat.S_IWRITE)


def _write(ini, text):
    """The whole new text first, then the ini replaced at once: a full disk never leaves a game's ini
    cut short (it happened to RevisionUser.ini on 15 Oct 2026, written in place)."""
    write_file(ini, text.encode('latin1'))


def owned_actor(line):
    # the editor's packages: DeusEdix's, a project's, the development mod's (settings.DEV)
    return bool(re.match(r'(?i)^\s*ServerActors\s*=\s*(?:%s|DeusEdix|DXP_[a-z0-9_]+)\.' % re.escape(settings.DEV['package']), line))


def original_actors(text):
    section, saved = '', {}
    for line in text.splitlines():
        if line.strip().startswith('['):
            section = line.strip()[1:-1].lower()
        if owned_actor(line):
            saved.setdefault(section, []).append(line)
    return saved


def owned_path(line):
    if not line.strip().lower().startswith('paths='):
        return False
    path = line.strip()[6:].replace('/', '\\').lower()
    return bool(re.search(r'(?:^|\\)(?:deusedixmaps|%s|deusedixprojects\\[a-z0-9_-]+)\\\*\.(?:dx|u|utx|uax|umx)$'
                          % re.escape(settings.DEV['mapsDir'].lower()), path))


def original_paths(text):
    """Legacy application paths, per section; a previously active project is never a default."""
    section, saved = '', {}
    for line in text.splitlines():
        if line.strip().startswith('['):
            section = line.strip()[1:-1].lower()
        if section in SECTIONS and owned_path(line) and 'deusedixprojects' not in line.lower():
            saved.setdefault(section, []).append(line)
    return saved


def original_save_paths(text):
    section, saved = '', {}
    for line in text.splitlines():
        if line.strip().startswith('['):
            section = line.strip().lower()
        if line.lower().startswith('savepath=') and 'deusedixprojects' not in line.lower():
            saved[section] = line.split('=', 1)[1]
    return saved


def activate_text(text, paths, saved, save_path=None, actors=None):
    """`paths` may be one active project's list or a per-section original-path snapshot."""
    section, out, injected = '', [], set()
    for line in text.splitlines():
        if line.strip().startswith('['):
            section = line.strip()[1:-1].lower()
        if section in SECTIONS and owned_path(line):
            continue
        if owned_actor(line) and (save_path is not None or actors is not None):
            continue
        if line.lower().startswith('savepath='):
            if save_path is not None:
                line = 'SavePath=' + save_path
            elif 'deusedixprojects' in line.lower():
                line = 'SavePath=' + saved.get('[' + section + ']', '..\\Save')
        out.append(line)
        if actors is not None and save_path is None and line.strip().lower() == '[' + section + ']':
            out.extend(actors.get(section, []))
        if section in SECTIONS and section not in injected and line.strip().lower() == '[' + section + ']':
            out.extend(paths.get(section, []) if isinstance(paths, dict) else paths)
            injected.add(section)
    return '\r\n'.join(out) + '\r\n'


def menu_ini(text, root_class, menu_map):
    """`text` (a launch's copy of the game's ini) with a project's own main menu (editor/main_menu.py): the root
    window that opens it ([Engine.Engine] Root=, `root_class`), and the map behind it as the game's own start map
    ([URL] LocalMap=: where the game goes when it has no map to open). Line ends kept; never the player's own ini."""
    def put(text, name, key, value):
        pattern = re.compile(r'(?ims)^(\[%s\][^\r\n]*\r?\n)(.*?)(?=^\[|\Z)' % re.escape(name))
        m = pattern.search(text)
        if not m:
            return text.rstrip('\r\n') + '\r\n[%s]\r\n%s=%s\r\n' % (name, key, value)
        body = m.group(2)
        line = re.compile(r'(?im)^%s\s*=[^\r\n]*' % re.escape(key))
        body = (line.sub(lambda _: '%s=%s' % (key, value), body, count=1) if line.search(body)
                else '%s=%s\r\n' % (key, value) + body)
        return text[:m.start(2)] + body + text[m.end(2):]
    text = put(text, 'Engine.Engine', 'Root', root_class)
    if menu_map:
        text = put(text, 'URL', 'LocalMap', menu_map + '.dx')
    return text


def play_save_path():
    """The SavePath of a Play (settings.SAVE_DIR) as the game's ini names it: from the game's System folder."""
    return '..\\' + settings.SAVE_DIR_NAME.replace('/', '\\')


def play_save_text(text, save_path, saved=None):
    """`text` with the SavePath of each section of the game's folders (SECTIONS) naming `save_path`; with `saved` (the
    player's own, per section, as original_save_paths reads them), the ones naming `save_path` back to those instead.
    A SavePath of another section (a mod's own setting) stays as it is."""
    section, out = '', []
    for line in text.splitlines():
        if line.strip().startswith('['):
            section = line.strip().lower()
        if section[1:-1] in SECTIONS and line.lower().startswith('savepath='):
            if saved is None:
                line = 'SavePath=' + save_path
            elif line.split('=', 1)[1].strip().lower() == save_path.lower():
                line = 'SavePath=' + saved.get(section, '..\\Save')
        out.append(line)
    return '\r\n'.join(out) + '\r\n'


def write_launch_inis(inis, text, user_ini, target=None):
    """A launch's copies of the game's ini files (settings.launch_inis), each one whole and then put in place
    (write_file): the game's ini as `text`, the player's user ini (`user_ini`, of `target`) as it is now
    (_user_copy); a copy an older Play left read-only is made writable first (_writable). -> inis"""
    ini, user = inis
    ini.parent.mkdir(parents=True, exist_ok=True)
    for path in inis:
        _writable(path)
    write_file(ini, text.encode('latin1'))
    write_file(user, _user_copy(user_ini, target))
    return inis


def _user_copy(user_ini, target=None):
    """What a launch's copy of the user ini starts as: the player's (`user_ini`) as it is now. A player who never
    started the game has none, and the engine would make it at the game's start from the game's default user ini beside
    it (settings.TARGETS 'def_user_ini'): the copy is made from that, the player's own still not made; with neither,
    the copy starts empty (the game's own defaults)."""
    try:
        return user_ini.read_bytes()
    except FileNotFoundError:
        pass
    try:
        return user_ini.with_name(settings.TARGETS[target or settings.TARGET]['def_user_ini']).read_bytes()
    except FileNotFoundError:
        return b''


def launch_args(inis, system):
    """The words that start a game on a launch's copies of its ini files: INI= first, then USERINI= (the engine takes
    the first "INI=" it finds, and "USERINI=" holds one), each one's path from the game's System folder (a bare file
    name there), ended by a comma: Steam quotes every word, and the engine stops a value at a comma, where it would
    otherwise read the closing quote as part of the name (then no ini: its First-Time Configuration, 15 Oct 2026)."""
    return ['%s=%s,' % (key, ntpath.relpath(str(path), str(system))) for key, path in zip(('INI', 'USERINI'), inis)]


def _state(ini, text):
    stamp = _snapshot_path(ini)
    existed = stamp.exists()
    if existed:
        state = json.loads(stamp.read_text(encoding='utf-8'))
    else:
        state = {}
    if not isinstance(state, dict):
        raise ValueError('Invalid original game settings snapshot; %s was not changed.' % ini.name)
    # Upgrade earlier snapshots from the first untouched backup. Current ini may
    # already have had its legacy paths/actors suspended by an active project.
    backup = ini.with_name(ini.name + '.bak_projects')
    original = backup.read_text(encoding='latin1') if existed and backup.exists() else text
    changed = False
    for key, read in (('save_paths', original_save_paths), ('server_actors', original_actors), ('original_paths', original_paths)):
        if key not in state:
            state[key] = read(original)
            changed = True
        if not isinstance(state[key], dict):
            raise ValueError('Invalid original game settings snapshot; %s was not changed.' % ini.name)
        for section, value in state[key].items():
            if not isinstance(section, str):
                raise ValueError('Invalid original game settings section.')
            if key == 'save_paths':
                valid = isinstance(value, str) and '\n' not in value and '\r' not in value
            else:
                check = owned_actor if key == 'server_actors' else owned_path
                valid = isinstance(value, list) and all(isinstance(line, str) and '\n' not in line
                    and '\r' not in line and check(line) for line in value)
            if not valid:
                raise ValueError('Invalid original game settings value; %s was not changed.' % ini.name)
    if changed:
        with stamp.open('w' if existed else 'x', encoding='utf-8') as file:
            json.dump(state, file, indent=2)
    return state


def _player_save_paths(ini, text, state):
    """The snapshot's SavePaths brought up to the player's current ones in `text` (a folder they chose after DeusEdix's
    first activation too) and written, whole and then in place at once, before the ini stops naming them: a Play's
    close, the undo of a Play cut short, a project's close and the uninstall put back the folder the player had just
    before. A line naming a folder of DeusEdix's (a Play cut short, a project active) is never recorded
    (original_save_paths): the player's folder recorded before it stays (27 Oct 2026: the snapshot of the first
    activation came back instead)."""
    current = original_save_paths(text)
    if all(state['save_paths'].get(section) == value for section, value in current.items()):
        return
    state['save_paths'].update(current)
    _save_state(ini, state)


def _save_state(ini, state):
    """The activation snapshot written whole, then put in place at once."""
    write_file(_snapshot_path(ini), json.dumps(state, indent=2).encode('utf-8'))


def _snapshot_path(ini):
    """The activation snapshot of a game's ini (its original settings, an older Play's record): the file beside it."""
    return ini.with_name('deusedix-project-activation.json')


def _snapshot(ini):
    """The activation snapshot as written (not checked: _state, _last_played_record do that); None with no file."""
    stamp = _snapshot_path(ini)
    return json.loads(stamp.read_text(encoding='utf-8')) if stamp.is_file() else None


def _user_ini(ini):
    """The user ini beside a game's ini (Revision.ini: RevisionUser.ini), by its game (settings.TARGETS), else the
    targeted game's for its own ini; None when not known."""
    for profile in (getattr(settings, 'TARGETS', None) or {}).values():
        if str(profile.get('ini', '')).lower() == ini.name.lower() and profile.get('user_ini'):
            return ini.with_name(profile['user_ini'])
    return getattr(settings, 'USER_INI', None) if ini == getattr(settings, 'GAME_INI', None) else None


def last_played(text):
    """{key: its value as written, None: no line} of LAST_PLAYED in a user ini's [DeusEx.Human] section."""
    section, found = '', dict.fromkeys(LAST_PLAYED)
    for line in text.splitlines():
        if line.strip().startswith('['):
            section = line.strip().lower()
        elif section == LAST_PLAYED_SECTION and '=' in line:
            key, value = line.split('=', 1)
            for name in LAST_PLAYED:
                if key.strip().lower() == name.lower():
                    found[name] = value
    return found


def last_played_text(text, values):
    """`text` with LAST_PLAYED as `values` ({key: value, None: no line}) in its [DeusEx.Human] section: a line changed
    in place, taken out for None, added at the end of the section (a section added at the end of the text when it has
    none); every other line, and the line ends, as they are."""
    newline = '\r\n' if '\r\n' in text else '\n'
    want = {name.lower(): (name, value) for name, value in values.items() if name in LAST_PLAYED}
    out, section, done, end = [], '', set(), None          # end: where the section's own lines stop in out
    for line in text.splitlines(keepends=True):
        stripped = line.strip()
        if stripped.startswith('['):
            if section == LAST_PLAYED_SECTION:
                end = len(out)
            section = stripped.lower()
        elif section == LAST_PLAYED_SECTION and line.split('=', 1)[0].strip().lower() in want and '=' in line:
            name, value = want[line.split('=', 1)[0].strip().lower()]
            if value is None or name in done:
                continue
            done.add(name)
            out.append(line.split('=', 1)[0] + '=' + value + line[len(line.rstrip('\r\n')):])
            continue
        out.append(line)
    if section == LAST_PLAYED_SECTION:
        end = len(out)
    rest = ['%s=%s%s' % (name, value, newline) for name, value in want.values() if value is not None and name not in done]
    if not rest:
        return ''.join(out)
    if end is None:
        if out and not out[-1].endswith(('\n', '\r')):
            out[-1] += newline
        out.append('[DeusEx.Human]' + newline)
        end = len(out)
    while end > 0 and not out[end - 1].strip():
        end -= 1                                            # before the blank lines that end the section
    if end == len(out) and not out[-1].endswith(('\n', '\r')):
        out[-1] += newline                                  # the text's last line had no line end
    out[end:end] = rest
    return ''.join(out)


def map_key(name):
    """A map's name as a record's 'played' keeps it and a user ini's lastPlayedMap is compared with it: no quotes, no
    spaces round it, lower case (the game's names are not case-sensitive); '' for none."""
    return str(name or '').strip().strip('"').strip().lower()


def _last_played_record(state, ini):
    """(LAST_PLAYED as an older Play's start recorded them, the set of its 'played') of the snapshot, checked; (None,
    set()) with no record (a 'played' left without one, by a copy of DeusEdix before fix-a3's, counts as none)."""
    kept = state.get('last_played') if isinstance(state, dict) else None
    if kept is None:
        return None, set()
    played = state.get('played', [])
    if not (isinstance(kept, dict) and set(kept) <= set(LAST_PLAYED) and all(
            value is None or (isinstance(value, str) and '\n' not in value and '\r' not in value) for value in kept.values())
            and isinstance(played, list) and all(isinstance(name, str) and name and name == map_key(name) for name in played)):
        raise ValueError('Invalid original game settings value; %s was not changed.' % _user_ini(ini))
    return kept, set(played)


def _last_played_back(ini):
    """A close (deactivate, deactivate_if_current: a project's close, the editor's and the MCP's start-up, the
    uninstall) after a Play of DeusEdix 0.1.58 or older cut short: LAST_PLAYED as its start recorded them (the two
    lines taken out where the player had none), only when the user ini's lastPlayedMap is one of the record's 'played'
    then: the file of that map need not be there any more (a Play's copy is removed at its end). Any other name is not
    that Play's (the player's own game played after a Play cut short): nothing written. The record goes either way
    (after the ini: a failure leaves it to the next close). No record, nothing written: a project's map started by hand
    from the game's own menu after an Install is left alone. -> changed"""
    state = _snapshot(ini)
    kept, played = _last_played_record(state, ini)
    if kept is None:
        if isinstance(state, dict) and 'played' in state:
            del state['played']                   # left without a record (an older copy): nothing to give back
            _save_state(ini, state)
        return False
    user, changed = _user_ini(ini), False
    if user is not None and user.is_file():
        text = user.read_bytes().decode('latin1')
        if map_key(last_played(text)['lastPlayedMap']) in played:
            updated = last_played_text(text, kept)
            if updated != text:
                _write(user, updated)
                changed = True
    del state['last_played']
    state.pop('played', None)
    _save_state(ini, state)
    return changed


def activate(paths):
    """Select a project's (or a workspace's) folders in its game: an Install's, kept until the project's close. A Play
    never activates (29 Oct 2026): it starts the game on launch copies (write_launch_inis), with these folders."""
    ini = settings.GAME_INI
    text = ini.read_text(encoding='latin1')
    state = _state(ini, text)
    _player_save_paths(ini, text, state)
    managed = getattr(settings, 'MANAGED_PROJECT', False)
    save = '..\\' + settings.MAPS_DIR_NAME.replace('/', '\\') + '\\Save' if managed else None
    if managed:
        (settings.MAPS_DIR / 'Save').mkdir(parents=True, exist_ok=True)
    updated = activate_text(text, paths, state['save_paths'], save, state['server_actors'])
    if updated.replace('\r\n', '\n') == text:
        return False
    backup = ini.with_name(ini.name + '.bak_projects')
    if not backup.exists():
        with backup.open('x', encoding='latin1', newline='') as file:
            file.write(text)
    if ini.read_text(encoding='latin1') != text:
        raise RuntimeError('%s changed while selecting this project. Try again.' % ini.name)
    _write(ini, updated)
    return True


def deactivate(_expected=None, ini=None):
    """Remove managed search paths and restore original save/campaign settings (of this project's game,
    or of `ini`)."""
    ini = ini or settings.GAME_INI
    text = ini.read_text(encoding='latin1')
    if _expected is not None and text != _expected:
        raise RuntimeError('%s changed before restoring this project. Try again.' % ini.name)
    state = _state(ini, text)
    restored = {key: list(lines) for key, lines in state['original_paths'].items()}
    # Keep legacy paths explicitly added while a project was active as well.
    for key, lines in original_paths(text).items():
        restored.setdefault(key, []).extend(line for line in lines if line not in restored.get(key, []))
    updated = activate_text(text, restored, state['save_paths'], actors=state['server_actors'])
    if ini.read_text(encoding='latin1') != text:
        raise RuntimeError('%s changed while restoring game settings. Try again.' % ini.name)
    if updated.replace('\r\n', '\n') != text:
        _write(ini, updated)
    _last_played_back(ini)                       # an older Play's map played last: the player's own back (or none)
    return True


def _changed(ini):
    """Did DeusEdix change this ini: a snapshot of it, or a project's folders or saves in it?"""
    if _snapshot_path(ini).is_file():
        return True
    text = ini.read_text(encoding='latin1')
    return any(owned_path(line) or owned_actor(line) or (line.lower().startswith('savepath=') and 'deusedixprojects' in line.lower())
               for line in text.splitlines())


def deactivate_all():
    """Uninstalling DeusEdix: every game's ini it changed (Revision.ini, the original game's DeusEx.ini) as
    it was, each one on its own (one that cannot be restored does not stop the others): (restored, errors)."""
    done, errors = [], []
    for target, profile in settings.TARGETS.items():
        ini = settings.system_folder(target) / profile['ini']
        try:
            if ini.is_file() and _changed(ini):
                deactivate(ini=ini)
                done.append(str(ini))
        except (OSError, ValueError, RuntimeError) as exc:
            errors.append('%s: %s' % (ini, exc))
    return done, errors


def _names_play_folder(text):
    """Whether a SavePath of the game's folders (SECTIONS, as play_save_text changes them) still names this
    workspace's Play folder: a Play of DeusEdix 0.1.58 or older cut short, not put back yet. A mod's own SavePath is
    never DeusEdix's to restore."""
    own, section = play_save_path().lower(), ''
    for line in text.splitlines():
        if line.strip().startswith('['):
            section = line.strip().lower()
        if section[1:-1] in SECTIONS and line.lower().startswith('savepath=') and line.split('=', 1)[1].strip().lower() == own:
            return True
    return False


def _play_save_back(ini):
    """After a Play of DeusEdix 0.1.58 or older of a workspace that is not a project, cut short (that Play activated the
    game's ini with its save folder): the SavePath lines still naming that folder back to the player's own, as recorded
    when the Play started (_player_save_paths). -> changed"""
    if not ini.is_file():
        return False
    text = ini.read_text(encoding='latin1')
    if not _names_play_folder(text):
        return False
    updated = play_save_text(text, play_save_path(), _state(ini, text)['save_paths'])
    if ini.read_text(encoding='latin1') != text:
        raise RuntimeError('%s changed while restoring its save folder. Try again.' % ini.name)
    _write(ini, updated)
    return True


# what the start-ups say when deactivate_if_current fails (editor/server.py restore_cut_short_play, the mapkit MCP's):
# the project opens anyway
RESTORE_FAILED = 'The save folder of a Play cut short could not be restored: %s'


def deactivate_if_current():
    """Restore game settings on project close only while this managed project owns them; for any other workspace,
    only what a Play of DeusEdix 0.1.58 or older cut short left: the player's own save folder and map played last."""
    if not getattr(settings, 'MANAGED_PROJECT', False):
        saves = _play_save_back(settings.GAME_INI)
        return _last_played_back(settings.GAME_INI) or saves
    ini = settings.GAME_INI
    if not ini.is_file():
        return False
    text = ini.read_text(encoding='latin1')
    section, targets = '', set()
    for line in text.splitlines():
        if line.strip().startswith('['):
            section = line.strip()[1:-1].lower()
        if section not in SECTIONS or not owned_path(line):
            continue
        value = line.strip()[6:].replace('/', '\\')
        match = re.fullmatch(r'(?i)(.*?deusedixprojects\\[a-z0-9_-]+)\\\*\.(?:dx|u|utx|uax|umx)', value)
        if match:
            folder = match[1]
            if not ntpath.isabs(folder):
                folder = ntpath.join(str(ini.parent), folder)
            targets.add(ntpath.normcase(ntpath.normpath(folder)))
    current = ntpath.normcase(ntpath.normpath(str(settings.MAPS_DIR)))
    # A second project may have changed the ini after this worker's Install.
    # Do not remove its paths, including a mixed configuration with ours left in.
    if targets != {current}:
        return False
    if not _snapshot_path(ini).is_file():
        raise RuntimeError('The original game settings snapshot is missing; this project was not deactivated.')
    return deactivate(_expected=text)
