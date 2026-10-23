"""Zones made in the map editor, as the original maps make them (Unreal's zones: areas closed by solid
geometry and zone portals, each with a ZoneInfo actor inside that gives it its light, fog, sound, gravity,
damage, water...).

- Water ("+ Water", a block with 'water'): a pool cut into the floor (a subtractive box, unless it fills a
  basin the map already has) and its surface: one sheet, translucent, not solid, two-sided, whose polygon is
  also a ZONE PORTAL (as Brush886 of 08_NYC_Bar: brush PolyFlags 268, polygon Portal|Translucent|NotSolid):
  the water below is a zone of its own, with a WaterZone in it. Liquids: clean, dirty, toxic, burning.
- Zone portals ("+ Portal", a block with 'portal'): an invisible sheet across a doorway (Portal|Invisible|
  NotSolid|TwoSided, as the game's) that closes a room into a zone of its own, for a ZoneInfo of the palette.
- Sky (a hole with 'sky'): its top face shows the sky (Marker_sky with FakeBackdrop, as 8000 faces of the game
  do); a map without a sky gets a sky box far away (a closed room with sky textures and a SkyZoneInfo).
- Clouds (Map > Sky & time of day, edits['level']['clouds']): a cloud layer in that sky box, for any sky, made
  as the game's levels make it (Wan Chai Street's ClenCloudBank_B): a sheet of the sky box, translucent and
  unlit, low over the SkyZoneInfo (its far edge a few degrees over the horizon), its texture moved by the
  engine (Auto U Pan) at the speed of the zone (SkyZoneInfo TexUPanSpeed): the same in Deus Ex and Revision.
  The clouds are painted in the editor or the game's own (CoreTexSky).

The builds call brush_ops() for these blocks and take the zone actors from actors(); report() reads the map
as built and says which zones are not closed (a zone that leaks takes the whole area it leaks into).
"""
import math
import re

import geom

PF_INVISIBLE = 1
PF_TRANSLUCENT = 4
PF_NOTSOLID = 8
PF_FAKEBACKDROP = 128
PF_TWOSIDED = 256
PF_UNLIT = 0x400000
PF_PORTAL = 0x04000000
# the cloud layer: translucent and unlit, never NotSolid (on the Hong Kong rooftop, NotSolid on the cloud sheet
# made the whole sky go black about one frame in four; our sky zone has no light, lit clouds are invisible)
CLOUD_FLAGS = PF_UNLIT | PF_TRANSLUCENT
PF_AUTOUPAN = 0x200
PF_SEMISOLID = 0x20
PAN_RATE = 35.0          # texels a second of Auto U Pan at TexUPanSpeed 1
# the game's own clouds (CoreTexSky, the same package in Deus Ex and Revision)
GAME_CLOUDS = ('ClenCloudBank_B', 'ClenCloudBank_A', 'FlufBlueCloud_A', 'FlufBlueCloud_B', 'SubtleCloud')
WATER_FLAGS = PF_PORTAL | PF_TRANSLUCENT | PF_NOTSOLID | PF_TWOSIDED
PORTAL_FLAGS = PF_PORTAL | PF_INVISIBLE | PF_NOTSOLID | PF_TWOSIDED

# the liquids: the game's textures (package Effects) and what their WaterZone does
LIQUIDS = {
    'water': dict(label='Clean water', tex='bluewater_a', size=256, props={}),
    'dirty': dict(label='Dirty water (canal, sewer)', tex='drtywater_a', size=256,
                  props={'ViewFog': '(X=0.100000,Y=0.120000,Z=0.060000)'}),
    'toxic': dict(label='Toxic water (radiation)', tex='Virus_SFX', size=64,
                  props={'bPainZone': 'True', 'DamagePerSec': '10', 'DamageType': 'Radiation',
                         'DamageString': '"Radioactive water"', 'ViewFog': '(X=0.050000,Y=0.250000,Z=0.020000)'}),
    'burning': dict(label='Burning liquid', tex='flame_b', size=128,
                    props={'bPainZone': 'True', 'DamagePerSec': '25', 'DamageType': 'Burned',
                           'DamageString': '"It burns"', 'ViewFog': '(X=0.450000,Y=0.150000,Z=0.000000)'}),
}
LIQUID_PACKAGE = 'Effects'
# sky boxes (CoreTexSky, as the game's): walls, top, bottom (texture, world units per tile)
SKIES = {
    'hongkong': dict(label='Hong Kong at night', walls=('HK_City_A_A', 2048), top=('starslesser', 1024), bottom=('starslesser', 1024)),
    'newyork': dict(label='New York at night', walls=('NY_1', 2048), top=('starslesser', 1024), bottom=('starslesser', 1024)),
    'stars': dict(label='Night sky, stars', walls=('ColorStars_A', 1024), top=('ColorStars_A', 1024), bottom=('ColorStars_A', 1024)),
    'sunset': dict(label='Sunset', walls=('SunsetskyA_B', 2048), top=('ClenCloudBank_B', 2048), bottom=('ClenCloudBank_B', 2048)),
    'clouds': dict(label='Grey clouds', walls=('ClenCloudBank_B', 2048), top=('ClenCloudBank_B', 2048), bottom=('ClenCloudBank_B', 2048)),
    'brightclouds': dict(label='Bright clouds (day)', walls=('FlufBlueCloud_B', 1024), top=('FlufBlueCloud_A', 1024), bottom=('FlufBlueCloud_A', 1024)),
    'orangehaze': dict(label='Orange haze (dusk)', walls=('ClenOrngeHaze_A', 2048), top=('ClenCloudBank_B', 2048), bottom=('ClenCloudBank_B', 2048)),
}
# 'mine': the map's own sky, made in the editor (Map > Sky & time of day): edits['level']['skyLook'] =
# {walls, top, bottom: textures imported into the map (edits['textures'])}
SKY_TEX = 'Marker_sky'
SKYBOX_CENTER = (-24000.0, -24000.0, -24000.0)     # far from every map (they are built round the origin)
SKYBOX_SIZE = 2048.0
ZONE_CLASSES = ('ZoneInfo', 'WaterZone', 'PrecipitationZone', 'SnowZone', 'SkyZoneInfo', 'RevSoundZone', 'RevZoneInfo')
# zone actors of other packages: the build loads them
CLASS_PACKAGE = {'PrecipitationZone': 'Precipitation', 'SnowZone': 'Precipitation'}

for _name, _size in (('bluewater_a', 256), ('drtywater_a', 256), ('Virus_SFX', 64), ('flame_b', 128)):
    geom.register(_name, _size, _size)          # Effects is not in the texture catalog of the map scripts


def is_zone_box(b):
    return bool(b.get('water') or b.get('portal'))


def surface_of(b):
    """The water's surface: 'below' units under the top of its block (a pool cut into a floor: its block
    goes 8 above the floor, the water 8 under it)."""
    w = b.get('water') or {}
    if w.get('below') is not None:
        return float(b['hi'][2]) - float(w['below'])
    if w.get('surface') is not None:
        return float(w['surface'])
    return float(b['hi'][2]) - (16.0 if b.get('hole') else 0.0)


def _sheet(name, corners, normal, tex, flags, tile):
    return geom.Brush([geom.Face(corners, geom.Mat(tex, tile=tile, flags=flags), normal)], name)


def brush_ops(b):
    """[(op 'add'|'sub', Brush, flags)] of a water or portal block, in build order."""
    lo, hi = [float(v) for v in b['lo']], [float(v) for v in b['hi']]
    name = b.get('name', 'EditBox')
    ops = []
    if b.get('water'):
        liq = LIQUIDS.get((b['water'] or {}).get('kind') or 'water', LIQUIDS['water'])
        if b.get('hole'):                       # the pool, cut into the floor; its sides take the block's texture
            ops.append(('sub', geom.box(tuple(lo), tuple(hi), geom.Mat(b.get('tex') or 'ClenGreyCncrt_A'), name=name), 0))
        s = surface_of(b)
        x, y, X, Y = lo[0], lo[1], hi[0], hi[1]
        ops.append(('add', _sheet(name + 'W', [(x, y, s), (X, y, s), (X, Y, s), (x, Y, s)], (0.0, 0.0, 1.0),
                                  liq['tex'], WATER_FLAGS, liq['size']), WATER_FLAGS))
    elif b.get('portal'):
        size = [hi[k] - lo[k] for k in range(3)]
        k = size.index(min(size))               # the sheet lies across its thinnest side
        m = (lo[k] + hi[k]) / 2
        a, c = [i for i in range(3) if i != k]
        corners = []
        for u, v in ((lo[a], lo[c]), (hi[a], lo[c]), (hi[a], hi[c]), (lo[a], hi[c])):
            p = [0.0, 0.0, 0.0]
            p[k], p[a], p[c] = m, u, v
            corners.append(tuple(p))
        n = [0.0, 0.0, 0.0]
        n[k] = 1.0
        ops.append(('add', _sheet(name + 'P', corners, tuple(n), 'ClenGreyCncrt_A', PORTAL_FLAGS, 256), PORTAL_FLAGS))
    return ops


def hole_mats(b):
    """The faces of a hole: its texture, and the sky on top when it opens to the sky."""
    tex = b.get('tex') or 'ClenGreyCncrt_A'
    if b.get('sky'):
        return {'sides': tex, 'bottom': tex, 'top': geom.Mat(SKY_TEX, flags=PF_FAKEBACKDROP)}
    return geom.Mat(tex)


def actors(edits):
    """The WaterZone of every pool: [{'cls', 'name', 'loc', 'props'}], like edits['added']."""
    out = []
    for b in edits.get('boxes') or []:
        if not b.get('water') or not all(b['hi'][k] > b['lo'][k] for k in range(3)):
            continue
        liq = LIQUIDS.get((b['water'] or {}).get('kind') or 'water', LIQUIDS['water'])
        lo, hi, s = b['lo'], b['hi'], surface_of(b)
        props = dict(liq['props'])
        if (b['water'] or {}).get('name'):
            props['ZoneName'] = '"%s"' % str(b['water']['name']).replace('"', "'")
        out.append(dict(cls='WaterZone', name='UCZone_' + re.sub(r'\W', '', b.get('name', 'Box')),
                        loc=[(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + min(s, hi[2])) / 2], props=props))
    return out


def sky_needed(edits):
    return any(b.get('sky') and b.get('hole') for b in edits.get('boxes') or [])


def skybox(edits, has_sky):
    """A sky box for a map with sky surfaces and no sky zone: ([('sub', Brush, 0)], [actor])."""
    if has_sky or not sky_needed(edits):
        return [], []
    lv = edits.get('level') or {}
    look = lv.get('skyLook') or {}
    h = SKYBOX_SIZE / 2
    c = SKYBOX_CENTER
    wall_align, wall_pan = (0.0, 0.0, 0.0), (0.0, 0.0)
    if lv.get('sky') == 'mine' and look.get('walls'):
        # the painted walls (square, the zenith at the top, the horizon at 62%): once round each wall and once from
        # its top to its bottom, their top row on the top edge (a plain 2048 tile kept the picture's 2:1 and
        # repeated it twice, from world 0: a band of ground colour across the sky, 18 Oct 2026)
        sky = dict(walls=(look['walls'], (SKYBOX_SIZE, SKYBOX_SIZE)), top=(look.get('top') or look['walls'], 2048),
                   bottom=(look.get('bottom') or look.get('top') or look['walls'], 2048))
        wall_align = (c[0] - h, c[1] - h, c[2] + h)
        # one texel down: the texture wraps, and filtering its very top row mixed in the bottom one (the ground's
        # grey: a pale line round the sky where the walls meet the top, 18 Oct 2026 photos)
        wall_pan = (0.0, 2.0 * SKYBOX_SIZE / 2048)
    else:
        sky = SKIES.get(lv.get('sky') or 'hongkong', SKIES['hongkong'])
    lo, hi = tuple(v - h for v in c), tuple(v + h for v in c)
    mats = {'sides': geom.Mat(sky['walls'][0], tile=sky['walls'][1], flags=0x400000, align=wall_align, offset=wall_pan),   # unlit
            'top': geom.Mat(sky['top'][0], tile=sky['top'][1], flags=0x400000),
            'bottom': geom.Mat(sky['bottom'][0], tile=sky['bottom'][1], flags=0x400000)}
    actor = dict(cls='SkyZoneInfo', name='UCSkyZone', loc=list(c), props={})
    ops = [('sub', geom.box(lo, hi, mats, name='UCSkyBox'), 0)]
    clouds = cloud_sheet(edits)                 # the clouds: a sheet of the box (after it), its zone pans them
    if clouds:
        ops.append(('add', clouds[0], PF_SEMISOLID))
        actor['props'].update(clouds[1])
    return ops, [actor]


def cloud_settings(edits):
    """The cloud layer of Map > Sky & time of day, in world units: None when there is none.
    edits['level']['clouds'] = {look ('soft', 'puffy', 'streaks': painted, tex = the map's texture; 'game': tex =
    one of GAME_CLOUDS; 'none' = no layer), height (degrees of its far edge over the horizon), size, speed (0-100),
    wind (degrees it comes from, as the sun's)}. sky-tool.js shows the same in its preview: keep the two in step."""
    cl = (edits.get('level') or {}).get('clouds') or {}
    look = cl.get('look', 'none')
    if look == 'none' or not cl.get('tex') or (look == 'game' and cl['tex'] not in GAME_CLOUDS):
        return None
    h = SKYBOX_SIZE / 2
    edge = min(30.0, max(3.0, float(cl.get('height', 8))))
    high = h * math.tan(math.radians(edge))                  # over the SkyZoneInfo: the edge `edge` degrees up
    tile = high * 2 * 2 ** (min(100.0, max(0.0, float(cl.get('size', 25)))) / 100 * 3)    # 2 to 16 times as wide
    speed = high * 0.1 * min(100.0, max(0.0, float(cl.get('speed', 25)))) / 100           # up to 5.7 degrees/s overhead
    goes = math.radians(float(cl.get('wind', 135)) + 180)    # where the wind blows them
    return dict(tex=cl['tex'], high=high, tile=tile, speed=speed, dir=(math.cos(goes), math.sin(goes)))


def cloud_sheet(edits):
    """The cloud layer as the game's levels make it (Wan Chai Street: ClenCloudBank_B over its SkyZoneInfo): a
    sheet of the sky box, translucent and unlit, its texture moved by the engine (Auto U Pan) at the speed its
    zone gives (SkyZoneInfo TexUPanSpeed), the same in Deus Ex and Revision. Its texture is turned to the wind
    (U along it): (Brush, SkyZoneInfo props) or None."""
    s = cloud_settings(edits)
    if s is None:
        return None
    c, h = SKYBOX_CENTER, SKYBOX_SIZE / 2
    z = c[2] + s['high']
    flags = CLOUD_FLAGS | (PF_AUTOUPAN if s['speed'] > 0 else 0)
    face = geom.Mat(s['tex'], tile=s['tile'], flags=flags, align=(c[0], c[1], z))
    hidden = geom.Mat(s['tex'], tile=s['tile'], flags=PF_INVISIBLE)
    brush = geom.box((c[0] - h + 4, c[1] - h + 4, z), (c[0] + h - 4, c[1] + h - 4, z + 2.0),
                     {'bottom': face, 'top': hidden, 'sides': hidden}, name='UCSkyClouds')
    a = math.atan2(s['dir'][1], s['dir'][0])
    ca, sa = math.cos(a), math.sin(a)
    faces = []
    for f in brush.faces:
        if f.normal[2] < -0.5:                 # the cloud face: its texture axes turned round Z to the wind
            U, V, origin = geom.mapping(f, False)
            turn = lambda w: (w[0] * ca - w[1] * sa, w[0] * sa + w[1] * ca, w[2])
            f = geom.Face(f.verts, f.mat, f.normal, turn(U), turn(V), origin)
        faces.append(f)
    tu = geom.tex_size(s['tex'])[0]
    # Auto U Pan moves the texture PAN_RATE texels a second times the zone's TexUPanSpeed (measured in the game)
    pan = -s['speed'] * tu / s['tile'] / PAN_RATE
    return geom.Brush(faces, 'UCSkyClouds'), {'TexUPanSpeed': '%.6f' % pan, 'TexVPanSpeed': '0.000000'}


def packages(edits):
    """Texture and class packages the zones of the map use (OBJ LOAD before the brushes and actors)."""
    out = []
    boxes = edits.get('boxes') or []
    if any(b.get('water') for b in boxes):
        out.append('OBJ LOAD FILE="%s.utx"' % LIQUID_PACKAGE)
    if sky_needed(edits):
        out += ['OBJ LOAD FILE="CoreTexSky.utx"', 'OBJ LOAD FILE="CoreTexMisc.utx"']
    used = {a.get('cls', '').split('.')[-1] for a in edits.get('added') or []}
    for cls, pkg in sorted(CLASS_PACKAGE.items()):
        if cls in used and 'OBJ LOAD FILE="%s.u"' % pkg not in out:
            out.append('OBJ LOAD FILE="%s.u"' % pkg)
    return out


def report(t3d_text, edits):
    """After the build: is every zone of the editor closed? A zone actor that is not in a zone of its own
    shares the zone it is in (often the whole map): its water, damage, fog or gravity would be there too."""
    mine = {a['name'] for a in actors(edits)}
    mine |= {a['name'] for a in edits.get('added') or [] if a.get('cls', '').split('.')[-1] in ZONE_CLASSES}
    if sky_needed(edits):
        mine.add('UCSkyZone')
    if not mine:
        return []
    region, cls_of = {}, {}
    for m in re.finditer(r'Begin Actor Class=(\S+) Name=(\S+)\n(.*?)End Actor', t3d_text, re.S):
        z = re.search(r"Region=\(Zone=\w+'(?:\w+\.)?(\w+)'", m.group(3))
        region[m.group(2)] = z.group(1) if z else None
        cls_of[m.group(2)] = m.group(1)
    lines = []
    for n in sorted(mine):
        if n not in region:
            continue
        z = region[n]
        if z == n:
            starts = [a for a, zz in region.items() if zz == n and cls_of.get(a) == 'PlayerStart']
            if starts and cls_of.get(n) != 'SkyZoneInfo':
                lines.append('  ZONE %s contains the start of the map (JC starts in its water, damage...)' % n)
            continue
        lines.append('  ZONE %s is not closed: it is part of the zone of %s (its water, damage, fog or gravity '
                     'would not be there; close the area with walls or zone portals)' % (n, z or 'the map'))
    return lines
