"""Turn into script (P8 slice 6, editor/LOGIC.md "Turn into script"): rules of the map written as a script of Tools >
Scripts, a UCScript doing what they did with the rules' own actions (UCScript.Act, Holds, After).

Each rule's cause stays in the map as a rule of its own that calls the script's input of the rule's id ("L7"); its
conditions, "only the first time" and actions are the script's: the same strings the build writes for the rule
(links.act_string, conditions.encode), so the game does what the rule did. The page marks the rules it replaced
(`replacedBy`): the build leaves them out, and Back to rules puts them back.

    script_of(edits, rule_ids, name, map_name)  {'text', 'rules': [ids turned], 'refused': [{'id', 'why'}]}
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE.parent) not in sys.path:
    sys.path.insert(0, str(HERE.parent))
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
import conditions  # noqa: E402
import formula  # noqa: E402
import links  # noqa: E402
import logicpatterns  # noqa: E402

NAME = re.compile(r'^[A-Za-z][A-Za-z0-9_]{1,40}$')
MAX_RULES = 8                      # UCScript.Inputs[8]: one input for each rule
MAX_LATER = 16                     # UCScript.AfterLabel[16]: the times waited at once
NOT_HERE = {'ownorders'}           # needs the link's own memory of the orders (UCLink.RememberOrders)


def _uc(s):
    """A string of UnrealScript: its backslashes and quotes escaped."""
    return '"%s"' % str(s).replace('\\', '\\\\').replace('"', '\\"')


def refusal(link, edits):
    """Why this rule cannot be a script yet, in words ('' when it can)."""
    if link.get('replacedBy'):
        return 'it is already done by the script %s' % (link['replacedBy'].get('script') or '')
    if link.get('instance'):
        return 'it is a placed pattern\'s: Unpack the pattern first'
    if link.get('otherwiseOf') or any(o.get('otherwiseOf') == link.get('id') for o in edits.get('links') or []):
        return 'it has an "If not" rule'
    if not links.valid(link):
        return 'it does nothing yet'
    v2 = links.v2_reasons(link)
    if v2:
        return 'it has %s' % ', '.join(v2)
    if links.is_steps(link) or links._has_own_checks(link):
        return 'it is a list of steps (If, Wait until, or an action with its own condition)'
    acts = links._plain_acts(link, set(edits.get('deleted') or {}))
    for a in acts:
        if a.get('area') is not None or a.get('group') or a.get('targetTag'):
            return 'it acts on a group, an area or objects tagged alike'
        if a.get('verb') in NOT_HERE:
            return 'it sends a character back to its own orders'
    if _uses_value(link, acts):
        return 'it uses Value, the number the output that starts it comes with'
    return ''


def _uses_value(link, acts):
    """Whether its conditions or actions read Value (P8 slice 5b): a script's Act and Holds have no output's number."""
    try:
        said = [conditions.encode(c) for c in conditions.check(link.get('requires'), limit=conditions.MAX_CONDITIONS)]
        said += [links.act_string(a) for a in acts]
    except Exception:            # (a rule that cannot be written is refused by its build)
        return False
    return any(formula.uses_value(f) for s in said for f in str(s).split('|'))


def _rule_code(link, edits, later):
    """The function of one rule, and its later steps for Step(): (lines, [(label, lines)])."""
    rid = links._name(link.get('id'))
    deleted = set(edits.get('deleted') or {})
    acts = sorted(links._plain_acts(link, deleted), key=lambda a: float(a.get('delay') or 0))
    reqs = conditions.check(link.get('requires'), limit=conditions.MAX_CONDITIONS)
    say = _say(link)
    groups = {}
    for a in acts:
        fields = links.act_string(a).split('|')
        call = ('Act(%s);' % ', '.join(_uc(f) for f in _trimmed(fields[1:6]))) if len(fields) == 6 \
            else 'ActEncoded(%s);' % _uc('0|' + '|'.join(fields[1:]))
        groups.setdefault(float(fields[0] or 0), []).append(call)
    last = max(groups)
    body = ['// %s: %s' % (rid, say), 'function %s()' % rid, '{']
    if last > 0:                                 # as the rule: set off again while it still runs, it lets it go
        body += ['\tif (Level.TimeSeconds < %sUntil)    // still doing it' % rid, '\t\treturn;']
    for c in reqs:
        body += ['\tif (!Holds(%s))' % _uc(conditions.encode(c)), '\t\treturn;']
    if link.get('once'):
        body += ['\tif (b%sDone)        // only the first time' % rid, '\t\treturn;', '\tb%sDone = True;' % rid]
    if last > 0:
        body.append('\t%sUntil = Level.TimeSeconds + %s;' % (rid, _float(last)))
    steps = []
    for delay in sorted(groups):
        if delay <= 0:
            body += ['\t' + line for line in groups[delay]]
            continue
        label = '%s_%d' % (rid, len(later) + len(steps) + 1)
        body.append('\tAfter(%s, \'%s\');    // %g s after it was set off' % (_float(delay), label, delay))
        steps.append((label, groups[delay]))
    body.append('}')
    later.extend(steps)
    return body


def _say(link):
    """the rule's sentence (its label, or its object and cause)"""
    return links._text(link.get('label') or '%s %s' % (link.get('src') or 'the player', link.get('when')))


def _float(v):
    s = '%g' % v
    return s if '.' in s or 'e' in s else s + '.0'


def _trimmed(fields):
    """verb, target, a, b, c without the empty values at the end (Act's are optional)"""
    out = list(fields)
    while len(out) > 1 and out[-1] == '':
        out.pop()
    return out


def script_of(edits, rule_ids, name, map_name=''):
    """The script's text for these rules (in their order), the ids it does, and the ones it cannot (with why)."""
    if not NAME.match(str(name or '')):
        raise ValueError('A script name has letters, digits and _ only, starts with a letter, 2 to 41 characters.')
    edits = logicpatterns.expand(edits if isinstance(edits, dict) else {})
    by_id = {str(l.get('id')): l for l in edits.get('links') or [] if isinstance(l, dict)}
    done, refused, funcs, later = [], [], [], []
    for rid in rule_ids or []:
        link = by_id.get(str(rid))
        why = 'there is no such rule' if link is None else refusal(link, edits)
        if not why and len(done) >= MAX_RULES:
            why = 'a script does at most %d rules' % MAX_RULES
        if why:
            refused.append(dict(id=str(rid), why=why))
            continue
        try:
            code = _rule_code(link, edits, later)
        except ValueError as exc:
            refused.append(dict(id=str(rid), why=str(exc)))
            continue
        funcs.append(code)
        done.append(links._name(link.get('id')))
    if not done:
        return dict(text='', rules=[], refused=refused)
    if len(later) > MAX_LATER:
        raise ValueError('These rules wait for %d different times: a script waits for at most %d at once.' % (len(later), MAX_LATER))
    out = ['// %s: made by Turn into script from the rule%s %s%s.' % (name, '' if len(done) == 1 else 's', ', '.join(done),
                                                                      ' of the map %s' % map_name if map_name else ''),
           '// Each rule\'s cause is still a rule, which calls the input of its name here; what the rule did is below.',
           '// Back to rules (the Logic window, the script selected) puts the rules back as they were.',
           'class %s extends UCScript;' % name, '']
    onces = [r for r in done if by_id[r].get('once')]
    runs = sorted({label.rsplit('_', 1)[0] for label, _lines in later}, key=done.index)
    for r in onces:
        out.append('var bool b%sDone;        // it was done once' % r)
    for r in runs:
        out.append('var float %sUntil;       // when it has done all it does' % r)
    if onces or runs:
        out.append('')
    out += ['function Input(string InputName, string Args, Actor Caller)', '{', '\tswitch (InputName)', '\t{']
    for r in done:
        out += ['\tcase "%s":' % r, '\t\t%s();' % r, '\t\tbreak;']
    out += ['\tdefault:', '\t\tSuper.Input(InputName, Args, Caller);', '\t}', '}', '']
    for f in funcs:
        out += f + ['']
    if later:
        out += ['// what the rules did later: After(seconds, label) calls it then', 'function Step(name Label)', '{',
                '\tswitch (Label)', '\t{']
        for label, lines in later:
            out += ['\tcase \'%s\':' % label] + ['\t\t' + line for line in lines] + ['\t\tbreak;']
        out += ['\t}', '}', '']
    out += ['defaultproperties', '{']
    for i, r in enumerate(done):
        out.append('\tInputs(%d)=(Id="%s",Label="Do what %s did")' % (i, r, r))     # its cause is the rule that calls it
    out += ['}', '']
    return dict(text='\n'.join(out), rules=done, refused=refused)


def free_name(stem='RulesScript'):
    """A script name not taken yet: RulesScript, RulesScript2..."""
    import scripts
    taken = {n.lower() for n in scripts.names(generated=True)}
    stem = stem if NAME.match(stem) else 'RulesScript'
    name, n = stem, 1
    while name.lower() in taken:
        n += 1
        name = '%s%d' % (stem, n)
    return name


def write(edits, rule_ids, name, map_name='', preview=False):
    """Turn into script for the editor (POST /api/logic/to_script): the script's text and, unless it is a preview,
    the script saved as a new one of Tools > Scripts (its name must be free). The page compiles it, then changes the
    rules (one undoable step)."""
    import scripts
    import settings
    name = str(name or '').strip() or free_name()
    if not preview:
        if any(n.lower() == name.lower() for n in scripts.names(generated=True)):
            raise ValueError('There is a script called %s already: choose another name.' % name)
        if name.lower() in ('ucscript', settings.PACKAGE.lower(), scripts.PACKAGE.lower()):
            raise ValueError('Choose another name: %s is taken.' % name)
    out = script_of(edits, rule_ids, name, map_name)
    if not out['rules']:
        return dict(out, name=name, saved=False)
    if not preview:
        scripts.save(name, out['text'])
    return dict(out, name=name, cls='%s.%s' % (scripts.PACKAGE, name), saved=not preview)
