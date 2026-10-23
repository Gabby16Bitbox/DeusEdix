"""Play preflight: account for unsaved-to-build additions, deletions and disabled starts."""
MESSAGE = 'This map has no enabled Player start. Add one from Objects, or enable an existing one, before pressing Play.'

def usable(actors, edits, chains=None):
    def enabled(value):
        if isinstance(value, list):value = value[0] if value else True
        return str(value).lower() not in ('false', '0')
    all_ = {a['name']:a for a in [*actors, *(edits.get('added') or [])]}
    out=[]
    for a in all_.values():
        cls=a.get('cls','').split('.')[-1]
        if cls!='PlayerStart' and 'PlayerStart' not in (chains or {}).get(a.get('cls'),[]):continue
        if (edits.get('deleted') or {}).get(a['name']) or (edits.get('disabled') or {}).get(a['name']):continue
        props={**(a.get('props') or {}), **((edits.get('props') or {}).get(a['name']) or {})}
        if enabled(props.get('bEnabled',True)) and enabled(props.get('bSinglePlayerStart',True)):out.append(a)
    return out

def require(actors, edits, chains=None):
    if not usable(actors,edits,chains):raise ValueError(MESSAGE)
