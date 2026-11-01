"""Opt-in local build acceleration experiment; defaults remain stock.

The request pins both switches. This module performs no native import, GPU work,
startup or probing at import time. A worker must receive the same configuration
as its request. Certificates and no-Full command guards remain mandatory.
"""
import os

ACCELERATION = 'DEUSEDIX_LOCAL_BUILD_ACCELERATION'
PREWARM = 'DEUSEDIX_LOCAL_BUILD_PREWARM'
MODES = ('off', 'verify', 'auto', 'gpu')


def validate(options):
    if not isinstance(options, dict) or set(options) != {'acceleration', 'prewarm'}:
        raise ValueError('Invalid local build performance options.')
    if options['acceleration'] not in MODES or type(options['prewarm']) is not bool:
        raise ValueError('Unsupported local build performance mode.')
    return dict(options)


def options(env=None):
    env = os.environ if env is None else env
    prewarm = env.get(PREWARM, 'off')
    if prewarm not in ('off', 'on'):
        raise ValueError('Local build prewarm must be off or on.')
    return validate(dict(acceleration=env.get(ACCELERATION, 'off'), prewarm=prewarm == 'on'))


def environment(config, base=None):
    config = validate(config)
    env = dict(os.environ if base is None else base)
    env[ACCELERATION] = config['acceleration']
    env[PREWARM] = 'on' if config['prewarm'] else 'off'
    return env


def prewarm_enabled():
    return options()['prewarm']


def check_native(path, config):
    """Do not silently pretend an older executable supports the new switches."""
    config = validate(config)
    if config['acceleration'] != 'off':
        if b'UCMapKit|local acceleration capability|1' not in path.read_bytes():
            raise ValueError('Local acceleration needs the experimental host to be compiled first. '
                             'No map was rebuilt; use acceleration=off for the existing host.')
