"""Behaviours of the characters and how the player moves (the Inspector's Tactics and Player movement).

edits['behave'][<character>] = {loc, grenades: {cls, above, range, every}, jump: {max}, dodge: {chance, speed, every}}
  -> a UCBehave actor of the mod per character (PawnName = the character), which throws grenades at a player
     above it, jumps over low obstacles and dodges when shot at, on top of the game's AI.
edits['player_move'] = {loc, air, air_if, jump_if, aug, skill, level}
  -> one UCPlayerMove: JC's air control, and other values while an aug is on or a skill is high enough.
The characters' own movement values (jump, step, speed, air control) are ordinary properties (edits['props']).
"""
import re

GRENADES = ('GasGrenade', 'LAM', 'EMPGrenade', 'NanoVirusGrenade')
AUGS = ('AugStealth', 'AugSpeed', 'AugMuscle', 'AugCloak', 'AugBallistic', 'AugCombat', 'AugDefense',
        'AugEnviro', 'AugHealing', 'AugHeartLung', 'AugPower', 'AugRadarTrans', 'AugShield', 'AugTarget',
        'AugVision', 'AugAqualung', 'AugEMP', 'AugLight', 'AugDrone')
SKILLS = ('SkillSwimming', 'SkillEnviro', 'SkillWeaponPistol', 'SkillWeaponRifle', 'SkillWeaponHeavy',
          'SkillWeaponLowTech', 'SkillDemolition', 'SkillMedicine', 'SkillComputer', 'SkillLockpicking', 'SkillTech')


def _num(v, lo, hi, default):
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return default


def _loc(e):
    loc = e.get('loc') or [0, 0, 0]
    return [float(x) for x in loc[:3]] if len(loc) >= 3 else [0.0, 0.0, 0.0]


def blocks(edits):
    """The UCBehave and UCPlayerMove actors of the map: [{'cls', 'name', 'loc', 'props'}], like edits['added']."""
    out = []
    deleted = edits.get('deleted') or {}
    for name, e in sorted((edits.get('behave') or {}).items()):
        if not re.fullmatch(r'\w+', name) or not isinstance(e, dict) or name in deleted:
            continue
        props = {}
        g = e.get('grenades')
        if isinstance(g, dict):
            cls = g.get('cls') if g.get('cls') in GRENADES else GRENADES[0]
            props.update(bGrenades='True', GrenadeClass='"DeusEx.%s"' % cls,
                         GrenadeAbove='%.6f' % _num(g.get('above'), 16, 2000, 96),
                         GrenadeRange='%.6f' % _num(g.get('range'), 100, 5000, 900),
                         GrenadeEvery='%.6f' % _num(g.get('every'), 1, 120, 6))
        j = e.get('jump')
        if isinstance(j, dict):
            props.update(bJumpObstacles='True', JumpMax='%.6f' % _num(j.get('max'), 20, 200, 56))
        d = e.get('dodge')
        if isinstance(d, dict):
            props.update(bDodge='True', DodgeChance='%.6f' % _num(d.get('chance'), 0.05, 1, 0.5),
                         DodgeSpeed='%.6f' % _num(d.get('speed'), 100, 1500, 420),
                         DodgeEvery='%.6f' % _num(d.get('every'), 0.5, 60, 2.5))
        if props:
            props['PawnName'] = name
            out.append(dict(cls='UCBehave', name='UCBehave_' + name, loc=_loc(e), props=props))
    m = edits.get('player_move')
    if isinstance(m, dict):
        props = {}
        if m.get('air') is not None and m.get('air') != '':
            props['AirControlNormal'] = '%.6f' % _num(m['air'], 0, 1, 0.05)
        cond = False
        if m.get('aug') in AUGS:
            props['AugName'] = '"%s"' % m['aug']
            cond = True
        elif m.get('skill') in SKILLS:
            props['SkillName'] = '"%s"' % m['skill']
            props['SkillLevel'] = str(int(_num(m.get('level'), 0, 3, 1)))
            cond = True
        if cond and m.get('air_if') is not None and m.get('air_if') != '':
            props['AirControlIf'] = '%.6f' % _num(m['air_if'], 0, 1, 0.05)
        if cond and m.get('jump_if'):
            props['JumpIf'] = '%.6f' % _num(m['jump_if'], 0.2, 5, 1)
        if props:
            out.append(dict(cls='UCPlayerMove', name='UCPlayerMove', loc=_loc(m), props=props))
    return out


def report(edits):
    lines = []
    for a in blocks(edits):
        p = a['props']
        if a['cls'] == 'UCBehave':
            what = [w for k, w in (('bGrenades', 'throws grenades from below'), ('bJumpObstacles', 'jumps over obstacles'),
                                   ('bDodge', 'dodges')) if k in p]
            lines.append('  EDIT behaviours %s: %s' % (p['PawnName'], ', '.join(what)))
        else:
            lines.append('  EDIT player movement (%s)' % ', '.join('%s=%s' % kv for kv in sorted(p.items())))
    return lines
