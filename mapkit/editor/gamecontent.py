"""Read installed text assets and mission-script flag references into a local cache only."""
import json
import re
from pathlib import Path

import gamecons
import kit
import t3d

import settings  # noqa: E402
CACHE = settings.GAME_CACHE / '_gamecontent'     # shared by the game's projects
VERSION = 1
_memory = {}


def exported(package, kind):
    if kind not in ('texts', 'scripts'):
        raise ValueError('Unknown original content type.')
    source = gamecons._package(package)
    signature = gamecons._stamp([source, gamecons._package('Extension')])
    key = (package, kind, signature, VERSION)
    if key in _memory:
        return _memory[key]
    file = CACHE / (package + '-' + kind + '.json')
    try:
        cached = json.loads(file.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        cached = {}
    if cached.get('signature') == signature and cached.get('version') == VERSION:
        _memory[key] = cached['rows']
        return cached['rows']
    session = kit.Session([], 'game-' + kind)
    try:
        command = 'UC_TEXTDUMP' if kind == 'texts' else 'UC_SCRIPTDUMP'
        session.batch(['OBJ LOAD FILE="%s.u"' % package,
                       command + ' ' + package + r' ..\Output\content.jsonl'])
        rows = kit.rows(session.folder / 'Output' / 'content.jsonl')
    finally:
        session.close()
    gamecons._write(file, dict(version=VERSION, signature=signature, rows=rows))
    _memory[key] = rows
    return rows


def text(package, tag, map_name=''):
    tag = str(tag or '').strip()
    if not tag or tag.lower() == 'none':
        return dict(found=False, text='', source='', message='This object has no game text.')
    if not re.fullmatch(r'[A-Za-z0-9_.]{1,128}', tag):
        raise ValueError('Invalid game text tag.')
    import settings
    if package == settings.PACKAGE and map_name:
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', map_name):
            raise ValueError('Invalid map name.')
        file = Path(__file__).resolve().parent / 'cache' / map_name / 'scene.t3d'
        if file.is_file():
            for actor in t3d.actors(file.read_text(encoding='latin1')):
                p = {k.lower(): v for k, v in actor['props'].items()}
                if actor['cls'].split('.')[-1] == 'UCTextBlock' and p.get('textname', '').lower() == tag.lower():
                    chunks = [p.get('text', '""')] + [p.get('textmore(%d)' % i, '""') for i in range(64)]
                    value = ''.join(c[1:-1] if c.startswith('"') and c.endswith('"') else c for c in chunks)
                    return dict(found=True, text=value, source='Map document · ' + tag, package=package, tag=tag)
        return dict(found=False, text='', source=tag, message='Map document is not in the current map export. Rebuild the map to refresh it.')
    rows = exported(package or 'DeusExText', 'texts')
    matches = [r for r in rows if r['path'].casefold() == tag.casefold() or r['path'].rsplit('.', 1)[-1].casefold() == tag.casefold()]
    if len(matches) > 1:
        raise ValueError('This text tag is ambiguous; use its full object path.')
    if not matches:
        return dict(found=False, text='', source=package + '.' + tag, message='Text not found in the installed package.')
    return dict(found=True, text=matches[0]['text'], source=matches[0]['path'], package=package, tag=tag)


def scan_flags(row):
    """Literal flag operations only. Strip comments/strings without shifting source line numbers."""
    source = row['text']
    mask = re.compile(r'//[^\n]*|/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"')
    code = mask.sub(lambda m: re.sub(r'[^\n]', ' ', m[0]), source)
    funcs = list(re.finditer(r'\b(?:function|event)\s+(?:\w+\s+)?(\w+)\s*\(', code, re.I))
    calls = re.finditer(r"\.\s*(GetBool|SetBool|GetInt|SetInt|GetByte|SetByte|GetFloat|SetFloat|GetName|SetName|GetString|SetString|DeleteFlag|ClearFlag|SetFlag)\s*\(\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*(?=[,)])", code, re.I)
    flags = {}
    for m in calls:
        function = next((f[1] for f in reversed(funcs) if f.start() < m.start()), '')
        operation = m[1]
        kind = re.sub(r'^(Get|Set)', '', operation, flags=re.I)
        flags.setdefault(m[2], []).append(dict(source='mission script', cls=row['path'], function=function,
            line=source.count('\n', 0, m.start()) + 1, operation=operation, type=kind.lower()))
    return flags


def mission_flags(map_name):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', str(map_name)):
        raise ValueError('Invalid map name.')
    file = Path(__file__).resolve().parent / 'cache' / map_name / 'scene.t3d'
    if not file.is_file():
        return dict(map=map_name, flags={}, classes=[], message='Build or open this map to read its mission script.')
    level = next((a['props'] for a in t3d.actors(file.read_text(encoding='latin1')) if a['cls'].split('.')[-1] == 'DeusExLevelInfo'), {})
    script = gamecons.ref({k.lower(): v for k,v in level.items()}.get('script', ''))
    result = dict(map=map_name, script=script, flags={}, classes=[], message='')
    if not script:
        result['message'] = 'This map has no original mission script.'
        return result
    seen = set()
    while script and script.casefold() not in seen:
        seen.add(script.casefold())
        if script.split('.')[-1] in ('Info', 'Actor', 'Object'):
            break
        if '.' not in script:
            result['message'] = 'The mission script has no package name: ' + script
            break
        package = script.split('.')[0]
        try:
            rows = exported(package, 'scripts')
        except (OSError, RuntimeError) as e:
            result['message'] = 'Mission source unavailable for ' + package + ': ' + str(e)
            break
        row = next((r for r in rows if r['path'].casefold() == script.casefold()), None)
        if not row:
            result['message'] = 'Source is not included for ' + script
            break
        result['classes'].append(script)
        for flag, refs in scan_flags(row).items():
            result['flags'].setdefault(flag, []).extend(refs)
        script = row['parent']
    result['message'] = result['message'] or 'Literal names from this mission and its parent scripts. Dynamically constructed flag names are not inferred.'
    return result
