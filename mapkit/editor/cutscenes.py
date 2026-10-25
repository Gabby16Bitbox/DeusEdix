"""Cutscenes made in the map editor: a "Cutscene camera" (a UCCutscene actor of the editor's package) and its timeline,
like the camera paths of Premiere or of the Minecraft film mods. The camera flies through keys (where it is,
where it looks, its roll and its zoom), each with a curve to the next one, cut into shots; subtitles, a fade
from and to black, the black bars of a film. Interactions play it ("Play the cutscene") and act during it
("When it starts", each action after its seconds) or after it ("When it has ended"); a Story event or
dialogue can play it too.

edits['cutscenes'] = {'<UCCutscene actor name>': {
    'title': 'Arrival on the roof',
    'keys': [{'t': seconds, 'p': [x, y, z] (where the eyes are), 'r': [pitch, yaw, roll] (65536 = a turn; the
              yaw does not wrap: the camera turns the short way the editor chose), 'fov': degrees across the
              width, 'e': at this key (1 smooth: passes through at its speed, 2 stop: slows down to it, 0 linear:
              straight to the next at the same speed, 4 hold: stays until the next key, then jumps), 's': shot}],
    'straight': False (straight lines between the keys, else a smooth path through them),
    'look': '' (the name of an actor the camera always looks at),
    'lines': [{'t': seconds, 'd': seconds (0: as long as the text needs), 'who': 'Jock', 'text': '...',
               'snd': 'Package.Sound' or ''}],
    'fadeIn': 0.5, 'fadeOut': 0.5, 'bars': True, 'skip': True, 'once': True, 'autoplay': False, 'showJC': True,
    'length': 0 (seconds; 0 or less than its keys and lines: until the last of them)}}

In the game (src/<settings.PACKAGE>/Classes/UCCutscene.uc) the values are the actor's own properties.
"""
import gametext

MAX_KEYS = 48
MAX_LINES = 24


def _text(s):
    """A text the game shows (gametext.plain), with no double quotes or line breaks (they end the value). Written
    into the T3D through _quoted."""
    return gametext.plain(str(s or '').replace('\r', ' ').replace('\n', ' ')).replace('"', "'")


def _quoted(s):
    """A string property of the T3D: in quotes, its backslashes as the engine's reader takes them (gametext.t3d)."""
    return '"%s"' % gametext.t3d(s)


def line_len(ln):
    d = float(ln.get('d') or 0)
    return d if d > 0 else 2.0 + len(str(ln.get('text') or '')) * 0.06


def keys_of(c):
    keys = [k for k in (c.get('keys') or []) if isinstance(k, dict) and 't' in k and len(k.get('p') or []) == 3]
    keys.sort(key=lambda k: (int(k.get('s') or 0), float(k['t'])))
    return keys[:MAX_KEYS]


def lines_of(c):
    lines = [ln for ln in (c.get('lines') or []) if isinstance(ln, dict) and str(ln.get('text') or '').strip()]
    lines.sort(key=lambda ln: float(ln.get('t') or 0))
    return lines[:MAX_LINES]


def length(c):
    ends = [float(k['t']) for k in keys_of(c)] + [float(ln.get('t') or 0) + line_len(ln) for ln in lines_of(c)]
    return max([float(c.get('length') or 0), 0.5] + ends)


def props(edits, name):
    """The properties of the UCCutscene actor `name` (added to the ones it was placed with)."""
    c = (edits.get('cutscenes') or {}).get(name)
    if not isinstance(c, dict):
        return {}
    out = {'CutName': _quoted(_text(c.get('title') or name))}
    keys = keys_of(c)
    for i, k in enumerate(keys):
        p, r = k['p'], (list(k.get('r') or [0, 0, 0]) + [0, 0, 0])[:3]
        out['KeyT(%d)' % i] = '%.4f' % float(k['t'])
        out['KeyP(%d)' % i] = '(X=%.2f,Y=%.2f,Z=%.2f)' % tuple(float(v) for v in p)
        out['KeyR(%d)' % i] = '(Pitch=%d,Yaw=%d,Roll=%d)' % tuple(int(round(float(v))) for v in r)
        out['KeyF(%d)' % i] = '%.3f' % max(5.0, min(170.0, float(k.get('fov') or 75)))
        out['KeyE(%d)' % i] = str(max(0, min(4, int(k.get('e', 1)))))
        out['KeyS(%d)' % i] = str(max(0, min(255, int(k.get('s') or 0))))
    out['NumKeys'] = str(len(keys))
    if c.get('straight'):
        out['bStraight'] = 'True'
    if str(c.get('look') or '').strip():
        out['LookAt'] = _quoted(_text(c['look']).strip())
    lines = lines_of(c)
    for i, ln in enumerate(lines):
        out['LineT(%d)' % i] = '%.3f' % float(ln.get('t') or 0)
        out['LineD(%d)' % i] = '%.3f' % float(ln.get('d') or 0)
        out['LineWho(%d)' % i] = _quoted(_text(ln.get('who')))
        out['LineText(%d)' % i] = _quoted(_text(ln.get('text')))
        if ln.get('snd'):
            out['LineSnd(%d)' % i] = _quoted(_text(ln['snd']))
    out['NumLines'] = str(len(lines))
    out['Length'] = '%.3f' % length(c)
    out['FadeIn'] = '%.3f' % max(0.0, float(c.get('fadeIn', 0.5) or 0))
    out['FadeOut'] = '%.3f' % max(0.0, float(c.get('fadeOut', 0.5) or 0))
    for key, prop, default in (('bars', 'bBars', True), ('skip', 'bSkippable', True), ('once', 'bOnce', True),
                               ('autoplay', 'bAutoPlay', False), ('showJC', 'bShowJC', True)):
        out[prop] = 'True' if c.get(key, default) else 'False'
    return out


def report(edits):
    added = {a['name'] for a in edits.get('added') or [] if str(a.get('cls', '')).endswith('UCCutscene')}
    lines = []
    for n, c in sorted((edits.get('cutscenes') or {}).items()):
        if n not in added or not isinstance(c, dict):
            continue
        shots = len({int(k.get('s') or 0) for k in keys_of(c)})
        lines.append('  EDIT cutscene %s "%s": %.1f s, %d keys, %d shots, %d lines%s' % (
            n, _text(c.get('title') or n), length(c), len(keys_of(c)), shots, len(lines_of(c)),
            ', at the start' if c.get('autoplay') else ''))
    return lines
