"""Search/display metadata only. Never change map names, engine tags or prefab identities."""
import functools
import hashlib
import json
import re
import threading
from pathlib import Path

import atomicfile
import data

CONFIG = Path(__file__).resolve().parent / 'config' / 'asset-catalog.json'
_lock = threading.RLock()
MATERIALS = {
    'Metal': r'met[al]|metl|iron|steel|galv|brass|copper|alum|grate|chrome',
    'Glass': r'glass|window|transluc|trans_|bulltprf',
    'Wood': r'wood|walnut|mahog|timber',
    'Fabric': r'fabric|cloth|mattress|carpet|cot\d|curtain|cushion',
    'Concrete': r'concr|cncrt|cement',
    'Stone': r'stone|marble|granite',
    'Brick': r'brick|brck',
}
# Object signals precede materials. Glass on a computer does not make it a window.
RULES = [
    ('Furniture · Beds', 'Bed', r'mattress|(?:^|\W)cot\d|bunk|bedframe|hospitalbed', 'bed beds letto letti cot bunk mattress materasso bedroom dormitory'),
    ('Electronics · Computers', 'Computer terminal', r'keyboard|computer|comptr|cmptr|compu_|terminal|desktop|monitor|screen', 'computer pc terminal terminals terminale terminali monitor screen schermo console'),
    ('Furniture · Seating', 'Seat', r'couch|sofa|chair|armchair|bench|cushion|seat(?:_|\d)', 'seat chair chairs sedia sedie sofa couch divano armchair poltrona bench panchina'),
    ('Furniture · Tables', 'Table', r'tabletop|(?:^|\W)table(?:_|\d)|desk|countertop', 'table tavolo tavoli desk scrivania counter banco'),
    ('Furniture · Storage', 'Storage cabinet', r'filecab|locker|bookcase|bookshelf|shelves|cabinet|drawer|racksides', 'cabinet armadio storage shelf scaffale shelves locker filing file drawer'),
    ('Electronics · Control panels', 'Control panel', r'controlpanel|control_panel|comptrpanel|techbutn|consocab|switchboard|keypad', 'control controls panel panels pannello pannelli console switch button bottone keypad'),
    ('Decorations · Pictures', 'Picture', r'painting|picture|portrait|artwork|poster', 'picture painting quadro quadri poster portrait wall art'),
    ('Architecture · Windows', 'Window', r'window|glass|bulltprf|trans_win|windopac', 'window windows finestra finestre glass vetro pane'),
]


@functools.lru_cache(maxsize=1)
def configuration():
    try:
        value = json.loads(CONFIG.read_text(encoding='utf-8'))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def fingerprint(item):
    """Tie annotations to an asset and its content; a rescan cannot rename an unrelated shape."""
    size = item.get('size') or []
    size = sorted(round(float(v), 1) for v in size[:2]) + [round(float(v), 1) for v in size[2:3]]
    value = [item.get('id'), size, sorted(str(t).split('.')[-1].lower() for t in item.get('tex', [])), len(item.get('brushes') or [])]
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()[:24]


def _file(kind):
    if kind == 'piece':
        return data.GAME_CACHE / '_catalog' / 'pieces.json'
    if kind == 'prefab':
        return data.CACHE / '_catalog' / 'prefabs.json'
    raise ValueError('Unknown catalog kind.')


def _read(kind):
    path = _file(kind)
    if not path.exists():
        return {}
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict) or value.get('version') != 1 or not isinstance(value.get('items'), dict):
        raise ValueError('Invalid catalog metadata. The existing file was preserved.')
    return value['items']


def _key(item, kind):
    return fingerprint(item) if kind == 'piece' else item.get('line') or item['id']


def enrich(item, kind='piece', overrides=None):
    result = dict(item)
    result['original_label'] = item.get('original_label', item.get('label') or item['id'])
    result['original_cat'] = item.get('original_cat', item.get('cat') or 'Project prefabs')
    text = ' '.join(str(t).split('.')[-1] for t in item.get('tex', []))
    if kind == 'prefab':
        text = result['original_label']
    result['materials'] = [name for name, rx in MATERIALS.items() if re.search(rx, text, re.I)]
    label, category, words, status = result['original_label'], result['original_cat'], [], 'original'
    if item.get('kind') not in ('door', 'elevator'):
        for cat, name, rx, aliases in RULES:
            if cat == 'Architecture · Windows' and result['original_cat'] != 'Windows and glass':
                continue
            if re.search(rx, text, re.I):
                label, category, words, status = name, cat, aliases.split(), 'suggested'
                # A user-created prefab's chosen title remains useful and intentional.
                if kind == 'prefab':
                    label = result['original_label']
                break
    if category == 'Windows and glass':
        category = 'Architecture · Windows'
    reviewed = configuration().get('reviewed', {}).get(fingerprint(item), {}) if kind == 'piece' else {}
    if reviewed:
        label, category, words, status = reviewed['label'], reviewed['category'], reviewed.get('keywords', []), 'reviewed'
    # Category aliases also make old correctly identified pieces searchable in Italian.
    aliases = configuration().get('aliases', {})
    words = list(words) + aliases.get(category, [])
    corrections = overrides if overrides is not None else _read(kind)
    custom = corrections.get(_key(item, kind), {})
    if custom:
        label, category, words, status = custom['label'], custom['category'], custom['keywords'], 'custom'
    result.update(label=label, cat=category, keywords=list(dict.fromkeys(words)), catalog_status=status,
                  catalog_key=_key(item, kind), catalog_kind=kind)
    return result


def decorate(items, kind='piece'):
    corrections = _read(kind)
    return [enrich(item, kind, corrections) for item in items]


def categories(items):
    return sorted({item.get('cat') or 'Other details' for item in items}, key=str.casefold)


def save(body):
    import pieces_library
    import prefab_library
    if not isinstance(body, dict) or body.get('kind') not in ('piece', 'prefab'):
        raise ValueError('Choose a piece or prefab.')
    kind, ident = body['kind'], body.get('id')
    if not isinstance(ident, str) or len(ident) > 240:
        raise ValueError('Invalid catalog entry.')
    entries = pieces_library._catalog().get('items', []) if kind == 'piece' else prefab_library.library()
    item = next((i for i in entries if i.get('id') == ident), None)
    if item is None:
        raise ValueError('This asset is no longer in the library. Refresh the browser.')
    if not body.get('reset'):
        for prop in ('label', 'category'):
            value = body.get(prop)
            if not isinstance(value, str) or not value.strip() or len(value.strip()) > 80 or any(ord(c) < 32 for c in value):
                raise ValueError('Use a name and category of 1–80 printable characters.')
        words = body.get('keywords')
        if not isinstance(words, list) or len(words) > 60 or any(not isinstance(w, str) or not w.strip() or len(w) > 64 or any(ord(c) < 32 for c in w) for w in words):
            raise ValueError('Use at most 60 keywords of 1–64 printable characters.')
    with _lock:
        value = _read(kind)
        key = _key(item, kind)
        if body.get('reset'):
            value.pop(key, None)
        else:
            value[key] = dict(label=body['label'].strip(), category=body['category'].strip(), keywords=list(dict.fromkeys(w.strip().lower() for w in words)))
        path = _file(kind)
        path.parent.mkdir(parents=True, exist_ok=True)
        atomicfile.write_json(path, dict(version=1, items=value))
        return enrich(item, kind, value)
