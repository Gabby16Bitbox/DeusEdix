"""What each object offers to the editor's rules: its outputs (what can happen to it) and its inputs (what a rule can
make it do), from its class. The table is data, editor/config/logic.json; editor/LOGIC.md explains it.

    io_for(['Keypad1', 'Keypad', 'HackableDevices', ...])
        {'family': 'keypad', 'outputs': ['code', 'wrongcode', 'npcused', 'near'], 'inputs': [...], 'default': 'hide',
         'free': [the actions without an object]}

An object's family is the one whose class is its NEAREST ancestor in its chain (the class first, then its parents),
so a BeamTrigger is a beam before it is a Trigger. A script of Tools > Scripts adds the outputs and inputs it declares
(scripts.ports) in front of its family's: 'output:<Id>' and 'input:<Id>'.
"""
import json
from pathlib import Path

CONFIG = Path(__file__).resolve().parent / 'config' / 'logic.json'
HEARS_KINDS = {'event', 'fail', 'keypad', 'option', 'motion', 'watch', 'start', 'cut', 'npcuse', 'timer', 'port'}


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
    return data


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


def tag(when, src, option=0):
    """The Tag the link of an output waits for (the object's event becomes it), or None when the link is watched or
    set off directly (it then takes its own: links.tag_of)."""
    pattern = OUTPUTS.get(when, {}).get('tag')
    return pattern.format(src=src, option=option) if pattern else None
