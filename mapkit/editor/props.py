"""Properties panel of the map editor: the properties that matter for a mission (doors, keypads, computers,
keys, containers, characters, triggers, the Tag/Event links), with the class defaults read from the game
(host UC_DEFAULTS, cached in cache/_palette/defaults.json: a map's T3D only has what differs from its class).

Edits: edits['props'] = {actor name: {property or property(index): value as UnrealEd text}}; the builds of
script maps and existing maps apply them with the host's UC_PROP (no rebuild: lighting and BSP stay).
"""
import json
import re
from pathlib import Path

import kit
import settings
from classtree import ClassTree

CACHE = Path(__file__).resolve().parent / 'cache' / '_palette' / 'defaults.json'
VERSION = 20               # 20: Counter; 19: Phases, At least N, First of; 18: the logic blocks (UCBAllOf, UCBGate, UCBSwitch) 2: the Character Creator's classes (UCCustom*) of the editor's package; 3: lights; 4: map links; 5: texts; 6: computers
                          # 14: timers (UCTimer) 15: effect points (UCEffectPoint)
                          # 16: a lamp's phase and corona, what a zone does to the view (the 3D view's Effects)
                          # 17: a zone's echo (the Reverb row) and Revision's OpenAL reverb
                          # 7: patrol points (8: their animation) 9: sounds 10: sound effects, door sounds

# (group, class that has it, property, label, kind, help)
# kinds: bool int float name string text(several lines, |n) item(class<Inventory>) choice enum users(struct array of logins)
#        options (specialOptions of a computer) emails / bulletins (edits['texts'], made into map texts by comptexts.py)
#        attitude(InitialAlliances entry for the Player) inventory(InitialInventory items)
#        byte (0-255, a slider) lightcolor (LightHue with a colour picker that also sets LightSaturation)
#        anim (an animation of the characters that use it: PatrolAnim, made real by the editor's UCAnimSet)
#        sound (a sound of the game, chosen and heard in the sound picker: editor/sounds.py)
#        playlist (a sound effect's list of sounds, drawn with its order, its variations and its repeats, the
#        playlistpart fields: static/sound-playlist.js)
ORDERS = ['Standing', 'Wandering', 'Patrolling', 'Sitting', 'Dancing', 'Idle', 'Following']
HIDE = {'UCTriggerBox': ('CollisionRadius', 'CollisionHeight', 'TriggerType')}
# New editor-owned properties remain editable before the first runtime Rebuild.
# Their defaults are fixed here; no expensive SDK defaults scan is needed on upgrade.
EDITOR_DEFAULTS = {'UCTriggerBox': {'bCylinder': ['False'], 'CylinderRadius': ['64.000000'], 'CylinderHeight': ['64.000000']},
                   'UCSoundFX': {'FXSounds': ['None'] * 7, 'FXOrder': ['0'], 'RandomPitch': ['0.000000'],
                                 'RandomVolume': ['0.000000'], 'RepeatMin': ['0.000000'], 'RepeatMax': ['0.000000']},
                   # how many of its contents drop out (Containers.numThings, default 1): not in the class dump
                   'Containers': {'numThings': ['1']}}
CHOICES = {'DamageType': ['Radiation', 'Burned', 'Shocked', 'PoisonGas', 'Poison', 'TearGas', 'HalonGas', 'Drowned'],
           'Mode': ['In turn', 'In order', 'At random']}       # a Switch block's (UCBSwitch.Mode)
FIELDS = [
    ('Links', 'Actor', 'Tag', 'Tag', 'name', 'The name other objects use to find it (the door a button opens, a story action...)'),
    ('Links', 'Actor', 'Event', 'Event', 'name', 'When it is used or triggered, it triggers every object whose Tag is this'),
    ('Door', 'DeusExMover', 'bLocked', 'Locked', 'bool', ''),
    ('Door', 'DeusExMover', 'KeyIDNeeded', 'Key that opens it', 'name', 'The Key ID of a NanoKey (None: no key opens it)'),
    ('Door', 'DeusExMover', 'bPickable', 'Can be lockpicked', 'bool', ''),
    ('Door', 'DeusExMover', 'lockStrength', 'Lock strength', 'float', '0 = easy to pick, 1 = very hard'),
    ('Door', 'DeusExMover', 'bBreakable', 'Can be broken', 'bool', ''),
    ('Door', 'DeusExMover', 'doorStrength', 'Door strength', 'float', '0 = weak, 1 = strong'),
    ('Door', 'DeusExMover', 'bFrobbable', 'JC can open it by hand', 'bool', 'Off: only buttons, keypads or the story open it'),
    ('Door', 'DeusExMover', 'bOneWay', 'Opens from one side only', 'bool', ''),
    ('Door', 'Mover', 'MoveTime', 'Opening time (seconds)', 'float', ''),
    ('Door', 'Mover', 'StayOpenTime', 'Stays open (seconds)', 'float', 'For doors that close by themselves'),
    ('Keypad', 'Keypad', 'validCode', 'Code', 'string', 'The right code triggers the Event (e.g. the Tag of a door)'),
    ('Keypad', 'Keypad', 'bToggleLock', 'Locks/unlocks instead of opening', 'bool', ''),
    ('Keypad', 'Keypad', 'FailEvent', 'Event on a wrong code', 'name', 'e.g. the Tag of an alarm'),
    ('Computer', 'Computers', 'userList', 'Accounts', 'users', 'Login names and passwords (up to 8)'),
    ('Computer', 'ATM', 'userList', 'Accounts', 'users', 'Account numbers and PINs (up to 8)'),
    ('Computer', 'Computers', 'ComputerNode', 'Network', 'enum', 'Whose network it is: the logo and name on its screen'),
    ('Computer', 'Computers', 'specialOptions', 'Special options', 'options', 'Buttons JC finds after logging in: '
     'each one shows a message and triggers an event (the Tag of a door, an alarm, a light...); with a login, '
     'only that account has it'),
    ('Computer', 'ComputerPersonal', 'TextPackage', 'Emails', 'emails', 'The emails of each account, read after '
     'logging in with it. They replace the game emails of this computer'),
    ('Computer', 'ComputerPublic', 'bulletinTag', 'Bulletins', 'bulletins', 'The bulletins of a public terminal '
     '(no login needed). They replace the game bulletins of this terminal'),
    ('Computer', 'ComputerSecurity', 'cameraTag', 'Cameras it controls (Tag)', 'name', ''),
    ('Computer', 'ComputerSecurity', 'turretTag', 'Turrets it controls (Tag)', 'name', ''),
    ('Computer', 'ComputerSecurity', 'doorTag', 'Doors it controls (Tag)', 'name', ''),
    ('Key', 'NanoKey', 'KeyID', 'Key ID', 'name', 'Doors whose "Key that opens it" is this ID open with this key'),
    ('Key', 'NanoKey', 'Description', 'Description', 'string', 'What the key says in the inventory'),
    # books, newspapers, datacubes: what JC reads. SpecialText is Revision's "script-given text" of every
    # InformationDevices (shown when textTag is empty); the editor writes it, line breaks as |n
    ('Text', 'InformationDevices', 'SpecialText', 'What it says', 'text', 'What JC reads when he uses it; a datacube also '
     'puts it in the DataVault. Your text replaces the game text below'),
    ('Text', 'InformationDevices', 'textTag', 'Game text', 'name', 'A text of the game it shows instead (e.g. 01_Datacube03); '
     'None when it shows your own text'),
    # Containers.Destroyed: Content2, then Content3, each takes the place of Contents 3 times in 10 (with all three:
    # about 5 in 10 the first, 2 the second, 3 the third); nothing drops out without Contents
    ('Contents', 'Containers', 'Contents', 'Contains', 'item', 'What drops out when it is broken (the two below count only with this one)'),
    ('Contents', 'Containers', 'Content2', 'Or sometimes', 'item', 'Drops out instead about 3 times in 10'),
    ('Contents', 'Containers', 'Content3', 'Or sometimes', 'item', 'Drops out instead about 3 times in 10 (with all three: about 5 in 10 the first, 2 the second, 3 this one)'),
    ('Contents', 'Containers', 'numThings', 'How many', 'int', 'How many of it drop out'),
    ('Character', 'ScriptedPawn', 'Orders', 'Orders', 'choice', 'What they do when the map starts'),
    # Gabby, 17 Oct 2026: a character the story or an interaction brings in later (a button, a zone...): the
    # game's own bInWorld (out of the world until EnterWorld; the interaction "Come back" does it, out of JC's sight)
    ('Character', 'ScriptedPawn', 'bInWorld', 'There from the start', 'bool',
     'Off: not in the map when it starts; an interaction (Come back, after a button, a zone...) or the story brings '
     'them in, where JC does not see. The editor shows them all the same.'),
    ('Character', 'ScriptedPawn', 'OrderTag', 'Order target (Tag)', 'name', 'Patrolling: the Tag of the first patrol point '
     '(the Patrol route below sets it); Sitting: a seat; Following: a character'),
    ('Character', 'ScriptedPawn', 'Alliance', 'Faction', 'faction', 'The faction they belong to (members of a faction are always friends)'),
    ('Character', 'ScriptedPawn', 'InitialAlliances', 'Relations', 'relations',
     'How they treat JC and the other factions when the map starts; fixed = it never changes by itself (if off, attacking them makes them hostile)'),
    ('Character', 'ScriptedPawn', 'InitialInventory', 'Carries', 'inventory', 'Weapons, ammo and items (up to 8)'),
    ('Character', 'ScriptedPawn', 'FamiliarName', 'Name', 'string', 'Shown in conversations once JC knows them'),
    ('Character', 'ScriptedPawn', 'UnfamiliarName', 'Name before meeting', 'string', ''),
    ('Character', 'ScriptedPawn', 'BindName', 'Conversation name', 'string', 'The name the conversations use (BindName)'),
    ('Character', 'ScriptedPawn', 'Health', 'Health', 'int', '100 = normal'),
    ('Character', 'ScriptedPawn', 'bInvincible', 'Invincible', 'bool', ''),
    ('Character', 'ScriptedPawn', 'bImportant', 'Important for the mission', 'bool', ''),
    ('Patrol point', 'PatrolPoint', 'PauseTime', 'Wait here (seconds)', 'float', 'How long a patrolling character stops '
     'here, turned the way the point faces (0: they walk on)'),
    ('Patrol point', 'PatrolPoint', 'Nextpatrol', 'Next point (Tag)', 'name', 'The Tag of the patrol point they walk to next'),
    ('Patrol point', 'PatrolPoint', 'PatrolAnim', 'Animation while waiting', 'anim', 'What they do while they wait here '
     '(instead of breathing): an animation of the characters patrolling through this point'),
    ('Wander point', 'WanderPoint', 'gazeTag', 'Look at (Tag)', 'name', 'A wandering character stopping here looks at '
     'this object (None: the way the point faces)'),
    ('Wander point', 'WanderPoint', 'gazeDuration', 'Look for (seconds)', 'float', ''),
    ('Zone', 'ZoneInfo', 'ZoneName', 'Place name', 'string', 'The name of this area'),
    ('Zone', 'ZoneInfo', 'AmbientBrightness', 'Ambient light', 'byte', 'The light everything in the zone has where no lamp reaches (the maps use 0-20)'),
    ('Zone', 'ZoneInfo', 'AmbientHue', 'Ambient colour', 'byte', 'Hue of the ambient light (0 red, 40 yellow, 80 green, 150 blue, 200 purple)'),
    ('Zone', 'ZoneInfo', 'AmbientSaturation', 'Colour strength', 'byte', '0 = full colour, 255 = white'),
    ('Zone', 'ZoneInfo', 'AmbientSound', 'Sound of the zone', 'sound', 'Heard everywhere in the zone (a machine room, a crowd, rain)'),
    ('Zone', 'ZoneInfo', 'bPainZone', 'Hurts', 'bool', 'It damages whoever is in it'),
    ('Zone', 'ZoneInfo', 'DamagePerSec', 'Damage per second', 'int', 'The game uses 5-20'),
    ('Zone', 'ZoneInfo', 'DamageType', 'Kind of damage', 'choice', 'Radiation (a hazmat suit protects), burned, shocked, poison gas...'),
    ('Zone', 'ZoneInfo', 'DamageString', 'Message when it hurts', 'string', 'e.g. High levels of radiation detected'),
    ('Zone', 'ZoneInfo', 'bKillZone', 'Kills at once', 'bool', 'A fall into a pit, a reactor core'),
    ('Zone', 'ZoneInfo', 'bGravityZone', 'Own gravity', 'bool', ''),
    ('Zone', 'ZoneInfo', 'ZoneGravity', 'Gravity', 'gravity', 'The pull downwards (with Own gravity): the game -950, -300 floats like on the moon'),
    ('Zone', 'ZoneInfo', 'ZoneGroundFriction', 'Ground friction', 'float', '8 = normal ground; 0.2 = ice'),
    ('Zone', 'ZoneInfo', 'bWaterZone', 'Water (JC swims)', 'bool', ''),
    # a zone's echo (UE1's ZoneInfo reverb): the Reverb row sets them from a preset, its Values show them
    # (static/zone-reverb.js); Revision's zones with OpenAL's own reverbs (RevZoneInfo, RevSoundZone, WaterZone,
    # PrecipitationZone, SnowZone: the classes with ReverbPreset) have it beside them, and a float Gain of OpenAL's
    # (EFX) that hides ZoneInfo's echo gains: their Gain row is left out (fields_for), a preset sets no echo gains there
    ('Zone', 'ZoneInfo', 'bReverbZone', 'Reverb', 'reverb', 'How the zone echoes the sounds made in it. A preset sets its '
     'echoes in one step (in a zone with an OpenAL reverb all but their gains: see OpenAL reverb); Custom: the values '
     'as they are'),
    ('Zone', 'ZoneInfo', 'MasterGain', 'Echo loudness', 'reverbpart', ''),
    ('Zone', 'ZoneInfo', 'CutoffHz', 'Cutoff (Hz)', 'reverbpart', ''),
    ('Zone', 'ZoneInfo', 'Delay', 'Echo delays', 'reverbpart', ''),
    ('Zone', 'ZoneInfo', 'Gain', 'Echo gains', 'reverbpart', ''),
    ('Zone', 'ZoneInfo', 'ReverbPreset', 'OpenAL reverb', 'enum', "The reverb Revision's OpenAL audio uses in this zone "
     "(EFX). The Reverb presets set it too (a water zone keeps its own, underwater: None puts it back), and leave the "
     "echo gains to the class (150 and 70, then none): this zone's own Gain is OpenAL's and hides them"),
    ('Texture panning', 'ZoneInfo', 'TexUPanSpeed', 'U speed', 'float',
     'Speed of all Auto U Pan surfaces in this zone. 1 = normal (35 texels/s), 0 = stopped; negative reverses it. Rebuild to apply.'),
    ('Texture panning', 'ZoneInfo', 'TexVPanSpeed', 'V speed', 'float',
     'Speed of all Auto V Pan surfaces in this zone. 1 = normal (35 texels/s), 0 = stopped; negative reverses it. Rebuild to apply.'),
    ('Rain and snow', 'PrecipitationZone', 'bWeatherActive', 'Falling', 'bool', 'Rain or snow falls in the whole zone, round JC'),
    ('Rain and snow', 'PrecipitationZone', 'PrecipDensity', 'How much', 'byte', 'Drops (flakes) in each batch: 7 = the default'),
    ('Collision box', 'UCTriggerBox', 'bCylinder', 'Shape', 'collision_shape', 'Box or upright cylinder. Tag and interactions stay the same. Rebuild to apply in game.'),
    ('Collision box', 'UCTriggerBox', 'BoxX', 'Width', 'half', 'Its size along X (units; a door is 64 wide)'),
    ('Collision box', 'UCTriggerBox', 'BoxY', 'Depth', 'half', 'Its size along Y'),
    ('Collision box', 'UCTriggerBox', 'BoxZ', 'Height', 'half', 'Its size upwards (JC is about 90 tall)'),
    ('Collision box', 'UCTriggerBox', 'CylinderRadius', 'Radius', 'radius', 'Distance from the centre to the cylinder edge'),
    ('Collision box', 'UCTriggerBox', 'CylinderHeight', 'Height', 'half', 'Full height of the cylinder (JC is about 90 tall)'),
    ('Collision box', 'UCTriggerBox', 'bSolidBox', 'Solid (an invisible wall)', 'bool', 'JC cannot walk through it, and it reacts when he touches it (Rebuild makes the wall)'),
    ('Collision box', 'UCTriggerBox', 'bAnyPawn', 'Anyone, not only JC', 'bool', 'Characters walking in count too'),
    ('Timer', 'UCTimer', 'Seconds', 'Seconds', 'float', 'How long it counts down once started (an action "Start the timer" can give another length)'),
    ('Timer', 'UCTimer', 'HUDLabel', 'Label on the HUD', 'string', 'Shown with the countdown above the belt, red under 10 seconds '
     '(empty: it counts unseen). When several run, the one closest to its end shows'),
    ('Timer', 'UCTimer', 'bAutoStart', 'Starts with the map', 'bool', 'Off: an interaction starts it ("Start the timer")'),
    ('Timer', 'UCTimer', 'bLoop', 'Starts again when it runs out', 'bool', 'Every time it runs out, its "runs out" rules happen again'),
    # the logic blocks (P3, editor/LOGIC.md "Logic blocks")
    ('All of these', 'UCBAllOf', 'Need', 'How many', 'int', 'How many different objects must tick it off, each once (0: all of those whose rules tick it off)'),
    ('All of these', 'UCBAllOf', 'bAgain', 'Starts again when done', 'bool', 'Once all have happened it is empty again, ready for another round'),
    ('Gate', 'UCBGate', 'bClosed', 'Starts closed', 'bool', 'Closed: what comes stops ("stops it"); a rule opens it'),
    ('Switch', 'UCBSwitch', 'NumWays', 'Ways', 'int', 'How many ways it has (2 to 6): each "Pick the next way" picks one'),
    ('Switch', 'UCBSwitch', 'Mode', 'Picks', 'choice', 'In turn: 1, 2... then 1 again. In order: 1 to the last once, then "has no more ways". At random: any'),
    ('Switch', 'UCBSwitch', 'Weights', 'How likely (at random)', 'string', 'One number per way, "2,1,1": the first twice as likely as each other (empty: all alike)'),
    ('Phases', 'UCBPhases', 'Phases', 'Phases', 'string', 'The phases in order, separated by commas: "Arrive, Alarm, Escape". Rules move it on and run when it enters or leaves one'),
    ('Phases', 'UCBPhases', 'StateName', 'Name', 'string', 'Its states: <Name> is the number of the phase now, <Name>_<phase> is Yes for the phase now (conditions and dialogues read them)'),
    ('At least N', 'UCBAtLeast', 'States', 'States', 'string', 'The states it looks at, separated by commas; !Name counts while that state is No'),
    ('At least N', 'UCBAtLeast', 'Need', 'How many', 'int', 'How many of them must hold (0: all of them)'),
    ('At least N', 'UCBAtLeast', 'StateName', 'Keeps the state', 'string', 'A state of its own, Yes while enough hold (empty: none): conditions and dialogues read it'),
    ('Counter', 'UCBCounter', 'ReachedAt', 'Goal', 'int', 'The number it waits for: "it gets to its goal" (0: none, it only counts)'),
    ('Counter', 'UCBCounter', 'StateName', 'Counter name', 'string', 'The counter that keeps its number (empty: named as the block): conditions and dialogues read it, and a rule that changes that counter moves the block too'),
    ('Counter', 'UCBCounter', 'bAgain', 'Starts again at its goal', 'bool', 'Once it gets to its goal it goes back to 0, ready to count again (every 3 times...)'),
    ('First of', 'UCBFirstOf', 'NumWays', 'Ways', 'int', 'How many things race (2 to 6): the first to come is heard, the others are not until it starts again'),
    ('First of', 'UCBFirstOf', 'TimeLimit', 'Time limit (seconds)', 'float', 'When none has come in this time: "the time ran out first" (0: no limit)'),
    ('First of', 'UCBFirstOf', 'bClockAtStart', 'The clock starts with the map', 'bool', 'Off: the clock starts when a rule says "Start the clock"'),
    ('Model', 'UCMeshDeco', 'Mesh', 'Model', 'mesh', 'The 3D model it shows (Models tab: any model of the game, of other mods, or imported)'),
    ('Model', 'UCMeshDeco', 'ItemName', 'Name', 'string', 'What JC sees when he looks at it (if he sees its name)'),
    ('Model', 'UCMeshDeco', 'bHighlight', 'JC sees its name', 'bool', 'Its name and a frame show when JC looks at it'),
    ('Model', 'UCMeshDeco', 'bBlockPlayers', 'Solid', 'bool', 'JC and the characters cannot walk through it (its cylinder)'),
    ('Model', 'UCMeshDeco', 'bInvincible', 'Cannot be destroyed', 'bool', ''),
    ('Model', 'UCMeshDeco', 'HitPoints', 'Strength', 'int', 'The damage it takes before it breaks (when it can be destroyed)'),
    ('Model', 'UCMeshDeco', 'bPushable', 'JC can push it', 'bool', ''),
    ('Model', 'UCMeshDeco', 'PrePivot', 'Pivot', 'hidden', ''),
    ('Sound effect', 'UCSoundFX', 'FXSound', 'Sound', 'sound', 'The sound effect it plays'),
    ('Sound effect', 'UCSoundFX', 'FXSounds', 'More sounds', 'playlist', 'A playlist: each time it plays, one of its sounds '
     '(Sound and these) is picked, at random or in sequence, its pitch and volume varied; it can play again by itself'),
    ('Sound effect', 'UCSoundFX', 'FXOrder', 'Order', 'playlistpart', ''),
    ('Sound effect', 'UCSoundFX', 'RandomPitch', 'Pitch varies', 'playlistpart', ''),
    ('Sound effect', 'UCSoundFX', 'RandomVolume', 'Volume varies', 'playlistpart', ''),
    ('Sound effect', 'UCSoundFX', 'RepeatMin', 'Repeats every (from)', 'playlistpart', ''),
    ('Sound effect', 'UCSoundFX', 'RepeatMax', 'Repeats every (to)', 'playlistpart', ''),
    ('Sound effect', 'UCSoundFX', 'bOnTouch', 'Plays when JC walks in', 'bool', 'Off: only when something triggers it (its Tag in the '
     'Event of a door, a button, a keypad, a trigger, a story action)'),
    ('Sound effect', 'UCSoundFX', 'bAtPlayer', "Heard in JC's head", 'bool', 'As a radio or a voice: as loud wherever JC is; '
     'off: it comes from this place'),
    ('Sound effect', 'UCSoundFX', 'FXRadius', 'Heard within (units)', 'float', 'How far from this place it is heard (the sphere in the 3D view)'),
    ('Sound effect', 'UCSoundFX', 'FXVolume', 'Volume', 'float', '1 = as recorded (up to 4)'),
    ('Sound effect', 'UCSoundFX', 'FXPitch', 'Pitch', 'float', '1 = as recorded; 0.8 deeper, 1.2 sharper'),
    ('Sound effect', 'UCSoundFX', 'ReTriggerDelay', 'Again after (seconds)', 'float', 'At least this long before it plays again (0: every time)'),
    ('Door sounds', 'Mover', 'OpeningSound', 'Starts opening', 'sound', ''),
    ('Door sounds', 'Mover', 'OpenedSound', 'Open', 'sound', 'When it has finished opening'),
    ('Door sounds', 'Mover', 'ClosingSound', 'Starts closing', 'sound', ''),
    ('Door sounds', 'Mover', 'ClosedSound', 'Shut', 'sound', 'When it has finished closing'),
    ('Door sounds', 'Mover', 'MoveAmbientSound', 'While moving', 'sound', 'Over and over while it moves (a lift, a big gate)'),
    ('Door sounds', 'Mover', 'SoundRadius', 'Heard within', 'byte', '25 x (this + 1) units'),
    ('Door sounds', 'Mover', 'SoundVolume', 'Volume', 'byte', '0-255'),
    ('Sound', 'AmbientSound', 'AmbientSound', 'Sound', 'sound', 'The sound it plays over and over (rain, a hum, wind, machines...)'),
    ('Sound', 'DeusExDecoration', 'AmbientSound', 'Sound', 'sound', 'A sound the object plays over and over (a TV, a fridge, a generator)'),
    ('Sound', 'Light', 'AmbientSound', 'Sound', 'sound', 'A sound the lamp plays over and over (the buzz of a neon)'),
    ('Sound', 'Actor', 'SoundRadius', 'Heard within', 'byte', 'How far it is heard: 25 x (this + 1) units (the sphere in the 3D view)'),
    ('Sound', 'Actor', 'SoundVolume', 'Volume', 'byte', '0-255'),
    ('Sound', 'AmbientSound', 'SoundPitch', 'Pitch', 'byte', '64 = as recorded; lower is deeper, higher is sharper'),
    ('Light', 'Light', 'LightHue', 'Colour', 'lightcolor', 'The colour of the light (hue and saturation, as in UnrealEd)'),
    ('Light', 'Light', 'LightSaturation', 'Saturation', 'byte', '0 = full colour, 255 = white (as in UnrealEd)'),
    ('Light', 'Light', 'LightBrightness', 'Brightness', 'byte', '0-255'),
    ('Light', 'Light', 'LightRadius', 'Radius', 'byte', 'How far it reaches: 25 x (radius + 1) units'),
    ('Light', 'Light', 'LightType', 'Type', 'enum', 'Steady, pulsing, blinking, flickering...'),
    ('Light', 'Light', 'LightEffect', 'Effect', 'enum', 'LE_Spotlight: a cone (see Cone); LE_NonIncidence: lights walls at any angle; '
                                                     'LE_TorchWaver, LE_FireWaver: flames...'),
    ('Light', 'Light', 'LightCone', 'Cone', 'byte', 'Width of the cone of a spotlight (LightEffect LE_Spotlight)'),
    ('Light', 'Light', 'LightPeriod', 'Period', 'byte', "A pulse's round, in both games: every Period / 35 seconds "
                                                        "(32: about 0.9 s), and a palette loop's. A blink keeps no time: on or off at "
                                                        "random whatever its Period, until it stays on for good (in Revision only when "
                                                        "Period + 1 is a power of two, after 256 s or more; in the original game after "
                                                        "about 7.3 x (Period + 1) s)"),
    ('Light', 'Light', 'LightPhase', 'Phase', 'byte', 'Where in its round a pulse starts (256 = a round): pulsing lamps of '
                                                      'one period out of step. In both games it does nothing for the other types '
                                                      '(blink, flicker, strobe, palette)'),
    ('Light', 'Light', 'VolumeBrightness', 'Fog brightness', 'byte', 'Light in the fog around it (only in zones with volumetric fog)'),
    ('Light', 'Light', 'VolumeRadius', 'Fog radius', 'byte', ''),
    ('Light', 'Light', 'bSpecialLit', 'Lights only "special lit" surfaces', 'bool', ''),
    ('Light', 'Light', 'bCorona', 'Corona', 'bool', 'A glow round the lamp where it is seen (its Skin is the texture of the glow)'),
    ('Map link', 'Teleporter', 'URL', 'Leads to', 'mapurl', 'Touching it takes JC to that map, at that arrival point. '
     'Empty: this is an arrival point (other maps lead here with its Tag)'),
    ('Map link', 'Teleporter', 'bEnabled', 'Active', 'bool', 'Off for an arrival point (it must not send JC away)'),
    ('Trigger', 'Trigger', 'TriggerType', 'Triggered by', 'enum', ''),
    ('Trigger', 'Trigger', 'bTriggerOnceOnly', 'Only once', 'bool', ''),
    ('Trigger', 'Trigger', 'CollisionRadius', 'Radius', 'float', ''),
    ('Trigger', 'Trigger', 'CollisionHeight', 'Height', 'float', ''),
    ('Trigger', 'Trigger', 'Message', 'Message to JC', 'string', 'Written on the screen when it triggers (empty: none)'),
]
# TextPackage has no field of its own: the text field sets it (a DataVault note key per device)
# Appearance-only replacement clears the old actor's skin overrides without touching its class.
# the Inspector's Movement of a character (static/behaviours.js): set there, not in the Properties panel
MOVEMENT = {'GroundSpeed', 'JumpZ', 'MaxStepHeight', 'AirControl'}
# the Inspector's Particles section of a generator (static/particles.js PARTICLE_FIELDS): set there, not in the
# Properties panel. Without them here a change made there (a damage, a texture, a colour) never reached the game:
# only the values the generator was placed with did (5 Nov 2026).
PARTICLES = {'particleTexture', 'frequency', 'checkTime', 'numPerSpawn', 'ejectSpeed', 'riseRate', 'particleLifeSpan',
             'particleDrawScale', 'bRandomEject', 'bGravity', 'bScale', 'bFade', 'bParticlesUnlit', 'bModulated',
             'FxArea', 'FxDamage', 'FxDamageType', 'FxRadius', 'FxReach', 'FxEvery', 'bFxHurtAll', 'bFxStartOn', 'FxOnTime',
             'bFxToggle'}
NAMES = sorted({f[2] for f in FIELDS} | {'TextPackage', 'Skin', 'MultiSkins'} | MOVEMENT | PARTICLES)
# read with the class defaults, not in the panel: what a zone does to the 3D view's Effects (zones.look)
ZONE_LOOK = ('ViewFog', 'ViewFlash', 'bFogZone', 'FogColor', 'FogDistance')


def base(key):
    return key.split('(')[0]


def defaults(log=print):
    """{'classes': {cls: {'parents': [...], 'props': {prop: [value per index]}, 'types': {prop: type}}},
    'enums': {prop: [names]}} from the game, made once."""
    if CACHE.exists():
        import build_cache
        d = build_cache.json_file(CACHE)
        if d.get('version') == VERSION:
            return d
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    log('reading the class defaults of the game (once)...')
    s = kit.Session([], 'editor-defaults')
    try:
        weather = ['OBJ LOAD FILE="Precipitation.u"'] if 'weather' in settings.FEATURES else []  # rain and snow zones (Revision)
        s.batch(['OBJ LOAD FILE="%s.u"' % settings.PACKAGE] + ['OBJ LOAD FILE="%s"' % p for p in settings.GAME_LOADS]
                + weather + [r'UC_DEFAULTS ..\Output\defaults.jsonl %s' % ','.join(NAMES + list(ZONE_LOOK))])
        rows = kit.rows(s.folder / 'Output' / 'defaults.jsonl')
    finally:
        s.close()
    classes, enums = {}, {}
    for row in rows:
        if row['kind'] == 'enum':
            enums[row['property']] = row['values']
            continue
        c = classes[row['class']] = dict(parents=row['parents'], props={}, types={})
        for p in row['properties']:
            vals = c['props'].setdefault(p['name'], [])
            while len(vals) <= p['index']:
                vals.append('')
            vals[p['index']] = p['value']
            c['types'][p['name']] = p['type']
    d = dict(version=VERSION, classes=classes, enums=enums)
    CACHE.write_text(json.dumps(d), encoding='utf-8')
    return d


def cached_defaults():
    """The class defaults as defaults() gives them, only from a cache file of this VERSION; None when there is none (or
    an older one, after a VERSION change): never a session of the host. For a build, which must not start the game's
    editor to read them (scene.rested_height, openal_gain: they go by names then)."""
    if not CACHE.exists():
        return None
    import build_cache
    try:
        d = build_cache.json_file(CACHE)
    except (OSError, ValueError):
        return None
    return d if isinstance(d, dict) and d.get('version') == VERSION else None


def fields_for(cls, log=print):
    """The fields of the Properties panel for a class, with its defaults and the class that declares each."""
    d = defaults(log)
    c = d['classes'].get(cls)
    if not c:
        return []
    chain = [cls] + c['parents']
    out, seen = [], set()
    for group, owner, prop, label, kind, help_ in FIELDS:
        # the original game has no SpecialText: a book's own text goes through textTag (editor/documents.py)
        fallback = EDITOR_DEFAULTS.get(owner, {}).get(prop)
        has = prop in c['props'] or fallback is not None or (kind == 'text' and 'textTag' in c['props'])
        if owner not in chain or prop in seen or not has:
            continue
        if prop in HIDE.get(cls, ()) or any(prop in HIDE.get(p, ()) for p in c['parents']):
            continue                           # fields that mean nothing for this class
        mine, its = c['types'].get(prop), d['classes'].get(owner, {}).get('types', {}).get(prop)
        if mine and its and mine != its:
            continue                           # the class declares its own property of that name (another type), which
                                               # hides the row's: Revision's RevZoneInfo float Gain (OpenAL's) is not
                                               # ZoneInfo's byte Gain[6] (the echo gains)
        if group == 'Sound' and owner == 'Actor' and 'AmbientSound' not in seen:
            continue                           # radius and volume only next to a sound field
        seen.add(prop)
        # the class of the game that declares it: the first of its chain from the top (Object) that has it. One name
        # declared in two classes apart is two properties (an ATM's accounts are not a computer's): copy and paste
        # keep them apart (static/prop-sets.js)
        declared = next((k for k in reversed(chain) if prop in d['classes'].get(k, {}).get('props', {})), owner)
        f = dict(group=group, prop=prop, label=label, kind=kind, help=help_, default=c['props'].get(prop, fallback or ''),
                 type=c['types'].get(prop, ''), declared=declared)
        if kind == 'choice' and prop == 'Orders':
            f['options'] = ORDERS
        elif kind == 'choice' and prop in CHOICES:
            f['options'] = CHOICES[prop]
        if kind == 'enum':
            f['options'] = d['enums'].get(prop, [])
        out.append(f)
    return out


_TREE = [None, None]       # the defaults file's time, its class tree


def tree_of(classes):
    """{class: {'parents': [...]}} (defaults()['classes']) -> its ClassTree."""
    return ClassTree.from_chains({c: v.get('parents') for c, v in classes.items()})


def class_tree(log=print):
    """The game's class hierarchy (a ClassTree) from the class defaults, kept until they are made again."""
    stamp = CACHE.stat().st_mtime_ns if CACHE.exists() else None
    if _TREE[1] is None or _TREE[0] != stamp:
        tree = tree_of(defaults(log).get('classes', {}))
        _TREE[:] = [CACHE.stat().st_mtime_ns if CACHE.exists() else None, tree]
    return _TREE[1]


def is_a(cls, *bases, log=print):
    """Is the class (Class or Package.Class) one of bases or under one of them; None when the game's classes do
    not have it (another mod's, one of the map's own)."""
    name = str(cls).split('.')[-1]
    tree = class_tree(log)
    return tree.is_a(name, *bases) if name in tree else None


def chain(cls, log=print):
    """The class and its parents (the Interactions of the editor: what it can do, what can start them)."""
    c = defaults(log)['classes'].get(cls)
    return [cls] + list(c['parents']) if c else [cls]


def factions(log=print):
    """Every character class with its default faction and relations, and every faction name the game uses."""
    d = defaults(log)
    classes, known = {}, set()
    for cls, c in d['classes'].items():
        if 'ScriptedPawn' not in c['parents']:
            continue
        alliance = (c['props'].get('Alliance') or [''])[0]
        rel = c['props'].get('InitialAlliances') or []
        classes[cls] = dict(alliance=alliance, rel=rel)
        if alliance and alliance != 'None':
            known.add(alliance)
        for r in rel:
            m = re.search(r'AllianceName=(\w+)', r)
            if m and m.group(1) != 'None':
                known.add(m.group(1))
    known.add('Player')
    return dict(classes=classes, known=sorted(known, key=str.lower))


def t3d_props(props):
    """The properties of an actor in a map's T3D that the panel shows (array entries included)."""
    return {k: v for k, v in props.items() if base(k) in NAMES}


# Revision's zone classes with OpenAL's reverb (RevZoneInfo, RevSoundZone, WaterZone, PrecipitationZone, SnowZone)
# declare a float Gain of their own, OpenAL's EFX gain (0-1), which hides ZoneInfo's byte Gain[6], the echo gains: a
# Gain(n) there sets that float (B6 in the game, 28 Oct 2026: an older editor's Hangar preset gave UCEdit1 Gain(0) 120,
# the map got Gain=120.000000, Gain(1)..Gain(5) were lost). The builds leave such keys out (that preset's edits, the
# Reverb row's boxes, an added object's own properties) and the build report says so.
ECHO_GAIN = re.compile(r'Gain\(\d\)')
# Revision's classes with that float Gain (this PC's class defaults, 28 Oct 2026): openal_gain's answer by the name
# when the cache file is not there or is older (the original game has none of them: WaterZone is ZoneInfo's there)
OPENAL_ZONES = ('RevZoneInfo', 'RevSoundZone', 'WaterZone', 'PrecipitationZone', 'SnowZone')


def openal_gain(cls, log=print):
    """Does the class (Class or Package.Class) declare its own float Gain, OpenAL's, so that no Gain(n) reaches its
    echo gains? By the class defaults' types when the cache file is of this VERSION (cached_defaults; False for a class
    they do not have), else by its name (OPENAL_ZONES, in Revision): never a session of the host, a build calls it."""
    name = str(cls or '').split('.')[-1]
    d = cached_defaults()
    if d is None:
        return getattr(settings, 'IS_REVISION', True) and name.lower() in {c.lower() for c in OPENAL_ZONES}
    c = (d.get('classes') or {}).get(name)
    return bool(c) and (c.get('types') or {}).get('Gain') == 'FloatProperty'


def echo_gains_hidden(cls, values, log=print):
    """The Gain(n) keys of values (an actor's edits or own properties) its class cannot take (openal_gain), sorted;
    [] for any other class. The class defaults are read only when there is such a key."""
    keys = sorted(k for k in values or {} if ECHO_GAIN.fullmatch(k))
    return keys if keys and openal_gain(cls, log) else []


def echo_gains_line(name, cls, keys):
    """The build report's line for echo gains left out (an EDIT skipped: one of the report's warnings)."""
    idx = sorted(int(k[5:-1]) for k in keys)
    which = ('Gain(%d..%d)' % (idx[0], idx[-1]) if len(idx) > 1 and idx == list(range(idx[0], idx[-1] + 1))
             else ', '.join('Gain(%d)' % i for i in idx))
    return ("  EDIT skipped %s of %s (echo gains: a %s's Gain is OpenAL's EFX gain, which hides them; its echoes keep "
            "the class's)" % (which, name, str(cls).split('.')[-1]))


def _echo_gains_out(edits, classes):
    """{actor: its Gain(n) keys commands leaves out} of edits['props'], by classes ({actor name: its class})."""
    out = {}
    for name, values in (edits.get('props') or {}).items():
        if classes and name in classes and isinstance(values, dict):
            keys = echo_gains_hidden(classes[name], values)
            if keys:
                out[name] = keys
    return out


def echo_gains_report(edits, classes):
    """The build report's lines for the Properties' echo gains commands leaves out (classes as it takes them)."""
    return [echo_gains_line(name, classes[name], keys) for name, keys in sorted(_echo_gains_out(edits, classes).items())
            if name not in (edits.get('deleted') or {})]


def commands(edits, classes=None):
    """UC_PROP for every property changed in the panel. classes ({actor name: its class}, the map's and the added
    ones): the echo gains of a zone whose class cannot take them are left out (echo_gains_report says so)."""
    # string[N] properties (fixed length): the engine's import keeps quotes in them as part of the text, so a map
    # exit's URL "06_X#Start" became a map called '"06_X' the game could not load (Crypt Test, 20 Oct 2026); the
    # quotes go. Other strings keep theirs (the import strips them, and a name with spaces needs them).
    raw_strings = {'URL', 'DestMap'}
    cmds, hidden = [], _echo_gains_out(edits, classes) if classes else {}
    for name, props in sorted((edits.get('props') or {}).items()):
        if name in (edits.get('deleted') or {}) or not re.fullmatch(r'\w+', name):
            continue
        for key, value in sorted(props.items()):
            if key in hidden.get(name, ()):
                continue                       # an echo gain its class's float Gain hides (OpenAL's): left out
            if re.fullmatch(r'\w+(\(\d\))?', key) and base(key) in NAMES:
                value = str(value).replace('\n', ' ')
                if base(key) in raw_strings and len(value) >= 2 and value[0] == value[-1] == '"':
                    value = value[1:-1]
                cmds.append('UC_PROP %s %s %s' % (name, key, value))
    return cmds + raw_commands(edits)


def report(edits, classes=None):
    """The build report's lines of the panel's edits; classes as commands takes them (the echo gains it leaves out are
    not among the values, a line of their own says so)."""
    hidden = _echo_gains_out(edits, classes)
    shown = {name: {k: v for k, v in props.items() if k not in hidden.get(name, ())}
             for name, props in (edits.get('props') or {}).items() if props}
    return ['  EDIT %s: %s' % (name, ', '.join('%s=%s' % kv for kv in sorted(props.items())))
            for name, props in sorted(shown.items()) if props and name not in (edits.get('deleted') or {})] + \
        ['  EDIT %s (All properties): %s' % (name, ', '.join('%s=%s' % kv for kv in sorted(props.items())))
         for name, props in sorted((edits.get('rawprops') or {}).items()) if props and name not in (edits.get('deleted') or {})] + \
        echo_gains_report(edits, classes)


# ---------------------------------------------------------------- All properties (the Inspector's last section)
# Every property UnrealEd's Properties window shows for a class (host UC_CLASSPROPS), read once per class and kept
# in cache/_palette/classprops. Edits: edits['rawprops'] = {actor: {property or property(index): value as UnrealEd
# text}}, applied after the Properties panel's own (so they win), with the same UC_PROP.
CLASSPROPS = CACHE.parent / 'classprops'
CLASSPROPS_VERSION = 1
RAW_KEY = re.compile(r'[A-Za-z_]\w{0,63}(\(\d{1,2}\))?')


def class_props(cls, log=print):
    """{'cls', 'props': [{name, index, type, group, default}], 'enums': {name: [values]}} of an actor class."""
    if not re.fullmatch(r'\w{1,127}', cls or ''):
        raise ValueError('Invalid class name.')
    path = CLASSPROPS / (cls + '.json')
    if path.exists():
        d = json.loads(path.read_text(encoding='utf-8'))
        if d.get('version') == CLASSPROPS_VERSION:
            return d
    s = kit.Session([], 'editor-classprops')
    try:
        weather = ['OBJ LOAD FILE="Precipitation.u"'] if 'weather' in settings.FEATURES else []
        s.batch(['OBJ LOAD FILE="%s.u"' % settings.PACKAGE] + ['OBJ LOAD FILE="%s"' % p for p in settings.GAME_LOADS]
                + weather + [r'UC_CLASSPROPS ..\Output\classprops.jsonl %s' % cls])
        rows = kit.rows(s.folder / 'Output' / 'classprops.jsonl')
    finally:
        s.close()
    props, enums = [], {}
    for row in rows:
        if row['kind'] == 'enum':
            enums[row['property']] = row['values']
        else:
            props.append(dict(name=row['name'], index=row['index'], type=row['type'], group=row['category'],
                              default=row['default']))
    if not props:
        raise ValueError('The game does not know the class %s (or it has nothing to set).' % cls)
    d = dict(version=CLASSPROPS_VERSION, cls=cls, props=props, enums=enums)
    CLASSPROPS.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(d), encoding='utf-8')
    return d


def forget_classes(classes):
    """Forget what class_props knows of these classes (a script compiled again may have new settings)."""
    for cls in classes:
        if re.fullmatch(r'\w{1,127}', cls or ''):
            (CLASSPROPS / (cls + '.json')).unlink(missing_ok=True)


def raw_commands(edits):
    """UC_PROP for every property set in All properties (one line each, no line breaks in a value)."""
    cmds = []
    for name, props in sorted((edits.get('rawprops') or {}).items()):
        if name in (edits.get('deleted') or {}) or not re.fullmatch(r'\w+', name) or not isinstance(props, dict):
            continue
        for key, value in sorted(props.items()):
            value = str(value).replace('\r', ' ').replace('\n', ' ').strip()
            if RAW_KEY.fullmatch(key) and value and len(value) <= 2000:
                cmds.append('UC_PROP %s %s %s' % (name, key, value))
    return cmds
