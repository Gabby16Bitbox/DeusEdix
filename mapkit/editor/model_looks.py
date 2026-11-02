"""Humanoid body templates and usable character looks; no actor/mission identity changes."""
import functools
from pathlib import Path
import re
from urllib.parse import urlsplit

import characters
import data


def _available(url):
    path = urlsplit(str(url or '')).path
    if not path.startswith('/cache/'):
        return False
    relative = Path(path[len('/cache/'):])
    if relative.is_absolute() or '..' in relative.parts:
        return False
    return data.cache_file(relative).is_file()


def usable(person, catalog):
    skins = person.get('skins')
    body = catalog['bodies'].get(person.get('body'))
    if not body or not isinstance(skins, list) or len(skins) != 8:
        return False
    visible = [t for t in skins if not characters._hidden(t)]
    return bool(visible) and all(_available(catalog['textures'].get(t)) for t in visible)


def bodies(log=print):
    catalog = characters.catalog(log=log)
    result = {}
    for key, body in catalog['bodies'].items():
        people = [p for p in catalog['people'] if p['body'] == key and usable(p, catalog)]
        if not people:
            continue
        preferred = [body.get('lookBody')] + list(characters.PREFERRED)
        people.sort(key=lambda p: (p['cls'] not in preferred, preferred.index(p['cls']) if p['cls'] in preferred else 999, p['name'].casefold(), p['cls']))
        source = people[0]
        actor = dict(cls='UCCustomCivilian', lookBody='%s.%s' % (body.get('lookPkg') or 'DeusEx', body['lookBody']),
                     radius=body['radius'], height=body['height'], scale=body.get('drawScale') or 1)
        result[body['mesh']] = dict(body=key, label=body['label'], mesh=body['mesh'], default=source['cls'], actor=actor,
            looks=[dict(id=p['cls'], name=p['name'], skins=p['skins'], pkg=p['pkg']) for p in people])
    return result


def describe(meshes, log=print):
    templates = bodies(log)
    living = {c['cls']: c for c in data.catalog(log=log)
              if c.get('mesh') and c.get('cat') == 'Characters' and not re.search(r'carcass|corpse', c['cls'], re.I)}
    result = []
    for model in meshes:
        model = dict(model)
        family = re.sub(r'_Carcass[BC]?$', '', model['mesh'])
        template = templates.get(family)
        if template:
            model.update(label=template['label'], used=template['default'], body=template['body'],
                look_count=len(template['looks']), look_names=[word for p in template['looks'] for word in (p['id'], p['name'])])
            if family != model['mesh']:
                model['hidden'] = True      # retained for existing placements; one live template in the browser
        elif model['pkg'] == 'DeusExCharacters' and re.match(r'G[MF]M?K?_', model['mesh'].split('.')[-1]):
            model['hidden'] = True          # no verified look: do not advertise an unusable grey template
        # A mesh alone has no AI. Only verified living game bodies get a pawn
        # type; a dead body's family can share skins without becoming alive.
        model.pop('character', None)
        if not re.search(r'carcass|corpse', model['mesh'], re.I):
            if template:
                model['character'] = template['actor']
            elif model.get('used') in living and living[model['used']]['mesh'] == model['mesh']:
                c = living[model['used']]
                model['character'] = dict(cls=c['cls'], radius=c['radius'], height=c['height'], scale=c.get('scale') or 1)
        result.append(model)
    return result


def visual_props(mesh, look):
    return {'Mesh': "LodMesh'%s'" % mesh, 'Skin': 'None', **{
        'MultiSkins(%d)' % i: "Texture'%s'" % value if value else 'None' for i, value in enumerate(look['skins'])}}


def appearances(meshes, log=print):
    templates = bodies(log)
    result = {}
    for model in meshes:
        family = re.sub(r'_Carcass[BC]?$', '', model['mesh'])
        template = templates.get(family)
        if not template:
            continue
        look = next(p for p in template['looks'] if p['id'] == template['default'])
        result[model['mesh']] = {key: value for key, value in visual_props(model['mesh'], look).items() if key != 'Mesh'}
    return result
