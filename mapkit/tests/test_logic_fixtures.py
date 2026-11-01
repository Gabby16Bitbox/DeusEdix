"""The behaviour fixtures of the level logic (tests/fixtures/logic, its README.md): scenarios of today's rule runtime
(UCLink), the outputs fired in and the logic-log lines expected out. They are the ground truth of the Logic
simulator, of these checks and of the in-game golden-log run. Checked here: every fixture has the agreed shape, its
edits compile with links.py into exactly the actors it assumes, its world and inputs fit those edits and the
editor's catalogue, its expected lines agree with the compiled rules, and the code it is derived from still says
so. tests/test_logic_fixtures.mjs reads the same lines with the page's logic-log.js."""
import json
import re
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(KIT), str(KIT / 'editor')]
import links  # noqa: E402
import logic_catalog  # noqa: E402

FOLDER = Path(__file__).resolve().parent / 'fixtures' / 'logic'
README = FOLDER / 'README.md'
SOURCES = (KIT / 'project-template' / 'src' / 'DeusEdix' / 'Classes', KIT / 'editor')     # where derivedFrom's files are
NUMBER = (int, float)
MS = 0.001                                      # times agree to the millisecond (README, "The clock")

# The agreed shape (README, "Format"): each part's keys and their types, required and optional.
FIXTURE = ({'id': str, 'title': str, 'behaviour': str, 'derivedFrom': list, 'assumes': list, 'map': str,
            'frame': NUMBER, 'until': NUMBER, 'edits': dict, 'world': dict, 'start': dict, 'inputs': list,
            'expected': list, 'compiled': list}, {'end': dict})
SOURCE = ({'file': str, 'lines': list, 'has': str}, {})
WORLD = ({'player': str, 'actors': list}, {})
ACTOR = ({'name': str, 'chain': list}, {'at': list, 'tag': str, 'absent': str, 'seconds': NUMBER, 'ports': dict,
                                         'script': dict})
SCRIPT = ({}, {'input': dict, 'started': list, 'loading': list})
STATE = ({}, {'flags': dict, 'counters': dict, 'items': list, 'credits': int, 'skills': dict, 'dead': list,
              'owned': list, 'jc': list})
CHANGE = ({}, dict(STATE[1], missing=list))     # an input's set: the state, and actors gone since
FIRE = ({'thing': str, 'output': str, 'by': str}, {'option': int, 'port': str})
COMPILED = ({'cls': str, 'name': str, 'loc': list, 'props': dict}, {})
ABSENT = ('deleted', 'disabled', 'missing')
ASSUMPTION = re.compile(r'^- `(A\d+)`', re.M)


def fixtures():
    return [json.loads(p.read_text(encoding='utf-8')) for p in sorted(FOLDER.glob('*.json'))]


def entries(fx):
    """The expected lines as (t, line), an anyOrder group's lines one by one."""
    return [(e['t'], line) for e in fx['expected'] for line in e.get('anyOrder') or [e['line']]]


def unquoted(value):
    """A string property of the compiled actors as the game reads it: gametext.t3d undone (a doubled backslash is
    one, a backslash and 22 a quote)."""
    if not value.startswith('"'):
        return value
    return re.sub(r'\\(\\|22)', lambda m: '\\' if m.group(1) == '\\' else '"', value[1:-1])


def rules(fx):
    """The compiled rules: {rule id: {'source', 'when', 'label', 'once', 'conds', 'acts': [fields of each Act]}}."""
    out = {}
    for a in fx['compiled']:
        if a['cls'] == 'UCLink':
            p = a['props']
            out[unquoted(p['Rule'])] = dict(
                source=unquoted(p.get('Source', '""')), when=p['When'], label=unquoted(p['Label']),
                once=p.get('bOnce') == 'True', conds=[unquoted(v) for k, v in p.items() if k.startswith('Cond(')],
                acts=[unquoted(v).split('|') for k, v in p.items() if k.startswith('Act(')])
    return out


def field(fields, i):
    return fields[i] if i < len(fields) else ''


def acts_of_line(rule, verb, target, detail):
    """The rule's actions an act line can come from: the action itself, the first line of an action on an area or
    a tag ('area light', 'tag red', no detail), or one of the objects it reached (UCLink.RunRecipients)."""
    found = []
    for f in rule['acts']:
        if field(f, 1) != verb:
            continue
        spread = field(f, 6)
        if spread in ('group', 'area+') and detail is None and target == 'area ' + field(f, 7):
            found.append(f)
        elif spread == 'tag' and detail is None and target == 'tag ' + field(f, 7):
            found.append(f)
        elif spread in ('group', 'area+', 'tag') and detail == field(f, 3) and not re.match(r'(area|tag) ', target):
            found.append(f)
        elif not spread and target == field(f, 2) and detail == field(f, 3):
            found.append(f)
    return found


class Shape(unittest.TestCase):
    def check(self, value, shape, where):
        required, optional = shape
        self.assertIsInstance(value, dict, where)
        for key, kind in required.items():
            self.assertIn(key, value, '%s: %s is missing' % (where, key))
        for key, v in value.items():
            kind = required.get(key) or optional.get(key)
            self.assertIsNotNone(kind, '%s: unknown key %s' % (where, key))
            self.assertIsInstance(v, kind, '%s: %s' % (where, key))
            self.assertFalse(isinstance(v, bool) and kind in (NUMBER, int),
                             '%s: %s is a number, not true/false' % (where, key))

    def test_enough_fixtures_one_per_file(self):
        found = fixtures()
        self.assertGreaterEqual(len(found), 25)
        self.assertEqual([fx['id'] for fx in found], sorted(p.stem for p in FOLDER.glob('*.json')))

    def test_every_part_has_its_shape(self):
        for fx in fixtures():
            where = fx.get('id', '?')
            self.check(fx, FIXTURE, where)
            for ref in fx['derivedFrom']:
                self.check(ref, SOURCE, where + ' derivedFrom')
            self.assertTrue(fx['derivedFrom'], where + ': derived from no code')
            self.check(fx['world'], WORLD, where + ' world')
            for a in fx['world']['actors']:
                self.check(a, ACTOR, '%s actor %s' % (where, a.get('name')))
                if 'absent' in a:
                    self.assertIn(a['absent'], ABSENT, where)
                self.check(a.get('script', {}), SCRIPT, where + ' script')
            self.check(fx['start'], STATE, where + ' start')
            self.check(fx.get('end', {}), STATE, where + ' end')
            for i in fx['inputs']:
                self.assertIsInstance(i.get('t'), NUMBER, where)
                self.assertEqual(len(i), 2, '%s: an input is {t, fire} or {t, set}: %s' % (where, i))
                if 'fire' in i:
                    self.check(i['fire'], FIRE, where + ' fire')
                else:
                    self.check(i['set'], CHANGE, where + ' set')
            for e in fx['expected']:
                self.assertIsInstance(e.get('t'), NUMBER, where)
                self.assertTrue(isinstance(e.get('line'), str) != isinstance(e.get('anyOrder'), list), where)
                self.assertEqual(len(e), 2, where)
            for a in fx['compiled']:
                self.check(a, COMPILED, where + ' compiled')

    def test_times_are_ticks_in_order(self):
        for fx in fixtures():
            frame = fx['frame']
            self.assertGreater(frame, 0)
            for name, times in (('inputs', [i['t'] for i in fx['inputs']]), ('expected', [t for t, _ in entries(fx)])):
                self.assertEqual(times, sorted(times), '%s: %s out of time order' % (fx['id'], name))
                for t in times:
                    self.assertTrue(0 <= t <= fx['until'] + MS, '%s: %s at %s, after until' % (fx['id'], name, t))
                    self.assertAlmostEqual(t / frame, round(t / frame), delta=MS / frame, msg='%s: %s is not a tick' % (fx['id'], t))


class Compiled(unittest.TestCase):
    def test_the_edits_compile_into_the_actors_the_fixture_assumes(self):
        for fx in fixtures():
            built = json.loads(json.dumps(links.blocks(fx['edits'])))
            self.assertEqual(built, fx['compiled'], '%s: links.blocks gives other actors' % fx['id'])

    def test_the_world_holds_what_the_rules_name(self):
        for fx in fixtures():
            world = {a['name']: a for a in fx['world']['actors']}
            self.assertEqual(len(world), len(fx['world']['actors']), '%s: two actors with one name' % fx['id'])
            edits = fx['edits']
            for name, a in world.items():
                self.assertEqual(a['chain'][-1], 'Actor', '%s: %s chain' % (fx['id'], name))
                absent = a.get('absent')
                self.assertEqual(absent == 'deleted', name in (edits.get('deleted') or {}), '%s: %s deleted' % (fx['id'], name))
                self.assertEqual(absent == 'disabled', (edits.get('disabled') or {}).get(name) is True, '%s: %s disabled' % (fx['id'], name))
            for link in edits['links']:
                named = [link['src']] + [a['target'] for a in link['do']]
                for name in filter(None, named):
                    self.assertIn(name, world, '%s: rule %s names %s, not in the world' % (fx['id'], link['id'], name))
            for name, entry in (edits.get('objectTags') or {}).items():      # a manual tag is the one the game gives
                if entry['mode'] == 'manual':
                    self.assertEqual(world[name].get('tag'), entry['value'], '%s: %s tag' % (fx['id'], name))

    def test_inputs_fire_outputs_the_thing_offers(self):
        for fx in fixtures():
            world = {a['name']: a for a in fx['world']['actors']}
            for i in fx['inputs']:
                f = i.get('fire')
                if not f:
                    continue
                self.assertIn(f['thing'], world, fx['id'])
                thing = world[f['thing']]
                offered = logic_catalog.io_for(thing['chain'], thing.get('ports'))['outputs']
                output = 'output:' + f['port'] if f['output'] == 'output' else f['output']
                self.assertIn(output, offered, '%s: %s does not offer %s' % (fx['id'], f['thing'], output))
                self.assertEqual('option' in f, f['output'] == 'option', fx['id'])
                self.assertEqual('port' in f, f['output'] == 'output', fx['id'])


class ExpectedLines(unittest.TestCase):
    def test_lines_agree_with_the_compiled_rules(self):
        for fx in fixtures():
            found = rules(fx)
            for t, line in entries(fx):
                kind, *f = line.split('|')
                where = '%s at %s: %s' % (fx['id'], t, line)
                self.assertEqual(f[0], fx['map'], where)
                if kind not in ('fire', 'skip', 'act', 'fail', 'hook') or (kind == 'fail' and f[1] == ''):
                    continue                    # a script's own line (input, output, noinput, a lost output)
                self.assertIn(f[1], found, where)
                rule = found[f[1]]
                if kind == 'fire':
                    self.assertEqual(f[2:4], [rule['source'], rule['when']], where)
                    self.assertEqual('|'.join(f[5:]), rule['label'], where)
                elif kind == 'hook':
                    self.assertEqual(f[2], rule['source'], where)
                elif kind == 'skip':
                    self.assertIn(f[2], ('once', 'running', 'cond'), where)
                    if f[2] == 'cond':
                        self.assertIn('|'.join(f[3:]), rule['conds'], where)
                    else:
                        self.assertEqual(f[3:], [''], where)
                    if f[2] == 'once':
                        self.assertTrue(rule['once'], where)
                elif kind == 'act':
                    detail = '|'.join(f[4:]) if len(f) > 4 else None
                    self.assertTrue(acts_of_line(rule, f[2], f[3], detail), where + ': no such action')
                else:
                    self.assertTrue(any(field(a, 1) == f[2] for a in rule['acts']), where + ': no such action')

    def test_an_action_runs_its_delay_after_its_rule_started(self):
        # README, "The clock" 4: the action with delay d runs d after the rule's first turn, the tick it fired in or
        # the next one
        for fx in fixtures():
            found, fired = rules(fx), {}
            for t, line in entries(fx):
                kind, _, rule, *f = line.split('|')
                if kind == 'fire':
                    fired[rule] = t
                elif kind == 'act':
                    detail = '|'.join(f[2:]) if len(f) > 2 else None
                    delays = {float(a[0]) for a in acts_of_line(found[rule], f[0], f[1], detail)}
                    self.assertIn(rule, fired, '%s: %s acts before it fired' % (fx['id'], line))
                    late = [round((t - fired[rule] - d) / fx['frame'], 6) for d in delays]
                    self.assertTrue(set(late) & {0.0, 1.0}, '%s at %s: %s is not its delay after the fire' % (fx['id'], t, line))

    def test_the_end_state_names_what_the_rules_set(self):
        for fx in fixtures():
            changed = {a.get('a') for link in fx['edits']['links'] for a in link['do'] if a['verb'] in ('count', 'flag')}
            for part in ('counters', 'flags'):
                for name in fx.get('end', {}).get(part, {}):
                    self.assertTrue(name in changed or name in fx['start'].get(part, {}) or any(
                        name in (i.get('set') or {}).get(part, {}) for i in fx['inputs']), '%s: %s' % (fx['id'], name))


class Sources(unittest.TestCase):
    def test_the_code_still_says_what_the_fixture_is_derived_from(self):
        for fx in fixtures():
            for ref in fx['derivedFrom']:
                path = next((folder / ref['file'] for folder in SOURCES if (folder / ref['file']).exists()), None)
                self.assertIsNotNone(path, '%s: no file %s' % (fx['id'], ref['file']))
                lines = path.read_bytes().decode('latin1').splitlines()
                a, b = ref['lines']
                if ref['has'] not in '\n'.join(lines[a - 1:b]):
                    now = [i + 1 for i, s in enumerate(lines) if ref['has'] in s]
                    self.fail('%s: %s:%d-%d no longer holds %r (now at lines %s): see what changed, then update the '
                              'fixture and its README row' % (fx['id'], ref['file'], a, b, ref['has'], now))

    def test_the_readme_lists_every_fixture_its_code_and_its_assumptions(self):
        text = README.read_text(encoding='utf-8')
        explained = set(ASSUMPTION.findall(text))
        for fx in fixtures():
            row = next((s for s in text.splitlines() if s.startswith('| `%s` |' % fx['id'])), None)
            self.assertIsNotNone(row, '%s is not in the README' % fx['id'])
            for ref in fx['derivedFrom']:
                a, b = ref['lines']
                self.assertIn('`%s:%s`' % (ref['file'], a if a == b else '%d-%d' % (a, b)), row, fx['id'])
            self.assertTrue(set(fx['assumes']) <= explained, '%s assumes %s' % (fx['id'], set(fx['assumes']) - explained))


if __name__ == '__main__':
    unittest.main()
