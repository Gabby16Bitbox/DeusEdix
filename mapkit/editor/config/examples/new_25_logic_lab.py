"""25_Logic_Lab - the patterns that come with DeusEdix, one in each cell (Logic window: a block each).

Take it apart: each block of the Logic window is a pattern of the library (Patterns), placed here on these objects.

    python tools\\mapkit\\maps\\new_25_logic_lab.py            # builds tools\\mapkit\\out\\25_Logic_Lab.dx
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
sys.path.insert(0, str(KIT))
from geom import Mat, box  # noqa: E402
from scene import Scene  # noqa: E402

MAP = '25_Logic_Lab'
OUT = KIT / 'out' / (MAP + '.dx')
s = Scene(MAP)
CELL, N = 1024, 10
X0 = -(N - 1) * CELL / 2
W = N * CELL + 512
HY0, HY1, H = -768, 0, 384
RY0, RY1 = 32, 544
FLOOR, WALLS, CEILING = Mat('ClenGrayCemnt_A'), Mat('DrtyGrayBlock_A'), Mat('WhitCeilnTile_B')
METAL = Mat('DrtySilvMetal_A')
DOORS = {0: ('KeycardDoor', {'bLocked': True, 'KeyIDNeeded': 'LabKeycard'}), 1: ('HackDoor', {'bLocked': True}), 2: ('SealDoor', {'bLocked': False}), 4: ('WaveDoor', {'bLocked': True}), 6: ('VaultDoor', {'bLocked': True})}

s.begin_group('room', 'Hall', 'Building')
s.sub(box((-W / 2, HY0, 0), (W / 2, HY1, H), {'sides': WALLS, 'top': CEILING, 'bottom': FLOOR}))
for k in range(N):
    x = X0 + k * CELL
    s.sub(box((x - CELL / 2 + 64, RY0, 0), (x + CELL / 2 - 64, RY1, 320), {'sides': WALLS, 'top': CEILING, 'bottom': FLOOR}))
    s.sub(box((x - 64, HY1 - 1, 0), (x + 64, RY0 + 1, 128), {'sides': WALLS, 'top': WALLS, 'bottom': FLOOR}))   # the doorway
    s.actor('Light', (x, (RY0 + RY1) / 2, 296), LightBrightness=140, LightRadius=24, LightHue=0, LightSaturation=255)
    s.actor('Light', (x - CELL / 2, (HY0 + HY1) / 2, H - 24), LightBrightness=150, LightRadius=40, LightHue=0, LightSaturation=255)
    s.actor('PathNode', (x, -400, 16))
s.actor('Light', (W / 2 - 256, (HY0 + HY1) / 2, H - 24), LightBrightness=150, LightRadius=40, LightHue=0, LightSaturation=255)
# 9: the pit of the lever bridge, and the bridge down in it
x9 = X0 + 9 * CELL
s.sub(box((x9 - 256, 160, -320), (x9 + 256, 416, 0), {'sides': WALLS, 'top': WALLS, 'bottom': FLOOR}))
s.end_group()

for k, (name, extra) in DOORS.items():
    x = X0 + k * CELL
    s.mover('DeusExMover', (x, (HY1 + RY0) / 2, 0), box((-64, -8, 0), (64, 8, 128), {'all': METAL}), name=name, Tag=name,
            NumKeys=2, MoveTime=1, bIsDoor=True, bFrobbable=True, bPickable=False, bBreakable=False,
            InitialState='TriggerToggle', **{'KeyPos(1)': '(Z=124.000000)'}, **extra)
s.mover('ElevatorMover', (X0 + 3 * CELL, -400, 8), box((-96, -96, -8), (96, 96, 0), {'all': METAL}), name='Lift', Tag='Lift',
        NumKeys=2, MoveTime=2, **{'KeyPos(1)': '(Z=192.000000)'})
s.mover('DeusExMover', (x9, 288, -200), box((-64, -128, -8), (64, 128, 0), {'all': METAL}), name='Bridge', Tag='Bridge',
        NumKeys=2, MoveTime=1.5, bIsDoor=False, bFrobbable=False, bPickable=False, bBreakable=False,
        InitialState='TriggerToggle', **{'KeyPos(1)': '(Z=200.000000)'})

s.actor('PlayerStart', (X0, -640, 48), rot=(0, 16384, 0))
s.actor('Teleporter', (X0, -640, 48), name='Start', Tag='Start', bEnabled=False, rot=(0, 16384, 0))
s.actor('DeusExLevelInfo', (X0, -640, H - 48), MapName='"25_Logic_Lab"', MissionLocation='"25_Logic_Lab"', missionNumber=25,
        Script='None', ConversationPackage='"None"')

if __name__ == '__main__':
    s.build(OUT, edits=HERE / 'new_25_logic_lab.edits.json')
