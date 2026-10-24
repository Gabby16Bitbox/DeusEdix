"""Character Creator of the map editor: characters of your own, put together from the bodies, faces and
clothes of the game's characters, saved as files that can be shared, and placed in any map.

In the game a human character is a body (a LodMesh: man in a long coat, woman in a dress, child...) with
eight skin slots (MultiSkins): face and hands, clothes, glasses, hair. Bodies of the same kind share the
layout of their pieces (the same head, the same legs...), so faces and clothes can be swapped. The
catalog (cache/_characters, made once from the game with the host) has:
  bodies   every body of the game's human characters, its pieces (slots that change together: Face,
           Top, Legs, Glasses...), the character it comes from (LookBody: gender, walk, voice, corpse)
           and its 3D model with every slot (bodies/<body>.json);
  options  every version of a piece the game has, keyed by the UV layout of its slots: the same
           trousers fit every body with the same legs, a face every head of the same kind;
  people   every human character of the game, for "Start from" (body, clothes, faction, weapons);
  textures the PNG of every texture.
In a map a character is a UCCustomCivilian / UCCustomSoldier / UCCustomThug (src/UnatcoContinues): the
editor sets its Mesh, MultiSkins and LookBody; it keeps that look (no HDTP swap) and so does its corpse.
Characters are saved in tools/mapkit/characters/<id>.json.
"""
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

import data
import kit
import settings

ROOT = Path(__file__).resolve().parents[1] / 'characters'
CACHE = data.GAME_CACHE / '_characters'
VERSION = 2               # 2: hidden versions of every piece the game hides somewhere; piece names
PROPS = ('Mesh,MultiSkins,Texture,Skin,CarcassType,CollisionRadius,CollisionHeight,DrawScale,bIsFemale,'
         'FamiliarName,BindName,Alliance,InitialInventory,InitialAlliances,Health')
HUMAN = {'HumanCivilian': 'civilian', 'HumanMilitary': 'soldier', 'HumanThug': 'thug'}
CLASSES = {'civilian': 'UCCustomCivilian', 'soldier': 'UCCustomSoldier', 'thug': 'UCCustomThug'}
MASKS = ('pinkmasktex', 'graymasktex', 'blackmasktex')
HIDE = 'DeusExItems.Skins.PinkMaskTex'
# the character a body is taken from (gender, walk, voice, corpse): ordinary people first
PREFERRED = ['Male1', 'Male2', 'Male3', 'ThugMale', 'ThugMale2', 'ThugMale3', 'Soldier', 'Businessman1', 'Female1',
             'Female2', 'Female3', 'Female4', 'Hooker1', 'Businesswoman1', 'ChildMale', 'ChildMale2', 'ScubaDiver',
             'MJ12Commando', 'BumMale', 'Bartender', 'JunkieMale']
BODY_NAMES = {
    'GM_Trench': 'Man - long coat', 'GM_Trench_F': 'Heavy man - long coat', 'GM_Suit': 'Man - suit',
    'GM_DressShirt': 'Man - shirt', 'GM_DressShirt_F': 'Heavy man - shirt', 'GM_DressShirt_S': 'Slim man - shirt',
    'GM_DressShirt_B': 'Big man - shirt', 'GM_Jumpsuit': 'Man - uniform / jumpsuit', 'GM_ScaryTroop': 'Commando armour',
    'GM_Scubasuit': 'Diver', 'GFM_SuitSkirt': 'Woman - suit and skirt', 'GFM_SuitSkirt_F': 'Heavy woman - suit and skirt',
    'GFM_TShirtPants': 'Woman - t-shirt and trousers', 'GFM_Trench': 'Woman - long coat', 'GFM_Dress': 'Woman - dress',
    'GMK_DressShirt': 'Child', 'GMK_DressShirt_F': 'Heavy child',
}


def _ref(value):
    """LodMesh'Pkg.Name' / Texture'Pkg.Grp.Name' / Class'Pkg.Name' -> 'Pkg.Name' (None for None)."""
    m = re.search(r"'([^']+)'", value or '')
    return m.group(1) if m else None


def _hidden(tex):
    return not tex or tex.split('.')[-1].lower() in MASKS


def _short(mesh):
    return mesh.split('.')[-1]


def _uvpoints(slot, head_only=False):
    """The texture points of a piece (rounded to 1/100); head_only: the top 12 units (the face proper:
    the hands of the same piece follow the sleeves of each body)."""
    uv, pos = slot['uv'], slot['pos']
    out = set()
    for j in range(len(uv) // 2):
        if not head_only or pos[j * 3 + 2] > slot['zmax'] - 12:
            out.add((round(uv[j * 2], 2), round(uv[j * 2 + 1], 2)))
    return out


def _same_layout(a, b, need):
    return len(a & b) >= need * max(1, len(a | b))


def _cluster(items, need):
    """items: [(key, kind, nslots, points)] -> {key: key of the first item with the same layout}:
    the same piece (a head, trousers) on several bodies, with the small differences of each body."""
    rep = {}
    reps = []
    for key, kind, n, pts in items:
        for rkey, rkind, rn, rpts in reps:
            if rkind == kind and rn == n and _same_layout(pts, rpts, need):
                rep[key] = rkey
                break
        else:
            reps.append((key, kind, n, pts))
            rep[key] = key
    return rep


def _classes(path):
    """UC_DEFAULTS -> {class: {parents, p: {property: [value per index]}}}."""
    out = {}
    for row in kit.rows(path):
        if row['kind'] != 'class':
            continue
        c = out[row['class']] = dict(parents=row['parents'], p={})
        for prop in row['properties']:
            vals = c['p'].setdefault(prop['name'], [])
            while len(vals) <= prop['index']:
                vals.append('')
            vals[prop['index']] = prop['value']
    return out


def _parse_bodies(path):
    """UC_MESHES of the body actors B<i> -> {i: {slot: {tris, flags, pos, uv, zmin, zmax}}}."""
    header, a = kit.arrays(path)
    out, first = {}, 0
    for row in header.get('actors', []):
        cur = out.setdefault(int(row['actor'][1:]), {})
        tris = range(first, first + row['triangles'])
        first += row['triangles']
        if row['kind'] != 'mesh':           # a mover's faces have no skin slot
            continue
        for t in tris:
            flags, slot = a['flags'][t], a['slot'][t]
            if flags & 1:
                continue
            s = cur.setdefault(slot, dict(tris=0, flags=flags, pos=[], uv=[], zmin=1e9, zmax=-1e9))
            nums = a['corners'][t * 15:t * 15 + 15].tolist()
            s['tris'] += 1
            for k in range(3):
                s['pos'] += nums[k * 5:k * 5 + 3]
                s['uv'] += nums[k * 5 + 3:k * 5 + 5]
                s['zmin'] = min(s['zmin'], nums[k * 5 + 2])
                s['zmax'] = max(s['zmax'], nums[k * 5 + 2])
    return out


def _groups(mesh, slots, users, skins):
    """The pieces of a body: slots that change together. users: the classes with this body;
    skins[cls][slot] = texture. -> [{id, label, kind, slots}]"""
    present = sorted(slots)
    top = max(s['zmax'] for s in slots.values())
    bottom = min(s['zmin'] for s in slots.values())
    height = max(1.0, top - bottom)
    skin = max((k for k in present if slots[k]['zmax'] >= top - 6), key=lambda k: slots[k]['tris'])
    parent = {k: k for k in present}

    def find(k):
        while parent[k] != k:
            k = parent[k]
        return k

    def kind(k):          # glasses: the frames and the lenses go together
        names = [skins[c][k].split('.')[-1].lower() for c in users if not _hidden(skins[c][k])]
        if names and sum('frames' in n for n in names) * 2 > len(names):
            return 'frames'
        if names and sum('lenses' in n for n in names) * 2 > len(names):
            return 'lenses'
        if not names and slots[k]['tris'] <= 12:
            return {320: 'frames', 260: 'lenses'}.get(slots[k]['flags'], '')
        return ''

    kinds = {k: kind(k) for k in present}
    for i, a in enumerate(present):
        for b in present[i + 1:]:
            same = sum(1 for c in users if skins[c][a] == skins[c][b] and not _hidden(skins[c][a]))
            if (users and same >= 0.7 * len(users)) or {kinds[a], kinds[b]} == {'frames', 'lenses'}:
                parent[find(b)] = find(a)
    sets = defaultdict(list)
    for k in present:
        sets[find(k)].append(k)
    out = []
    for members in sorted(sets.values(), key=lambda m: (skin not in m, m[0])):
        zmin = min(slots[k]['zmin'] for k in members)
        zmax = max(slots[k]['zmax'] for k in members)
        tris = sum(slots[k]['tris'] for k in members)
        if skin in members:
            label, k_ = 'Face', 'face'
        elif any(kinds[k] for k in members):
            label, k_ = 'Glasses', 'extra'
        elif zmin < bottom + 0.25 * height and zmax > bottom + 0.75 * height:
            label, k_ = 'Long coat', 'clothes'
        elif zmin < bottom + 0.25 * height:
            label, k_ = 'Legs', 'clothes'
        elif zmin >= top - 0.2 * height:
            label, k_ = ('Hat / helmet' if tris >= 40 else 'Head detail'), 'extra'
        elif all(slots[k]['flags'] & 2 for k in members) and zmax - zmin > 40:
            label, k_ = 'Coat tails', 'clothes'
        elif zmax > bottom + 0.6 * height and tris >= 60:
            label, k_ = 'Top', 'clothes'
        elif zmax > bottom + 0.6 * height and tris >= 20:
            label, k_ = 'Shirt', 'clothes'
        else:
            label, k_ = 'Detail', 'extra'
        n = sum(1 for g in out if g['label'].split(' ')[0] == label.split(' ')[0])
        out.append(dict(label=label if not n else '%s %d' % (label, n + 1), kind=k_, slots=members))
    for i, g in enumerate(out):
        g['id'] = 'g%d' % i
    return out


def catalog(log=print, force=False):
    """The catalog of bodies, pieces, characters and textures (made once, about a minute)."""
    path = CACHE / 'catalog.json'
    if path.exists() and not force:
        c = json.loads(path.read_text(encoding='utf-8'))
        if c.get('version') == VERSION:
            return c
    (CACHE / 'bodies').mkdir(parents=True, exist_ok=True)
    log('reading the characters of the game (once)...')
    s = kit.Session([], 'editor-characters')
    try:
        s.batch(['OBJ LOAD FILE="%s.u"' % settings.PACKAGE] + ['OBJ LOAD FILE="%s"' % p for p in settings.GAME_LOADS]
                + [r'UC_DEFAULTS ..\Output\looks.jsonl %s' % PROPS])
        classes = _classes(s.folder / 'Output' / 'looks.jsonl')
        humans = {}
        for cls, d in classes.items():
            behaviour = next((HUMAN[p] for p in d['parents'] if p in HUMAN), None)
            mesh = _ref((d['p'].get('Mesh') or [''])[0])
            if not behaviour or not mesh or cls.startswith('UCCustom') or cls in HUMAN:
                continue
            humans[cls] = dict(d, behaviour=behaviour, mesh=mesh)
        skins = {c: [_ref(v) for v in (h['p'].get('MultiSkins') or [''] * 8)] + [None] * 8 for c, h in humans.items()}
        skins = {c: v[:8] for c, v in skins.items()}
        users = defaultdict(list)
        for c, h in humans.items():
            users[h['mesh']].append(c)
        meshes = sorted(users)
        source = {m: next((p for p in PREFERRED if p in users[m]), sorted(users[m])[0]) for m in meshes}
        # every body with every slot visible (a plain texture in all of them): its pieces and their layout
        body = ''.join("Begin Actor Class=%s Name=B%d\n    Location=(X=%d,Y=0,Z=0)\n    Mesh=LodMesh'%s'\n%sEnd Actor\n"
                       % (source[m], i, i * 200, m, ''.join("    MultiSkins(%d)=Texture'Engine.DefaultTexture'\n" % k
                                                            for k in range(8))) for i, m in enumerate(meshes))
        (s.folder / 'T3D' / 'bodies.t3d').write_text('Begin Map\n' + body + 'End Map\n', encoding='ascii')
        s.batch(['MAP NEW', r'MAP IMPORTADD FILE="..\T3D\bodies.t3d"', r'UC_MESHES ..\Output\bodies.bin'])
        models = _parse_bodies(s.folder / 'Output' / 'bodies.bin')
        pkgs = {c['cls']: c.get('pkg') for c in data.catalog(log=lambda *a: None)}
        bodies, options, layouts, models_of = {}, defaultdict(dict), [], {}
        for i, m in enumerate(meshes):
            slots = models.get(i) or {}
            if not slots:
                log('body %s: no model' % m)
                continue
            models_of[m] = slots
            groups = _groups(m, slots, users[m], skins)
            family = _short(m).split('_')[0]               # GM (men), GFM (women), GMK (children)
            for g in groups:
                g['key'] = '%s/%s' % (_short(m), g['id'])
                if g['kind'] == 'face':                    # a face: the texture of the head, on every slot of the piece
                    g['head'] = max(g['slots'], key=lambda k: slots[k]['tris'])
                    layouts.append((g['key'], 'face:' + family, 1, _uvpoints(slots[g['head']], True)))
                else:
                    layouts.append((g['key'], 'piece', len(g['slots']),
                                    set().union(*(_uvpoints(slots[k]) for k in g['slots']))))
            src = source[m]
            h = humans[src]['p']
            bodies[_short(m)] = dict(
                mesh=m, label=BODY_NAMES.get(_short(m), _short(m).replace('_', ' ')), family=family,
                female=(h.get('bIsFemale') or ['False'])[0] == 'True', lookBody=src, lookPkg=pkgs.get(src) or 'DeusEx',
                height=float((h.get('CollisionHeight') or ['47.5'])[0]), radius=float((h.get('CollisionRadius') or ['20'])[0]),
                drawScale=float((h.get('DrawScale') or ['1'])[0]), skins=skins[src], texture=_ref((h.get('Texture') or [''])[0]),
                users=sorted(users[m]), groups=groups, model='bodies/%s.json' % _short(m))
            parts = [dict(slot=k, flags=v['flags'], pos=[round(x, 2) for x in v['pos']], uv=[round(x, 4) for x in v['uv']])
                     for k, v in sorted(slots.items())]
            (CACHE / 'bodies' / (_short(m) + '.json')).write_text(json.dumps(dict(mesh=m, parts=parts)), encoding='utf-8')
        # the same piece on several bodies (heads: 80% of the texture points in common, clothes 85%)
        rep = _cluster([l for l in layouts if l[1] != 'piece'], 0.8)
        rep.update(_cluster([l for l in layouts if l[1] == 'piece'], 0.85))
        for b in bodies.values():
            for g in b['groups']:
                g['key'] = ('face:' if g['kind'] == 'face' else 'piece:') + rep[g['key']]
            for c in users[b['mesh']]:                     # what every character of this body wears on each piece
                for g in b['groups']:
                    if g['kind'] == 'face':
                        tex = (skins[c][g['head']],)
                    else:
                        tex = tuple(skins[c][k] for k in g['slots'])
                    options[g['key']].setdefault(tex, []).append(c)
        for b in bodies.values():                          # extras can always be taken off
            for g in b['groups']:
                if g['kind'] == 'extra' and not any(all(_hidden(t) for t in tex) for tex in options[g['key']]):
                    options[g['key']][tuple(HIDE for _ in g['slots'])] = []
        people = []
        for c, h in sorted(humans.items()):
            p = h['p']
            people.append(dict(
                cls=c, pkg=pkgs.get(c) or 'DeusEx', name=(p.get('FamiliarName') or [c])[0].strip('"') or c,
                body=_short(h['mesh']), skins=skins[c], texture=_ref((p.get('Texture') or [''])[0]),
                behaviour=h['behaviour'], bind=(p.get('BindName') or [''])[0].strip('"'),
                alliance=(p.get('Alliance') or ['None'])[0],
                inventory=[[_ref(v), int(re.search(r'Count=(\d+)', v).group(1)) if re.search(r'Count=(\d+)', v) else 1]
                           for v in p.get('InitialInventory') or [] if _ref(v)],
                relations=[v for v in p.get('InitialAlliances') or [] if 'AllianceName=None' not in v]))
        # PNGs: the palette's when it has them, the others exported here
        wanted = {t for opts in options.values() for tex in opts for t in tex if not _hidden(t)}
        wanted |= {t for p in people for t in p['skins'] if not _hidden(t)}
        index = data.GAME_CACHE / '_palette' / 'index.json'
        have = json.loads(index.read_text(encoding='utf-8')).get('_textures', {}) if index.exists() else {}
        textures = {t: '/cache/_palette/' + have[t]['png'] for t in wanted if have.get(t, {}).get('png')}
        todo = {t: (0, 0) for t in wanted if t not in textures}
        if todo:
            log('exporting %d textures...' % len(todo))
            for t, info in data.export_textures(s, todo, CACHE, log).items():
                if info.get('png'):
                    textures[t] = '/cache/_characters/' + info['png']
    finally:
        s.close()
    opts = {key: [{'tex': list(tex), 'from': sorted(cs)} for tex, cs in
                  sorted(v.items(), key=lambda kv: (-len(kv[1]), [str(t) for t in kv[0]]))] for key, v in options.items()}
    c = dict(version=VERSION, bodies=bodies, options=opts, people=people, textures=textures, classes=CLASSES)
    path.write_text(json.dumps(c), encoding='utf-8')
    log('characters: %d bodies, %d characters of the game, %d textures' % (len(bodies), len(people), len(textures)))
    return c


# ------------------------------------------------------------------ the characters made in the editor
def _id(text):
    return re.sub(r'[^a-z0-9]+', '-', str(text).lower()).strip('-')[:48] or 'character'


def load_all():
    ROOT.mkdir(parents=True, exist_ok=True)
    out = []
    for p in sorted(ROOT.glob('*.json')):
        try:
            out.append(json.loads(p.read_text(encoding='utf-8')))
        except ValueError:
            continue
    return out


def save(ch):
    """Save a character (its id comes from its name the first time)."""
    if not isinstance(ch, dict) or not ch.get('body'):
        raise ValueError('a character needs a body')
    ch = dict(ch)
    ch['id'] = _id(ch.get('id') or ch.get('name'))
    ch['name'] = str(ch.get('name') or ch['id'])[:64]
    if ch.get('behaviour') not in CLASSES:
        ch['behaviour'] = 'civilian'
    ROOT.mkdir(parents=True, exist_ok=True)
    (ROOT / (ch['id'] + '.json')).write_text(json.dumps(ch, indent=1), encoding='utf-8')
    return ch


def delete(cid):
    import player_profiles
    used = player_profiles.references(_id(cid))
    if used:
        raise ValueError('This character is used as the player by %s. Choose a different player there before deleting it.' % ', '.join(used))
    p = ROOT / (_id(cid) + '.json')
    if p.exists():
        p.unlink()
