"""The code of the runtime classes' states that wait (Sleep, FinishAnim, MoveTo...), and how far it must not change.

A saved game keeps each actor in the middle of its state code: the place it waits at is an offset into that code's
bytecode. Loaded by a newer version of the class whose state code moved before that place, the game reads the wrong
bytes and stops with "Unknown code token" (measured 10 Nov 2026: a UCLink rule waiting in its Running state, a line
added at the top of Running, the save made before: Revision crashed on load; a new variable alone, or code added after
the last wait, loaded and ran on). So, once a version is released, a waiting state's code may only grow after its last
wait: everything up to it stays as it was. Functions (DoAct, DoStep...) may change freely: a save never waits inside
one.

`released.json` (tests/data/released_state_code.json) keeps that prefix of every waiting state of the template as the
last release had it; tests/test_state_code_saves.py compares. Regenerated at each release, from the released files:

    python state_code.py <released project-template folder> <version>     (writes tests/data/released_state_code.json)

The comparison is of the source (comments and blank lines aside), not of the bytecode: a change elsewhere that alters
what a line compiles to (a variable's type, a function's parameters) is not seen."""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
RELEASED = HERE / 'tests' / 'data' / 'released_state_code.json'
# the runtime classes a player's game can save: the template's own, and the original game's overlay of it.
# UCShotRunner waits only in DeusEdix's own test sessions (its live mode, photos), never in a player's game
FOLDERS = ('src/DeusEdix/Classes', 'vanilla/Classes')
SKIP = {'UCShotRunner'}
LATENT = re.compile(r'\b(Sleep|FinishAnim|FinishInterpolation|MoveTo|MoveToward|StrafeTo|StrafeFacing|TurnTo|TurnToward'
                    r'|WaitForLanding)\s*\(')
STATE = re.compile(r'^\s*(?:auto\s+|simulated\s+)*state\s*(?:\(\s*\))?\s+(\w+)', re.I)
LABEL = re.compile(r'^\s*(\w+)\s*:\s*$')


def _plain(line):
    """a line without its comment (// outside quotes) and spaces at its ends"""
    out, quoted = [], False
    for i, ch in enumerate(line):
        if ch == '"':
            quoted = not quoted
        elif not quoted and line.startswith('//', i):
            break
        out.append(ch)
    return ''.join(out).strip()


def states(text):
    """{state: [its code's lines from its first label to its end, plain, no blank ones]} of the states that wait"""
    found, lines, i = {}, text.replace('\r\n', '\n').split('\n'), 0
    while i < len(lines):
        m = STATE.match(lines[i])
        if not m:
            i += 1
            continue
        depth, opened, labelled, code = 0, False, False, []
        while i < len(lines):
            plain = _plain(lines[i])
            i += 1
            if depth == 1 and LABEL.match(plain):          # the state code starts at its first label
                labelled = True
            if labelled and plain:
                code.append(plain)
            depth += plain.count('{') - plain.count('}')
            opened = opened or '{' in plain
            if opened and depth <= 0:
                break
        if any(LATENT.search(c) for c in code):
            found[m.group(1)] = code
    return found


def frozen(code):
    """the part of a state's code that must not change: up to its last wait, included"""
    last = max(i for i, c in enumerate(code) if LATENT.search(c))
    return code[:last + 1]


def template_states(template):
    """{'Class.State': code} of every waiting state of a project-template folder (the vanilla overlay as 'vanilla/')"""
    out = {}
    for folder in FOLDERS:
        for f in sorted((Path(template) / folder).glob('*.uc')):
            if f.stem in SKIP:
                continue
            for name, code in states(f.read_text(encoding='latin1')).items():
                out[('vanilla/' if folder.startswith('vanilla') else '') + f.stem + '.' + name] = code
    return out


def write_released(template, version):
    data = {'version': version, 'states': {k: frozen(v) for k, v in template_states(template).items()}}
    RELEASED.parent.mkdir(exist_ok=True)
    RELEASED.write_bytes((json.dumps(data, indent=1) + '\n').encode('utf-8'))
    return data


if __name__ == '__main__':
    d = write_released(sys.argv[1], sys.argv[2])
    print(d['version'], {k: len(v) for k, v in d['states'].items()})
