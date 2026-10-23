"""Logical scripting tags, without modifying native UE1 Tag/Event wiring."""
import re
COLOR_TAGS=[('red',0),('orange',21),('yellow',43),('green',85),('cyan',128),('blue',170),('purple',191),('magenta',213),('pink',234)]
NAME = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,63}$')
TAG_VERBS = {'open','close','toggle','lock','unlock','blow','attack','hostile','friend','neutral','stand','wander','follow','goto','run','leave','appear','lighton','lightoff','lighttoggle','hide','show','on','off'}

def value(raw, allow_empty=True):
    if not isinstance(raw,str) or (raw and not NAME.fullmatch(raw)) or (not raw and not allow_empty):
        raise ValueError('A scripting tag needs 1-64 letters, digits or underscores, starting with a letter or underscore.')
    return raw

def entries(edits):
    rows=edits.get('objectTags') or {}
    if not isinstance(rows,dict):raise ValueError('Invalid scripting tags.')
    result={}
    for name,entry in rows.items():
        if not isinstance(name,str) or not re.fullmatch(r'\w+',name) or not isinstance(entry,dict) or entry.get('mode') not in ('auto','manual','original'):
            raise ValueError('Invalid object scripting tag.')
        result[name]=dict(entry, value=value(entry.get('value'),False)) if entry['mode']=='manual' else {'mode':entry['mode']}
    return result

def validate(edits):
    entries(edits)
    for link in edits.get('links') or []:
        for action in link.get('do') or []:
            if action.get('targetTag'):
                value(action['targetTag'],False)
                if action.get('area') is not None or action.get('verb') not in TAG_VERBS:
                    raise ValueError('This action cannot target a scripting tag.')
            if isinstance(action.get('area'),dict):value(action['area'].get('tag',''))

def blocks(edits,excluded=()):
    return [dict(cls='UCObjectTag',name='UCTag_'+name,loc=[0,0,0],props={'TargetName':name,
                 'Value':'"'+entry.get('value','')+'"','bAuto':'True' if entry['mode']=='auto' else 'False',
                 'bOriginal':'True' if entry['mode']=='original' else 'False'})
            for name,entry in entries(edits).items() if name not in excluded]

def light_label(name,actor,edits):
    entry=(edits.get('objectTags') or {}).get(name)
    if entry and entry.get('mode')=='manual':return entry['value']
    p={**(actor.get('props') or {}),**(edits.get('props') or {}).get(name,{})}
    if not entry or entry.get('mode')=='original':
        tag=str(p.get('Tag',actor.get('tag',''))).strip('"')
        if tag and tag.lower() not in ('none',actor.get('cls','Light').split('.')[-1].lower()):return tag
    light=actor.get('light') or {}
    hue=max(0,min(255,float(p.get('LightHue',light.get('hue',0)))))
    saturation=float(p.get('LightSaturation',light.get('sat',255)))
    if saturation>=220:return 'white'
    return min(COLOR_TAGS,key=lambda item:min(abs(hue-item[1]),255-abs(hue-item[1])))[0]

def matching_lights(names,wanted,edits):
    if not wanted or not isinstance(names,dict):return set(names)
    return {name for name,actor in names.items() if light_label(name,actor,edits).lower()==wanted.lower()}

def from_text(text):
    import t3d
    result={}
    for actor in t3d.actors(text):
        if actor['cls'].split('.')[-1]!='UCObjectTag':continue
        p=actor['props'];name=p.get('TargetName','').strip('"')
        if not name:continue
        if p.get('bOriginal','').lower()=='true':entry={'mode':'original'}
        elif p.get('bAuto','').lower()=='true':entry={'mode':'auto'}
        else:entry={'mode':'manual','value':p.get('Value','').strip('"')}
        result[name]=entry
    return result

def with_baked(edits,text):
    return dict(edits,objectTags={**from_text(text),**(edits.get('objectTags') or {})})
