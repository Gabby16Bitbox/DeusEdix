"""Conversion of local game conversations; no original content is bundled with the editor."""
import hashlib
import json
import re


def truth(p, key, default=False):
    return str(p.get(key, str(default))).lower() == 'true'


def conditions(items):
    return [dict(flag=f['flag'], **{'is': f['value']}, expiration=f.get('expiration', 0)) for f in items]


def convert(con, actor, package, disabled=False):
    p = con['properties']
    d = dict(id='original_' + hashlib.sha1(con['path'].encode()).hexdigest()[:12], title=con['name'],
             owner=actor or '@player', bind=con['owner'], replaces=con['name'], disabled=disabled,
             original=dict(path=con['path'], package=package), start='original', once=truth(p,'bdisplayonce'),
             requires=conditions(con['requires']), radius=int(p.get('radiusdistance', 0)),
             native={k: v for k,v in p.items() if k in ('bdatalinkcon','bfirstperson','bnoninteractive',
                 'brandomcamera','bcanbeinterrupted','bcannotbeinterrupted','binvokebump','binvokefrob',
                 'binvokesight','binvokeradius','radiusdistance')}, steps=[], conversionNotes=[])
    losses = []
    if disabled:
        return dict(dialogue=d, losses=[], notices=[])
    steps=d['steps']
    for e in con['events']:
        kind=e['type']; ep=e['properties']; step=None
        if e['label']:
            steps.append(dict(type='label', name=e['label']))
        if kind == 'Speech':
            step=dict(type='line', who=e['speaker'], to=e['speakingTo'], text=e['text'],
                      native={k:v for k,v in ep.items() if k in ('bcontinued','bshowitem','bplayanim','speechfont')})
            if e.get('sound'):
                step['voice']=dict(ref=e['sound'], package=package, text=e['text'], speaker=e['speaker'])
        elif kind == 'Choice':
            options=[]
            for c in e['choices']:
                option=dict(text=c['text'], goto=c['label'], requires=conditions(c['flags']),
                            skill=c['skill'], skillLevel=c['skillLevel'], displayAsSpeech=truth(c['properties'],'bdisplayasspeech'))
                if c.get('sound'):
                    option['voice']=dict(ref=c['sound'],package=package,text=c['text'],speaker='JCDenton')
                options.append(option)
            step=dict(type='choice',options=options,clearScreen=truth(ep,'bclearscreen'))
        elif kind in ('SetFlag','CheckFlag'):
            step=dict(type='flag' if kind=='SetFlag' else 'if', requires=conditions(e.get('flags',[])))
            if kind=='CheckFlag': step['goto']=ep.get('setlabel','')
        elif kind == 'Jump':
            step=dict(type='goto',label=ep.get('jumplabel',''))
            if ep.get('jumpcon') not in (None,'None',''):
                import gamecons
                step['conversation']=gamecons.ref(ep['jumpcon'])
        elif kind == 'AddGoal':
            step=dict(type='goal',goal=ep.get('goalname',''),text=ep.get('goaltext',''),done=truth(ep,'bgoalcompleted'),secondary=not truth(ep,'bprimarygoal'))
        elif kind == 'AddNote': step=dict(type='note',text=ep.get('notetext',''))
        elif kind == 'TransferObject':
            step=dict(type='give',item=ep.get('objectname',''),count=int(ep.get('transfercount',1)),
                      **{'from':ep.get('fromname',''),'to':ep.get('toname',''),'fail':ep.get('faillabel','')})
        elif kind == 'Trigger': step=dict(type='trigger',tag=ep.get('triggertag',''))
        elif kind == 'End': step=dict(type='end')
        elif kind == 'AddCredits': step=dict(type='credits',amount=int(ep.get('creditstoadd',0)))
        elif kind == 'AddSkillPoints': step=dict(type='skillpoints',amount=int(ep.get('pointstoadd',0)),text=ep.get('awardmessage',''))
        elif kind == 'CheckObject': step=dict(type='checkitem',item=ep.get('objectname',''),goto=ep.get('faillabel',''))
        elif kind == 'CheckPersona':
            step=dict(type='checkvalue',valueType=ep.get('personatype','EP_Credits'),condition=ep.get('condition','EC_GreaterEqual'),amount=int(ep.get('value',0)),goto=ep.get('jumplabel',''))
        elif kind == 'RandomLabel':
            step=dict(type='random',labels=e.get('labels',[]),cycle=truth(ep,'bcycleevents'),once=truth(ep,'bcycleonce'),shuffle=truth(ep,'bcyclerandom'))
        elif kind == 'Animation':
            step=dict(type='animation',actor=ep.get('eventownername',''),sequence=ep.get('sequence',''),loop=ep.get('playmode')=='AM_Loop',seconds=int(ep.get('playlength',0)),wait=truth(ep,'bfinishanim'))
        elif kind == 'Trade': step=dict(type='trade',actor=ep.get('eventownername',''))
        elif kind == 'Comment':
            d.setdefault('comments',[]).append(ep.get('comment',''))
        elif kind == 'MoveCamera':
            if not d['conversionNotes']: d['conversionNotes'].append('Original camera directions were replaced by the editor\'s automatic cameras.')
        else: losses.append('Unsupported event: '+kind+' ('+e['path']+')')
        if step: steps.append(step)
    if losses: d['conversionNotes'].extend(losses)
    labels=[s['name'].casefold() for s in steps if s['type']=='label']
    missing=sorted({str(label) for s in steps for label in targets(s) if label and str(label).casefold() not in labels})
    if missing:
        d['originalMissingLabels']=missing
        d['conversionNotes'].append('The original already contains unresolved labels: '+', '.join(missing)+'. These branches were preserved for review.')
    if len(labels)!=len(set(labels)):
        d['conversionNotes'].append('The original repeats some labels. Their order is preserved; the game uses its first matching label.')
    return dict(dialogue=d, losses=losses, notices=d['conversionNotes'])


def ustr(value):
    """One game string, even when the compiler needs several short string constants."""
    import story
    s=story.spoken(value)
    return ' $ '.join(story.lit(s[i:i+180]) for i in range(0,len(s),180)) or '""'


def voice_path(voice):
    if not isinstance(voice,dict): return None
    ref=voice.get('ref','')
    # the original games' voices (Revision's, the original DeusExConAudio...), and a mod's package.sound
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+',ref):
        raise ValueError('Choose an original voice from Game voices.')
    return ref


def stamp(d):
    return 'DeusEdix:' + hashlib.sha1(json.dumps(d,sort_keys=True).encode()).hexdigest()[:20]


def targets(s):
    kind=s.get('type')
    return ([o.get('goto') for o in s.get('options',[])] if kind=='choice' else
            s.get('labels',[]) if kind=='random' else [s.get('label')] if kind=='goto' and not s.get('conversation') else
            [s.get('goto')] if kind in ('if','checkitem','checkvalue') else [s.get('fail')] if kind=='give' else [])


def validate(data, complete=False):
    """Reject invalid overrides before saving or emitting executable source. Drafts may have empty fields."""
    import story
    seen=set()
    for d in data.get('dialogues') or []:
        name=d.get('replaces')
        if name:
            if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,63}',name):
                raise ValueError('Invalid original conversation name.')
            identity=(d.get('owner'),name.lower())
            if identity in seen: raise ValueError('Only one override per original conversation and owner is allowed: '+name)
            seen.add(identity)
        if not complete or d.get('disabled'): continue
        labels={str(s.get('name','')).casefold() for s in d.get('steps',[]) if s.get('type')=='label'}
        if not name and len(labels)!=sum(s.get('type')=='label' for s in d.get('steps',[])):
            raise ValueError('Duplicate labels in '+str(d.get('title',d.get('id'))))
        for s in d.get('steps',[]):
            kind=s.get('type')
            if kind not in ('line','choice','label','if','goto','flag','goal','trigger','give','do','end','credits','skillpoints','checkitem','checkvalue','random','animation','trade','note'):
                raise ValueError('Unsupported story step: '+str(kind))
            for label in targets(s):
                if label and str(label).casefold() not in labels and label not in d.get('originalMissingLabels',[]): raise ValueError('Unknown label '+str(label)+' in '+str(d.get('title',d.get('id'))))
            if kind=='random' and not 1<=len(targets(s))<=64: raise ValueError('A branch selection needs 1 to 64 labels.')
            if s.get('conversation') and not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+',s['conversation']):
                raise ValueError('Invalid target conversation path.')
    for line,_ in story.voiced_lines(data):
        voice=line.get('voice')
        if isinstance(voice,dict): voice_path(voice)
        elif voice and not re.fullmatch(r'D\d+',str(voice)): raise ValueError('Invalid recorded voice key.')


def event_code(s):
    """Extra event types; normal steps remain in story.py."""
    import story
    t=s['type']; fields={}
    kind={'note':'AddNote','credits':'AddCredits','skillpoints':'AddSkillPoints','checkitem':'CheckObject',
          'checkvalue':'CheckPersona','animation':'Animation','trade':'Trade'}.get(t)
    if not kind: return None
    if t=='note': fields={'noteText':s.get('text','')}
    elif t=='credits': fields={'creditsToAdd':int(s.get('amount',0))}
    elif t=='skillpoints': fields={'pointsToAdd':int(s.get('amount',0)),'awardMessage':s.get('text','')}
    elif t=='checkitem': fields={'objectName':s.get('item',''),'failLabel':s.get('goto','')}
    elif t=='checkvalue': fields={'personaType':s.get('valueType','EP_Credits'),'condition':s.get('condition','EC_GreaterEqual'),'value':int(s.get('amount',0)),'jumpLabel':s.get('goto','')}
    elif t=='animation':
        import settings
        fields={'eventOwnerName':s.get('actor',''),'sequence':s.get('sequence','')}
        if settings.IS_REVISION: fields.update(playMode='AM_Loop' if s.get('loop') else 'AM_Once',playLength=int(s.get('seconds',0)))
        else: fields['bLoopAnim']=str(bool(s.get('loop')))     # the original game's ConSys: a loop, no length
        fields['bFinishAnim']=str(bool(s.get('wait')))
    elif t=='trade': fields={'eventOwnerName':s.get('actor','')}
    return ["\t\tc.NativeEvent('%s');"%kind]+['\t\tc.LastProp(%s, %s);'%(story.lit(k),ustr(str(v))) for k,v in fields.items()]
