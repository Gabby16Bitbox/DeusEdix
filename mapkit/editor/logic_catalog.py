"""What each object offers to the editor's rules: its outputs (what can happen to it) and its inputs (what a rule can
make it do), from its class. The table is data, editor/config/logic.json; editor/LOGIC.md explains it.

    io_for(['Keypad1', 'Keypad', 'HackableDevices', ...])
        {'family': 'keypad', 'outputs': ['code', 'wrongcode', 'npcused', 'near'], 'inputs': [...], 'default': 'hide',
         'free': [the actions without an object]}

An object's family is the one whose class is its NEAREST ancestor in its chain (the class first, then its parents),
so a BeamTrigger is a beam before it is a Trigger. A script of Tools > Scripts adds the outputs and inputs it declares
(scripts.ports) in front of its family's: 'output:<Id>' and 'input:<Id>'.

Version 2 of the table is the one vocabulary of the logic: each output and verb has its label, sentence, typed
arguments, inverse verb, games, disclosure level and keywords; movers have words by what they are (a bridge is
lowered), and Connect has its likeliest pairs. The readers at the end give them to the build, Check map and the
assistant; static/logic-vocab.js makes the page's sentences from the same table.

    label('verb', 'on', 'soundfx')    'Play it'          label('verb', 'open', 'door', 'bridge')   'Lower'
    pairs_for('keypad', 'door')        [{'when': 'code', 'do': ['unlock', 'open'], 'ask': ['code', 'lockAtStart']}, ...]
"""
import json
from pathlib import Path

CONFIG = Path(__file__).resolve().parent / 'config' / 'logic.json'
HEARS_KINDS = {'event', 'fail', 'keypad', 'option', 'motion', 'watch', 'start', 'cut', 'npcuse', 'timer', 'port',
               'key'}         # key: a key JC presses (no object: the key is the link's own, UCMutator.Mutate tells it)


def _load(path=CONFIG):
    """The table, checked: every family's outputs and inputs are ones the table describes."""
    data = json.loads(Path(path).read_text(encoding='utf-8'))
    outputs, inputs = data['outputs'], data['inputs']
    for when, entry in outputs.items():
        if entry.get('hears') not in HEARS_KINDS:
            raise ValueError('logic.json: output %s has an unknown way to be heard: %r' % (when, entry.get('hears')))
    owners = {}
    for family in data['families']:
        unknown = [w for w in family['outputs'] if w not in outputs] + [v for v in family['inputs'] if v not in inputs]
        if unknown:
            raise ValueError('logic.json: family %s names unknown outputs or inputs: %s' % (family['id'], unknown))
        for cls in family['classes']:
            if cls in owners:
                raise ValueError('logic.json: class %s is in two families (%s, %s)' % (cls, owners[cls], family['id']))
            owners[cls] = family['id']
    if not set(data['free']) <= set(inputs):
        raise ValueError('logic.json: a free action is not an input')
    _check_vocabulary(data)
    return data


def _check_vocabulary(data):
    """Version 2, checked the same way: levels and games are ones the table names, arguments have a type it
    describes, an inverse verb undoes its inverse, mover words and Connect pairs name what their families offer."""
    if 'v' not in data:
        return
    levels, games, types, families = data['levels'], data['games'], data['types'], {f['id']: f for f in data['families']}
    for kind, table in (('output', data['outputs']), ('verb', data['inputs'])):
        for key, entry in table.items():
            if entry.get('level', levels[0]) not in levels or not set(entry.get('games', games)) <= set(games):
                raise ValueError('logic.json: %s %s has an unknown level or game' % (kind, key))
            untyped = [a.get('id') for a in entry.get('args', []) if a.get('type') not in types]
            if untyped:
                raise ValueError('logic.json: %s %s has arguments of no known type: %s' % (kind, key, untyped))
    for verb, entry in data['inputs'].items():
        if entry.get('inverse') and data['inputs'].get(entry['inverse'], {}).get('inverse') != verb:
            raise ValueError('logic.json: %s and its inverse %s do not undo each other' % (verb, entry['inverse']))
    movers = [families[f] for f in data['movers']['families']]
    for word in data['movers']['words']:
        unknown = [o for o in word.get('outputs', {}) if not any(o in f['outputs'] for f in movers)] + \
                  [v for v in word.get('verbs', {}) if not any(v in f['inputs'] for f in movers)]
        if unknown:
            raise ValueError('logic.json: the mover word %s names what no mover has: %s' % (word['id'], unknown))
    for src, targets in data['pairs'].items():
        for dst, pairs in targets.items():
            if (src != 'any' and src not in families) or dst not in families:
                raise ValueError('logic.json: pairs %s > %s: an unknown family' % (src, dst))
            for pair in pairs:
                when = pair.get('when')
                offered = (not when if src == 'any' else not when or when in families[src]['outputs']) and \
                    all(v in families[dst]['inputs'] for v in pair['do']) and set(pair.get('ask', [])) <= set(data['asks'])
                if not offered:
                    raise ValueError('logic.json: pairs %s > %s: %s is not offered' % (src, dst, pair))


TABLE = _load()
OUTPUTS = TABLE['outputs']                       # when -> {'hears', 'tag'}
INPUTS = TABLE['inputs']                         # verb -> {'target'}
FREE = tuple(TABLE['free'])                      # actions with no object (a message, a state...)
FAMILIES = {f['id']: f for f in TABLE['families']}
_FAMILY_OF_CLASS = {cls: f['id'] for f in TABLE['families'] for cls in f['classes']}


def family_of(chain):
    """The family of an object whose class chain is `chain` (the class first): its nearest ancestor's."""
    for cls in chain:
        if cls in _FAMILY_OF_CLASS:
            return FAMILIES[_FAMILY_OF_CLASS[cls]]
    return FAMILIES['other']


def io_for(chain, ports=None):
    """What an object of this class chain offers: {family, outputs, inputs, default}, plus for a script its declared
    ports ({'inputs': [{'id', 'label', 'args'}], 'outputs': [{'id', 'label'}]}, scripts.ports) as 'output:<Id>' /
    'input:<Id>' in front, with their labels and arguments."""
    family = family_of(chain)
    out = dict(family=family['id'], outputs=list(family['outputs']), inputs=list(family['inputs']),
               default=family['inputs'][0] if family['inputs'] else '', free=list(FREE))     # the first: the usual one
    if ports:
        out['outputs'] = ['output:' + p['id'] for p in ports.get('outputs', [])] + out['outputs']
        out['inputs'] = ['input:' + p['id'] for p in ports.get('inputs', [])] + out['inputs']
        out['labels'] = {**{'output:' + p['id']: p['label'] for p in ports.get('outputs', [])},
                         **{'input:' + p['id']: p['label'] for p in ports.get('inputs', [])}}
        out['args'] = {p['id']: p['args'] for p in ports.get('inputs', [])}
        if ports.get('inputs'):
            out['default'] = 'input:' + ports['inputs'][0]['id']
    return out


def tag(when, src, option=0, key=''):
    """The Tag the link of an output waits for (the object's event becomes it; a key's: UCL_Key_<key>), or None when the
    link is watched or set off directly (it then takes its own: links.tag_of)."""
    pattern = OUTPUTS.get(when, {}).get('tag')
    return pattern.format(src=src, option=option, key=key) if pattern else None


# ---------------------------------------------------------------- the vocabulary (version 2)
# The words of an output or a verb for the editor's Python side: the build and Check map (what a game cannot run),
# the assistant (labels, search, Connect pairs). The page's sentences: static/logic-vocab.js, from the same table.
LEVELS = tuple(TABLE.get('levels', ()))          # the disclosure levels, the simplest first
GAMES = tuple(TABLE.get('games', ()))            # the games an output or a verb can work in
_KINDS = {'output': OUTPUTS, 'verb': INPUTS}
_WORDS = {w['id']: w for w in TABLE.get('movers', {}).get('words', [])}


def entry(kind, key, word=''):
    """An output's ('output') or a verb's ('verb') entry, as a mover word says it (a bridge: 'Lower', not 'Open');
    {} for one the table does not know."""
    base = _KINDS[kind].get(key)
    if base is None:
        return {}
    over = _WORDS.get(word, {}).get('outputs' if kind == 'output' else 'verbs', {}).get(key)
    return dict(base, **over) if over else base


def label(kind, key, family='', word=''):
    """What the menus call it (app.js LK_WHEN, lkVerbLabel): a verb as its target's family words it; its id when
    the table does not know it."""
    found = entry(kind, key, word)
    return found.get('labels', {}).get(family) or found.get('label') or key


def level_of(kind, key):
    """Its disclosure level ('basic', 'more', 'advanced'); one the table does not know is the last."""
    return entry(kind, key).get('level') or (LEVELS[-1] if LEVELS else '')


def shown_at(kind, key, level):
    """Whether it is offered at that level (the simpler ones included)."""
    return LEVELS.index(level_of(kind, key)) <= LEVELS.index(level)


def games_of(kind, key):
    """The games it works in ('revision', 'vanilla')."""
    return list(entry(kind, key).get('games', []))


def works_in(kind, key, game):
    return game in games_of(kind, key)


def inverse_of(verb):
    """The verb that undoes it ('' none): the way back of a rule that holds 'while'."""
    return entry('verb', verb).get('inverse', '')


def args_of(kind, key):
    """What it takes: [{'id', 'type', 'label', 'default'...}], the types described in the table's 'types'."""
    return list(entry(kind, key).get('args', []))


def search(text, level=None, game=None):
    """The outputs and verbs whose label, keywords or id have every word of text, offered at level and working in
    game: [(kind, key, label)], outputs first, in the table's order (static/logic-vocab.js search)."""
    words = text.lower().split()
    found = []
    for kind, table in _KINDS.items():
        for key, item in table.items():
            words_of = ' '.join([item.get('label', ''), *item.get('kw', []), key]).lower()
            if (level is None or shown_at(kind, key, level)) and (game is None or works_in(kind, key, game)) \
                    and all(w in words_of for w in words):
                found.append((kind, key, item.get('label') or key))
    return found


def pairs_for(src_family, dst_family):
    """The first choices of Connect from an object of src_family to one of dst_family, the likeliest first:
    [{'when', 'do': [verbs], 'ask': [ids of ask()]}]. The pairs for any source follow, with the source's first
    output; what the two families do not offer is left out. [] when none: Connect keeps its own choice."""
    src, dst = FAMILIES.get(src_family), FAMILIES.get(dst_family)
    if not src or not dst:
        return []
    pairs = TABLE.get('pairs', {})
    out = []
    for pair in pairs.get(src_family, {}).get(dst_family, []) + pairs.get('any', {}).get(dst_family, []):
        pair = dict(pair, when=pair.get('when') or (src['outputs'] or [''])[0])
        if pair['when'] in src['outputs'] and all(v in dst['inputs'] for v in pair['do']) \
                and not any(p['when'] == pair['when'] and p['do'] == pair['do'] for p in out):
            out.append(pair)
    return out


def ask(key):
    """A field a Connect pair asks for: {'label', 'of': 'source' | 'target' | 'step', 'prop' or 'arg'...}, or None."""
    return TABLE.get('asks', {}).get(key)


def mover_words():
    """What a mover can be (the Inspector's 'This mover is a...'): [{'id', 'noun', 'verbs', 'outputs'}], the usual
    one first."""
    return list(_WORDS.values())


def noun_of(family, word=''):
    """A family's kind of object as a sentence names it ('sound effect'; a mover by its word), '' when none."""
    return _WORDS.get(word, {}).get('noun') or FAMILIES.get(family, {}).get('noun', '')


def not_in_game(links, game):
    """What a map's rules use that the game cannot run: [(rule id, 'output' | 'verb', key)], for the build and
    Check map to name (settings.TARGET)."""
    out = []
    for link in links:
        if link.get('when') in OUTPUTS and not works_in('output', link['when'], game):
            out.append((link.get('id', ''), 'output', link['when']))
        out += [(link.get('id', ''), 'verb', act['verb']) for act in link.get('do', [])
                if act.get('verb') in INPUTS and not works_in('verb', act['verb'], game)]
    return out


def vocabulary():
    """The whole table, for the page (static/logic-vocab.js vocabulary(data))."""
    return TABLE
