"""New maps from the map editor ("New map"), part of a mission of the campaign:
  empty   a room to build in: a map script made from a template (tools/mapkit/maps/<script>.py), built
          like the others; the editor's changes live next to it (<script>.edits.json)
  copy    any map (the game's, the mod's, a script's build) under a new name, as a mod map (maps\\)
Both get the mission's number and script in their DeusExLevelInfo (the mission's flags and events),
an arrival point "Start" and a PlayerStart, so other maps can lead to them (Links, map exits).
"""
import re
import time
from pathlib import Path

import data
import dxmaps
import kit
import maplinks
import settings

MISSIONS = [(1, 'Liberty Island'), (2, 'New York: Battery Park, Hell\'s Kitchen'), (3, 'LaGuardia airfield'),
            (4, 'New York: Hell\'s Kitchen again'), (5, 'UNATCO: escape'), (6, 'Hong Kong'),
            (8, 'New York: the return'), (9, 'Brooklyn Naval Shipyard'), (10, 'Paris: the catacombs'),
            (11, 'Paris: cathedral, Everett'), (12, 'Vandenberg'), (14, 'Ocean Lab'), (15, 'Area 51'),
            (0, 'Training')]
TEXTURES = dict(floor='ClenGrayCemnt_A', walls='DrtyGrayBlock_A', ceiling='WhitCeilnTile_B')   # a smooth floor: no joints
# the light of the room (New map > Mood): a light every ~512 units (4 lights left a 2048 room dark, Crypt Test,
# 20 Oct 2026); hue/saturation as the game's lights (saturation 255 = white), a dark mood flickers here and there
MOODS = {
    'normal': dict(label='Normal', bright=150, hue=0, sat=255, flicker=False),
    'dark': dict(label='Dark (horror): dim red, some lights flicker', bright=120, hue=8, sat=110, flicker=True),
    'warm': dict(label='Warm: lamps, wood, evening', bright=165, hue=24, sat=150, flicker=False),
    'cold': dict(label='Cold: blue, metal, night', bright=160, hue=150, sat=160, flicker=False),
}

TEMPLATE = '''"""{map} - a new map made in the map editor ({date}).

A room to build in: add pieces, objects, characters and blocks in the map editor; they are kept in
{script}.edits.json next to this script and applied by every build. Mission {mission}: {mission_name}.

    python tools\\\\mapkit\\\\maps\\\\{script}.py            # builds tools\\\\mapkit\\\\out\\\\{map}.dx
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
sys.path.insert(0, str(KIT))
from geom import Mat, box  # noqa: E402
from scene import Scene  # noqa: E402

MAP = '{map}'
OUT = KIT / 'out' / (MAP + '.dx')
s = Scene(MAP)
W, D, H = {w}, {d}, {h}            # the room (Unreal units: a door is 64 x 128)
FLOOR, WALLS, CEILING = Mat('{floor}'), Mat('{walls}'), Mat('{ceiling}')

s.begin_group('room', 'Room', 'Building')
s.sub(box((-W / 2, -D / 2, 0), (W / 2, D / 2, H), {{'sides': WALLS, 'top': CEILING, 'bottom': FLOOR}}))
NX, NY = max(2, min(8, round(W / 512))), max(2, min(8, round(D / 512)))     # a light every ~512 units ({mood})
for i in range(NX):
    for j in range(NY):
        x, y = -W / 2 + W * (i + 0.5) / NX, -D / 2 + D * (j + 0.5) / NY
        s.actor('Light', (x, y, H - 24), LightBrightness={bright}, LightRadius=32, LightHue={hue}, LightSaturation={sat},
                LightType='LT_Flicker' if {flicker} and (i + j) % 3 == 1 else 'LT_Steady')

# where JC appears: the start of the map, and the arrival point "Start" (other maps: {map}#Start)
s.actor('PlayerStart', (0, -D / 4, 48), rot=(0, 16384, 0))
s.actor('Teleporter', (0, -D / 4, 48), name='Start', Tag='Start', bEnabled=False, rot=(0, 16384, 0))
s.actor('DeusExLevelInfo', (0, 0, H - 48), MapName='"{map}"', MissionLocation='"{location}"', missionNumber={mission},
        Script={mission_script!r}, ConversationPackage={conversations!r})
s.actor('PathNode', (0, 0, 48))

if __name__ == '__main__':
    s.build(OUT, edits=HERE / '{script}.edits.json')
'''


def map_name(mission, name):
    word = re.sub(r'[^A-Za-z0-9]+', '_', str(name)).strip('_')
    if not word:
        raise ValueError('give the map a name')
    return '%02d_%s' % (int(mission), word[:40])


def _check_free(name):
    if name.lower() in {m.lower() for m in maplinks.all_maps()}:
        raise ValueError('a map called %s already exists' % name)


def create_empty(name, mission, size=(2048, 2048, 384), location='', textures=None, log=print, mood='normal'):
    """A map script with a room; built at once. Returns (script, map)."""
    new = map_name(mission, name)
    _check_free(new)
    script = 'new_' + new.lower()
    path = kit.PROJECT / 'tools' / 'mapkit' / 'maps' / (script + '.py')
    if path.exists():
        raise ValueError('the script %s already exists' % path.name)
    w, d, h = (max(256, min(16384, int(v))) for v in size)
    tex = dict(TEXTURES, **{k: v for k, v in (textures or {}).items() if v and re.fullmatch(r'\w+', v)})
    mission_name = ('Chapter %d' % int(mission)) if dxmaps.isolated_project() else dict(MISSIONS).get(int(mission), '')
    # the game's mission script and conversations: Revision's, or the original game's (DeusEx.MissionNN)
    mission_script = 'None' if dxmaps.isolated_project() else settings.mission_script(mission)
    conversations = '"None"' if dxmaps.isolated_project() else settings.CONVERSATIONS
    m = MOODS.get(mood) or MOODS['normal']
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(TEMPLATE.format(mood=m['label'].split(':')[0], bright=m['bright'], hue=m['hue'], sat=m['sat'], flicker=m['flicker'], map=new, script=script, date=time.strftime('%d %b %Y'), mission=int(mission),
                                    mission_name=mission_name, w=w, d=d, h=h, location=str(location or new).replace('"', ''),
                                    mission_script=mission_script, conversations=conversations,
                                    **tex), encoding='utf-8')
    return script, new


def discard(script):
    """A new empty map whose first build failed: its script goes (and its edits, if any), so the
    same name can be used again once the cause is fixed."""
    maps = kit.PROJECT / 'tools' / 'mapkit' / 'maps'
    if not re.fullmatch(r'new_\w+', script):
        return
    for path in (maps / (script + '.py'), maps / (script + '.edits.json')):
        if path.exists():
            path.unlink()


def copy_bytes(src, new, mission=None, location='', log=print):
    """Prepare a private map copy; isolated projects detach original gameplay hooks and exits.

    The source is only read. The caller publishes the returned bytes with exclusive creation,
    so a concurrent import cannot overwrite another map.
    """
    src = Path(src)
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_-]{0,63}', new):
        raise ValueError('Invalid map name.')
    import ue1pkg
    pkg = ue1pkg.Pkg(str(src))
    infos = [e['name'] for e in pkg.exports if pkg.classname(e) == 'DeusExLevelInfo']
    folder = kit.new_run([src], 'newmap-' + new)
    cmds = [r'MAP LOAD FILE="..\Input\%s"' % src.name]
    detached = dxmaps.isolated_project()
    if not detached and mission is not None:
        # MAP LOAD resolves the source's mission class lazily; a different chapter's
        # class must be loaded before UC_PROP can resolve it.
        cmds += ['OBJ LOAD FILE="%s"' % p for p in settings.GAME_LOADS]
    if detached and not infos:
        # Imported maps may have no level info. Give the copy explicit independent defaults.
        info = 'DeusEdixLevelInfo'
        occupied = {e['name'].casefold() for e in pkg.exports}
        while info.casefold() in occupied:
            info += '_'
        (folder / 'T3D' / 'project-info.t3d').write_text(
            'Begin Map\nBegin Actor Class=DeusExLevelInfo Name=%s\nScript=None\nConversationPackage="None"\nEnd Actor\nEnd Map\n' % info,
            encoding='latin1')
        cmds.append(r'MAP IMPORTADD FILE="..\T3D\project-info.t3d"')
        infos = [info]
    for info in infos if detached else infos[:1]:
        # UC_PROP takes a string as it is: no quotes (a MapName "06_X" with its quotes crashed Revision,
        # whose HUD makes a name of it)
        cmds.append('UC_PROP %s MapName %s' % (info, new))
        if mission is not None:
            cmds.append('UC_PROP %s missionNumber %d' % (info, int(mission)))
        if detached:
            cmds += ['UC_PROP %s Script None' % info, 'UC_PROP %s ConversationPackage None' % info]
        elif mission is not None:
            cmds.append('UC_PROP %s Script %s' % (info, settings.mission_script(mission)))
        if location:
            cmds.append('UC_PROP %s MissionLocation %s' % (info, str(location).replace('"', '').strip()))
    if detached:
        available = {name.casefold() for name in maplinks.all_maps()} | {new.casefold()}
        source_names = {src.stem.casefold()}
        properties = []
        for i, entry in enumerate(pkg.exports):
            cls = pkg.classname(entry)
            if cls == 'DeusExLevelInfo' or 'Teleporter' in cls or cls.endswith('MapExit'):
                values = {name: pkg.pval(value) for name, _type, _array, value in pkg.props(i + 1)}
                properties.append((entry, cls, values))
                if cls == 'DeusExLevelInfo' and values.get('MapName'):
                    source_names.add(str(values['MapName']).casefold())
        for entry, cls, values in properties:
            for prop in ('URL', 'DestMap'):
                url = str(values.get(prop) or '')
                if not url or url.startswith('#'):
                    continue
                if prop == 'URL' and '/' not in url and '#' not in url:
                    continue  # Engine.Teleporter uses a bare tag for an in-level teleport.
                destination, _tag = maplinks.split_url(url)
                if destination.casefold() in source_names:
                    # A full URL back into the source is an internal teleport in the copy.
                    replacement = new + url[len(destination):]
                elif destination.casefold() in available:
                    continue
                else:
                    replacement = ''
                cmds.append('UC_PROP %s %s %s' % (entry['name'], prop, replacement))
    cmds.append(r'MAP SAVE FILE="..\Output\%s.dx"' % new)
    transcript, _elapsed = kit.execute(folder, cmds, 'newmap.log', timeout=1800)
    for command in cmds:
        if command.startswith('UC_PROP '):
            _verb, actor, prop = command.split(maxsplit=3)[:3]
            if 'UCMapKit|prop|ok|%s|%s' % (actor, prop) not in transcript:
                raise RuntimeError('The private map copy could not update %s.%s; no map was imported.' % (actor, prop))
    out = folder / 'Output' / (new + '.dx')
    if not out.exists():
        raise RuntimeError('the copy was not saved')
    return out.read_bytes()


def create_copy(name, mission, source_map, location='', log=print):
    """Explicitly copy a project or original map; never edit the source in place."""
    new = map_name(mission, name)
    _check_free(new)
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_-]{0,63}', str(source_map)):
        raise ValueError('Invalid source map name.')
    src = maplinks.map_file(source_map)
    if src is None:
        # Only this explicit copy action may read an original in an isolated campaign.
        original = dxmaps.GAME_MAPS / (source_map + '.dx')
        src = original if original.is_file() else None
    if src is None or not src.is_file():
        raise FileNotFoundError(source_map)
    raw = copy_bytes(src, new, mission=mission, location=location, log=log)
    dxmaps.MOD_MAPS.mkdir(parents=True, exist_ok=True)
    target = dxmaps.MOD_MAPS / (new + '.dx')
    with target.open('xb') as out:
        try:
            out.write(raw)
        except Exception:
            out.close()
            target.unlink(missing_ok=True)
            raise
    return dxmaps.PREFIX + new, new
