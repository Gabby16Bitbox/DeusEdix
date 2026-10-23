"""Per-map InformationDevices text overrides, using the game's ExtString parser.

edits.documents[actor] = {text: raw game markup}. Reading an original never writes an override.
Short serialized chunks avoid UE1's per-line import limit, including books over 8 KB.
"""
import hashlib
import re
import settings
from comptexts import plain

MAX_TEXT = 55000
CHUNK = 850


def validate(edits):
    docs = edits.get('documents') or {}
    if not isinstance(docs, dict):
        raise ValueError('Documents must be keyed by actor name.')
    for actor, doc in docs.items():
        if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,63}', str(actor)) or not isinstance(doc, dict):
            raise ValueError('Invalid document actor.')
        text = doc.get('text')
        if not isinstance(text, str) or len(text) > MAX_TEXT or re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', text):
            raise ValueError('Document text must be at most 55,000 characters and contain no control characters.')
        if len(game_text(text)) > MAX_TEXT:
            raise ValueError('Document text exceeds 55,000 characters after conversion to the game font.')
    return docs


def tag(map_name, actor):
    return 'DXEdDoc_' + hashlib.sha256((map_name.lower() + '/' + actor.lower()).encode()).hexdigest()[:32]


def game_text(text):
    # Source newlines are whitespace in ExtString markup. Paragraphs are explicit <P> tags.
    return re.sub(r'[\r\n]+', ' ', plain(text))


def blocks(edits, map_name):
    out = []
    for actor, doc in sorted(validate(edits).items()):
        if actor in (edits.get('deleted') or []):
            continue
        name = tag(map_name, actor)
        props = {'TextName': name}
        out.append(dict(cls='UCTextBlock', name=name, loc=[0, 0, 0], props=props))
    return out


def commands(edits, map_name):
    out = []
    for actor, doc in sorted(validate(edits).items()):
        if actor in (edits.get('deleted') or []):
            continue
        text = game_text(doc['text'])
        chunks = [text[i:i + CHUNK] for i in range(0, len(text), CHUNK)] or ['']
        for i, chunk in enumerate(chunks):
            out.append('UC_TEXTHEX %s %s %s' % (tag(map_name, actor),
                'Text' if i == 0 else 'TextMore(%d)' % (i - 1), chunk.encode('utf-8').hex()))
        out += ['UC_PROP %s textTag %s' % (actor, tag(map_name, actor)),
                'UC_PROP %s TextPackage %s' % (actor, settings.PACKAGE)]
        if 'special_text' in settings.FEATURES:     # Revision's own text of the object (the original game has none)
            out.append('UC_PROP %s SpecialText ' % actor)
    return out


def report(edits):
    return ['  EDIT document of %s (%d characters)' % (actor, len(doc['text']))
            for actor, doc in sorted(validate(edits).items())]
