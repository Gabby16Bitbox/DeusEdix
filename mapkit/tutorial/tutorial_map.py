"""DeusEdix training wing: eight compact rooms on a winding route, with stable lesson actor names, and behind
the Library an optional advanced wing of four more (dialogue choices, timers and keypads, an ambush, scripts).

Booth proportions follow 00_Training: floor 96 above the hall, sill another 32,
128-high glazing, 384-wide control room. Geometry is generated here; textures and
music are resolved from the player's game. No original map is distributed.
"""
import copy
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
TUT = KIT / 'tutorial'
sys.path[:0] = [str(KIT), str(TUT), str(KIT / 'editor')]
import training_reference as reference
import geom
import settings
from geom import Mat, box, sign_box
from scene import DEFAULT_PACKAGES, PF_TRANSLUCENT, PF_TWOSIDED, PF_UNLIT, Scene

MAP = '00_DeusEdix_Tutorial'
OUT = KIT / 'out' / (MAP + '.dx')
class TrainingScene(Scene):
    def build(self, out_map, edits=None, **kwargs):
        import layout_defaults
        return layout_defaults.build(self, out_map, edits, TUT, super().build, **kwargs)

    def _apply_prefabs(self, edits):
        report = super()._apply_prefabs(edits)
        expected = {'paste~' + entry['pid'] for entry in edits.get('prefabs', []) if not entry.get('deleted')}
        missing = expected - {name for name, _ in self.pastes}
        if missing:
            raise RuntimeError('Training scenery could not be imported: ' + ', '.join(sorted(missing)))
        return report

    def _apply_actor_edits(self, edits):
        # The recruit connects either leaf. The physical double door opens as one assembly,
        # while the saved exercise still contains exactly the rule they wrote.
        edits = copy.deepcopy(edits)
        # An explicit animation replaces its stock controller, never a second controller.
        replaced = {'UCAnim_' + name for name in edits.get('anims', {})}
        self.actors = [block for block in self.actors if not
                       (block.startswith('Begin Actor Class=UCAnimSet ') and
                        block.split('Name=', 1)[1].split()[0] in replaced)]
        names = {a.split('Name=', 1)[1].split()[0] for a in self.actors}
        for link in edits.get('links', []):
            actions = link.get('do', [])
            for action in list(actions):
                name = action.get('target', '')
                if action.get('verb') not in ('open', 'close', 'toggle', 'lock', 'unlock'):
                    continue
                if not name.startswith(('TutorialDoor', 'TrainingDoor', 'TutorialVault')):
                    continue
                other = name[:-5] if name.endswith('Right') else name+'Right'
                if other not in names or other in edits.get('deleted', {}):
                    continue
                twin = dict(action, target=other)
                if twin not in actions:
                    actions.append(twin)
        return super()._apply_actor_edits(edits)


s = TrainingScene(MAP, packages=DEFAULT_PACKAGES + ['UNATCO', 'NycBar', 'CoreTexTextile', 'OceanLab'])
s.auto_groups = False  # Named teaching objects stay easy to select in the hierarchy.
# Actor sound references only survive the native T3D import if their package is
# already loaded. These are the original 00_Training sliding-door sounds.
s.extra_obj += ['OBJ LOAD FILE="Training_Music.umx"', 'OBJ LOAD FILE="Ambient.uax"',
                'OBJ LOAD FILE="MoverSFX.uax"']
if settings.IS_REVISION:
    s.extra_obj += ['OBJ LOAD FILE="RevisionDeco.u"']
s.after_textures += ["UC_PROP @LevelInfo Song Music'Training_Music.Training_Music'"]
TUTORIAL = json.loads((TUT / 'tutorial.json').read_text(encoding='utf-8'))
LAYOUT = TUTORIAL['layout']
ROOMS = [r['size'] for r in LAYOUT]
ORIGINS = [r['origin'] for r in LAYOUT]
TITLES = TUTORIAL['rooms']
GUIDE = json.loads((TUT / 'guide.json').read_text(encoding='utf-8'))
TIPS = json.loads((TUT / 'tips.json').read_text(encoding='utf-8'))
FLOOR, WALLS = Mat('Uob_Floor_A'), Mat('Uob_BlockWall_A')
CEILING, TRIM = Mat('Uob_ConRmCeiln'), Mat('Heli_LiftMetl_A')
PLATE, DOOR = Mat('UN_Wall_Green'), Mat('un_BlastDoor_A')
WOOD, WOOD_FLOOR = Mat('un_woodwall_b'), Mat('un_woodfloor_a')
GLASS = Mat('WindOpacStrek_A', flags=PF_TRANSLUCENT | PF_TWOSIDED)
BOOTH_FLOOR, SILL, WINDOW_TOP = 96, 128, 256
HALF = dict(CrateUnbreakableSmall=16.0, CrateUnbreakableMed=32.0,
            UNATCOTroop=47.5, ScientistMale=45.13, ScientistFemale=45.13,
            WHDeskLibrarySmall=27.0, WHBookstandLibrary=27.0, CoffeeTable=13.68,
            ChairLeather=23.25, Lamp1=24.39, Plant2=43.88, WaterCooler=41.57,
            OfficeChair=25.55, ComputerPersonal=7.4, BookOpen=1.42, BookClosed=1.7,
            DataCube=2.0, UCCustomCivilian=45.13, Basketball=10.0, CrateExplosiveSmall=16.0)
# The original game has no RevisionDeco. Keep the lesson actor identity but
# use its own tabletop drink prop, with the real vanilla collision height.
COFFEE = 'RevisionDeco.Mugfull' if settings.IS_REVISION else 'Sodacan'
HALF[COFFEE] = 4.0 if settings.IS_REVISION else 4.5
if not settings.IS_REVISION:
    for tip in TIPS:
        tip['text'] = tip['text'].replace('Revision/System/Revision.log', 'System/DeusEx.log')
        tip['text'] = tip['text'].replace('Revision/DeusEdixMaps', settings.MAPS_DIR_NAME).replace('Revision.ini', 'DeusEx.ini')


def on(cls, x, y, base=0.0, yaw=0, name=None, **props):
    """The collision bottom rests on the actual supporting surface, never the sill."""
    return s.actor(cls, (x, y, base + HALF[cls]), name=name, rot=(0, yaw, 0), **props)


def text(t):
    return '"%s"' % '|n'.join(t.strip().replace('"', "'").replace(chr(92), '/').splitlines())


def detail(lo, hi, mat=TRIM):
    s.add(box(lo, hi, mat), semisolid=True)


def hazard(lo, hi, width=12):
    b = box(lo, hi, TRIM)
    for f in b.faces:
        ext = [max(p[i] for p in f.verts) - min(p[i] for p in f.verts) for i in range(3)]
        rot = (90 if ext[0] >= ext[1] else 0) if abs(f.normal[2]) > .7 else (0 if ext[2] >= max(ext[:2]) else 90)
        f.mat = Mat('WarnYeloStrip_A', (width, 4 * width), rot=rot)
        u = geom.mapping(f, False)[0]
        f.mat = f.mat.with_(align=min(f.verts, key=u.dot))
    s.add(b, semisolid=True)


def sign(label, face, x, y, z, width=192, green=False):
    """The editor's simple sign construction, with a text texture made locally the way the game draws its
    signs (signs.py): an enamel plate under a UNATCO band, DANGER over the live ranges, CAUTION at the
    doors; 'A / B' puts B on a smaller second line. green = the unlit welcome plate (UNATCO blue)."""
    import signs
    from signs import Line
    name = 'TrainingSign%d' % len(s.textures)
    path = KIT / 'textures' / '_tutorial' / (name + '.pcx')
    first, _, second = (p.strip() for p in label.partition(' / '))
    lines = [Line(first, .5)] + ([Line(second, .32)] if second else [])
    if green:
        signs.plate(path, (512, 128), 'unatco', [Line(first, .52), Line(second or 'UNATCO TRAINING WING', .24)])
    elif any(w in label for w in ('DEMOLITION', 'LIVE FIRE')):
        signs.plate(path, (512, 128), 'notice', lines, header='danger', header_size=.32)
    elif 'AUTHORIZED' in label:
        signs.plate(path, (512, 128), 'notice', lines, header='caution', header_size=.28)
    else:
        signs.plate(path, (512, 128), 'notice', lines, header='unatco', header_size=.26)
    s.texture(path, name, 'TrainingSigns')
    half, h = width / 2, width / 8
    lo, hi = {'-x': ((x-2, y-half, z-h), (x, y+half, z+h)),
              '+x': ((x, y-half, z-h), (x+2, y+half, z+h)),
              '-y': ((x-half, y-2, z-h), (x+half, y, z+h)),
              '+y': ((x-half, y, z-h), (x+half, y+2, z+h))}[face]
    s.add(sign_box(lo, hi, face, name, TRIM, flags=PF_UNLIT if green else 0), semisolid=True)


def ceiling_light(x, y, z, warm=False, width=96):
    detail((x-width/2-4, y-20, z-8), (x+width/2+4, y+20, z), TRIM)
    detail((x-width/2, y-16, z-10), (x+width/2, y+16, z-8),
           {'bottom': Mat('Uob_HangnLight', rot=90, flags=PF_UNLIT), 'all': TRIM})
    s.light((x, y, z-24), brightness=160 if warm else 200, hue=28 if warm else 145,
            sat=165 if warm else 225, radius=24)


def watching(name, x, y, anim, rate=.5):
    s.actor('UCAnimSet', (x, y, BOOTH_FLOOR+48), name='UCAnim_'+name,
            PawnName=name, IdleAnim=anim, IdleRate='%.6f' % rate)


# A quiet burgundy weave, generated locally, gives reception the requested red floor.
# Its mirror flag is handled by the game renderer; the editor shows the base material.
from PIL import Image
carpet = Image.new('RGB', (128,128))
carpet.putdata([(96+((x*17+y*31)%9)-4, 17+((x+y)%3), 27+((x*3+y)%5))
                for y in range(128) for x in range(128)])
carpet_path=KIT/'textures'/'_tutorial'/'TrainingBurgundy.pcx'
carpet_path.parent.mkdir(parents=True,exist_ok=True)
carpet.quantize(colors=32).save(carpet_path)
s.texture(carpet_path,'TrainingBurgundy','Training')

# Carve the complete connected shell before fittings. The cells make genuine L/U plans;
# the central service core of the drill hall cannot be walked or seen straight through.
for i, room in enumerate(LAYOUT):
    cx, cy = room['origin']
    s.begin_group('room%d' % i, room['label'], 'Building')
    if i == 0:
        # The original's smaller observation hall, at its exact scale (496 x 544 x 304).
        first = len(s.ops)
        reference.room(s, (112, 576, -192), (608, 1120, 112), (360, 848, -192), (0, 0, 0),
                       materials={'Uob_ConRmFloor': 'TrainingBurgundy', 'BlastDoors_B': 'un_BlastDoor_A'})
        for _, shape, _ in s.ops[first:]:
            for f in shape.faces:
                if all(abs(v[2]) < .01 for v in f.verts):
                    f.mat = Mat('TrainingBurgundy', flags=f.mat.flags | 0x08000000)
    else:
        mats = {'sides': WOOD if i == 7 else WALLS, 'top': CEILING,
                'bottom': WOOD_FLOOR if i == 7 else FLOOR}
        for x0, y0, x1, y1 in room['cells']:
            s.sub(box((cx+x0, cy+y0, 0), (cx+x1, cy+y1, room['size'][2]), mats))
    s.end_group()

# Short vestibules alternate east, south, west and north instead of lining up all eight rooms.
LESSON_DOORS = {2: 'TutorialDoor', 8: 'TutorialVault'}
PASSAGES = []
for i, passage in enumerate(TUTORIAL['passages']):
    a, b = passage['from'], passage['to']
    mid = tuple((a[k]+b[k])/2 for k in range(2))
    yaw = 0 if a[1] == b[1] else 16384
    xf = geom.XForm((0, 0, 0), (*mid, 0), yaw=yaw)
    length = abs(b[0]-a[0])+abs(b[1]-a[1])
    def slab(lo, hi, mat):
        # Local X follows the corridor; local Y is across its width.
        pts = [xf.point(p) for p in (lo, hi)]
        return box(tuple(min(p[k] for p in pts) for k in range(3)),
                   tuple(max(p[k] for p in pts) for k in range(3)), mat)
    s.begin_group('passage%d' % i, 'Vestibule: '+TITLES[i+1], 'Building')
    s.sub(slab((-length/2-1, -64, 0), (length/2+1, 64, 128),
               {'sides': TRIM, 'top': CEILING, 'bottom': FLOOR}))
    s.sub(slab((-5, -121, 0), (5, 121, 128), TRIM))
    s.end_group()
    PASSAGES.append((mid, yaw, xf, length))

# Only the two rooms where observation serves the lesson have glass.
BOOTHS = [(0, (0, 272, 0), 0), (2, (992, -704, 0), 49152)]
for i, at, yaw in BOOTHS:
    s.begin_group('booth%d' % i, 'Observation booth: '+TITLES[i], 'Building')
    reference.room(s, (8, 1120, -96), (712, 1712, 144), (360, 1120, -192), at,
                   materials={'drtywater_a': 'Uob_Floor_A'}, yaw=yaw)
    xf = geom.XForm((0, 0, 0), at, yaw=yaw)
    s.light(xf.point((0, 70, 220)), brightness=100, hue=145, sat=95, radius=12)
    s.end_group()

# Each plan has its own lighting rhythm: amber stores, cool security, bright drill lanes,
# a low task-lit lab, warm reading lamps. Every light has a physical ceiling fitting.
LAMPS = {1: [(-80, 80), (176, -208)], 2: [(0, 0)],
         3: [(-208, 160), (-208, -160), (208, 160), (208, -160), (0, -192)],
         4: [(0, 0)], 5: [(-144, 0), (144, 0)], 7: [(0, 80)],
         8: [(0, 40)], 9: [(-128, 0), (128, 0)], 10: [(-128, -96), (128, 96)], 11: [(-96, 0), (96, 0)]}
for i, spots in LAMPS.items():
    cx, cy = ORIGINS[i]
    h = ROOMS[i][2]
    s.begin_group('room_detail%d' % i, TITLES[i]+' lighting', 'Building')
    for x, y in spots:
        ceiling_light(cx+x, cy+y, h, warm=i in (1, 7), width=64 if i == 3 else 96)
    s.actor('AmbientSound', (cx+spots[0][0], cy+spots[0][1], h-32),
            AmbientSound="Sound'Ambient.Ambient.HumLight2'", SoundRadius=8, SoundVolume=18, SoundPitch=54)
    s.end_group()

for i, (mid, yaw, xf, length) in enumerate(PASSAGES):
    s.begin_group('doorframe%d' % i, 'Security frame %d' % i, 'Building')
    for end in (-1, 1):
        x = end*(length/2-2)
        for y in (-68, 68):
            pts = [xf.point((x-2, y-4, 0)), xf.point((x+2, y+4, 136))]
            hazard(tuple(min(p[k] for p in pts) for k in range(3)),
                   tuple(max(p[k] for p in pts) for k in range(3)))
        pts = [xf.point((x-2, -64, 128)), xf.point((x+2, 64, 136))]
        hazard(tuple(min(p[k] for p in pts) for k in range(3)),
               tuple(max(p[k] for p in pts) for k in range(3)), width=8)
        # Label each side for the room reached, independently of corridor direction.
        forward = TUTORIAL['passages'][i]['to'][0 if yaw == 0 else 1] > TUTORIAL['passages'][i]['from'][0 if yaw == 0 else 1]
        destination = i+1 if (end == -1) == forward else i
        face = ('-x' if end == -1 else '+x') if yaw == 0 else ('-y' if end == -1 else '+y')
        px, py, _ = xf.point((x+end*3, 0, 162))
        sign('ROOM %d / %s' % (destination, TITLES[destination].upper()), face, px, py, 162, width=160)
    s.light((*mid, 116), brightness=85, hue=145, sat=230, radius=6)
    for x in (-length/2+24, length/2-24):
        s.actor('PathNode', xf.point((x, 0, 48)))
    s.end_group()
    # the doors of a lesson open only by a rule: room 2's by the button, the advanced wing's vault by a dialogue
    lesson = i in LESSON_DOORS
    tag = LESSON_DOORS.get(i, 'TrainingDoor%d' % i)
    for leaf, direction in enumerate((-1, 1)):
        name = tag if leaf == 0 else tag+'Right'
        shape = reference.transformed(reference.door_shape(), geom.XForm((0, 0, 0), yaw=yaw))
        travel = xf.vec((0, direction*56, 0))
        s.mover('DeusExMover', xf.point((0, direction*32, 64)), shape, name=name, Tag=tag,
                NumKeys=2, MoveTime=2, StayOpenTime=3600 if lesson else 5,
                bDynamicLightMover=False, bIsDoor=True, bFrobbable=not lesson,
                bBreakable=False, bPickable=False, MoverEncroachType='ME_ReturnWhenEncroach',
                InitialState='TriggerOpenTimed' if lesson else 'TriggerToggle',
                **{'KeyPos(1)': '(X=%g,Y=%g,Z=0)' % travel[:2]})
        s.actors[-1] = s.actors[-1].replace('End Actor',
            "    OpeningSound=Sound'MoverSFX.door.SlideDoorOpen'\n"
            "    ClosedSound=Sound'MoverSFX.door.SlideDoorClose'\nEnd Actor")

# Hale and the engineers rest on the original observation floor, 96 above the recruit.
g = GUIDE
props = {'Mesh': "LodMesh'%s'" % g['mesh'], 'LookBody': "Class'%s.%s'" % (g['lookPkg'], g['lookBody']),
         'CollisionRadius': '%.6f' % g['radius'], 'CollisionHeight': '%.6f' % g['height'],
         'FamiliarName': text(g['name']), 'UnfamiliarName': text(g['unfamiliar']), 'BindName': text(g['bind']),
         'Alliance': g['faction'], 'InitialAlliances(0)': '(AllianceName=Player,AllianceLevel=1.000000,bPermanent=True)',
         'Orders': g['orders'], 'bInvincible': 'True'}
props.update({'MultiSkins(%d)' % k: "Texture'%s'" % t for k, t in enumerate(g['skins'])})
HALF['UCCustomCivilian'] = g['height']
on('UCCustomCivilian', 40, 360, base=96, yaw=49152, name='TutorialGuide', **props)
watching('TutorialGuide', 40, 360, 'GestureRight', .35)
for y, cls, name, label in [(-640, 'ScientistFemale', 'TutorialObserver0', 'Dr. Mira Okafor'),
                            (-768, 'ScientistMale', 'TutorialObserver1', 'Tomas Reiner')]:
    on(cls, 1080, y, base=96, yaw=32768, name=name, FamiliarName=text(label),
       UnfamiliarName=text(label), Orders='Standing', bInvincible=True)
watching('TutorialObserver0', 1080, -640, 'GestureLeft', .35)
on('ScientistFemale', -64, -1152, yaw=0, name='TutorialObserver2',
   FamiliarName=text('Specialist June Halloran'), Orders='Standing', bInvincible=True)
s.actor('UCAnimSet', (-64, -1152, 48), name='UCAnim_TutorialObserver2',
        PawnName='TutorialObserver2', IdleAnim='GestureBoth', IdleRate='.35')

# Reception: original wall recesses, ceiling and observation console, a burgundy reflective floor,
# waiting bench and two planters. This is a reception, not another oversized drill hall.
s.begin_group('reception', 'Reception waiting area', 'Building')
sign('WELCOME, RECRUIT', '-y', 0, 270, 80, width=192, green=True)
detail((-216, -170, 28), (-184, 30, 36), Mat('Uob_Concrete'))
for y in (-154, -2):
    detail((-212, y, 0), (-188, y+16, 28))
on('WaterCooler', 200, -210)
on('Plant2', -200, 204)
on('Plant2', 200, 204)
s.light((0, -120, 220), brightness=150, hue=28, sat=200, radius=18)
s.end_group()

# L-shaped stores: racks in the long loading aisle; placement lesson around the corner.
s.begin_group('stores', 'L-shaped stores: shelves, pallets and loading marks', 'Building')
for x0,y0,x1,y1 in [(416, 144, 656, 188), (404, -320, 448, -144)]:
    for z in (8, 72, 136):
        detail((x0,y0,z), (x1,y1,z+6))
    for x in (x0,x1-6):
        for y in (y0,y1-6):
            detail((x,y,0), (x+6,y+6,180))
    for z in (78,142):
        for frac in (.25,.75):
            # Follow the rack's long axis, including the narrow rack against the west wall.
            x,y = (x0+(x1-x0)*frac,(y0+y1)/2) if x1-x0 > y1-y0 else ((x0+x1)/2,y0+(y1-y0)*frac)
            on('CrateUnbreakableSmall', x, y, base=z)
hazard((456,-336,0), (468,136,1))
hazard((468,-352,0), (904,-340,1))
detail((848,-184,0), (936,-96,8), WOOD_FLOOR)
on('CrateUnbreakableMed',892,-140,base=8)
sign('STORES / REQUISITIONS', '-y', 536, 190, 204, width=192)
on('DataCube', 540, 164, base=142, name='TrainingCoffeeMemo',
   SpecialText=text('MEMO: COFFEE\nTo: training wing staff\nThe coffee budget for this quarter is spent. It was spent in the first week. Whoever keeps refilling the booth in room 0 knows who they are.\nAccounting'),
   textTag='None', TextPackage='"UCText_%s_TrainingCoffeeMemo"' % MAP)
s.end_group()
s.begin_group('plate', 'Crate stockpile', 'Building')
x0,y0,x1,y1 = TUTORIAL['plate']
s.add(box((x0,y0,0), (x1,y1,2), {'top': PLATE, 'all': TRIM}))
s.light(((x0+x1)/2,(y0+y1)/2,150), brightness=95, hue=75, sat=155, radius=7)
s.end_group()
on('CrateUnbreakableSmall',528,-24,name='TutorialCrate')

# Compact security control room: the red-lit exit and adjacent button are seen together.
s.begin_group('button_panel', 'Security door control', 'Building')
detail((608,-684,40),(614,-620,104),Mat('Uob_Consocab_D'))
sign('DOOR SAFETY / AUTHORIZED PERSONNEL', '-y',800,-514,166,width=240)
s.light((640,-752,154),brightness=105,hue=0,sat=85,radius=8)
s.end_group()
s.actor('Button1',(618,-652,72),name='TutorialButton',rot=(0,0,0))

# Horseshoe drill hall: enter the right lane, turn around a service core and leave by the left.
# Low obstacles occupy the sides only; a clear continuous walkway serves the lesson.
s.begin_group('drill_hall','Horseshoe drill course and instructor station','Building')
detail((72,-1256,0),(216,-1112,8),Mat('Uob_Concrete'))
for x in (-168,440):
    for y in (-1000,-840):
        detail((x,-12+y,0),(x+16,36+y,32),Mat('Uob_Concrete'))
for x in (-160,432):
    hazard((x,-1200,0),(x+8,-712,1),width=8)
sign('MOVEMENT / BEHAVIOUR', '+y',144,-1074,152,width=176)
sign('EXIT / LABORATORY', '-x',-174,-656,164,width=144)
s.end_group()
on('UNATCOTroop',144,-1184,base=8,yaw=0,name='TutorialTrooper',Orders='Standing')
for x,y in [(352,-752),(352,-1184),(144,-1184),(-64,-1184),(-64,-752)]:
    s.actor('PathNode',(x,y,48))

# Lab: a low ceiling, two workstations and storage. The conversation happens at arm's length.
s.begin_group('lab','Laboratory workstations and specimen storage','Building')
for x in (-608,-384):
    # The computer's visible keyboard/display mesh is deeper than its collision cylinder.
    detail((x-48,-906,0),(x+48,-814,48),Mat('Uob_Consocab_D'))
    on('ComputerPersonal',x,-860,base=48,yaw=16384)
    on('OfficeChair',x,-792,yaw=49152)
detail((-680,-688,0),(-636,-600,96),{'all':TRIM,'+x':Mat('un_MetalDoor_A')})
sign('RESEARCH / TRANSCRIPTS','-y',-400,-594,144,width=152)
s.end_group()
on('ScientistFemale',-432,-736,yaw=32768,name='TutorialScientist',Orders='Standing',bInvincible=True)

# Materials workshop: two ordinary game crates, one deliberately overdesigned by Hale.
# The little face is drawn by the map script; no edited game texture is distributed.
from PIL import Image, ImageDraw
smile = Image.new('RGB', (256,256), '#8b7252')
paint = ImageDraw.Draw(smile)
# This stock crate uses a 2x2 UV atlas, not one full image on each face.
for ox,oy in ((0,0),(128,0),(0,128),(128,128)):
    def tile(rect):
        return (ox+rect[0],oy+rect[1],ox+rect[2],oy+rect[3])
    for y in range(0,128,16):
        paint.line(tile((0,y,127,y)),fill='#64513b',width=2)
    paint.rectangle(tile((2,2,125,125)),outline='#423e37',width=8)
    paint.ellipse(tile((25,25,103,103)),fill='#ddba39',outline='#6b551b',width=2)
    paint.ellipse(tile((45,46,52,56)),fill='#282722')
    paint.ellipse(tile((76,46,83,56)),fill='#282722')
    paint.arc(tile((43,48,85,87)),0,180,fill='#282722',width=4)
smile_path=KIT/'textures'/'_tutorial'/'HaleMoraleCrate.pcx'
smile_path.parent.mkdir(parents=True,exist_ok=True)
smile.quantize(colors=64).save(smile_path)
s.texture(smile_path,'HaleMoraleCrate','Training')
s.begin_group('materials','Materials workshop: side-by-side submissions','Building')
for x,label in [(-1248,'HALE / APPROVED'),(-992,'RECRUIT / PENDING')]:
    detail((x-64,-696,0),(x+64,-568,24),TRIM)
    sign(label,'-y',x,-698,18,width=112)
# Paint samples, a workbench and the rejected submissions cabinet give the room a purpose.
for x,mat in [(-1328,'UN_Wall_Green'),(-1232,'WarnYeloStrip_A'),(-1136,'Uob_BlockWall_A')]:
    detail((x-32,-942,80),(x+32,-936,144),Mat(mat))
detail((-1360,-932,0),(-1120,-884,48),Mat('Uob_Consocab_D'))
on('OfficeChair',-1248,-828,yaw=49152)
sign('MATERIALS / MORALE IMPROVEMENT','-x',-818,-656,180,width=192)
s.end_group()
on('CrateUnbreakableMed',-1248,-632,base=24,name='TutorialHaleCrate',
   **{'MultiSkins(0)': "Texture'MyLevel.Training.HaleMoraleCrate'"})
on('CrateUnbreakableMed',-992,-632,base=24,name='TutorialTextureCrate')

# Film stage: The Last Cup. A single mug on a pedestal, two guards, cold backlight and a warm key.
# There is deliberately no ready-made camera or connection: those are the recruit's exercise.
s.begin_group('film_set','Film stage: The Last Cup','Building')
detail((-1360,32,0),(-848,40,240),Mat('Heli_LiftMetl_A'))
detail((-1176,-104,0),(-1032,40,16),Mat('Uob_Concrete'))
detail((-1128,-56,16),(-1080,-8,60),TRIM)
sign('THE LAST CUP / TAKE 001','-y',-1104,30,204,width=240)
sign('SCREENING','+x',-1390,-300,126,width=144)
for x in (-1344,-864):
    detail((x-12,12,0),(x+12,20,224),Mat('Uob_HangnLight',flags=PF_UNLIT))
s.light((-1104,-220,160),brightness=235,hue=28,sat=180,radius=20)
s.light((-1264,0,200),brightness=150,hue=145,sat=80,radius=10)
s.light((-944,0,200),brightness=100,hue=0,sat=95,radius=9)
s.light((-1104,-360,140),brightness=70,hue=145,sat=225,radius=10)
# Camera marks sit flush with the stage floor.
hazard((-1232,-360,0),(-1200,-328,1),width=8)
hazard((-1156,-192,0),(-1124,-160,1),width=8)
s.end_group()
on(COFFEE,-1104,-32,base=60,name='TutorialCoffee',bInvincible=True)
for x,name in [(-1248,'TutorialCoffeeGuard0'),(-960,'TutorialCoffeeGuard1')]:
    on('UNATCOTroop',x,-16,yaw=49152,name=name,Orders='Standing',bInvincible=True)
s.actor('Button1',(-1382,-300,72),name='TutorialFilmButton',rot=(0,0,0))

# Library: timber, low bookshelves, two facing reading chairs and warm pools of lamplight.
s.begin_group('library_furniture','Library reading alcove and reference shelves','Building')
for x in (-640,-352):          # the gap between them: the door to the advanced wing
    for z in (8,48,88,128):
        detail((x-72,0,z),(x+72,44,z+6),WOOD_FLOOR)
    for dx in (-72,66):
        detail((x+dx,0,0),(x+dx+6,44,176),WOOD)
    for dx,z in ((-44,54),(0,94),(44,134)):
        on('BookClosed',x+dx,24,base=z)
sign('REFERENCE LIBRARY / QUIET','-y',-496,46,200,width=200)
s.light((-376,-96,132),brightness=90,hue=28,sat=135,radius=10)
s.light((-600,-280,120),brightness=80,hue=28,sat=155,radius=10)
s.end_group()
on('WHDeskLibrarySmall',-376,-100,yaw=0)
on('WHBookstandLibrary',-632,-110,yaw=49152)
on('CoffeeTable',-590,-292)
on('ChairLeather',-680,-292,yaw=0)
on('ChairLeather',-500,-292,yaw=32768)
on('Plant2',-310,-400)
on('Lamp1',-352,-100,base=54)
spots=[('BookOpen',-632,-110,54),('BookClosed',-400,-100,54),('BookClosed',-376,24,54),
       ('BookClosed',-606,-284,27.36),('BookClosed',-576,-300,27.36),('DataCube',-640,24,54)]
for k,(tip,(cls,x,y,base)) in enumerate(zip(TIPS,spots)):
    name='TutorialBook%d' % k
    on(cls,x,y,base,yaw=(k*9000)%65536,name=name,SpecialText=text(tip['text']),
       textTag='None',TextPackage='"UCText_%s_%s"' % (MAP,name))

# ---------------------------------------------------------------- the advanced wing (optional)
# Room 8, interrogation: a table between JC and the archivist who knows how to open the vault (the door north).
s.begin_group('interrogation', 'Interrogation room: the archivist and his table', 'Building')
detail((-672,404,28),(-528,476,34),WOOD)
for x in (-664,-544):
    for y in (412,460):
        detail((x,y,0),(x+8,y+8,28),TRIM)
detail((-816,250,0),(-776,350,180),Mat('Uob_Consocab_D'))
detail((-816,370,0),(-776,470,180),Mat('Uob_Consocab_D'))
sign('INTERVIEW / RECORDED','+x',-824,520,170,width=160)
s.end_group()
on('OfficeChair',-600,350,yaw=16384)
on('ScientistMale',-600,530,yaw=49152,name='TutorialInformant',FamiliarName=text('Leon Duarte'),
   UnfamiliarName=text('Archivist'),Orders='Standing',bInvincible=True)

# Room 9, demolition range: a charge on a pallet, the arming panel and the defuse keypad on the east wall,
# a ten-second timer (an invisible object: TutorialFuse in the Hierarchy).
s.begin_group('range', 'Demolition range: charge, arming panel and keypad', 'Building')
detail((-688,1052,0),(-592,1148,8),WOOD_FLOOR)
for lo,hi in (((-720,1020,0),(-560,1028,1)),((-720,1172,0),(-560,1180,1)),((-720,1028,0),(-712,1172,1)),((-568,1028,0),(-560,1172,1))):
    hazard(lo,hi,width=8)
detail((-392,900,40),(-384,1120,112),Mat('Uob_Consocab_D'))
sign('DEMOLITION RANGE / STAND CLEAR','-y',-640,1224,190,width=240)
s.end_group()
on('CrateExplosiveSmall',-640,1100,base=8,name='TutorialBomb')
s.actor('Button1',(-394,940,72),name='TutorialArmPanel',rot=(0,32768,0))
s.actor('Keypad2',(-394,1080,72),name='TutorialDefusePad',rot=(0,32768,0),validCode='"0451"')
s.actor(settings.PACKAGE+'.UCTimer',(-640,900,64),name='TutorialFuse',Seconds='10.000000',HUDLabel=text('CHARGE'))

# Room 10, ambush yard: two troopers behind cover at the far end, a zone across the entrance.
s.begin_group('yard', 'Ambush yard: cover crates and the entrance zone', 'Building')
sign('AMBUSH YARD / LIVE FIRE','-y',-1280,1224,180,width=200)
hazard((-1180,800,0),(-1172,1200,1),width=8)
s.end_group()
for y in (940,1080):
    on('CrateUnbreakableMed',-1392,y)
for k,y in enumerate((940,1080)):
    on('UNATCOTroop',-1480,y,yaw=0,name='TutorialAmbusher%d' % k,Orders='Standing')
s.actor(settings.PACKAGE+'.UCTriggerBox',(-1104,1000,64),name='TutorialAmbushZone',BoxX='64.000000',BoxY='200.000000',BoxZ='64.000000')
for x,y in [(-1460,1000),(-1300,880),(-1300,1120),(-1150,1000),(-1280,830)]:
    s.actor('PathNode',(x,y,48))

# Room 11, code lab: two workstations, and a button for the recruit's own script.
s.begin_group('codelab', 'Code lab: workstations', 'Building')
for x in (-1440,-1344):
    detail((x-44,216,0),(x+44,272,48),Mat('Uob_Consocab_D'))
sign('CODE LAB / UNREALSCRIPT','-x',-1056,300,160,width=176)
s.end_group()
for x in (-1440,-1344):
    on('ComputerPersonal',x,244,base=48,yaw=16384)
    on('OfficeChair',x,312,yaw=49152)
s.actor('Button1',(-1066,440,72),name='TutorialScriptButton',rot=(0,32768,0))

# The recruit places the PlayerStart during the reception lesson.
s.actor('Teleporter',(-120,-170,48),name='Start',Tag='Start',bEnabled=False,rot=(0,0,0))
s.actor('DeusExLevelInfo',(0,0,256),MapName=text(MAP),MissionLocation='"DeusEdix Training Wing"',
        missionNumber=0,Script='None',
        ConversationPackage='"None"' if getattr(settings,'PROJECT_KIND','legacy') == 'tutorial' or not settings.IS_REVISION else 'RevisionConversations',
        **{'startupMessage(0)':'"DeusEdix Training Wing"','startupMessage(1)':'"Restricted area"'})

if __name__ == '__main__':
    s.build(OUT, edits=HERE / (Path(__file__).stem + '.edits.json'))
