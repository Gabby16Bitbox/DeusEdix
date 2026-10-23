"""Activate one project's map search paths and save folder in its game (Revision.ini, or the original
game's DeusEx.ini: settings.GAME_INI).

The original settings are recorded before the first activation. Content stays in
separate project directories; changing projects never deletes another build.
"""
import json
import ntpath
import os
import re
from pathlib import Path

import settings

# the sections with the game's folders (Paths): Revision.ini has two, the original DeusEx.ini only the first
SECTIONS = {'core.system', 'revisioninternal.launchsystem'}


def _write(ini, text):
    """The whole new text first, then the ini replaced at once: a full disk never leaves a game's ini
    cut short (it happened to RevisionUser.ini on 15 Oct 2026, written in place)."""
    tmp = ini.with_name(ini.name + '.deusedix-tmp')
    tmp.write_text(text, encoding='latin1', newline='')
    os.replace(tmp, ini)


def owned_actor(line):
    return bool(re.match(r'(?i)^\s*ServerActors\s*=\s*(?:UnatcoContinues|DeusEdix|DXP_[a-z0-9_]+)\.', line))


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
    return bool(re.search(r'(?:^|\\)(?:deusedixmaps|unatcomaps|deusedixprojects\\[a-z0-9_-]+)\\\*\.(?:dx|u|utx|uax|umx)$', path))


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


def _state(ini, text):
    stamp = ini.with_name('deusedix-project-activation.json')
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


def activate(paths):
    ini = settings.GAME_INI
    text = ini.read_text(encoding='latin1')
    state = _state(ini, text)
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
    return True


def _changed(ini):
    """Did DeusEdix change this ini: a snapshot of it, or a project's folders or saves in it?"""
    if ini.with_name('deusedix-project-activation.json').is_file():
        return True
    text = ini.read_text(encoding='latin1')
    return any(owned_path(line) or owned_actor(line) or (line.lower().startswith('savepath=') and 'deusedixprojects' in line.lower())
               for line in text.splitlines())


def deactivate_all():
    """Uninstalling DeusEdix: every game's ini it changed (Revision.ini, the original game's DeusEx.ini) as
    it was, each one on its own (one that cannot be restored does not stop the others): (restored, errors)."""
    done, errors = [], []
    for profile in settings.TARGETS.values():
        ini = (settings.GAME / profile['root'] if profile['root'] else settings.GAME) / 'System' / profile['ini']
        try:
            if ini.is_file() and _changed(ini):
                deactivate(ini=ini)
                done.append(str(ini))
        except (OSError, ValueError, RuntimeError) as exc:
            errors.append('%s: %s' % (ini, exc))
    return done, errors


def deactivate_if_current():
    """Restore game settings on project close only while this managed project owns them."""
    if not getattr(settings, 'MANAGED_PROJECT', False):
        return False
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
    if not ini.with_name('deusedix-project-activation.json').is_file():
        raise RuntimeError('The original game settings snapshot is missing; this project was not deactivated.')
    return deactivate(_expected=text)
