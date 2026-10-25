"""The current project's story memory, read without loading maps in the engine.

This is an index, not a second flag store: stories and interactions remain the source
of truth. Only their authored JSON files are read; caches, backups, generated code
and other projects are deliberately outside the scan.
"""
import ast
import json
import re
from pathlib import Path

import conditions
import story


class _Index:
    def __init__(self):
        self.flags = {}

    def add(self, flag, map_name, context, kind, label=None, source='project', type='bool'):
        """type: 'bool' for a state, 'int' for a counter (the game's integer flags)."""
        if not isinstance(flag, str) or not flag.strip():
            return
        flag = flag.strip()
        # UE names are case insensitive. Keep the author's spelling without creating
        # two suggestions for the same runtime flag.
        entry = self.flags.setdefault(flag.casefold(), dict(flag=flag, source=source,
                                                          type=type, uses=[]))
        if source == 'automatic':
            entry['source'] = source
        if label:
            entry['label'] = str(label)
        use = dict(map=str(map_name), context=str(context), kind=kind)
        if use not in entry['uses']:
            entry['uses'].append(use)

    def merge(self, entries):
        for entry in entries:
            for use in entry['uses']:
                self.add(entry['flag'], use['map'], use['context'], use['kind'],
                         entry.get('label'), entry['source'], entry.get('type', 'bool'))

    def result(self):
        return sorted(self.flags.values(), key=lambda entry: entry['flag'].casefold())


def _items(value):
    return (item for item in value if isinstance(item, dict)) if isinstance(value, list) else ()


def collect_story(value, map_name):
    """Return indexed flags from an authored story, leaving all its fields untouched."""
    index = _Index()
    if not isinstance(value, dict):
        return []

    def flag(item, context, kind='read'):
        index.add(item.get('flag'), map_name, context, kind)

    def requirements(item, context, kind='read'):
        for condition in _items(item.get('requires')):
            flag(condition, context, kind)
            if conditions.kind(condition) == 'counter':      # a counter condition of an event (conditions.py)
                index.add(condition.get('counter'), map_name, context, kind, type='int')

    def actions(items, context):
        for action in _items(items):
            if action.get('type') == 'flag':
                flag(action, context, 'write')
            if action.get('type') == 'do':
                actions(action.get('do'), context)

    for dialogue in _items(value.get('dialogues')):
        title = dialogue.get('title') or dialogue.get('id') or 'Untitled'
        context = 'Dialogue: ' + str(title)
        requirements(dialogue, context)
        if dialogue.get('id') and not dialogue.get('disabled'):
            played = story.con_name(map_name, dialogue) + '_Played'
            index.add(played, map_name, context, 'automatic', str(title) + ' · Played', 'automatic')
        for step in _items(dialogue.get('steps')):
            kind = step.get('type')
            if kind in ('flag', 'if'):
                # Imported native flag/check steps replace their single flag with
                # the explicit list. Preserve expiration and ordering in the source.
                use = 'write' if kind == 'flag' else 'read'
                if step.get('requires'):
                    requirements(step, context, use)
                else:
                    flag(step, context, use)
            elif kind == 'choice':
                for option in _items(step.get('options')):
                    choice = context + ' · Answer: ' + str(option.get('text') or 'Untitled')
                    flag(option, choice)
                    requirements(option, choice)
            elif kind == 'do':
                actions(step.get('do'), context)

    for info in _items(value.get('infolinks')):
        title = info.get('title') or info.get('id') or 'Untitled'
        context = 'InfoLink: ' + str(title)
        if info.get('id'):
            index.add(story.heard_flag(map_name, info), map_name, context, 'automatic',
                      str(title) + ' · Heard', 'automatic')
        actions(info.get('do'), context)

    for event in _items(value.get('events')):
        context = 'Event: ' + str(event.get('title') or event.get('id') or 'Untitled')
        requirements(event, context)
        when = event.get('when')
        if isinstance(when, dict) and when.get('type') == 'flag':
            flag(when, context)
        actions(event.get('do'), context)
    return index.result()


def collect_edits(value, map_name):
    """Index the states and counters the Interactions write (actions flag, count) and read (their conditions)."""
    index = _Index()
    if isinstance(value, dict):
        for link in _items(value.get('links')):
            context = 'Interaction: ' + str(link.get('label') or link.get('id') or link.get('src') or 'Untitled')
            for condition in _items(link.get('requires')):
                if conditions.kind(condition) == 'counter':
                    index.add(condition.get('counter'), map_name, context, 'read', type='int')
                elif conditions.kind(condition) == 'flag':
                    index.add(condition.get('flag'), map_name, context, 'read')
            for action in _items(link.get('do')):
                if action.get('verb') == 'flag':
                    index.add(action.get('a'), map_name, context, 'write')
                elif action.get('verb') == 'count':
                    index.add(action.get('a'), map_name, context, 'write', type='int')
    return index.result()


def _read(path):
    try:
        return json.loads(path.read_text(encoding='utf-8-sig'))
    except (OSError, UnicodeError, ValueError):
        # A concurrently saved or incomplete draft must not hide the remaining flags.
        return None


def _direct_files(folder, pattern):
    """Do not follow a linked folder/file into a different project or backup tree."""
    if not folder.is_dir() or folder.is_symlink() or folder.resolve() != folder.absolute():
        return []
    return sorted((path for path in folder.glob(pattern)
                   if path.is_file() and not path.is_symlink() and path.resolve().parent == folder.resolve()),
                  key=lambda path: path.name.casefold())


def _script_map(path):
    try:
        module = ast.parse(path.read_text(encoding='utf-8-sig'))
        for node in module.body:
            if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'MAP'
                                                    for target in node.targets):
                name = ast.literal_eval(node.value)
                if isinstance(name, str) and name:
                    return name
    except (OSError, UnicodeError, SyntaxError, ValueError, TypeError):
        pass
    return path.stem


def catalog(kit=None, story_dir=None):
    """Return ``{flags: [{flag, source, type, uses, label?}]}`` for this project only."""
    kit = Path(kit) if kit is not None else story.KIT
    story_dir = Path(story_dir) if story_dir is not None else (story.STORY if kit == story.KIT else kit / 'story')
    index = _Index()
    for path in _direct_files(story_dir, '*.json'):
        index.merge(collect_story(_read(path), path.stem))
    # Identity flags are written by UCPlayerMap, not by the Character Creator's NPCs.
    def has_player(path):
        value = _read(path)
        level = value.get('level') if isinstance(value, dict) else None
        return isinstance(level, dict) and bool(level.get('player'))

    if (kit / 'players.json').exists() or any(
            has_player(path) for path in _direct_files(kit / 'maps', '*.edits.json')):
        index.add('UCEdPlayer_jc', '*', 'Player character', 'automatic', 'Player is JC Denton', 'automatic')
        for path in _direct_files(kit / 'characters', '*.json'):
            value = _read(path)
            if not isinstance(value, dict) or value.get('id') != path.stem:
                continue
            if re.fullmatch(r'[a-z0-9][a-z0-9-]{0,47}', path.stem) and path.stem != 'jc':
                index.add('UCEdPlayer_' + path.stem.replace('-', '_'), '*', 'Player character', 'automatic',
                          'Player is ' + str(value.get('name') or path.stem)[:64], 'automatic')
    maps = kit / 'maps'
    script_names = {path.stem.casefold(): _script_map(path) for path in _direct_files(maps, '*.py')}
    for path in _direct_files(maps, '*.edits.json'):
        stem = path.name[:-len('.edits.json')]
        index.merge(collect_edits(_read(path), script_names.get(stem.casefold(), stem)))
    return dict(flags=index.result())
