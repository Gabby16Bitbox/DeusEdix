"""Project defaults and per-InfoLink overrides; only stock game fonts reach the runtime."""
import hashlib
import json
import re
from pathlib import Path
import atomicfile
import settings

KIT = Path(__file__).resolve().parent
FILE = KIT / 'infolink-style.json'
CLASSES = KIT.parents[1] / 'src' / settings.PACKAGE / 'Classes'
DEFAULT = dict(enabled=False, font='terminal', size='normal', background=None, text=None)
FONTS = ('terminal', 'dialogue', 'bold')
SIZES = ('normal', 'large')


def validate(value, partial=False):
    if not isinstance(value, dict) or set(value) - set(DEFAULT):
        raise ValueError('Invalid InfoLink appearance settings.')
    out = {} if partial else dict(DEFAULT)
    for key, v in value.items():
        if key == 'enabled':
            if type(v) is not bool: raise ValueError('InfoLink custom style must be on or off.')
        elif key == 'font':
            if v not in FONTS: raise ValueError('Choose a supported InfoLink font.')
        elif key == 'size':
            if v not in SIZES: raise ValueError('Choose a supported InfoLink text size.')
        elif v is not None:
            if not isinstance(v, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', v):
                raise ValueError('InfoLink colors must be #RRGGBB or use the game theme.')
            v = v.lower()
        out[key] = v
    return out


def snapshot():
    raw = FILE.read_bytes() if FILE.exists() else b''
    try:
        style = validate(json.loads(raw)) if raw else dict(DEFAULT)
    except (ValueError, TypeError) as exc:
        raise ValueError('Cannot read the project InfoLink style. Its saved file was preserved.') from exc
    return dict(style=style, revision=hashlib.sha256(raw).hexdigest())


def validate_story(story):
    for il in story.get('infolinks') or []:
        if il.get('style') is not None:
            validate(il['style'], partial=True)


def resolved(override):
    value = snapshot()['style']
    if override is not None:
        value.update(validate(override, partial=True))
        value['enabled'] = override.get('enabled', True)
    return value


def color(v):
    if v is None: return '(R=0,G=0,B=0)'
    return '(R=%d,G=%d,B=%d)' % tuple(int(v[i:i+2],16) for i in (1,3,5))


def fields(style):
    s = validate(style)
    return dict(bCustomStyle=str(s['enabled']), StyleFont=str(FONTS.index(s['font'])),
                StyleSize=str(SIZES.index(s['size'])), bStyleBackground=str(s['background'] is not None),
                StyleBackground=color(s['background']), bStyleText=str(s['text'] is not None),
                StyleText=color(s['text']))


def write_runtime():
    props = fields(snapshot()['style'])
    text = ('// Generated from tools/mapkit/infolink-style.json.\n'
            'class UCInfoLinkStyle extends Object;\n\n'
            'var bool bCustomStyle, bStyleBackground, bStyleText;\n'
            'var byte StyleFont, StyleSize;\n'
            'var Color StyleBackground, StyleText;\n\n'
            'defaultproperties\n{\n' + ''.join('    %s=%s\n'%p for p in props.items()) + '}\n')
    dst = CLASSES / 'UCInfoLinkStyle.uc'
    CLASSES.mkdir(parents=True, exist_ok=True)
    if not dst.exists() or dst.read_text(encoding='latin1') != text:
        atomicfile.write_text(dst, text, encoding='latin1')


def save(value, expected):
    style = validate(value)
    if snapshot()['revision'] != expected:
        raise ValueError('The project InfoLink style changed elsewhere. Reopen Map story before saving.')
    atomicfile.write_json(FILE, style)
    write_runtime()
    return snapshot()


def override_code(override):
    if override is None: return []
    # Resolve the project defaults at generation time, not against another map's style.
    return ['\ts.%s = %s;' % p for p in fields(resolved(override)).items()]
