"""Rebuild requests add work; they never suppress work required by map edits.

Existing .dx maps can reuse their baked BSP, lighting and paths. Generated maps
start from their script every time, so their geometry cannot be reused safely.
Only fixed modes cross the process boundary; no engine command text is accepted.
"""
import os

MODES = ('auto', 'full', 'lighting', 'paths')
# The words of the Rebuild menu (menubar.js) for each mode, in every message that names one.
NAMES = {'auto': 'Automatic', 'full': 'Full', 'lighting': 'Lighting', 'paths': 'AI paths'}
ENV_MODE = 'DEUSEDIX_REBUILD_MODE'


def normalize(options=None):
    if options is None:
        return {'mode': 'auto'}
    if not isinstance(options, dict) or set(options) - {'mode'}:
        raise ValueError('Rebuild options must contain only a mode.')
    mode = options.get('mode', 'auto')
    if not isinstance(mode, str) or mode not in MODES:
        raise ValueError('Choose %s or %s.' % (', '.join(NAMES[m] for m in MODES[:-1]), NAMES[MODES[-1]]))
    return {'mode': mode}


def plan(options=None, *, geometry=False, lights=False, paths=False,
         keep_paths=False, inactive=False):
    """Merge a request with automatically detected work for an existing map."""
    mode = normalize(options)['mode']
    full = mode == 'full'
    force_paths = full or mode == 'paths'
    return {
        'geometry': bool(geometry or full),
        'lights': bool(lights or full or mode == 'lighting'),
        'paths': bool((paths or force_paths) and (not keep_paths or inactive or force_paths)),
    }


def script_environment(options=None, base_env=None):
    """Fresh per-child environment; the server's process is never mutated."""
    env = dict(os.environ if base_env is None else base_env)
    env[ENV_MODE] = normalize(options)['mode']
    return env


def script_stages(light=True, paths=True, env=None):
    """A script always recreates geometry. Requests may add its optional stages."""
    mode = (os.environ if env is None else env).get(ENV_MODE, 'auto')
    options = normalize({'mode': mode})
    return plan(options, geometry=True, lights=light, paths=paths)


def report(options=None, *, generated=False):
    """A build's line for a forced mode, named as the Rebuild menu names it (NAMES); none in Automatic."""
    mode = normalize(options)['mode']
    if mode == 'auto':
        return []
    if generated:
        return ['  REBUILD Generated maps recreate their geometry on every build; the stages a Rebuild in %s adds '
                'are included.' % NAMES[mode]]
    detail = {'full': 'geometry, BSP, lighting and AI paths', 'lighting': 'lighting', 'paths': 'AI paths'}[mode]
    return ['  REBUILD A Rebuild in %s forces %s, including unchanged data; required edits are also rebuilt.'
            % (NAMES[mode], detail)]
