# DeusEdix: the guide

DeusEdix is a map editor for Deus Ex and Deus Ex: Revision. It opens the original Revision maps in
3D, with the game's real models and textures, and lets you change them without UnrealEd:

- move, rotate, scale, copy and delete objects and whole structures (a helipad, a building);
- add any object of the game, blocks (walls, platforms) and ready-made pieces of other levels;
- replace the texture of an object or a structure with your own picture;
- change the properties that matter for a mission (locked doors, keypad codes, computer
  passwords, what a crate contains, what a guard does and carries...);
- write the mission's **story**: dialogues, InfoLinks, events and actions, compiled for you;
- make your own **characters** from the faces, bodies and clothes of the game's characters;
- make **new maps** (an empty room or a copy of any map) and **link** them to each other and to the
  game's maps.

The game's files are never modified: existing maps are edited on a copy of your own, and what you
make goes into a folder of DeusEdix's (`Revision\DeusEdixMaps`).

DeusEdix is a fan-made tool, not affiliated with the Deus Ex: Revision team, Eidos or Square Enix.

## Start it

You need **Deus Ex: Game of the Year Edition**, from Steam or GOG. **Deus Ex: Revision** (Steam) is
optional: it goes into the same `steamapps\common\Deus Ex` folder and lets you make maps for Revision
too. Each project is made for one of the two games (New project > Game). The installer finds the folder;
if it cannot, DeusEdix asks for it when it starts (or run `deusedix-cli.exe --set-game "<Deus Ex folder>"`
in DeusEdix's folder). With a Steam copy, **Play** starts the game through Steam; a GOG copy starts by
itself.

Start **DeusEdix** from the Start menu. The first time it prepares its workspace from your game
(links and copies inside its own folder: nothing of the game is changed) and compiles its package,
which takes a few seconds. The 3D view needs an internet connection (it loads three.js, the 3D
engine, from a CDN).

DeusEdix's window needs Windows 10 or 11 with Microsoft Edge WebView2 (part of Windows; Microsoft's
WebView2 Runtime installs it if it is missing). Without it, or under Wine or Proton (Linux, Steam Deck),
DeusEdix opens the editor in your web browser instead; `DeusEdix.exe --browser` does the same on
purpose. It closes by itself when you close its last page.

The start screen lets you create a new map, open an existing map, or take Dr. Hale's tutorial.

The first time you open a map the editor analyses it and takes what the 3D view needs from the
game (from a few seconds to a minute); after that it opens at once.

## Opening and closing maps

The editor starts on **New Map / Open Map**, with a card for Dr. Hale's tutorial and your eight
most recent maps. **New Map** opens the dialog of an empty room, a copy of a map or one of your
map templates. **Open Map** searches your maps, recent maps and original levels grouped by mission.
You can search by filename, location or mission name. The list in the top bar remains a quick switcher:

- **Script-built maps**: maps made from scripts (`tools\mapkit\maps\`), including new empty rooms.
  Your changes are kept next to the script and applied on every rebuild.
- **Mod maps**: your project's copies of existing maps (`maps\`).
- **Original maps (you edit a copy)**: every Revision map. Changes are saved separately and built on a copy.

The first time you open a map the editor analyses it (from a few seconds to a minute); after
that it opens at once.

**Browse for a .dx file...** imports a map into the project's `maps` folder. Check the copy name
and press **Import copy**. Existing names are refused: choose another name to keep both maps.
The original file and the game's folders stay untouched. A map without a build is marked
**Not built yet**; pending edits/builds are marked **Changed, not installed**.

**File > Close map** returns to the start screen. If the map or Story has unsaved changes, choose
**Save changes**, **Discard** or **Cancel**. Saving here stores your work; **Apply in game** and
**Rebuild** are still separate operations. **Settings > General > When the editor opens** chooses
**Start screen** (the default) or **Last map**. **Clear recent** clears the list and last-map memory.

## Interactive tutorial

**Help > Interactive tutorial** opens an eight-room training wing run by Dr. Elias Hale.
The route turns through an L-shaped loading bay and a horseshoe drill course, with smaller
rooms for conversation, materials and reading. Observation glass is used in reception and security.
**Show me** frames the lesson and selects its object. The panel notices completed exercises:

1. **Reception**: fly around the editor; meet Hale behind the original training observation window.
2. **Stores**: select and move a crate, then place a new crate on top of the Crate stockpile platform around the corner. Pulsing circles guide you from the Objects search to the crate and the drop zone.
3. **Door systems**: connect the wall button to either leaf of the double door; both leaves open together.
4. **Drill hall**: give the trooper a greeting animation in the horseshoe practice course.
5. **Lab office**: write a dialogue for the scientist.
6. **Materials workshop**: select the plain crate, open **Textures > Edit**, paint its skin and
   choose **On this object only > Apply**. Hale's smiling demonstration crate is beside it.
   Merely saving a picture in My textures does not complete this exercise.
7. **Film stage**: frame *The Last Cup*, a guarded mug of coffee. **Tools > Add a cutscene camera**
   (or **+ Cutscene**) records the first view. Move the playhead to about four seconds, move the
   camera or change its framing, and press **K** for another key. Play the complete preview, then
   connect the **SCREENING** button to the camera with **Play the cutscene**. The exercise checks
   for two distinct keys in the stage, a preview of the current shot and a working button rule.
8. **Field test and library**: **Apply in game** in Story, **Rebuild**, then **Play from here**.
   Test the door, greeting, dialogue, painted crate and screening button; finish with the library's tips.

The map is generated locally from the script in `tools/mapkit/tutorial/` and the installed game's
assets. Reception, observation booths and door leaves reuse selected architecture from the local
`00_Training`, preserving scale and texture alignment. Original map files are never modified or
bundled. The burgundy reception floor uses the engine's mirror flag; the browser's Lit preview
does not reproduce that reflection, so use **View in game** to inspect it.

**The advanced wing** is optional and opens north of the library, for those who want more than the
basics. Every basic step offers **Advanced ›**, and **Advanced wing** sits next to **Finish**; the panel
counts the training and the wing apart and never moves from one to the other by itself:

- **Interrogation**: a dialogue with **JC's answers** (choices), a consequence that opens the vault, and
  a story flag the informant remembers next time.
- **Demolition range**: a timer that counts down, what happens when it runs out, and a keypad that
  defuses the bomb.
- **Ambush yard**: a trigger zone that sends two attackers at JC.
- **Code lab**: your first script (**Tools > Scripts**), wired to a button with an interaction, then
  tried live with the **Console** while the game runs.

Dr. Hale speaks his lines (his voice is in the editor and in the game). The speaker button in the head
of his panel (**Mute tutorial audio**) silences his voice and the background music.

Exercise edits and custom dialogue are kept when the tutorial's stock text is updated.
**Start over** on the last step clears the training edits and story and rebuilds the map.
The first time the editor opens, Hale offers the course; it remains available in Help.

## Moving around

The controls are those of Unreal Engine 5 (they are also listed under **Help**).

| | |
|---|---|
| Hold the right mouse button and move the mouse | look around |
| Right mouse + `W` `A` `S` `D`, `Q` `E` | fly (`Shift` = faster) |
| Mouse wheel | forward and back |
| Mouse wheel while flying (right mouse held) | the fly speed, shown for a moment at the bottom of the view |
| Middle mouse drag | pan |
| `Alt` + left drag | turn round the selection's middle (without one: what is under the mouse) |
| `Alt` + right drag | go toward that point (right or down) or away from it |
| Left click | select an object, or a structure by clicking its walls |
| Left click again on the same spot | the next thing under the mouse, behind the first (round again after the last) |
| `Ctrl` + right click | the list of everything under the mouse (*Select under cursor*) |
| `Ctrl` + `Alt` + click a surface | the lamps that light that point, brightest first (*Lights here*, see *Lighting of the view*) |
| `F` | frame the selection: the camera flies to it; press `F` again to come closer |
| `Shift+F` (View > Align view to selected) | look from the selected object along its front (a character: from its eyes) |
| `Shift+P` (View > Pilot selection) | pilot the selection: the view looks through it and flying takes it along, until `Shift+P` again or `Esc` |
| `L` | lighting of the view: Shaded, Lit, Unlit (see below) |

An `Alt` click without a drag still picks a face (see *Faces and texture alignment*), and `Alt`
dragging a gizmo handle still copies the object. After `F` or an orbit the camera keeps turning round the same
point while it looks at it, even with nothing selected.

The **axis widget** in the top right corner of the 3D view shows the view's axes as the gizmo does (X red, Y green
and up, Z blue: the Inspector's axes). Click an end to look from that side toward the middle of the view: **Y**
looks down from above, with X to the right as in the Top view; X and Z look level. **Shift**+click opens the matching
Top, Front or Side view instead. Under it, where the camera faces in the game's units: the letter of the game's
compass (North is the map's *TrueNorth*) and the yaw (65536 a turn).

**Settings > Camera**: the flying speed (also the wheel while flying), the mouse sensitivity, invert, the **field of
view** and **clipping**. The field of view is the one of your game (`DefaultFOV` in RevisionUser.ini, User.ini for
the original game; else the game's own: 86° in Revision, 75° in the original), so the view frames what the player
sees; move the slider for another one, **Game's** goes back to it. A new cutscene camera starts with it too.
**Near** and **Far** set how close and how far the view draws.

## Lighting of the view

Like *Lit* and *Unlit* in Unity or Unreal, the list next to **Help** (or the `L` key) changes how
the 3D view is lit:

| | |
|---|---|
| **Shaded** | the editor's own soft light: everything is easy to see; good for building |
| **Lit** | the game's lighting: the light and the shadows of every lamp, their colour, how far they reach, spotlights, the ambient light of each zone. What you see is close to what the game shows |
| **Unlit** | the textures only, without any light |

In **Lit**:

- Walls, floors and ceilings show the map's real lightmaps, with their shadows.
- Objects and characters are lit vertex by vertex like the engine does: the side facing a lamp is
  bright, the other side dark. A lamp lights an object only if the object's centre can see it.
- Neon signs, screens and other *unlit* surfaces stay at full brightness, as in the game.
- A slider appears next to the list: it makes the whole view brighter or darker, to compare with
  your screen. It does not change the game.

**Lit** shows the lighting of the **last rebuild**: lamps you add, move or change are not shown
until you press **Rebuild**. An object you add or move takes the lamps around its new place at
once, but without their shadows until the rebuild.

**UnrealEd's views**: the same list (and **View** in the menu bar) also has UnrealEd's
**Wireframe** (the outline of every surface, the textures hidden; the objects stay as they are),
**BSP cuts** (the textured world with the edges of every BSP polygon on it: where the engine split
the surfaces when it built the map) and **Zones** (every surface in the colour of its zone, with a
legend: the rooms that zone portals and ZoneInfo actors make). They show the last rebuild; a map
read by an older version of the editor shows its zones after one **Rebuild**. Choosing a lighting
brings the textured world back.

**Lightmap detail** (in the same list, as Unity's lightmap resolution view): every wall, floor and ceiling in the
colour of how far apart the samples of its lightmap are, the points the engine lights it on (its shadows are as
sharp as that), with a check for each sample. The legend gives the colours (up to 12 units a sample: very sharp
and the most memory; 24 to 48: the usual, about 32; over 96: very soft) and the map's lightmaps: how many, how many
samples, and about how much memory they take as the game's 32-bit lightmaps (an estimate: the map file keeps a bit a
sample for each lamp instead). Grey is a surface without a lightmap (unlit, sky, invisible). It shows the last
**Rebuild**: change a face's **Shadow detail** (see *Shadow detail*), Rebuild, and look again. A face only a few
samples big gets an estimate of its size.

**Lights here**: `Ctrl`+`Alt`+click a wall, a floor or a ceiling (in any lighting; `Alt`+click alone still picks
the face). A small menu lists the lamps that light that point, brightest first, with their share of the light
there, then the lamps whose reach gets there but that a wall hides; click one to select it. It is an estimate made
in the editor from the lamps as they are now (their radius, brightness, colour, the angle they meet the surface at
and a spotlight's cone, and a ray from the point to each lamp through the walls of the 3D view), not from the
lightmaps: the game's shadows come from the last Rebuild, and objects do not hide a lamp. A lamp the project's game
never lights (a flickering lamp in Revision, or there a palette lamp whose Skin is Effects.Corona.Corona_G) is not
listed, and **Light preview** (in the same list as Lit: the lamps as they are now, without shadows) leaves it dark
too.

**Effects** (the sun button next to the list, or **View > Effects**), as Unity's Scene view Effects: in the **Lit**
view the map moves as the game does. It is kept for the next time (in the browser). While it is on:

- Lamps whose **Type** is pulse, subtle pulse, blink, flicker or strobe change as the game's renderer makes them, in
  the game the project is for (Revision and the original game differ): a pulse goes from 21 to 99% of the lamp (60%
  on average) and a subtle pulse from 81 to 99%, a round every Period / 35 seconds (32: about 0.9 s), Phase / 256 of
  a round later. A **blink** keeps no time: it is on or off at random, in about half the frames, whatever its
  Period, and its Phase does nothing. It stays on for good after a while: in Revision only when Period + 1 is a power
  of two (Period 0: after 256 s, 1: after 512 s, 3, 7, 15...: later; the default 32 never does), in the original
  game whatever the Period, after about 7.3 x (Period + 1) seconds (32: about 4 minutes); the game counts from the
  start of the map, the editor from when Effects starts showing. A **flicker** is dark in Revision: its renderer
  never lights one (the original maps' flickering lamps are dark too: use a blink); in the original game it is off
  in about half the frames, else at 50 to 100% of the lamp, a new value every frame. Every **strobe** of the map
  switches together, on one frame and off the next, whatever its Period and Phase. Palette types (texture palette
  once / loop) and the light effects (torch, searchlight...) stay steady, but in Revision a palette lamp whose Skin is
  Effects.Corona.Corona_G is dark (measured: that Skin gives it no light).
- On objects and characters each lamp's own share of their light goes up and down: as the Lit view lights them. On
  walls, floors and ceilings the lightmaps hold the light of every lamp together, so the editor takes a lamp's share
  as its light at that point without shadows, never more than the lightmap holds there: behind a wall within its
  reach the light dims a little too. The 16 moving lamps nearest the camera move on the walls; the others stay steady
  there. The lamps are those of the last **Rebuild**, as their **Type**, **Period** and **Phase** are now (a value set
  in **All properties** first: it wins at Rebuild).
- Lamps with **Corona** on and a **Skin** (the texture the game draws as the corona: set it in **All properties**;
  the original maps use Effects.Corona.Corona_E, F or G) show a glow of their colour where they are, the same size
  on the screen at any distance, as the game draws it: in a square a fifth of the view's width at DrawScale 1, its
  bright middle about a tenth of that square across, fading out within the middle half of it (as Revision's Corona_G
  does; the original game's textures were not measured). It shows at full strength whatever the lamp does (a dark
  flickering lamp's corona still shines, and so does a lamp of brightness 0: the original maps' glows); at most 32,
  the nearest; none for a lamp whose **Enabled in game** is unticked (it is out of the map). A wall coming between it
  and the camera fades it out in a third of a second, and back in. Without a Skin the game draws no corona, and
  neither does the editor.
- Surfaces with **Auto U Pan** or **Auto V Pan** move their texture at their zone's speed (TexUPanSpeed, TexVPanSpeed:
  35 texels a second at 1), water, waterfalls and clouds.
- With the camera in a zone that has a view fog (**ViewFog**, **ViewFlash**: water, toxic liquid), the whole view
  takes it as JC's view does with his head in that zone; a zone with a **FogDistance** and a **FogColor** fades to
  that colour with distance. The game's volumetric fog (lamps' fog brightness) is not drawn.

The zones' speeds and fog are those of the last **Rebuild**; a map read by an older version of the editor pans at
the usual speed and shows no zone fog until it is opened again. Effects costs nothing while it is off: the view is
drawn every frame only while Effects shows.

## The screen

The layout follows the familiar hierarchy, scene, inspector and asset browser arrangement:

- **Menus and toolbar**: File, Edit, View, Map, Tools, Window, Settings and Help.
  The Windows app uses a native menu above the editor; the browser keeps these menus in the
  top bar. Save, Rebuild and Play remain beside the current map. Themes and Rounded variants
  are in Settings. **Edit > Search everything…** (`Ctrl+K`) finds any command, object of the map,
  object to place, texture or sound by its name (see *Searching everything*).
- **Hierarchy** (left): every object of the level. The structures (helipad, buildings...) with
  their objects inside, then the other objects by kind, as the 3D view's Show menu sorts them: characters, lights,
  objects, doors, triggers, AI paths, blocks (with the walls, roads, floors, ceilings, stairs and roofs you drew),
  sounds, cameras and cutscenes, zones. Click a line to select it,
  double-click it (or press `F`) to go to
  it, the bin deletes it. The search box finds any object by name or kind, and by its Tag, Event, sounds,
  textures, model or state, or what points at it (see *Searching the map*). Bulbs identify lights,
  people identify NPCs, and cubes, doors and routes identify objects, movers and AI paths.
  NPC icons show their configured relation towards JC at map start: **green** for allies,
  **grey** for neutral characters and **red** for enemies. Class defaults and unsaved relation
  changes are included, and Undo updates the colour too. Hover over an icon for its meaning.
  Player starts have a flag and helicopters have their own icon. A single piece taken out of a
  structure has the piece icon, not the structure's.
- **Browser** (bottom), the media library, its sections on the left. **Game**: **Objects** (every
  object of the game: your own characters first, then the most used, the ways in and out of a map,
  decorations, weapons, characters...), **Models** (every 3D model), **Pieces** (every object of the
  original levels made of brushes, whole: see *Adding things*), **Sounds**. **Prefabs**: the
  structures and nests you saved, reusable in every level of the project, their copies linked to them (see *Adding
  things*). **Imported**: **My
  models** and **My sounds**, what you brought in with **Import...** (or dropped on the editor).
  The **Console** tab next to it shows the running game's log (see *Scripts and the Console*).
  Click a tile, then a floor or a wall to place it, or drag it onto the 3D view; sounds are dragged
  (see *Sounds*). **+ Create** adds a block, a hole, water, a zone portal, a sign or a cutscene camera;
  **Characters...** opens the Character Creator. Nothing assembled by hand is in the library: the
  structures of the map you are editing are in the Hierarchy.
  **Favourites**, as in Unity's Project window: the **star** of a tile (it shows under the pointer) keeps that
  object, character, model, piece, mover, prefab or sound in a **Favourites** group at the top of its section,
  for this project (textures have theirs in the texture picker, see *Textures*); its star again takes it out. A
  favourite whose asset is gone (a mod's package removed, a prefab or a sound of yours deleted) stays there,
  dashed and *Missing*, until its star takes it out. The fixed **Most used** list of Objects stays as it was.
  The **slider** at the top right of the Browser makes the tiles a **list** (one line each, with the class or the
  model's own name after the name) or **small**, **medium** or **large** tiles; `Ctrl`+wheel over the tiles does
  the same, and then neither the page nor the 3D view zooms. One size for every section, kept in this browser.
- **Inspector** (right): the selected object's transform and relevant properties in foldouts.
  Changes and Messages can be expanded when needed. Right-click an object for actions for
  its type: a character offers Dialogues and Animation Studio; a light offers Light settings.
  The **padlock** at the top keeps the Inspector on this object while you select others (to drag
  something onto its fields); press it again to follow the selection. **Right click > Properties…** (in the 3D
  view or the Hierarchy) opens a floating Inspector of that one object instead, while the panel keeps following the
  selection (see *Properties and connections*).
- **History** (a tab next to the Inspector; **Window > History** or `Ctrl+U`), as Unity's Undo History: every
  change of this map by its name (*Move 3 objects*, *Light brightness of Light4*, *Apply texture Wall_A*, *Fill
  AI paths*), the newest at the top and **Map opened** at the bottom. The step the map is at is marked, the steps
  Redo would bring back are dimmed. Click a step to go back (or forward) to it: the map is drawn once, however
  many steps that takes, and the status bar says how many; `Up` / `Down` move in the list, `Enter` goes (the
  focus stays on the step gone to). **Edit > Undo** and **Redo** say the step they take (*Undo Move 3 objects*),
  and after `Ctrl+Z` the status bar says what was undone. A click that changes nothing (on the gizmo, an animation
  key or a key of the cutscene timeline, let go where it was) is no step, and the steps Redo would bring back stay.
  `Ctrl+U` brings the panel to the front, or hides it when it is there already (while a panel or the 3D view is
  maximized over it, `Ctrl+U` shows it and the layout comes back). The last 100 steps are kept (past that the
  bottom row says *Before the oldest step kept*). The history belongs to the map open: opening another map, a
  Rebuild (it loads the map again) or reloading the page starts it again, empty. Your changes are not lost with
  it: **Save** and autosave (Settings > General, every 5 minutes at first) keep them. While a character is posed
  with *Pose here*, `Ctrl+Z` is the pose's own and the History panel waits.
- **The 3D view's toolbar** (top left of the view, like Unity's): **Move**, **Rotate**, **Scale**
  (`W` `E` `R`), **Center / Pivot** (`Z`) and **Global / Local** (`X`) for the gizmo (see *Objects*),
  the **arrows** of the previous and next selection, **grid snap** (`G`) with its
  **grid step** and **rotation step**, the **grid** shown in the view at the floor of the selection, the **bulb**
  that shows or hides the icons of lights, AI paths and logic points (see *Objects*), and the **Show** menu (the
  stacked layers: each kind of thing shown, locked and with its icons, see *Visibility, selection and game
  activation*). Then
  **Isolate** (`Shift+H`) and the **crossed eye** with the number of objects hidden with the eye
  (see *Visibility, selection and game activation*), and the **camera** that pilots the selection (`Shift+P`, see
  *The selection and the view* under *Objects*); while one is on, a flag says so
  (*Isolated: 3 objects*, *Hidden shown: 5*, *Piloting Light*) with a button that ends it. Last, the view's
  lighting with **Effects** (see *Lighting of the view*) and the **speaker** that plays the map's ambient sounds round
  the camera (see *Hear the map* under *Sounds*).
- **The axis widget** (top right of the view, like Unity's scene gizmo): click an axis end to look from
  that side, with the camera's heading under it (see *Moving around*).
- **Panels**: drag a panel tab to the left, right or bottom edge, or into the scene to float it.
  The panel menu also offers docking and hiding. Resize by dragging its edge. **Window** shows
  hidden panels and offers Default, Scene and Inspect layouts, plus Reset layout. The layout
  is remembered on this computer. Floating panels remain inside the editor window.
  **Saved layouts**, as Unity's Layout menu: **Window > Save layout as…** keeps the panels as they are (where each
  one is docked, how wide, which tab is in front) under a name of yours, for writing the Story, a lighting pass,
  texture work or play-testing with the Console. Each one is then an item of the Window menu (**Layout:** and its
  name) that puts them back at once; a name used again replaces it. Up to 10, kept in this browser for every project
  (they are yours, not the project's). **Delete layout…** lists them with a Delete button each; **Export layouts…**
  writes them all to `deusedix-layouts.json`, **Import layouts…** adds those of such a file (on another computer, or
  after clearing the browser), one with a name you have already replacing yours.
  **Maximize panel** (`Shift+Space`, Window menu), as Unity's: the docked panel under the pointer fills the
  editor, with its tabs; over the 3D view, the 3D view fills it (floating panels stay). `Shift+Space` again, or
  `Esc`, puts the layout back; so does any change of the panels (docking, hiding, a layout from the menu). The
  layout you had is never changed by it, nor stored maximized. Over a floating panel or a window nothing happens
  (the status bar says so). The key can be changed in Settings > Keyboard shortcuts.

### Visibility, selection and game activation

- The **eye** hides an object only in the scene view. Its game behaviour is unchanged.
- The **lock** prevents accidental selection, snapping onto it and edits in the scene. You can still select its
  Hierarchy row to inspect it or unlock it. View > Show all objects and Unlock all objects recover
  these editor-only states, which are remembered per map on this computer.
- **Show** (the stacked layers in the 3D view's toolbar, as Unity's Layers and Gizmos menus): a row for each
  kind of thing, as the Hierarchy sorts them (Structures, Characters, Lights, Objects, Doors and elevators,
  Triggers and logic, AI paths, Blocks with the drawings, then Sounds, Cameras and cutscenes and Zones wherever
  they are: a class named for a sound or music, a camera or a cutscene, or a zone, the game's or a mod's; a character
  stays a character whatever its name, as the engine's Camera), with how many the map has. Its **eye** hides the
  whole kind in the 3D view (hidden blocks are their
  boxes: what the last Rebuild built of them is the map's own and stays, as with Isolate); its **padlock** locks
  it: not picked by a click or a rectangle, left out of Select all, not snapped to (`V`, `Ctrl+Shift`), no gizmo
  or dots, its settings greyed in the Inspector (Drop to floor and placing from the browser still land on it);
  its **bulb** (the kinds drawn as icons) hides only that kind's icons. A click on a kind's name shows only that
  kind (to follow the triggers and logic of a room), again shows every kind; **Show, unlock and draw every kind**
  puts them all back. **Icon size** makes every icon of the view bigger or smaller. **Esc** closes the menu (and the
  toolbar's other lists) and does nothing else: the next Esc ends a placing or clears the selection. The Hierarchy's kind
  folders are these same rows (so a sound sits in Sounds, not in Triggers and logic) and have the same eye and
  padlock, which cover everything the folder lists (the Structures folder's too; Blocks lists the drawings, each
  with its own eye and padlock); a row of a hidden kind is greyed,
  of a locked one in italics, and says why when you hover it. A structure, or a folder of yours, still moves and
  deletes as one with a hidden or locked kind inside it: selected whole or with other things, dragged in the
  Hierarchy, moved into another folder or taking things moved into it, and edited from its right-click menu; only
  the own eye or padlock of something in it holds it. What you place, paste, draw, duplicate or make in any other
  way (the Hierarchy's **+**, the 2D Shape Editor, Clip, a hole's light, Fill AI paths, a patrol route's points, the
  sky's suns, a cutscene camera, Replace with) of a hidden or locked kind is made all the same, and the status bar
  says that its kind is hidden or locked. These states are kept per project on this computer, apart from each object's
  own eye and padlock: an object shows only when both let it, and showing a kind again never turns an object's
  own eye back on (nor View > Show all objects a kind's). The toolbar's button is lit while a kind is off.
- **Isolate** (`Shift+H`, the frame button of the 3D view's toolbar, or View > Isolate selection), as
  Unity's: only the selection stays in the view, with what it holds (the objects of a structure, what a
  folder holds) and the structure each selected object stands in, so a desk is seen in its room.
  Everything else is hidden until you press `Shift+H` again or **Exit** on the toolbar's flag; opening
  another map or starting Play ends it too. Objects you add meanwhile (a copy, a paste) are shown. The
  map, the eyes and Save are untouched; in the Hierarchy the rows outside the isolation are greyed.
  The map's own surfaces that are in no structure (the built blocks) stay.
- **Show hidden** (the crossed eye of the toolbar, with how many objects the eye hides, or View > Show
  hidden objects for now) shows them for a while without turning their eye back on: press it again
  (or **Hide** on its flag) and they are hidden as before. Inside an isolation the eye still hides, and
  Show hidden reveals only what is isolated. View > Show all objects, instead, turns every eye back on.
- **Enabled in game** controls whether an actor exists in the next playable Rebuild. An unchecked
  object remains in the editor with its properties, animation and dialogue configuration intact.
  Toggle it back on and rebuild to restore it. This change supports Undo and Save; structural
  BSP groups use the eye and lock, without an actor activation switch.

Authored interactions involving inactive actors are skipped with a build message. Original mission
scripts may still expect their actors, so test the mission after disabling one. For existing .dx
maps, the editable source is retained in `maps/.authoring/` with its edits; keep that folder with
the project when moving it. Build caches can be reconstructed from the retained source.

The viewport uses a coloured bulb for lights, a camera for cutscene cameras, a walking figure for
AI path points, a speaker for sounds and distinct symbols for triggers and other logic objects.

### Searching the map

The Hierarchy's search box works as Unity's scene search. **Words** find a name, the label the Hierarchy
shows or a class, as before (`crate`, `patrol point`); with several words, each one must be there. **Tokens**
look at one thing of an object:

| | |
|---|---|
| `t:` (or `class:`) | its class, the classes it comes from, or its kind: `t:light`, `t:door`, `t:character`, `t:sound`, `t:camera`, `t:zone`, `t:structure`, `t:ScriptedPawn` |
| `tag:` / `event:` | its Tag / its Event: `tag:alarm` finds what an alarm's Event sets off, `event:alarm` what sets it off |
| `name:` / `label:` | its name in the map (`name:DeusExMover3`) / the name the Hierarchy shows |
| `snd:` | a sound it uses: an ambient sound, a door's or an elevator's sounds, a sound effect's, a sound its Interactions rules play (the sounds set on it in the map or here; a class's own default sounds are not known) |
| `tex:` | a texture it uses: its skins, the faces of a structure, a block's, one put on it in the Textures section |
| `mesh:` | its model: `mesh:Chair`, or a model's package, `mesh:DeusExDeco` |
| `is:` | `is:hidden`, `is:locked` (by its padlock or its kind's), `is:disabled` (in game), `is:added` (in the editor), `is:original` (of the map), `is:nested` (in a folder, or inside a structure), `is:selected` |
| `ref:` | `ref:Button1`: that object, what points at it and what it points at (Event to Tag, the keys of a door, the patrols, the Inspector's Connections) and its Interactions rules both ways |

`tag:alarm` finds a part of the value; `tag=Alarm` the whole of it (for a sound, a texture or a model also its
last part: `snd=Hum` for *Ambient.Ambient.Hum*). A value with spaces goes in quotes (`tag:"Alarm Lights"`). A
`-` before a word or a token leaves out what it finds (`t:light -is:hidden`), wherever it is. A folder or a structure
whose name has a word you look for shows all it holds (the folders and structures in it too, with what they hold),
but what a `-` word or token leaves out; with `-` words alone, a folder or a structure they leave empty is not listed.
Words and tokens can be mixed, and
every one must hold: `t:door snd:metal is:original`. While you type, the tokens are offered under the box as
small chips, then the values this map has for one (its tags, its classes, its sounds...): **Up** / **Down**
choose one, **Tab** or **Enter** (or a click) puts it in. **Esc** in the box clears the search (pressed again,
the keys go back to the 3D view).

While a search is on, the **3D view** dims everything that does not match: the matches stay bright, and their
parts hidden behind walls glow through them, so you see at once where the alarm triggers or the doors of a sound
are (the Top, Front and Side views stay as they are). The gizmo and the selection's outline stay bright.
Clearing the box brings the view back as it was; the
objects themselves and their materials are not changed, and nothing of the search is saved. Opening another map (or
closing this one) ends the search: a name of one map means nothing, or another object, in the next.

**Find references** (right click an object or a moving block, or Edit > *Find references*), as Unity's *Find
References in Scene*: the search becomes `ref:` and its name. **Find in map** in the browsers asks which objects
use an asset: in a sound's Inspector (**Sounds**), and by right click on a model (**Models**) or on a texture's
picture (the texture picker): the search becomes `snd=`, `mesh=` or `tex=` and the name.

### Searching everything

**Edit > Search everything…** (`Ctrl+K`), as Unity's Search window: one box over the whole editor. Type part of a
name: the letters of each word are looked for in their order, best at the start of a word, so `rbl` finds *Rebuild
lighting* and `keypad` finds both the keypads of this map and the keypad to place. The results come in groups, the
group with the best match first:

- **Commands**: every command of the menus, with its menu and its key. What its menu greys out now (a map command
  with no map open, Paste properties with nothing copied) is greyed here too and does not run; the rest runs exactly
  as from its menu. The Window menu's panels are under **Panels** instead.
- **In this map**: the map's objects, found as the Hierarchy's search finds them; **Enter** selects one and frames it,
  as a double click in the Hierarchy.
- **Place an object**: the items of the Objects browser, your characters too; **Enter** starts placing it (click a
  floor or a wall).
- **Textures** (this map's first, then the game's) and **Sounds** (the game's and yours): **Enter** opens it in its
  browser, the texture picker on its picture (right click: *Find in map*) or the Sounds browser with that sound chosen
  (its search becomes the sound's name).
- **Settings** (each page, found also by what is on it: `fov` finds Camera) and **Panels** (Hierarchy, Inspector,
  Asset browser, Console and the browser's sections): **Enter** opens it (a panel comes to the front, never hides).

`>` at the start looks only at the commands (`>` alone lists them all), `@` only at this map's objects (`@` alone
lists them all, and the Hierarchy's tokens are offered as you type). A query with a token of the Hierarchy's search
(`t:light`, `tag:alarm`, `is:hidden`: see *Searching the map*) searches the map's objects too. **Up** / **Down**
choose, **Enter** runs (a click too), **Tab** puts in the token offered, **Esc** closes. With the box empty, your last
20 searches come back (kept per project on this computer). The box does not open over another window (Settings, the
Story, the Animation Studio...), while the game is played, or while you type in a field, where `Ctrl+K` stays the
field's. Its key can be changed in Settings > Keyboard shortcuts.

### Keys: the shortcut helper and Press a key

Many keys work only in one mode, and the status bar says them only once. The **shortcut helper**, as Unity's
Shortcut Helper Bar, keeps them in sight: switch it on in **Settings > General > Shortcut helper** (it is off at
first). At the right of the status bar it shows 4 to 8 keys of what the 3D view is doing (hover a key for the
mode's name and what the key does):

| Mode | Keys shown |
|---|---|
| Selecting (nothing selected) | click, right mouse to fly, `Ctrl+K`, `B`, `M`, `L`, `1`…`9` (kept views), `H` |
| Move tool (something selected) | the other two tools, `G`, `F`, `End`, `X`, `V` held while dragging (corner snap), `Delete` |
| Rotate tool | the other two tools, `G`, `T` (aim at the pointer), `F`, `Z`, `X`, `Delete` |
| Scale tool | the other two tools, `G`, `F`, `Z`, `X`, `End`, `Delete` |
| Placing an object / a block | click, `R` (a quarter turn; not for blocks), `G`, `Esc` |
| Drawing a wall, road, floor or ceiling | click, `Enter`, `Backspace`, `Esc` |
| Drawing stairs or a roof | click A then B, `[` `]` narrower or wider, `,` `.` lower or higher steps (stairs) |
| Patrol route | click, `Enter` or `Esc` when done |
| Edit vertices, Face selection, Measure, Aim at a point | click (`Shift+click`: one more corner or face), `V`, `Q` or `M` ends it (`Esc` too, but in Face selection), `Delete` takes picked corners away |
| Face selection, besides | `Alt+G` Grow, `Alt+Shift+G` Grow (any angle), `Y` Slip; with `Alt` held, `Alt+1…0`: the recent textures |
| Texture Slip (`Y`) | moving the pointer, the wheel, the arrows, `P` (one pan for all), click or `Enter`, `Esc` or right click; `Shift` held: finer, `Ctrl` held: snaps |
| Pilot, flying (right mouse held), a cutscene panel open | right mouse and the wheel, `W` `A` `S` `D` `Q` `E`, `Shift`; `K` and `Space` in a cutscene |

Hold **Shift**, **Ctrl** or **Alt** and it shows what they do now: with the mouse first (*Shift+click* adds to the
selection, *Ctrl+drag* draws a box, *Alt+drag* on a gizmo handle copies, *Alt+click* picks a face, *Ctrl+Alt+click*
lists the lamps lighting a point (*Lights here*), *Shift* while
drawing keeps to 45°, *Shift+click* while placing keeps placing), then the commands with that modifier. The commands'
keys are yours: give one another key in Settings and the strip shows it (`R` turning what is placed follows the
Scale tool's key, and so do the status bar's hints while placing). Click a key on the strip: **Settings > Keyboard
shortcuts** opens on it, the command's row
marked, and what that key does everywhere listed above the table. The strip hides while a window holds the keys
(Settings, the Story, the Animation Studio...), while the game is played and without a map; with too little room it
shows the keys that fit.

**Press a key** at the top of Settings > Keyboard shortcuts looks a key up instead: press it (with its modifiers) and
every context where it does something is listed: the commands with that key (*W*: the Move tool in the 3D view,
flying forward with the right mouse held) and the keys of a mode (*Enter*: ends a drawing, ends a patrol route;
*Delete*: in Edit vertices, takes the picked corners away). **Change** next to a command waits for its new key. Hold
Shift, Ctrl or Alt alone to list what they do with the mouse. Press other keys to look them up in turn; `Esc` stops.

## Objects

Click an object to select it. Then:

| | |
|---|---|
| `W` / `E` / `R` | the arrows move, rotate or scale it (also from the 3D view's toolbar); or type the numbers in the right panel |
| `Z` / `X` | the gizmo: **Center / Pivot** (where a group turns and scales) and **Global / Local** (the map's axes or the object's own); also in the 3D view's toolbar and the Edit menu |
| `T` | aim the selection at the point under the pointer (with `E`: `Ctrl+Shift+click`; right click > **Aim at a point…**) |
| `Ctrl+Shift+F` (Edit > Align with view) | put the selection where the view looks from, turned the way it looks (see *The selection and the view* below) |
| `Ctrl+Alt+F` (Edit > Move to view) | move the selection onto what the middle of the view looks at, keeping its turn |
| `End` (or the floor icon) | drop it onto whatever is below |
| `Ctrl+D` or right click > Duplicate | duplicate the whole selection, keeping rotation, scale and spacing |
| right click > **Replace with…** (Edit menu), or `Alt` + an item of the browser let go on an object | make the selection (or that object) another object, character or model, keeping its name, place, turn, size, Tag, Event and the rules and Story that name it (see *Replace with* below) |
| `Alt` + drag a transform handle | duplicate in place, then move the copies with the handle; one Undo removes the copies and their move |
| `Ctrl+C`, `Ctrl+V` | copy and paste where you are looking, even into another map: open the other map, copy, come back, paste |
| `Ctrl+C`, `Ctrl+A`, `Up` / `Down`, `Esc` in the Console's log | the Console's own: copy the lines picked (a text selected with the mouse: that text), pick every line shown, pick the line before or after (`Shift`: one more), let them go; the map's objects are neither copied nor selected (see *Scripts and the Console*) |
| `Ctrl+X` (Edit > Cut) | copy, then delete: one `Ctrl+Z` puts it back. What cannot be copied (a door of the map) is not deleted |
| `Ctrl+A`, `Ctrl+I`, `Shift+D` | select all, invert the selection, deselect (Edit menu); hidden and locked things are left out |
| `Ctrl+Shift+[` / `Ctrl+Shift+]` | the previous / next selection (`è` and `+` on an Italian keyboard), also the arrows of the 3D view's toolbar |
| `Ctrl+Alt+1`…`9`, `Alt+1`…`9` | keep the selection in a slot, select it again (in Face selection `Alt+1`…`9` and `Alt+0` put the recent textures on the selected faces instead) |
| `Y` over selected faces (Edit > Slip the texture) | the Texture Slip: roll their texture with the pointer and size it with the wheel, live (see *Faces and texture alignment*) |
| `Shift+H` | isolate the selection: only it is shown until `Shift+H` again (View > Isolate selection); `H` stays Quick help |
| `Esc` in the Hierarchy's search | clear the search: the whole map again; `Up` / `Down` and `Tab` or `Enter` put in a token offered under the box (see *Searching the map*) |
| `Alt`+click a folder's arrow in the Hierarchy | open or close it with every folder inside it; right click in the Hierarchy > **Expand all** / **Collapse all** for every folder (see *Folders (nests)*) |
| `Ctrl+K` (Edit > Search everything…) | one search over the menus' commands, this map's objects, the objects to place, textures, sounds, the Settings pages and the panels (see *Searching everything*) |
| `Ctrl`+wheel over the Browser's tiles (or the texture picker's) | the size of the tiles: a list, small, medium or large, as the slider at the top right of each; the tile under the pointer stays under it (see *The screen*) |
| `Delete` (or the bin icon) | delete |
| `Ctrl+Z` / `Ctrl+Y` | undo / redo (also `Ctrl+Shift+Z`): a texture applied from the Texture Editor is one step, Ctrl+Z takes it away and Ctrl+Y puts it back; the status bar says what was undone, Edit > Undo / Redo the step they take (*Undo Move 3 objects*) |
| `Ctrl+U` (Window > History) | the History panel: every change of this map by name, newest first; a click goes back (or forward) to that step (see *The screen*) |
| `Shift+Space` (Window > Maximize panel) | the docked panel under the pointer, or the 3D view, fills the editor; again, or `Esc`, the layout is back (see *The screen*) |
| right click > **Properties…** | a floating Inspector of that object, beside the panel, that stays on it whatever you select; up to 3 (see *Properties and connections*) |
| `G` | grid snap on/off; its steps are in the 3D view's toolbar |
| `Ctrl` while dragging the gizmo | grid snap the other way for as long as it is held: free with snap on, on the grid with snap off |
| `Ctrl+[` / `Ctrl+]` | halve / double the grid step (`Ctrl+è` and `Ctrl++` on an Italian keyboard); while drawing stairs `[` and `]` stay the stairs' |
| `Ctrl+\` (Edit > Push to grid) | put each selected thing onto the nearest grid point, one `Ctrl+Z` |
| `V` held while moving with the gizmo | vertex snapping: the selection's corner nearest the pointer goes onto the corner of the map or of another object under the pointer (see *Snapping to corners and surfaces*); a tap of `V` is still Edit vertices |
| `Ctrl+Shift` dragging the gizmo's middle square | surface snapping: it slides over what is under the pointer and rests on it |
| drag a dot of the selection | a light's reach or a spotlight's cone, a sound's radius, a trigger's or a collision box's size; with `R`, one side of a block. `Alt`: both sides, `Shift`: every side by the same share, `Esc`: cancel (see *Drag handles* below) |

In the Inspector, hold the **X**, **Y** or **Z** label and drag left or right to move along
that axis. Each pixel changes the coordinate by **1 Unreal unit**, even with grid snap on;
hold `Shift` for **0.1 unit** per pixel. The object moves in the view as you drag. Release to
keep the move, `Esc` to cancel, or `Ctrl+Z` to undo the whole drag in one step. This also works
for blocks and structures (their objects follow). Click the number to type an exact value.

**Maths in the number fields**, as in Unity: the numbers of the Transform (position, rotation, pitch,
roll, scale, a block's size) and of the Properties (a light's brightness and radius, a door's strength,
Movement, the numbers of All properties) take a sum, worked out when you press `Enter` or leave the
field: `2+3`, `10/4`, `(64+16)/2`, `2^3`, `7%4`, `pi`, `sqrt(2)`, `sin`, `cos`, `tan`, `floor`, `ceil`,
`round` (angles in radians: `pi` is half a turn). `+=16`, `-=8`, `*=0.8` and `/=2` work on the value the
field had: `+=16` in **Y** raises a crate by 16. The status bar shows the sum and its result (*X position:
10/4 = 2.5*). Something that is not a number (`2+`) leaves the value as it was and the status bar says
why; `Esc` puts back the value the field had before you typed; the arrow keys step it. `2,5` is 2.5 too.
Dragging a label still works on these fields. In All properties only the fields of numbers take sums: a
vector such as `(X=1,Y=2,Z=3)` stays UnrealEd's text. With several objects selected, `L(a,b)` and `R(a,b)`
spread a value over them, evenly or at random (see **Editing several objects at once** below); in a field of
one object they are refused.

**Rotate (`E`)** turns an object every way, as in Unity: the green ring turns it round, the red and
blue rings tip it forward or onto its side (a book lying on a lectern, a tilted sign), the outer ring
turns it as seen from the camera. The Inspector shows **Rotation**, **Pitch** and **Roll**; type them
for exact values. Pieces, structures, blocks, characters, doors and groups all support three-axis
rotation. Selection outlines follow the object's orientation rather than expanding along the map's axes.
A block keeps its size when it turns, also with grid snap on.
An NPC's AI may turn it again while playing; editor placement does not disable its behaviour.

**Aim at a point** (Unity's look-at): the selected objects turn their front to a point of the 3D view, each
from its own place: a security camera at a door, a spotlight at a painting, a turret down a corridor, a
guard toward the entrance. Point at a wall, a floor or an object and press `T`; or, with **Rotate** (`E`),
**Ctrl+Shift+click** the point (while `Ctrl+Shift` are held a dashed line goes from each object to the
pointer); or right click > **Aim at a point…** (also in the Edit menu), then click the point (`Esc`
cancels). Lights, cameras, turrets and effect points tip up or down too; characters, the player start, AI
path points, furniture and items turn round only and stay standing (their pitch stays). Roll always stays.
Several objects each aim at the same point; blocks and structures have no front and keep their turn. One
`Ctrl+Z` undoes it.

**Replace with** (Unity's prefab *Replace*): the selected objects become another object, a character of yours or a
model, each where it was, turned its way and at its size, under its own name. Twelve MJ12 troopers become UNATCO
troopers, crates become barrels, a pickup another pickup. Click the replacement in the browser (Objects, your
characters, or a model in Models: it waits to be placed), then right click the selection > **Replace with…** (or Edit >
**Replace with…**). With nothing picked, the command waits for the next item you click in the browser (a row at the
top of Objects says so; **Cancel** or `Esc` stops it). Or hold `Alt` while you let go of an item of the browser on an
object: it replaces that object, or the whole selection when the object is part of it (with nothing under the
pointer it is placed as usual).

- What goes over: the place (an object or a character stands with its feet where the old object's were; a light, a
  logic point and something tipped, a lamp on a wall, keep their middle), the turn (a character only turns round), the size (the map's own *DrawScale* and the
  editor's scale), **Tag**, **Event**, the conversation name, a character's orders and patrol route, and every other
  property of the old object the new class also has, checked against the class's full list (as *All properties*
  shows it), values of All properties too. The look (model, skins, collision) is the new class's, or the model's or
  character's you picked.
- Because the name stays, the **Interactions** that use the object, the patrol routes, the cutscenes that look at it,
  the conditions and the **Story** (dialogues, events) still find it, and so do its animation, its folder, and its
  hidden or disabled state. A conversation name the game's own conversations or a dialogue of the Story use
  stays on it even when the new class has another.
- Before anything changes, a list shows what does not fit: the properties the new class has no place for, and the uses
  that no longer make sense, by what the new class offers to the rules (the catalogue of outputs and inputs): a rule
  *when they are killed* on a barrel, an action *attack* on a crate, a dialogue on something that cannot talk, a
  patrol route through what is no longer a patrol point. **OK** replaces anyway (those uses stay, to change or delete
  them later; the log lists them again), **Cancel** leaves everything as it was. With nothing to say, it just replaces.
- One `Ctrl+Z` undoes the whole replacement. An object of the map becomes an object added in the editor: at Rebuild
  the map's own is removed and the new one takes its name (Delete of the replacement removes the map's own too).
- Doors and lifts, blocks and structures keep their kind (pieces, blocks and movers of the browser cannot replace
  objects). Of an object of the map, only the properties the editor reads (its Properties panel, All properties set
  in the editor) go over; a replaced object inside a structure no longer moves with it (moving the structure later,
  or taking it apart, is fine: the map's own is still found and removed at Rebuild). Should the map's own not be
  found where it was (the map's script changed it), it stays and the new one is left out, and the build log says so:
  two objects never share a name.

**The selection and the view** (Unity's *Align With View*, *Move To View*, *Align View to Selected* and first
person control of a camera). Fly to where a security camera, a spotlight, a turret, the player start or a guard
should be and look the way it should look, then:

- **Align with view** (`Ctrl+Shift+F`, Edit menu) puts the selection where the view looks from, turned the way it
  looks. Lights, cameras, turrets and effect points take the view's pitch too (and a roll of 0: the view has none);
  characters, the player start, furniture and items turn round only and stay standing, as with Aim at a point. A
  character goes with its **eyes** at the camera (its *BaseEyeHeight*, else 0.8 of its collision height, as the game
  does), so it sees what you saw; press `End` to drop it to the floor.
- **Move to view** (`Ctrl+Alt+F`, Edit menu) moves the selection onto what the middle of the view looks at, a floor,
  a wall or an object, resting on it as *Drop to floor* does (on the grid along it with grid snap on), its turn kept.
  With nothing within 4000 units it goes in the air 400 units ahead.
- **Align view to selected** (`Shift+F`, View menu) does the opposite: the view goes to the object and looks along its
  front, from a character's eyes. Select a security camera and press it to see what it watches.
- **Pilot selection** (`Shift+P`, View menu, or the camera button of the 3D view's toolbar): the view looks through
  the object and flying the view (right mouse + `W` `A` `S` `D`, the wheel, panning) takes it along, turned as you
  look. A flag *Piloting ...* says so, the gizmo is off and the object itself is not drawn (the view is inside it).
  `Shift+P` again, `Esc` (also while you fly) or the flag's **Exit** ends it: the object stays where the view took it
  and the view goes back to where it was. Selecting something else, or clicking an empty place, ends it too.

With several objects selected they go as one: the last object you picked that has a front (a light, a camera, a
character...) goes to the view, and the rest keep their place about it, turned with it round the vertical. Blocks and
structures move with the group but cannot lead it (they have no front). Each command is one `Ctrl+Z` (none when the
selection is already there); the moves of the view itself are not undone. The keys can be changed in Settings >
Keyboard shortcuts.

**Center / Pivot and Global / Local** (the two buttons after Scale in the 3D view's toolbar, as Unity's;
`Z` and `X`, or Edit > *Gizmo: Pivot* and *Gizmo: Local*). **Center**: a group's gizmo sits in the middle of
the bounds of what is selected, and turns and scales it about there. **Pivot**: it sits on the last object
you picked (pressing `Z` names it), and the group turns about that one: pick the chairs, then their table
last, and they turn round it. A single object always turns about its own pivot. **Global**: the handles point along the
map's axes. **Local**: they follow the object's own turn, its pitch and roll too (an object stuck to a slope,
a tilted block, a ramp), and for a group the last object picked's; with grid snap on, a move then goes in
whole grid steps along those axes from where the object was. The editor remembers both choices on this
computer (Settings).

**Scale (`R`)**: drag the middle square to scale evenly, as in Unity: right or up makes it bigger,
left or down smaller, 1% for every pixel the mouse moves (5% steps with grid snap). It never flips
inside out, however far you drag. The coloured handles scale one axis (blocks and structures).

**Drag handles**, as Unity's handles of lights, audio sources and colliders: a selected object shows dots on
what it reaches, drawn over everything so that they can be grabbed through a wall; the dot under the pointer
turns orange. Drag one: the value shows at the bottom of the view and in the status bar as you go (as its
field in the Inspector will show it); let go and it is written in the units the game keeps it, one `Ctrl+Z`.
`Esc` while dragging puts it back; then, as after a drag that ends where it began, `Ctrl+Z` and `Ctrl+Y` are as they
were. With grid snap on, sizes go in grid steps.

- **A light**: six dots on its sphere set its **Radius** (`LightRadius`). The game's light reaches
  25 × (radius + 1) units, so the reach goes in whole steps of 25 units, grid or not. A **spotlight**
  (Effect `LE_Spotlight` or `LE_StaticSpot`) shows its cone instead of the sphere, along its front (aim it
  with `E` or `T`): the dot at the tip sets its reach, the four on the rim how wide it opens (**Cone**,
  `LightCone`: 128 is 45° from the middle, 90° wide), in rotation steps with grid snap on.
- **A sound**: the dots on its circles set *Heard within*: `SoundRadius` (steps of 25 units, as a light's
  radius) or a sound effect's own distance in units (`FXRadius`).
- **A trigger**, or a sound effect played when JC walks in: four dots round its cylinder set its *Radius*
  (`CollisionRadius`), the top and bottom ones its *Height* (`CollisionHeight`, half the cylinder's height).
  The trigger stays in the middle.
- **A collision box**: a dot in the middle of each side (its cylinder shape has the trigger's dots). Dragging
  one moves that side alone: the box's middle follows, so the opposite side stays where it is.
- **A block**, with **Scale** (`R`): a dot in the middle of each side, also on holes, water and zone portals.
  Dragging one moves that side alone and the opposite side stays, as Unity's box handles: extend a floor to
  the next room, a wall up to the ceiling, a doorway to one jamb without moving the other. With grid snap on, a
  side facing along the map's axes lands on the grid (no slivers in the game's CSG); a turned block gets a
  whole number of grid steps thick. A side never crosses the opposite one (4 units at least). A hole's cut
  follows the drag. The coloured handles of the gizmo still scale from the middle.
- **Alt** while dragging a side (a block or a collision box): both sides move, the middle stays. **Shift**:
  the other sides grow or shrink by the same share.

The dots work in the Top, Front and Side views too, each view with its own: a dot whose line points at you is left
out of that view (it could not be dragged there) and shows in the others, so the top and bottom of a block that the
Top view leaves out are dragged in the Front or Side view; in the 3D view, turn the view a little. Sides facing away
from you are dimmer.

**Grid snap** (`G`, the magnet in the 3D view's toolbar, or Edit > *Grid snap*, ticked while it is on): moves go in
steps of the **grid step**
(units: a door is 64 wide), turns in steps of the **rotation step** (degrees). Type any number in the
two boxes, or pick one with their arrow; they are the same as Settings > Editing. In **Local**, a move
goes that many units from where it began, along the object's own axes. As in Unity, **`Ctrl` held while
dragging** the gizmo turns grid snap the other way for as long as it is held (a free move with snap on, a
snapped one with it off; a block's size too), and **`Ctrl+[`** and **`Ctrl+]`** halve or double the grid step
(Edit > *Grid step: half* and *Grid step: double*).

**The grid in the 3D view**: the grid button after the rotation step (or View > *Grid in the 3D view*) shows
the grid on the floor, as Unity's scene grid: a cell for each grid step and a brighter line every 8 cells,
fading out round the camera (from high up, every second or fourth line shows, so that it stays readable). It
lies at the bottom of the selection, on the grid, and follows it while you move it; with nothing selected, on
the floor under the camera. Walls and floors in front of it hide it; the Top, Front and Side views keep their
own grid. The editor remembers whether it is shown.

**Push to grid** (Edit menu, `Ctrl+\`, Unity's *Push To Grid*): each selected thing goes onto the nearest grid
point, for pieces pasted from UnrealEd and objects of the original maps that are a few units off. A block that
is not turned goes by its lowest corner, so a block a whole number of grid steps long gets every side on the grid
(no slivers in the game's CSG); a turned block by its middle; structures, Pieces and drawings by their pivot.
An object keeps its height (it stands on its floor by its collision); only its X and Y go onto the grid. One
`Ctrl+Z` undoes it; when everything is on the grid already, the status bar says so and nothing changes.

**Snapping to corners and surfaces**, as Unity's vertex and surface snapping, while you move something with the
gizmo (`W`), one object or several:

- **Hold `V` while dragging**: the corner of the selection nearest the pointer goes onto the corner nearest the
  pointer of the map, a structure, a block, a model or a drawing under it, when one is within a few pixels. A
  dot marks the corner that snaps: white while it looks for a corner, orange once it is on one. Away from any
  corner the move goes on as the gizmo makes it (on the grid with grid snap). The selection's corners are a
  block's own corners, the vertices of a structure, a Piece or a drawing, and for a model the corners of its
  bounds and its pivot (a light or another icon: its pivot); the corners it lands on are those of the faces
  under the pointer. It joins blocks to the off-grid pieces of the original maps without a gap. A tap of `V`
  outside a drag is still Edit vertices (the key of Edit vertices in Settings does both).
- **Hold `Ctrl+Shift` while dragging the middle square**: the selection slides over the surface under the
  pointer (the map, a structure, a block, a model, a drawing; not itself) and rests on it by its bounds, as
  **Drop to floor** puts it on a floor: on a desk, on a shelf, against a wall. With grid snap it goes in grid
  steps along the surface. It keeps its turn; in **Stick** mode (the Drop button's menu) one object also turns to
  the surface, as **Stick to surface** turns it, and a decoration stuck to a wall or a slope gets *Physics None*
  so that it stays there in the game. Let go of `Ctrl+Shift` and it follows the gizmo again, with its own turn.

Each drag stays one `Ctrl+Z`. Turning and scaling are not snapped to corners or surfaces.

**Icons**: the bulb in the 3D view's toolbar hides the symbols of lights, AI path points and logic
points, to see the level as it is; the **Show** menu next to it hides the icons of one kind (the sounds, the
AI paths...) and sets the **Icon size**. Hidden icons cannot be clicked or taken by a rectangle in the view:
pick them in the Hierarchy.

Objects scale all together (in Deus Ex an object has a single size, and its collision follows).
Objects whose name starts with `UC` are the editor's own (interactions, the map's `UCBoot`...): you can
move them, but keep them in the same room.

### Particles: smoke, steam, sparks, dust

**Objects > Effects** has the game's particles, ready to place: rising smoke, a steam jet, cold mist that sinks,
sparks, short bursts of electric sparks and falling dust (each a `ParticleGenerator`, the class of the game's steam
vents, set as the game sets its own). Click one, then a floor, wall or ceiling: its **cyan arrow** comes out of the
surface clicked, and that is the way the particles are thrown. Turn it with `E`, Rotation and Pitch.

While it is selected the particles play in the 3D view, with their texture: thrown along the arrow, rising or
sinking, falling with gravity, growing and fading as the game does it. The **Particles** section of the right panel
has its settings by name, each with a slider; the preview follows them as you drag:

- **Texture**: the picture of each particle (its small picture opens the texture picker: the game's *Effects*
  package has its smoke, sparks and flames; the dropper takes one from the 3D view);
- **Chance** and **Every (s)**: how often it throws a puff; **Particles each time**: how many in a puff;
- **Speed** along the arrow, **Rise** (below 0 they sink), **Life (s)**, **Size**;
- **Spread out**, **Gravity**, **Grow**, **Fade out**, **Glow (unlit)**, **Darkens (modulated)**.

Only the settings the game's class has are shown (read from the game the first time). **always play the preview**
keeps it playing when it is not selected (the editor's only: the game does not read it). Generators already in a map
(an original map's steam vents) have the same arrow, preview and section. The preview follows the game's rules
closely, but it is not the game: Rebuild and Play show the particles for sure.

**Particles that hurt, and switching them on and off.** The Effects of the browser are `UCParticles` (DeusEdix's
package: the game's particles, and more). Under the particle settings their section has:

- **Damage**: how much each hit, its **Kind** (fire, electricity, poison gas, tear gas, radiation, EMP, explosion,
  shot, stun: what JC's augmentations and armour resist), its **Radius** round the stream, its **Reach** along the
  arrow (0: a ball round it), **Hit every (s)**, and whether it **Hurts characters too** (else JC only). Nothing is
  hurt through a wall. While it is selected, a red see-through shape in the 3D view shows where it hurts;
- **Switching on and off**: **On at the start** (off: it waits), **Stays on (s)** once switched on (0: until switched
  off), and whether **"Switch on" also switches it off**. Switch it with the Interactions' *Switch on* and *Switch
  off* (when JC uses a button, walks into a collision box, picks something up, a timer runs out...) or with the
  game's own triggers through its Tag. Off, it throws no more particles (those in the air finish their life) and its
  sound stops.

The browser has some ready: *Steam that burns*, *Electric hazard*, *Toxic gas*, *Smoke when switched on (10 s)*. A
generator of an original map (a `ParticleGenerator`) has **Make it able to hurt and switch on/off**: it becomes a
`UCParticles` with the same particles (Replace with..., one Undo).

**Your own effects.** **Save as my effect…** in the section keeps the particles' settings (texture, damage and
switching too) under a name of yours: they are in **Objects > Effects** of this project, under the game's, to place
again in any map (right click one to delete it). A particle can have a picture of yours as its texture: import it
into the map (the texture editor), then type its name in **Texture**.

### Several objects at once

**Ctrl+click** or **Shift+click** adds an object to the selection (or takes it away) in the 3D
view; in the Hierarchy, Ctrl+click adds one row and **Shift+click** picks every row in between.
**Ctrl+drag** or **Shift+drag** in the 3D view selects every object inside the rectangle. The gizmo moves them
together (**W**) and turns them about their middle (**E**), or about the last one picked with **Pivot** (`Z`).
**Delete**, **Ctrl+D**, **Alt+drag**
and **End** (drop to floor) act on the selection. Pieces are included in rectangle selection too.
Objects, blocks and structures can be selected together; the panel lists them.
If a protected member cannot be duplicated, the whole operation stops with a visible warning:
it never silently copies only the lights. Un-nest to duplicate independent scenery, or use a reusable prefab.
**Ctrl+C / Ctrl+V** can transfer several actors or blocks between maps; for mixed selections
containing structures use **Save as prefab** instead. Alt+click away from a transform handle still selects a face.

**Things stacked under the mouse** (a light inside a lamp, a trigger inside a desk, a player start on a
teleporter): click, then **click again on the same spot** to select the next one behind it, and so on
round; the status bar says which one of how many (*Under the pointer, 2 of 3: Teleporter*). The first click
picks the folder of the nearest thing, as usual; the next ones each thing on its own. The map's own walls
are a step too (nothing selected). A click on the gizmo's handles moves the object instead: click beside
them. **Ctrl + right click** (or right click > **Select under cursor…**) lists everything under the mouse
with its icon, nearest first: click one to select it alone, **Shift+click** to add it to the selection or
take it out. Hidden icons, hidden and locked things are not listed.

**Selection commands** (Edit menu): **Select all** (`Ctrl+A`) and **Invert selection** (`Ctrl+I`) work on
what you can click in the view (hidden and locked things are left out), **Deselect** is `Shift+D` (or
`Esc`), **Cut** (`Ctrl+X`) copies and deletes. **Previous / Next selection** (`Ctrl+Shift+[` and
`Ctrl+Shift+]`, or the two arrows in the 3D view's toolbar) walk back and forth through the last 50
selections of the map, skipping what was deleted; after `Esc`, Previous brings the last selection back.
**Selection slots**: `Ctrl+Alt+1` to `Ctrl+Alt+9` keep the selection (Edit > *Keep selection in slot 1*),
`Alt+1` to `Alt+9` select it again; they are kept per map on this computer, with the camera bookmarks. In Face
selection (`Q`) `Alt+1` to `Alt+9` and `Alt+0` are the recent textures' (see *Faces and texture alignment*).
These keys can be changed in Settings > Keyboard shortcuts, except the slots (so can `Z`, `X` and `T` of the gizmo
and Aim at a point, Push to grid and the grid step's `Ctrl+[` and `Ctrl+]`, and the four commands of the selection
and the view).

**Mirror X / Y / Z** (Edit menu, UnrealEd's *Transform > Mirror*) mirrors the selection about its
middle, across the game's X, Y or Z axis. Blocks take their mirror image (a ramp rises the other way;
a block with corners of its own, from *Edit vertices*, has them mirrored); walls, floors, stairs and
roofs you drew too (on X or Y: a drawing stands on its floor), and curved or spiral stairs turn the
other way. Objects face the mirrored way and keep their up (a model cannot be drawn mirrored);
pieces of the map move to their mirrored place as they are. Their animations follow them. One
**Ctrl+Z** undoes it.

**With UnrealEd**: Edit > **Copy as T3D (UnrealEd)** puts the selection on the clipboard the way
UnrealEd copies actors, so *Edit > Paste* in UnrealEd puts it at the same place: blocks as brushes
(a hole subtracts, a detail block is semisolid), what you drew as its pieces (cut by the holes, as the
Rebuild cuts them), objects with their properties. The other way, what you copy in UnrealEd
(*Edit > Copy*) comes in with **Ctrl+V** (or Edit > **Paste T3D (UnrealEd)**): brushes become blocks
with corners of their own, the other actors objects, at the places they had in UnrealEd's map. A
concave brush, a sheet, the builder brush and movers are left out and named in **Messages** (split a
concave brush in UnrealEd first). The pieces of the map are UnrealEd's own brushes: copy them there.

**Drop to floor** and **Stick to surface** also work on independent Pieces and multi-selections.
They use the actual geometry, ignoring the selected objects themselves. To place something while you drag it,
hold `Ctrl+Shift` on the gizmo's middle square (see *Snapping to corners and surfaces*). If no reachable surface is
found, the editor reports it without changing the object or adding an empty Undo step.

**Editing several objects at once**, as in Unity: with several things selected, the Inspector shows the
fields they share. A field whose objects all have the same value shows it; where they differ it shows a dim
**—**. Whatever you type or pick there is set on every one of them, and one `Ctrl+Z` takes it all back.

- **Transform**: X, Y, Z, Rotation, Pitch, Roll and Scale %. A structure with doors or an elevator does not
  turn, and Scale % is for objects with a model (blocks and structures keep their size: resize them with
  `R`); a field only some of them have says how many (*1 of 4*). A block moved or turned keeps its size,
  and a structure carries its own objects (those selected with it are not moved twice).
- **Tags & events**: the **Engine tag** and the **Event** of any objects, even mixed with blocks.
- **The Properties they all have**: every field the classes of all of them have, by group, as one object
  shows them: when they are all lights, the **Light** section (colour, hue, saturation, brightness, radius,
  type, effect, cone...); for 8 doors, Locked, lock strength, opening time... Settings that belong to one
  object (accounts, emails, special options, inventory, relations, sounds, the conversation name) are listed
  under *One object at a time*: select one to set them.
- **All properties**, when they are all of one class, each one's UnrealEd value, set on all of them.

The number fields take sums on each object's own value: `+=16` in **Y** raises every crate by 16 from where
it is, `*=0.8` in Radius makes every light reach 80% as far as it did. `L(a,b)` spreads the objects evenly
from a to b in the order of the list at the top of the Inspector (the order you picked them):
`L(0,512)` in **X** lines up five lights 128 apart, `L(0,270)` in Rotation fans four chairs out. `R(a,b)`
gives each a random value between a and b: `R(0,360)` in Rotation turns 20 trash cans each its own way. The
status bar says what each one got (*Rotation (yaw) in degrees: R(0,360) = 12 to 347 on 20 objects*).
Dragging the label of a number field showing **—** moves each one from its own value (the field shows
`+=8` while you drag): 17 lights spread over the map all move 8 along X, each from where it is.

**Right click** a field showing **—**: *Set all to Light3's value: 150*, one choice for each different value
(Unity's *Set to Value of*). **Narrow the selection**: when different kinds of things are selected, a
button for each kind with how many there are (*Light 12*, *Block 3*) keeps only those.

### UnrealEd's tools

What UnrealEd has for brushes and surfaces, on the editor's blocks and on the map's faces:

- **Top, Front and Side views** (View menu, off at first): panes at the right of the 3D view. The wheel
  zooms at the cursor, a right or middle drag moves the view, a click picks, dragging the selection
  moves it on the pane's plane with the grid. **Cut** leaves out what is between the pane and the 3D
  camera (above it, in the Top view), so rooms show from inside.
- **Edit vertices** (`V`, the Edit menu or the block's panel): move a block's corners one by one, as
  UnrealEd's vertex editing; it stays a convex shape. (`V` held while the gizmo moves something is vertex
  snapping instead: see *Snapping to corners and surfaces*.) **Delete** takes a corner away, **Reset corners**
  gives the block its box and shape again.
- **Tools > 2D Shape Editor**: draw a profile (or start from a rectangle, an arch...), then
  *Extruded* or *Revolved*, solid or a hole: it becomes blocks, one convex piece each, in one nest.
- **Edit > Clip block**: two clicks in a Top, Front or Side view draw the line that cuts the selected
  blocks in two. **Intersect blocks** and **Deintersect blocks**: the block picked last cuts the others,
  keeping what they share with it, or what is outside it.
- **Look** in the panel of a face (Face selection, `Q`): UnrealEd's surface properties, *Unlit*,
  *Translucent*, *Masked*, *Modulated*, *Two-sided*, *Mirror*, *Invisible*, *Fake backdrop*, *Special
  lit*, *No smooth*, *Auto U Pan*, *Auto V Pan*. The last two make the faces' texture slide by itself at their zone's
  speed, as the original maps' clouds and some water do (**View > Effects** shows it moving after a Rebuild). A box is
  ticked when every selected face has it, mixed when some do. **Select same texture** picks every face of the map with
  that texture, **Replace in whole map** gives them all another one.
- **All properties**, the last section of an object's panel: every property UnrealEd's Properties
  window shows for its class, applied at Rebuild after the editor's own.
- **Select all of this class** (Edit menu, or right click on an object).
- **Measure** (`M`): click two points on the surfaces for the distance between them.
- **Camera bookmarks**: `Ctrl+1` to `Ctrl+9` keep the view, `1` to `9` go back to it (with `Alt`: the
  selection slots, see *Several objects at once*).

### Folders (nests): keep things together

Like a nest in Premiere: select some things (Ctrl+click, Ctrl+drag) and press **Ctrl+G** (or
**Edit > Nest**, or right click > **Create folder**). They become one folder in the Hierarchy, at the
top, and one thing in the 3D view: a click on any of them picks the whole folder, the gizmo moves and
turns it all; a **double click** picks one thing inside it.

- A new folder's name is ready to type: type it and press **Enter**, or click anywhere else to keep
  it (**Esc** keeps the old name). Later, **F2**, **Enter** or right click > **Rename** names it again.
- The **+** at the top of the Hierarchy makes an empty **Folder** (inside the folder chosen, if any, else in
  the one new objects go in): drag things into it. An empty folder stays until you delete it (**Del**, or its bin).
- **New objects go here** (right click a folder or a nest, as Unity's *Set as Default Parent*): from then on
  what you place from the Browser (objects, characters, models, pieces, prefabs, blocks, holes, water, portals,
  signs), paste (`Ctrl+V`, Paste T3D), draw (walls, roads, floors, ceilings, stairs, roofs), make with the
  Hierarchy's **+** or the 2D Shape Editor, a hole's light and a new cutscene camera go into that folder. It is
  shown in **bold**, and a small banner at the top of the Hierarchy names it: click the name to find the folder,
  **×** to stop (or right click it > **New objects go to the top level**). One per map, kept with the map's
  changes; `Ctrl+Z` undoes setting it. Renamed, it stays; deleted or un-nested, it stops. While the folder (or
  one around it) is hidden or locked with its eye or padlock, new things stay at the top level, so that they do
  not vanish or get stuck at once: the banner says *hidden* or *locked*. The **+** and the Shape Editor put things
  in the folder picked in the Hierarchy first. As anything in a folder, a click in the 3D view picks the whole
  folder (a double click picks one thing). A copy made with **Ctrl+D** stays beside its original, in its own
  folder, and **Replace with** keeps the object where it was. Fill AI paths, the points of a patrol route and
  the sky's suns are not put there.
- **Expand all** and **Collapse all** (right click anywhere in the Hierarchy, or the Hierarchy panel's menu **⋯**)
  open or close every folder. **Alt+click** a folder's arrow to open or close it with every folder inside it.

### Cubes, wedges, cylinders, cones, spheres and domes

The Hierarchy's **+** also makes a **Cube**, a **Wedge** (a ramp, high at its +X side), a
**Cylinder**, a **Cone**, a **Sphere** or a **Dome** (half a sphere on a flat base), 128 units wide,
where the 3D view looks (standing on the floor there) and inside the folder chosen (else the one new objects go
in). Move it (**W**),
turn it any way (**E**), resize it (**R**: the coloured handles from the middle, or the dot of one side to move
that side alone, see *Drag handles*; or Width, Depth and Height in the Inspector); **Shape** in
the Inspector changes one into another.

The round ones work like UnrealEd's brush builders, with their settings in the Inspector:

- **Sides**: how many sides round (3 to 64, 16 by default). 6 makes a hexagon, 8 an octagon.
- **Hollow**: the thickness of the wall, 0 for solid. A hollow cylinder is a pipe or a tower, a
  hollow dome or sphere is a shell. The editor cuts it into convex pieces by itself.
- **Top %** (cone): the radius at the top as a share of the bottom. 0 is a point, more a cut cone.
- **Align to side** (cylinder, cone): a flat side facing +X instead of a corner.

Unlike UnrealEd's builders they stay blocks: resize the box and the shape stretches with it (an
oval cylinder, an egg, a low dome), and you see the texture before the Rebuild.

Give it a texture like a wall: pick one in the Inspector's **Texture** field, or drag a texture
thumbnail onto the block (or click the thumbnail, then the block). Until the next **Rebuild** the
block shows its texture the way the game will map it; Rebuild puts it in the game. **Kind** makes it
a detail block or a hole (a round hole with a cylinder); water, zone portals, moving blocks and signs
are always boxes.

Dragging an object into or out of a Nest keeps its world position, rotation and scale. A drop
hint names the destination; cycles, locked groups and unsupported structural moves are refused.
One drop is one Undo step. A Nest containing lights or other fixed-size actors can move and rotate,
but cannot be scaled as a whole.

- **Un-nest** (**Ctrl+Shift+G**, right click, or the button in the Inspector) takes everything out
  again.
- One thing at a time: **drag** it in the Hierarchy out of the nest (anywhere outside it), or onto
  another nest to move it there. Nests can hold other nests.
- **Delete** on a nest deletes it with what it holds; **Ctrl+D** duplicates it as a new nest. A copy of one
  thing inside a nest stays in that nest, right after the original.
- A nest is the editor's own way of keeping things together: the map itself does not change.

The structures of the map are nests too. Open one in the Hierarchy: its **pieces** (each brush of
the script, each piece pasted from another level) and its objects are listed inside it.

- **Un-nest** a structure (Ctrl+Shift+G, or the **Un-nest** button) to take it apart: its pieces
  become structures of their own, its objects become free. They show apart at once; **Rebuild**
  makes them separate structures of the map. What the map script describes under one comment stays
  together in a nest named after that comment, so a big structure comes apart one level at a time.
- **Drag one piece or one object out** of a structure in the Hierarchy to take only that one out
  (right click > **Take out of...** does the same). On an object, the Inspector has **take it out**
  next to *Part of*.
- Nothing jumps: what comes out stays exactly where it is now. **Ctrl+Z** puts it back.

## Structures

A structure is a group of walls, lights and objects that belong together: the helipad, a
building, a staircase. Click one of its walls, or pick it in the **Hierarchy**.

- Move and rotate it with the gizmo or the numbers; its lights and objects follow.
- **Scale** stretches it, one axis at a time if you want. Textures repeat over the bigger
  surface, unless you tick *stretch textures*.
- **Copy**, **Duplicate**, **Reset** (put it back as it was), **Delete**.
- Structures with doors or lifts can be moved and rotated; their native motion keys follow.
  Their size remains protected from scaling.
- **Un-nest** takes it apart into its pieces and objects (see *Nests* above).

In existing maps, moving pieces of the map makes the rebuild recalculate geometry and lighting:
check the result with **View in game**. Some original maps cannot be rebuilt (Wan Chai Street,
for example): there you can only change objects, not the map's geometry.

## Adding things

- **Objects** (the browser at the bottom): search any object of the game ("crate", "barrel",
  "lamp", "guard"...), pick it, then click a floor or a wall to place it. `Shift`+click places
  more copies.
- `B` adds a **block**: a wall or a platform with the texture you choose; tick *solid* to make
  it walkable.
- **Pieces** (the browser): fences, chain-link, grates, railings, pipes, vents, cables, signs and
  neon, lamps, windows, ladders, beams and columns, wall and floor panels, shelves, awnings... In
  Deus Ex these are not objects but brushes (geometry) the level designers made: the editor takes
  them from the original levels, each one whole (the brushes that make it, nothing around it) and
  only once even if the game repeats it a hundred times. The tile says how often the game uses it
  and where. Click one, then a floor (it stands on it) or a wall (its front faces out): it becomes
  part of the map with **Rebuild**, like a pasted structure; move, turn and copy it as one.
  The first time, the Pieces tab reads the game's original maps to find them (**Generate Pieces**):
  several maps at once, a few minutes in all; after that only changed maps are read again.
- **Game doors and elevators** are in **Objects → Movers**, under **Doors** or **Elevators · two stops**.
  Pieces contains static geometry; Movers contains native moving brushes. Choose a textured preview,
  place it in an opening and **Rebuild**. Doors are individual leaves/panels; use them in Play to
  open and close. Lifts start when the player steps on, wait four seconds at the other stop,
  then return. Leave room for their original travel, including space below a descending lift.
  Geometry, textures, movement and assigned sounds come from your selected installed game.
  Each placement has an independent tag; original locks, keys, mission events, return groups
  and external controllers are removed. Immediately after placement the Inspector identifies it as
  a **DeusExMover**, with activation, move/wait times and door locking. These settings are saved and
  support Undo and independent duplicates. After Rebuild, **Edit mover…** selects the native actor
  for its tags, interactions, Door sounds and Animate settings. Moving, turning, duplicating and Undo
  work as with a piece. A mover placed by an older version can be selected as a native actor after Rebuild.
  Multi-floor/script-controlled mechanisms and unsupported tilted movers are not listed as ready-made
  pieces. This does not cut a doorway or build an elevator shaft, buttons or navigation automatically.
  On upgrade, **Refresh scan** adds the mover library using existing reference caches where possible;
  its first pass also extracts missing mover previews locally. No game assets are shipped.
- **Prefabs** (the browser): select a structure or a nest and choose **Save as prefab…** (in the
  Inspector, the right-click menu or the Prefabs tab). It is kept as it is now, built, with the 3D view as its
  picture, and can be placed in any level of the project. Doors, lifts, mission objects and objects with an Event
  are still left out of a prefab (their tags would have to be renamed for every copy).
  **Linked copies**, as Unity's prefab instances: a copy placed from the Prefabs tab stays linked to its prefab. Its
  row in the Hierarchy has a **v2** badge (the version it places; yellow with **↑**: a newer version is in the
  library; dashed: the prefab was deleted from it). Its Inspector has a **Prefab** section with the prefab, the version
  and its **overrides**: what you changed on that copy's objects (moved, deleted, given another class with *Replace
  with...*, properties changed, off in game; a click on one selects that object). **Duplicate** and **Copy** /
  **Paste** of a linked copy take its overrides along, moved with the new copy. Its buttons, also in the copy's
  right-click menu, each one step of the History (a version saved by *Apply to prefab* stays in the library when you
  undo it: the copy goes back to the version it had):
  - **Select instances**: every copy of that prefab in the map.
  - **Apply to prefab**: the copy, as it is built, becomes the newest version of its prefab (Rebuild first, as for
    *Save as prefab*); its overrides are the prefab's from then on. A copy scaled away from 100% is not applied (a
    prefab keeps its own size), nor one on an older version: update it first, or it would undo the versions since.
  - **Update instances**: every copy of that prefab in this map goes to the newest version, each where it is, with
    its overrides (a change to an object the new version no longer has goes; Messages says which). Rebuild shows them.
    Copies in other maps keep their version until you update them there.
  - **Unpack** (several copies at once from the right-click menu): the copy forgets its prefab and stays as it is.
- **A prefab's card** in the Prefabs tab, its **⋯** (or a right click): **Select instances** and **Update
  instances** in the open map, **Rename…** (every version of it; copies already built show the new name after the
  next Rebuild), **Use the current view as its picture**, **Delete…**: asked first, with the maps and map templates
  that place it. Its versions leave the library but stay on disk (copies are built from them, and Undo or the
  clipboard can place one again); they go when the project is next opened after DeusEdix was closed or another
  project was open, if no saved map or template places them, and a copy pasted after that is refused, saying so
  (only when its files are really gone: when the editor cannot find out, the copy is pasted). The card says the
  prefab's version and how many copies the open map has (and how many are older).
- Walls, roads, floors and ceilings: draw them (see *Drawing walls, roads, floors and ceilings*
  below), or use **+ Block** (`B`) with the game's wall and floor textures, or start from a room
  (**New map**).
- Right click a folder in the Hierarchy > **New objects go here**: what you add from then on goes into it
  (see *Folders (nests)*).

### Drawing walls, roads, floors and ceilings

**Tools > Draw wall / Draw road / Draw floor / Draw ceiling** (or the same buttons in **+ Create**).
Click points on the ground one after the other; `Shift` keeps the line at 45 degrees; the points snap
to an 8-unit grid. **Enter**, a double click or a click on the first point again finishes; `Backspace`
takes the last point away, `Esc` stops. As soon as a tool is chosen, a sliver of what it makes follows the
cursor (a piece of wall as long as it is thick, a slice of road, a tile of floor or ceiling, the first step, a
roof's eave): it is where the first click puts it.

- **Wall**: a wall along the line, 160 high and 16 thick, with clean corners.
- **Road**: the asphalt with a sidewalk and a curb on each side.
- **Floor**: a slab over the shape you drew (any outline, also with corners going in).
- **Ceiling**: the same slab at the top of walls of its **Height**: the ceiling of a room, with
  ceiling tiles underneath.

Select a drawn shape to change it in the Inspector: height, thickness, width, sidewalks and every
texture. Move and turn it with the gizmo. **Rebuild** makes it part of the map.

Like a block, a drawn shape shows its textures before the **Rebuild** the way the game will map them,
holes cut in it included. Every texture field has its picture: click it for the texture picker. Or
take a texture (click its picture in an object's **Textures**, or drag it) and click a face of the
drawing: the face's own setting changes (a floor's top or its edge, a step's tread or its riser).

### Stairs and roofs from A to B

**Tools > Draw stairs** (or **Stairs** in **+ Create**): click where the stairs start, then where they
arrive. Click near the edge of an upper floor and the end snaps onto it. The steps share the height
exactly, about 16 high and 32 deep as in Deus Ex, 128 wide. While drawing, `[` and `]` make them
narrower or wider, `,` and `.` lower or higher steps.

In the Inspector:

- **Shape**: **straight**, **curved** (it turns by **Curve** degrees on the way) or **spiral**
  round the first point, with an **Inner radius**, **Steps a turn** and a **Column** in the middle.
  **Turns** picks left or right.
- **Form**: steps, or a smooth **ramp**.
- **Base**: solid down to the floor (as the game's stairs), or floating steps of **Step thickness**.
- **Landing**: a flat part at the top.
- **Look**: ready textures (concrete, metal, marble, industrial), or set the tread, riser (the front
  of each step) and side textures yourself. Every step gets its texture lined up with it.

**Tools > Draw roof**: click the eave, then the ridge. **Shed** is one slope, **gable** two. When A
and B are on one level the slope follows **Pitch**; otherwise it goes from A's height to B's.

## Textures

The **Textures** section of the right panel lists the pictures of the selected object (one per
skin) or structure (one per texture of its faces). **Edit** opens it in the **Texture Editor**;
**Import** opens a picture of yours (PNG, JPG...) there; **Export** downloads the PNG for another
paint program; **Original** goes back to the game's texture.

**Choosing a texture**: every texture field (a block's, a hole's, a drawn wall's...) has a small
picture of its texture next to it. Click the picture: a grid opens with the textures of this map,
**All textures** of the game (search by name) and every package. A click tries a texture at once,
a double click (or Enter) keeps it, Esc closes. The pictures of a package are made from your game the
first time you open it (a few seconds), then they are kept. You can still type a name in the field.
Right click a picture > **Find in map**: the objects, blocks and structures of the map that use that texture
(the Hierarchy's search `tex=`, see *Searching the map*). The **star** of a picture keeps that texture in
**Favourites**, the first source on the left, for this project (one that neither the map nor the game has any
longer shows as *Missing*: its star takes it out). The slider at the top right, or `Ctrl`+wheel over the grid,
makes the pictures a list, small, medium or large.

**Drag the small picture** of a texture onto a wall, floor or ceiling of the map (or click it, then
click the face): that face takes the texture, previewed while you hover. `Esc` cancels, `Ctrl+Z`
undoes it, **Rebuild** puts it in the game. It works on built faces, not on models.

### Faces and texture alignment

**Alt+click** a wall, floor or ceiling to select its face. **Shift+Alt+click** adds or removes
faces. **Edit > Face selection** (`Q`, configurable in Settings) lets you select faces with plain
clicks and add them with Shift. In fly mode, Q still moves down. The selected faces are highlighted
and the right panel shows **Surface**. Selecting an object returns to its normal inspector.

Choose a loaded **Texture** and press **Apply**, or use **Align**:

| Alignment | Result |
| --- | --- |
| Floor / Wall | Reset the mapping to horizontal / vertical alignment |
| One Tile | Fit one complete texture to the source face's width and height |
| One Tile U / V | Fit the width / height of one tile and preserve the texture's proportions |
| Around a cylinder | Wrap one tile continuously around all vertical side faces of the brush; the caps stay unchanged |

Cylinder sides must form one closed outline and use the same texture. **Pan U/V** adds whole
texels to the offset. **Scale U/V** multiplies the tile size (2 is twice as large, 0.5 is half);
a Pan of 0, 0 or a Scale of 1, 1 changes nothing and is not queued. **Slip** starts the Texture
Slip (below). **Rotate 90°**, **Flip U** and **Flip V** change its orientation. **Select whole brush** selects all
its visible faces; a structure's **Surfaces** section can select the faces of all its brushes.

**Recent textures**, as ProBuilder's material palette: under the Texture list the panel keeps the last 10 textures
you applied to faces (with the list, the texture picker or a drag), newest first, each with its picture and its key,
in the project. Click one, or in Face selection press `Alt+1` to `Alt+9` and `Alt+0`, to put it on the selected
faces: one `Ctrl+Z` takes it back. A texture put from the strip keeps its place there, so its key stays the same
while you texture a room (floor, walls, trim, ceiling); one applied another way comes first. In Face selection
these keys are the strip's, not the selection slots' (those work again once Face selection is off); they can be
changed in Settings > Keyboard shortcuts (*Face selection*). While a Rebuild runs they wait for it.

**Grow** (`Alt+G`, Edit > *Grow face selection*), as ProBuilder's Grow Selection, adds the faces that share an edge
with the selected ones and lie in their plane (within 5°): a wall or a floor split by BSP cuts, or one that goes on
through a doorway, is selected with a press or two before **Align**. **Grow (any angle)** (`Alt+Shift+G`) adds
every face next to them: the walls round a floor, the sides of a column. Each press adds one ring of faces; a piece
of an edge is enough (BSP cuts meet at T-junctions), a corner is not. It takes the faces as the 3D view shows them:
hidden objects are left out, a structure moved since the Rebuild counts where it is now. The keys work in Face
selection (`Q`); the menu items and the panel's **Grow** buttons whenever faces are selected.

**Texture Slip** (`Y`, Edit > *Slip the texture*, the Surface panel's **Slip**), as Premiere's slip tool: with faces
selected (in Face selection or with `Alt+click`), point at one of them and press `Y` (pressed elsewhere, or from the
menu or the panel, it starts when the pointer comes over one). Move the pointer: the texture rolls on the faces in
any direction, the texel under the pointer staying under it, on walls, floors, ceilings and slopes alike. The wheel
makes it larger (up) or smaller round the point under the pointer: four notches double it. `Shift` is finer (an
eighth of the pointer's way, a sixteenth of a doubling a notch), `Ctrl` snaps the pan to an eighth of the tile and
the size to whole powers of two, the arrows nudge it a texel the way they point on the screen (with `Ctrl`, a snap
step). The line beside the pointer says the pan and the size.
A click (or letting go after a drag) or `Enter` keeps it: one `Ctrl+Z` (*Slip the texture* in the History) takes it
back, **Rebuild** puts it in the game. `Esc`, the right button, `Alt`, a click elsewhere or a menu, leaving the
editor, Undo, Save, a Rebuild, closing or opening a map cancel it, with nothing changed.

It queues what the panel's **Scale** and **Pan** do: one Scale for all the faces and each face its own Pan, so a
texture running over several faces stays one: the faces stay within half a texel of the face under the pointer
(exact when made smaller by whole factors, such as `Ctrl` to ×1/2), any two within a texel, however many slips of
the same faces you keep one after another. Each slip starts where the slips before it left the faces, to a fraction
of a texel, and the History keeps that with each step: an Undo, a Redo or a jump in the History gives it back with
the changes, a Rebuild keeps it and a Pan of a face moves it as much. A face changed otherwise since starts from its
queued pans, in whole texels: an alignment, One Tile, Rotate or a flip queued on it, Around a cylinder queued on its
brush (not on the caps, which it leaves as they are) or a Scale; so does every face after **Revert all changes**,
after the editor is opened again and in another map (and see the known limits below). What the assistant's scripts
write into the queued changes directly counts as the panel's: an alignment, One Tile, Around a cylinder (on the faces
it wraps), Rotate or flip added on a face or taken off it drops its fraction, and anything else is judged by the
numbers alone (a face still where the slip left it, give or take whole texels, keeps its fraction). Faces joined by
edges where the texture runs on round them (a ring of walls, the sides of a column, a box's top over the side its
texture comes from) scale as one; a face whose texture runs on round none of its edges with the others, such as a
floor or a cap aligned otherwise, scales round its own point under the pointer. Scaling a texture wrapped right round
a closed shape, such as a cylinder, keeps every edge closed but one. A ring parts first where two textures meet
(walls going round through a floor of another texture part at the floor's edge, not at a corner of the walls), then
where its texture already steps (by more than a texel), else at its shortest edge, and a slip kept after another
parts it again where that one did while its texture still steps there, even where another of its edges steps, with a
Rebuild, an Undo, a Redo, a jump in the History, a Pan of all the same faces or a structure moved and rebuilt between
them too; an edge lined up since, by rolling one face alone or a Pan, counts as one that does not step, so the ring
parts where its texture still steps (with every edge closed it must still part somewhere, perhaps at an edge you
lined up); a ring of equal edges of one texture parts at the one farthest round from the face under the pointer (from
the side nearest the pointer when it is on a face apart, such as a cap), so point at the side that must stay
seamless. The same goes for a face set in another, such as a sign in a wall, whose texture runs on over two of its
sides: a side where the texture already steps parts before one where it does not, and of two alike, the one nearest
the pointer stays closed. A pan wraps round the texture only past the engine's ±32767 texels. Faces only a Rebuild
shows (a change queued on them the view cannot work out, BSP pieces mapped otherwise) are left out, and the line says
how many. One slip adds at most 512 of the map's 4096 queued surface changes, and a slip of the same faces folds into
the pans and scales before it; for a large selection (*Select same texture* on a big map) slip fewer faces, or press
`P`: every face then gets the pan of the one under the pointer (two changes in all), and seams may show between the
others. With fewer than 1024 changes left, the line and the status bar say how many. It refuses faces of a locked
structure, blocks not built yet, a structure resized since the Rebuild, and a selection over structures moved since
the Rebuild otherwise than the face under the pointer (Rebuild first).

The Texture Slip's known limits:

- A Scale brought back to where it was (×2, then ×1/2) counts as none: the next slip still starts from the fraction
  of a texel the slip before left, as if both Scales were undone.
- Rolling a part of a ring alone moves its texture against the rest of the ring at both ends of that part.
- A Pan of only some of a ring's faces between two slips: the next slip may part the ring at another edge.
- After a structure is moved and rebuilt between two slips, its faces start from their queued pans, in whole texels,
  so an edge may end up about a texel off.
- A structure resized (**Scale**) or turned and rebuilt between two slips you kept can open a second seam in a ring.
  To avoid it, finish the slips, or Undo them, before you resize or turn the structure.
- A Rotate or a Flip U queued on a ring's faces between two slips you kept can open a second seam at the next slip.
  One Tile, Wall or Floor queued between them may make it part the ring at another edge.

These operations affect the full source face, including pieces split by BSP cuts. They are stored
in order and the 3D view shows them at once, as the game will, but for these, which show only after a Rebuild (the
panel says how many of the selected faces): Around a cylinder; a texture none of the map's surfaces or objects use
yet, its size known only after a Rebuild; a face whose BSP pieces are mapped otherwise; Floor or Wall on a structure
moved or turned since the Rebuild; any change on a structure resized since the Rebuild; an alignment or a texture
taken back after a Rebuild; and, on a map last rebuilt by an older editor, the changes it had when opened. **Save**
keeps them, **Rebuild** puts them in the map and its lighting. A change Save cannot keep
is said when the map opens; one the Rebuild would fail on (a pan past the engine's 16 bits, One Tile on a face with no
size) is said at once and again after Save, and Rebuild asks before it starts. Undo (`Ctrl+Z`) removes the last edit.
Changing UVs also rebuilds lighting because the game's lightmaps use those coordinates. Changes
are written to both the rendered surfaces and their source brushes, so later geometry rebuilds
keep them. If the source brush or its face layout is replaced outside the editor, select the new
faces again.

### Shadow detail

In **Surface > Shadows**, choose **Low**, **Normal** or **High**. High makes finer shadows and
uses more map memory; Low is coarser. Normal clears both special detail flags. A selected
structure also has **Shadows for the whole structure**, which includes every face of its brushes.

**Rebuild** recalculates lighting. On an existing map, shadow or UV edits alone do not rebuild
geometry or AI paths. **Messages** reports the lightmap sample count and shadow storage before
and after the build. The size difference depends on the faces and lights in the map. **View > Lightmap
detail** shows the result across the map: every surface in the colour of how far apart its samples are.

### Texture Editor

The texture opens at its full size (the HDTP ones at 1024). On the left the tools, with their keys
(the keys are Photoshop's; **F1** or the right-click menu lists them all). The pointer shows the tool:
a small cross for the brushes (the circle around it is the brush's size), a bucket, a dropper, the
text cursor with a T, a target while Alt picks the clone stamp's source.

| Tool | |
|---|---|
| **Brush** (B) | paints the colour; size, hardness (soft or sharp edge), opacity (see *Brush keys* below) |
| **Eraser** (E) | makes pixels see-through: the texture becomes *masked*, like the game's fences and grates |
| **Fill** (G) | fills the area of similar colours (tolerance; *only the touching area* or every pixel of that colour) |
| **Colour picker** (I, or Alt with a brush) | takes the colour of a pixel. Under the tools, as in Photoshop: the **colour** (front square) and the **background colour** (back square), click one to choose it, `X` or ⇄ swaps them; the last colours used are below (click: the colour, right-click: the background colour) |
| **Clone stamp** (S) | Alt+click where to copy from, then paint: covers a stain or a seam with another part of the texture |
| **Soften** (U) | blurs where you paint (hard edges, seams; it wraps round the edges as the texture tiles) |
| **Lighten** (O) / **Darken** (Shift+O) | worn edges, light, dirt, shadows where you paint |
| **Text** (T) | words on the texture (a label, a number, graffiti): click where they go and type there. Its handles make it bigger or smaller, its edge (or `Ctrl`+drag) moves it; `Ctrl+Enter` or a click elsewhere paints it (the click starts the next one), `Esc` drops it. Font, size, bold, outline, shadow and opacity are in the bar and show at once |
| **Select** (M) | a rectangle: painting and adjustments stay inside it; drag its handles to change it; *Focus*, *Crop…*, *Clear* (see-through), Esc for none |

The wheel zooms (at 8x and more a pixel grid shows), the middle button or Space+drag moves the
picture, `Ctrl+0` fits it, `Ctrl+1` shows it at its real pixels, `Ctrl++` / `Ctrl+-` zoom. Ctrl+Z / Ctrl+Y
undo and redo.

**Brush keys** (as in Photoshop):

- `[` and `]` (the two keys right of P on any keyboard, `è` and `+` on an Italian one): smaller and
  bigger; with `Shift`, softer and harder.
- `Alt` + right drag: left and right change the size, up and down the hardness (the inner circle).
- `1` … `9`, `0`: opacity (or strength) 10% … 90%, 100%; two digits typed quickly give that value
  (`4` then `5`: 45%).
- `Shift`+click: a straight line from the last point painted.
- `X` swaps the two colours, `D` puts back black and white.
- Holding a tool's key uses that tool only until the key is let go (hold `E` to erase a moment, then
  the brush is back); a quick press changes tool.
- Layers: `Ctrl+Shift+N` a new layer, `Ctrl+J` the selection on a layer of its own (or the layer
  duplicated), `Ctrl+E` merge down. `Ctrl+I` inverts the colours, `V` lifts the selection to move it.

**Focus** (`F`): the view zooms onto the selection, to paint a small part closely. Nothing is cut;
`F` or `0` shows the whole texture again.

**Crop…** cuts the texture down to the selection, after a preview (as in Photoshop or GIMP): what goes
away is dimmed, the handles adjust the rectangle, and the bar shows its size and the size it will have
in the game. **Snap to power of two** keeps the sides at 8, 16, 32... 1024 pixels, so the game does
not stretch it. **Enter** crops, **Esc** leaves the texture as it is; after a crop, `Ctrl+Z` puts the
whole texture back. Cropping is rarely what an object needs: a model's skin is cut and stretched over
the whole model, and on walls the piece fills the tile the whole texture filled. To work on a part,
use Focus.

**Copy and paste**: `Ctrl+C` copies the selection as you see it (all the layers), `Ctrl+X` cuts it.
Select where it goes and press `Ctrl+V`: the piece appears there (with no selection, where it came
from), floating. Drag it, or move it with the arrows (1 pixel; `Shift`: 10). **Enter**, **Put down** or
a click outside paints it on the active layer; `Esc` drops it. A picture copied in another program (a
photo, a screenshot) always lands inside the texture, in the middle of the selection or of the
texture, made smaller to fit when it is bigger; its handles size it, as `Ctrl+T` does, and it keeps its
own pixels, so it stays sharp when made bigger again. To make a picture the whole texture, use **Open…**.

**Free transform** (`Ctrl+T`, as in Photoshop): the selection (or the whole layer) is lifted off the layer.
Drag it to move it; its corners and sides scale it (`Shift`: in proportion); just outside a corner the
cursor turns and dragging turns it (`Shift`: 15° steps). The bar flips it, turns it 90° or resets it.
**Enter** (or a click outside) keeps it, one `Ctrl+Z` for all of it; `Esc` puts it back as it was. If the
active layer is empty there (a fresh *Paint layer* over the picture), the visible layer below is transformed.
A pasted piece has the same handles. In a web browser `Ctrl+T` opens a new tab: use the right-click menu.

**Right click** (without moving the mouse; a right drag still moves the view) opens a menu as in Photoshop:
free transform, flip and turn the selection, copy / cut / paste, fill with the colour (`Alt+Backspace`) or
the background colour (`Ctrl+Backspace`), clear, focus, crop, deselect (`Ctrl+D`), select all, take the colour
under the pointer, swap the colours, undo and redo.

On the right:

- **Preview**: the texture repeated 3 x 3 (as on a wall: seams show at once) and, for an object,
  the object itself turning with the texture as you paint it. **Game colours** shows it with the 256
  colours Deus Ex keeps.
- **Adjust** (the selection, or the whole picture): brightness, contrast, hue, saturation and
  lightness (live, then **Apply**); *Colorize* (the brush colour over the picture, keeping its light
  and dark: a blue crate made red), *Grey*, *Invert*, *Blur*, *Sharpen*, *Noise* (fine grain), *Grime*
  (patches of dirt, as on worn walls).
- **Tile and size**: *Make seamless* (the edges blend with the other side: it repeats without a
  line), *Offset ½* (the seams come to the middle to paint over them, then Offset again), flips, turn
  90 degrees, *Resize* (sides a power of two: 32 to 2048).
- **Put it in the game**:
  - **On this object only** (one object's skin) / **On this structure only** (the faces of the
    structure with that texture);
  - **On every object of the map with this texture** (every crate of that kind, every chair...) /
    **On every face of the map with this texture**;
  - **Only keep it in My textures**, or *also keep it* while applying it.

**My textures** (top bar of the editor) are your pictures kept for later: open one to edit it or to
put it on something else. They are files in `tools\mapkit\textures\_library\`.

The picture becomes a texture of the map: 256 colours, sides a power of two (the editor shows the
size it will have), see-through pixels make it masked. A structure's texture keeps the size of the
one it replaces on the walls (the same tiling). **Rebuild** puts it in the game.

## Properties and connections

The **Properties** section shows, in plain words, what matters for a mission:

Sliders keep their numeric value and available previews in sync while you drag (light colour,
light and sound reach). Release to keep the change, `Esc` to cancel it, or `Ctrl+Z` to undo the
whole drag. You can also type the number (or a sum, see *Objects*) or use the arrow keys. Lighting on walls still needs
**Rebuild**; the Lit view's brightness slider changes only the editor's view.

With several objects selected, the Properties they all have (and All properties, when they are all of one
class) are set on all of them at once, a dim **—** where they differ: see *Editing several objects at once*.
To give objects the settings of another, or keep settings for later, see *Copy, paste and presets of
properties* below.

**Properties… windows**, as Unity's floating Inspector: **right click > Properties…** on an object, a block, a
drawing or a structure (in the 3D view or the Hierarchy) opens a window with its Inspector, the same sections as the
panel (Transform, Properties, Interactions, All properties, Textures...), while the panel goes on following the
selection. Wiring logic often needs two objects in sight: a keypad and its door, a trigger and the SpecialEvent it
fires, a character and the computer that sets its flag. The window is live: what changes the object anywhere (the
gizmo, `Ctrl+Z`, the panel, another window) shows in it, and what you change in it is one step of the History, undone
with `Ctrl+Z` as in the panel (a field you are typing in waits until you leave it). Its buttons (Duplicate, Copy,
Delete...) first select its object, as the panel's do. Drag its title to move it, its corner to resize it; the square
maximizes it. Up to **3** at once: a fourth closes the one used longest ago. A window closes with its object (deleted)
or its map (closed, another map opened, or loaded again by a Rebuild, as the padlock lets go then); Properties… on an
object that has one brings it to the front. The lines of an object's links and routes in the 3D view stay those of
the panel's object, and the faces of a structure are edited from the panel.

| Object | Properties |
|---|---|
| everything | **Engine tag (legacy)** (the native target name), **Event** (what it triggers), and the separate **Scripting tag** for new groups |
| doors | locked, key that opens it, can be lockpicked and lock strength, can be broken and door strength, JC can open it by hand, opens from one side only, opening time, stays open |
| keypads | code, locks/unlocks instead of opening, event on a wrong code |
| computers, ATMs | accounts (login and password; account number and PIN), network (the logo on the screen), special options (buttons after logging in that show a message and trigger an event) |
| personal computers | **Emails**: for each account, emails with sender, subject and text |
| public terminals | **Bulletins**: title and text, read without logging in |
| security computers | the cameras, turrets and doors they control |
| keys (NanoKey) | Key ID, description |
| crates and containers | what is inside |
| books, newspapers, datacubes | **What it says**: the text JC reads, on several lines; the game text it shows otherwise (Game text) |
| characters | orders (standing, wandering, patrolling, sitting...), order target, faction, relations (see Factions), what they carry, names, conversation name, health, invincible, important; **Patrol route** and **Animation** (see below) |
| patrol points | wait here (seconds), next point, animation while waiting |
| wander points | what a wandering character looks at when it stops here, and for how long |
| triggers | triggered by, only once, radius, height, message to JC |
| zones | place name, ambient light and colour, sound of the zone, hurts, instant death, gravity, ground friction, water, **Reverb** (see *Zones*) |
| sound effects | sound, plays when JC walks in or when triggered, heard in JC's head or within a distance, volume, pitch, again after |
| doors (sounds) | starts opening, open, starts closing, shut, while moving, heard within, volume |
| map exits and arrival points | where the exit leads (a map and its arrival point) and whether it is active |
| lights | colour (a colour picker and the hue slider, as in UnrealEd), saturation, brightness, radius, type (steady, pulsing, flickering...), effect (spotlight, torch...), cone, period, phase (where in its round a pulse starts: lamps of one period out of step), fog brightness and radius, special lit, corona (a glow round the lamp, its Skin the texture: without one the game draws none). **View > Effects** shows the types, period, phase and corona moving in the Lit view |

A field shows the value you set, otherwise the map's, otherwise the game's default for that kind
of object. Changes are applied by **Rebuild**, without touching the lighting.

**Lights**: select one (in the 3D view or under *Lights* in the Hierarchy). The Inspector shows
its colour and its properties, the same ones UnrealEd has. The sphere of the light takes the new
colour at once, and while it is selected a wire sphere shows how far it reaches. The lighting of
the walls and of the objects (the **Lit** view, the game) changes with **Rebuild**, which
recalculates the lighting when a light changed. Under a lamp's **Type**, **Period**, **Phase** and **Corona**, a note
in the warning colour says what that setting does not do in the game the project is for: a flickering lamp that
Revision never lights, a blink's Phase and when it stops blinking, a Period or a Phase that does nothing for that
type, a corona without a Skin (see *Lighting of the view*).

**Books, newspapers and datacubes**: select one (or place one from Objects). The Inspector
shows the document read from your installed game. **Edit a copy** starts with its original
text and formatting; **Write text** starts a new document. Use **Insert paragraph** (or `<P>`)
for paragraph breaks, then **Save text** and **Build**. Keep existing game tags for player
names, colours and formatting. Source line breaks alone are whitespace in this format.

**Restore original** removes only your document override. Other properties and the game's
text packages remain unchanged; Undo also restores a removed override. An empty saved text
is intentionally empty, so use Restore original to go back. Existing SpecialText documents
remain readable and are included when making a copy. Each override belongs to this object
in this map and is listed under Changes. Long documents are kept in safe-sized chunks.

The game reads the copy through its own text parser. Datacubes become DataVault notes;
books and newspapers follow the player's literature preference. The copy gets its own note
identity, so an old original note in a save is not rewritten. Start the rebuilt map to test it.

**Computers**: under *Accounts* the logins and passwords; *Special options* are the buttons JC finds
after logging in (for example "Open the vault" with *Triggers* = the Tag of the vault door: the
door opens; *Account* limits a button to one login). *Emails* (personal computers) are written per
account: JC reads them after logging in with it, and can add them to the DataVault. *Bulletins*
(public terminals) need no login. Emails and bulletins replace the game's own on that computer; an
account shows the same emails on every computer of the same mission, as in the game. In the map
they are hidden `UCTextBlock` objects; the map's `UCBoot` makes them into the texts the computers read when
the map starts.

**Holes**: **+ Hole** in the bottom bar, then click a wall: a doorway 64 wide and 112 high,
standing on the floor below, through the wall; on a floor, a pit; on a ceiling, an opening. A hole
cuts away the walls, floors and ceilings it touches when the map is rebuilt (UnrealEd's subtractive
brush); its sides take the texture of the surface you clicked (change it in the panel). Resize it
with **R** or the numbers in the panel; any block can become a hole (*Kind*: Solid block, Detail block,
Hole). The 3D view previews the cut at once: the walls, floors and ceilings inside the hole's box
disappear while you place, move or resize it. The faces of the hole's sides (with their texture)
appear after **Rebuild**, when the engine really cuts it. Holes cut what you drew too (walls,
floors, ceilings, stairs and roofs, see *Drawing walls*): a doorway through a drawn wall, a
stairwell through a drawn floor.

**Build order**: blocks are built in their order, as UnrealEd builds its brushes. A hole cuts the
solid blocks built before it; a solid block built after a hole fills it again. A block's panel shows
its place (*Build order*) with **To first** and **To last** (also Edit > **Order: to first / to
last**); Rebuild applies it. Detail blocks are never cut by holes, as in UnrealEd.

**A new room**: a hole the size of the room next to an existing one, then a doorway between
them; the new room is dark until it has a light: **Light it** (in the panel of a room-sized hole)
puts one in the middle under its ceiling.

**Signs**: **+ Sign** in the bottom bar, then click a wall (or a floor: the sign stands on it,
facing you). Write the text in the panel (Enter for a new line), choose a style and the size. The
styles include the original game's own: the **UNATCO** plate, **DANGER**, **CAUTION**, **RESTRICTED
AREA**, the red **STOP** plate, yellow and UNATCO blue plates and a shipping label, with the
narrow capitals and the coloured bands of the game's signs; and notice, warning stripes, street,
red or blue neon, green screen. **Plate** sets the band and the **screws**, **Wear** how old the
enamel looks (grime, scratches, chips). The text is drawn into a picture that becomes a texture of
the map, on the front of a thin iron block: any letters work, Chinese too. The preview in the 3D view
shows it before the rebuild.

**Connections** shows who triggers what, also with arrows in the 3D view: orange = this object
triggers (or opens) the other one, blue = the other one triggers (or opens) this. It covers
Event and Tag, keypads, security computers, keys and doors (Key ID), and patrols (a character's first
patrol point, each point's next one). Click a name to select that object. Example: select a keypad
and you see its code and the door it opens.

### Copy, paste and presets of properties

As Unity's component menu: give other objects the settings of one, put a field back to the class default,
keep a look or a set-up to use again (a flickering fluorescent, a locked door type, a hostile patrol).

- **⋮** in the Inspector (next to the eye and the padlock): **Copy properties** of the selected object,
  **Paste properties** on the selection (one object or several, of any class), **Reset properties to the
  class defaults**, **Save as preset**, **Apply preset**, **Presets...** (apply or delete the presets that
  fit the selection). **Edit > Copy properties** and **Paste properties** do the same on the selection.
- **Right click a section's title** (Light, Door, Sound, Behaviour, Movement, All properties...): copy,
  paste or reset that section only, or save it as a preset (*Save Light as preset*).
- **Right click a field** (its name): **Copy value** and **Paste value** (into the same property, or one of
  the same kind that takes any value: a brightness into a radius, a light's colour with its saturation into
  another light's colour; a choice only into one that has that value, so a light's type does not go into its
  effect; in All properties only a number goes into another property), **Reset to the class default** (with
  the value it gives), and **Revert to the map's value** when the map has a value of its own. In All
  properties: **Clear** takes away what was set there. With several objects selected these work on all of
  them. A conversation name the original conversations use (read only in the Inspector) can only be copied.

A paste, a preset or a reset first lists what it changes: each property with what the objects have now
and what they get (*Brightness 150 → 220, 3 objects*), ticked. Untick what you want to keep. The
**Engine tag**, the **Event** and the **conversation name** stay each object's own: they are listed
unticked, and change only if you tick them; a conversation name the original conversations use is never
changed. Only what an object's class has is pasted on it: a light's Light section does not go on a crate,
a crate keeps its own, and a computer's accounts do not go on an ATM (another property of the same name).
One `Ctrl+Z` takes the whole paste back. An object's name in the map and its position are not properties:
they are never pasted. Nor is a patrol point's animation: its own field sets up the characters patrolling
there to play it, so pick it there.

Presets are kept in the project (its other maps too), for the class they were saved from and the classes
under it: a *Light* preset also fits spotlights. A preset keeps every value of what it was saved from
(the whole object, or one section), without the tag, event and conversation name; saving one with a name
used already for that class replaces it.

### Tables of lights, doors and characters

As Unity's Light Explorer: **Window > Lights table**, **Doors table** or **Characters table** opens a window
with every light (door, character) of the map in a row and its properties in columns, to compare and balance
them at a glance. The window floats over the 3D view and the editor stays usable: drag its title bar to move
it, its corner to resize it; the tabs at its top go from one table to another.

- **Lights**: in game, colour (a swatch: click it to pick a colour, which sets the hue and the saturation),
  name, class, type, effect, brightness, hue, saturation, radius, period, cone and special lit.
- **Doors**: in game, name, class, Key ID, **Key in map** (*yes* when a key with that Key ID is in this map,
  *no* when JC must bring it from elsewhere), locked, lock strength, lockpickable, breakable, door strength,
  opens by hand, one-way, open time and stay open. Elevators are listed too, without the lock's fields.
- **Characters**: in game, name, class, orders, faction, **Towards JC** (friendly, neutral or hostile: it sets
  their relation with JC, a fixed one stays fixed), their relations, health, dialogue name, there from the
  start, invincible and mission critical.

Click a heading to sort by it, again for the other way; an empty cell means that object has no such property.
Click a row to select the object (`Ctrl`+click: one more or one less; `Shift`+click: the rows in between) and
double-click it to frame it in the 3D view. **Filter** keeps the rows with every word typed in their name,
class or values (*flicker*, *hostile*, *no*); **Only the selection** keeps the rows selected when you tick it.

Type in a cell, or pick a value, to change the object: it is the Inspector's field, one `Ctrl+Z`. When its
row is selected, the value goes on every selected row the table shows that has that column (a selected row
the filter hides is left as it is), as in the Inspector with several objects: a number cell takes sums, `+=16`
on each one's own value, `L(0,255)` spread down the rows in the order shown, `R(0,360)` at random. The
dialogue name stays one row's own, and is read only where the original conversations use it (as in the
Inspector). `Esc` puts a cell back while you type, the
arrow keys step a number. The table follows the changes made elsewhere (the Inspector, `Ctrl+Z`). The 3D view
shows a light's new colour at once; the walls are lit again by **Map > Rebuild lighting**, and doors and
characters change in the game after **Rebuild**.

## Interactions (when this happens, do that)

No Tag or Event to write: at the top of an object's Properties, its **Interactions** say in plain words
what happens when something happens to it.

- **What it offers**: first, two rows of buttons. **When it...** lists what can happen to that object
  (each with the number of its rules): click one to add a rule on it. **It can...** lists what a rule can
  make it do (with the number of rules that do): click one, then the object that should make it happen.
  Both come from the object's class, the way the game itself works: a keypad offers *the right code is
  typed*, a beam *JC breaks its beam*, a camera nothing of its own (the game gives it no event). Things
  the game cannot do are not offered: an elevator is not switched on, a trigger that only redirects
  others (an alliance or an orders trigger) does not start rules.
- **+ When it...**: what starts it. A door: *it has opened*, *it starts closing*, *it is blown up*. A
  button or any object JC uses: *JC uses it*. A keypad: *the right code is typed*, *a wrong code is
  typed*. A computer: *JC chooses an option of it* (write the text of the button on its screen and what
  the screen says after). A trigger zone: *JC walks in*. A laser: *JC breaks its beam*. An alarm: *it
  sounds the alarm*. A character: *they are killed or knocked out*. An item: *JC picks it up*. An object:
  *it is destroyed*. Most things: *JC comes near* (within a distance you choose).
- **+ Then...**: *something to an object (click it)*: click it in the 3D view or in the Hierarchy, and
  the list shows only what that object can do:
  - doors: open, close, open or close, lock, unlock, blow up, give JC its key;
  - characters: attack JC (*alone*: their faction stays out of it), turn hostile, become friendly or
    neutral, stand still, wander about, follow JC, walk or run to a place (click it), leave or come
    back (only when JC does not see them);
  - lights: turn on, turn off, turn on or off;
  - elevators: go to a floor (0 is where it starts);
  - cameras, turrets, alarms, lasers: switch on, switch off; a sound effect: play it;
  - objects, items, bodies, keypads, computers and alarm lights: vanish, appear again;
  - most devices and objects (not characters, lights or lasers): an explosion there (damage and radius);
    most things: a sound from it.

  Or without an object: a message on the screen, a goal (the same name completes it later), a note in
  the DataVault, a flag (the Story's flags: an interaction can start a Story event), a **counter** (add
  to it, take from it, or set it: *the levers pulled*, *the guards down*), a sound (from an object or in
  JC's head), take JC to another map.
- **+ Only if...**: conditions, all of which must hold when it happens, or the rule does nothing that
  time (it is not used up, even with *once*): a state (a flag) is yes or no, JC carries an item (or does
  not), a character is alive (not killed nor knocked out), JC's skill is at least Trained, Advanced or
  Master, a counter compared with a number, JC's credits. The Story's events take the same conditions.
  The conditions are checked the moment it happens, before any rule acts: if one rule on a button adds 1
  to a counter, another rule on the same button still sees the old number that time.
- Every action has its **after ... s**: seconds from the moment the rule starts (the door opens, 2 s
  later the alarm sounds). **once**: only the first time.
- **🔗 Connect to...**: click another object, and the rule is made with what the two usually do
  together: a button or a keypad opens a door, a zone sends a guard at JC, a switch turns a light on or
  off. The object that can start something acts on the other; change what it does afterwards.
- Each rule is also written as a sentence ("When JC uses button UCLButton: open door UCLDoor, turn off
  light UCLLamp, after 1 s the message ..."). Green arrows in the 3D view go from the object to what it
  acts on; the Properties of that object list the rules acting on it (click one to go to its object).
- **Far away or out of view**: when the other end of an arrow is off the screen (or behind you), a
  green label on the edge of the view points towards it, with its name and distance (*to light
  Light114 · 307 m*, or *from ...* for an object acting on this one); click it and the camera goes
  there. An object in view but very far gets the label just above it. **both** next to an action
  frames the object and the one it acts on together. A rule that takes JC to another map shows
  *takes JC to ...* by the object.
- **Logic** (top bar): every interaction of the map, grouped by object and editable there too, like an
  event sheet. **+ When the map starts** is for what happens at once (a message, a goal, a guard
  that leaves).
- **Check** lists rules whose objects were deleted, actions without an object, sounds not chosen,
  texts left empty, maps that do not exist.

**Rebuild** puts them in the game. The game's own Tag and Event (**Connections (Tag / Event)**) still
work: an object with an Event of its own keeps triggering it as well.

### When JC presses a key

In the **Logic** window, **+ When JC presses a key** makes a rule that runs when JC presses the key you choose (a
letter, a digit, F1–F12, Insert, Delete, Home, End, Page Up/Down, the numeric keypad). It works in **Play**: the
key is bound for that launch in Play's own copy of your settings (yours are left as they are). A key the game
already uses (W, A, S, D, E, F, the number keys...) is taken from JC for that launch: the rule says so in red.

### First-person moments (the weapon JC holds)

**Tools > First-person moments...** makes moments of the weapon JC holds, seen as the player sees it: an
inspection of the gun, a gesture when a weapon is picked up, a weapon raised as a door opens.

- **Weapon**: the one it is made for (its first-person model and its place in the view are read from the game).
  In the game the moment plays only while JC holds that weapon.
- **Clips**: pieces of the weapon's own animations one after another (Select, Reload, Shoot...): any frames of
  one, at any speed (**in ... s**), backwards too (**⇄**, or a *to* before the *from*). The last frame stays
  until the moment ends.
- **Moves**: keys of the weapon's place in the view (forward, right, up), straight from one to the next; the
  last one is where it ends (0 0 0: back where it was).
- **Sounds** at their seconds, and a **shake** of the view (in the game only).
- ▶ and the timeline play it in the view, with its sounds.

An Interaction plays it: **JC's weapon plays a moment** (an action without an object), when JC presses a key,
uses a button, walks into a collision box, picks something up... JC firing, reloading or putting the weapon away
ends the moment at once.

**New animations from Blender.** **Export the model (.glb)** writes the weapon's first-person model (arms and
gun) at rest. Animate it in Blender any way you like (an armature, shape keys) without moving its points in edit
mode, and export it as .glb with its animation. **Import an animation (.glb)...** reads it back frame by frame
(30 frames a second, or the number you choose) as a new animation of the weapon, `FP_<name>`, in a copy of its
model in DeusEdix's `DeusEdixAnims` package (as the Animation Studio's), and adds its clip to the moment. In the
game the weapon wears that copy while the moment plays.

## Scripting tags

Select an object and open **Inspector > Scripting tag**. A scripting tag groups objects for new
interactions in the current map. Several objects can share one tag; it is not a unique object ID,
a faction or a Story flag.

### Auto, Custom and Original

- **Auto** follows the object's type or current state. Characters use `neutral`, `friendly` or
  `enemy` according to their attitude towards JC. Lights use the nearest major colour:
  `red`, `orange`, `yellow`, `green`, `cyan`, `blue`, `purple`, `magenta` or `pink`; very low colour
  saturation becomes `white`. Brightness and switching a light off do not change its colour tag.
- Typing a tag makes it **Custom**. `JOHN` stays `JOHN` when you change the character's faction,
  attitude or appearance. Even typing the same value as the automatic tag makes it manual.
  **Auto** explicitly returns it to automatic behaviour.
- Objects with an authored native tag start in **Original** mode, keeping that tag as their
  scripting label. **Auto** opts into automatic labels; **Original**, when available, restores
  the inherited label after an override.

Use 1-64 ASCII letters, digits or underscores, starting with a letter or underscore: `JOHN_2`,
not `John Smith`. Matching ignores case but matches the whole tag: `GREEN` matches `green`,
not `greenish`.

### Target a tag or filter a group

In an object's **Interactions**, add a starting event, then choose **+ Then... > objects with a
tag…**. Enter the **Tag** and choose the action. A light action affects matching lights, not
characters that happen to have the same tag. The match count is a preview of the current map;
automatic tags can change before the action runs in the game.

For a local group, choose **+ Then... > a group within a radius…**. Set **Group** to **Lights**,
enter `green` in **Tag**, and choose the **Radius** and **Center**. An empty Tag accepts all tags.
**Refresh group** captures the current matching objects. Saved members remain connected if moved;
**Include newcomers** also adds matching objects in the zone when the action runs. The tag filter
is checked at execution, and the radius reaches through walls: it does not detect room boundaries.

Try this with a green light, a red light and a button: use the button's **JC uses it** event,
target `green`, choose the action that turns lights off, then **Rebuild** and test in the game.
Only matching lights should switch off. Save and Rebuild after changing tags or their interactions.

### Native tags and story safety

**Scripting tag** is separate from **Engine tag (legacy)**, the native **Event** and the
character's **BindName**. A scripting override does not rename these identities or reconnect the
original campaign. This applies to every character, including Anna, not just newly placed NPCs.
Do not change an engine tag merely to put an object in a new scripting group.

A tag selects recipients; a Story flag remembers what happened. Assigning `JOHN` does not make
Anna an ally, kill her or rewrite her later appearances. Changing AI, alliances, dialogue or
character outcomes can still affect the campaign. Use [Mission graph](#mission-graph-read-only)
to inspect the recorded dependencies before making those changes.

## Factions

Every character belongs to a **faction** (UNATCO, Cop, triad_red for the Red Arrow, triad_lum for the
Luminous Path, mj12...) and has **relations**: how they treat JC (`Player`) and each other faction
when the map starts, *friendly*, *neutral* or *hostile*. Members of the same faction are always
friends. A relation can be **fixed**: it never changes by itself. If it is not fixed, it works as
in the game: attack them and they turn hostile.

- **A character's relations**: select them; in **Properties** set *Faction* and edit the
  *Relations* list (faction, attitude, fixed). The field suggests every faction of the game and of
  the map.
- **The Factions panel** (top bar) lists the factions of the map, how many characters each has
  (click the number to see and select them) and how they treat JC. *Change a whole faction*
  sets a relation for all its members at once, for example *Red Arrow towards JC becomes hostile*.
- **Window > Characters table** lists every character with its faction, how it treats JC and its
  relations: sort or filter by them, and change *Towards JC* or the faction of one or of the selected
  rows (see *Tables of lights, doors and characters*).
- **During the mission** (after a dialogue, when a flag is set, when JC reaches a point) use the
  Story: the action *A faction...* turns a whole faction friendly, neutral or hostile towards JC
  or another faction; *A character... joins a faction* moves one character; the event *a faction
  turns hostile to JC* reacts when that happens (JC shot one of them, or the story turned them).
- **Only one character**: *A character... becomes hostile to JC* (or *attacks JC right now*). Tick
  **alone** to keep the rest of their faction out of it: in the game, someone who attacks calls his
  friends for help, and characters treat neutrals as friends, so without *alone* the others may
  join the fight. With *alone* the character leaves their faction and does not call for help. If JC
  then fires a gun in front of the others, they may still react to the shooting, as in the game.

To place a character: **Objects** (the browser), search its name ("Red Arrow", "MJ12",
"civilian", "dog"...), click the floor; then set its orders, faction and relations in Properties.
To make a character of your own, see the next section.

## Characters

The **Character Creator** (**Characters** in the top bar, or **Characters...** in the browser)
makes characters of your own from the bodies, faces and clothes of the game's characters.

1. **+ New**, or **Start from** a character of the game: it takes their whole look, their
   behaviour and their weapons.
2. **Body**: the kind of body (man in a long coat, man in a suit, man in a uniform, woman in a
   dress, heavy man, child...). The pieces it shares with the old one stay: a face, the trousers.
3. **Look**: every piece of the body (*Face*, *Top*, *Legs*, *Long coat*, *Glasses*,
   *Hat / helmet*...) has the versions that exist in the game. The arrows go through them, the
   button with the number opens them all as pictures; under it, which character of the game wears
   it. Faces fit every body of the same kind (all the men, all the women), trousers every body with
   the same legs. **Random face** and **Random clothes** mix them for you.
4. **Behaviour**: *Civilian* (goes about their business, runs away from fights), *Soldier*
   (guards, takes cover, fights back), *Criminal* (attacks when provoked). **When placed**: stands,
   walks around, sits, dances. **Health** (100 is normal).
5. **Faction** and **Towards JC** (friendly, neutral, hostile, fixed), as in Factions above. To
   make a faction of your own (a new gang), give the same faction name to all its characters.
6. **Carries**: up to four weapons or items (a weapon needs its ammo too).
7. **Save**. The preview turns: drag it to turn it, the wheel zooms.

The character is now the first entry of **Objects** in the browser: click it and click a floor,
as many times as you want (each copy can still change its own properties in the Inspector).
**Place in map** does the same from the Creator. If you change a saved character and save it
again, its copies already placed in the open map change too (save the map and Rebuild).

Characters are files in `tools\mapkit\characters\` (one `.json` each): **Export** saves one
anywhere, to share it; **Import** loads one made by someone else. **Duplicate** makes a variant.

In the game they keep exactly the look you gave them (the HDTP models do not replace it), and
their corpse wears the same clothes, also after JC carries it and puts it down. They have the walk, eye height and pain sounds of the body's
original character (a woman's body has a woman's voice). They say nothing by themselves: give
them dialogues in the Story (they have their own conversation name, `UCEd_<their name>`).

The first time, the Creator reads the characters of the game (a few seconds). Characters need
DeusEdix's classes `UCCustomCivilian`, `UCCustomSoldier`, `UCCustomThug`: they are part of its package,
so **Install** puts them in the game together with the map.

## Animation: any object, doors and elevators too

Select an object (a model, a decoration, a light, a door, an elevator, a block) and **Animate...**: the
Animation panel opens at the bottom, like Premiere's Motion or Unity's Animation window. It has rows for
**Position**, **Rotation** and **Scale**, with their values at the playhead and their keys on the timeline.

- Move the **playhead** (click or drag on the timeline), then move, turn or scale the object with the gizmo
  (W, E, R) or type its values: every change is a **key** at that time (the first one also puts a key at 0,
  where it rests). **◆** adds or takes away a key of that row; drag a key to move it in time; click a key
  to choose its **curve** (linear, smooth, ease in, ease out, hold) or to delete it.
- **▶** plays it (the gizmo hides while it plays), **◀** plays it backwards, **■** goes back to the start.
  **Once**, **Loop** or **Back and forth**; **at the start**: it plays when the map starts.
- Positions are offsets from where the object stands, so moving the object moves its whole animation.
  Rotation in degrees: 360 is a whole turn (two keys 0 and 360: it spins once).
- **Doors, elevators and moving blocks** are the engine's movers: up to 8 keys, no scale, and whoever stands
  on them moves with them. A door you animate still opens when JC uses it, with your movement (a door that
  slides can swing on its hinge instead). A block becomes a **moving block** (*Kind* in its panel, or
  *Animate...* on it) and moves in the game as you animate it: a lift, a platform, a crusher.
- In the **Interactions**: *Then... → Play its animation*, *Play it backwards*, *Stop its animation*, and
  *When → its animation has finished* to chain things. Each rule has a **Timeline**: its actions as bars at
  their time (an animation as long as it lasts); drag a bar to when it should happen.
- **Events** (the last row, like Unity's Animation Events): things that happen at a time of the animation,
  in step with it however it is retimed: a clank when a crane arm stops, a hiss as a panel slides open, an
  alarm when a lift reaches a floor. **+** puts one at the playhead: *Play a sound* (the sound list opens;
  heard from the object, within its radius, at its volume) or *Trigger an Event* (type a **Tag**: every
  object with that Tag is triggered, a door, a light, an alarm, a sound effect). Or drop a sound from the
  browser on the row: a sound event at that time. Click a marker to change it or delete it, drag it to retime
  it (up to 16). In the game they happen whenever the animation passes them: every round of a *Loop*, both
  ways of *Back and forth*, played backwards; once each time (where it turns back, an event there plays once),
  and a door's or an elevator's whoever moves it (JC opening a door too). An event after the last key happens
  at the end. **▶** plays the sound events as the playhead passes them, and dragging the playhead forwards
  plays them too (backwards it does not); an Event only says in the status bar what it will trigger. To run
  an **Interaction** at a time, trigger the Tag of something whose own rule reacts (a sound effect, a door).

## Collision boxes

**Objects > Triggers > Collision box**: a box (purple in the 3D view; its **Width**, **Depth** and **Height**
in its Properties, or drag the dot of one side in the 3D view: see *Drag handles* in *Objects*). In its Interactions: *JC walks in* and *JC walks out*; *Anyone, not only JC* counts the
characters too; *Only once*; a *Message to JC*. Tick **Solid** and it is an **invisible wall** (orange):
JC cannot walk through it (Rebuild makes the wall), and *JC walks in* is when he touches it, to keep him in
an area or tell him why he cannot go on.

## Cutscenes

A cutscene is a camera that flies along keys on a timeline, like the camera paths of a video editor or of
the Minecraft film mods: the player watches, then gets JC back where he was.

1. Look at the first view you want and press **+ Cutscene** (bottom bar): a *Cutscene camera* is made, its
   first key is that view, and its timeline opens at the bottom with **🎥 Look through** on (the 3D view
   becomes the game's screen: 16:9, with the black bars).
2. Click the timeline further on (the red playhead), fly the camera there (right mouse + WASD, the mouse
   to turn) and press **K** (or **◆ Key**). Each key keeps the camera's place, where it looks, its **Roll**
   (tilt) and its **Zoom** (field of view: smaller = closer). Do it for every key.
3. **▶** (or Space) plays it in the editor: the picture as the game shows it, black bars, subtitles, fades.
   **■** goes back to the start; Esc stops, then stops looking through.
4. The camera flies **through** the keys without slowing down at them (a curve in time, as in video
   editors): it starts gently at the first key and stops gently at the last. Click a key to change what it
   does there: *Smooth* (passes through), *Stop here* (slows down to it and starts again), *Linear*
   (straight to the next key at the same speed), *Hold* (stays until the next key, then jumps); its Zoom,
   Roll, *Go there*, *Set to the view* (the key becomes what you see now), *Delete key*. Drag a key along the
   timeline to change its time: keys far apart in space but close in time make the camera fast there.
5. **Path**: *Smooth through the keys* (a curve that does not stop at each key) or *Straight lines*.
   **Even speed** spaces the keys so the camera keeps the same speed all along. **Looks at**: a character
   the camera always turns to (the keys still give its place, roll and zoom).
6. **✂ New shot** cuts at the playhead: the shot so far ends there and a new one starts with the view you
   have (fly elsewhere and press K for its first key). Between two shots the film jumps, no flight.
   *Join with the shot before* takes a cut away.
7. **Subtitles**: **+** at the playhead, then *Who* (a name, in yellow), the line, how long (0: as long
   as the text needs), a sound or a voice. Drag them along the timeline.
8. **Events**: **+** at the playhead, then click a door, a character, a light... in the 3D view or the
   Hierarchy: it happens at that second (the door opens at 3.2 s, the guard runs off). They are the
   Interactions *When it starts* of the cutscene (in its Properties, where you can add messages, sounds,
   goals): drag them along the timeline to change their second. *When it has ended* is in its Properties
   too (a guard attacks, JC goes to another map).
9. Options: *Fade in* / *out* (seconds from and to black), *black bars*, *can be skipped* (a click or
   Space skips it: what was still to happen at once), *only once*, *at the start of the map*, *JC visible
   where he stands* (a stand-in of JC stays there while the camera flies), *Length*.
10. **👁 Preview** (on at first): as the playhead moves or plays, the events show on the objects as the game
    does them by then. A door or an elevator opens through its keys in its *MoveTime*, after its *DelayTime* (a door
    that closes by itself does after its *StayOpenTime*; *Go to a floor* goes straight to that key); an object plays
    its animation, backwards, or stops; a character walks or runs to its place at its own speed, with its walk
    animation (along the AI paths of the last Rebuild; sent on the walkable area, or with no AI paths, straight
    there); a light goes dark (its icon, and its light in the *Lit* view with **View > Effects** on); something
    vanishes or appears again. Move the playhead back before an event and the object is where it is again. Nothing
    is changed in the map: no undo step, nothing to save. A click or a key outside the panel puts everything back
    first, so that what you do starts from where things really are; move the playhead to see them again. Events
    the editor cannot show (a message, a sound, a lock, an attack...) are dashed on the timeline: Rebuild and Play
    for those. A subtitle with a sound shows its voice's waveform in its clip, as long as the voice lasts, and **▶**
    plays the voices in time from where the playhead is, as the game does (a line's voice starts when the line
    shows, and plays to its end). **👁 Preview** off: the objects stay where they are and the voices are silent.

**What plays it**: an interaction **Play the cutscene** (select a collision box, **🔗 Connect to...**, click
the camera: *When JC walks into it: play the cutscene*), a button, a door, a character killed...; a Story
event or dialogue (action **Play a cutscene**: under a flag, after a talk); or *at the start of the map*.
A cutscene that starts during a conversation waits for its end.

In the game JC does not move, cannot be hurt and is not seen while it plays; the stories of the map and
the collision boxes wait. At the end he is back where he was, looking where he looked, with his weapon.
**Check map** warns about a cutscene with no keys or one nothing plays.

## Models: every 3D model, and your own

The **Models** tab of the browser (next to Objects and Pieces) lists every 3D model the game can load, by
package: Deus Ex's (DeusExDeco, DeusExCharacters, DeusExItems), HDTP's, Revision's, the packages of other
mods (Packages...) and yours (**DeusEdixModels**). Search by name; a package shows its previews the first time it
is opened (a few seconds). Click a model, then a floor or a wall: it is placed as an object of its own (DeusEdix's
`UCMeshDeco`) with a collision round it, at the size the game uses it. Its Properties: **Model**
(*Replace…*: click another one in the Models tab), name, solid, cannot be destroyed, strength, JC can push
it, and the Interactions of any object. Right click a model > **Find in map**: the objects of the map that
have it (the Hierarchy's search `mesh=`, see *Searching the map*).

**Replace a model, keep the logic:** select a mesh object, then **Inspector > Model > Replace…**.
Click the replacement in **Models** (including imported models). This changes the mesh and its skins,
not the actor's class or name: tags, links, AI, dialogue, inventory, transform, pivot and collision stay.
The old per-object texture overrides are removed with the old model. **Cancel** or **Esc** leaves it
unchanged; **Ctrl+Z** restores the entire replacement, including those textures. **Rebuild** applies it
in game. The appearance is reapplied once after the initial HDTP setup; later gameplay effects remain
controlled by the original class. Characters need compatible animation sequences and attachments;
corpses and inventory/first-person models still follow the original class. Brush doors/elevators and
map structures are not mesh actors, so they do not offer this command. To change the class too (a crate into a model,
a model into a barrel), use **Replace with…** (see *Objects*).

**Import model...** (Models tab) makes your own: a model made in Blender, 3ds Max, Maya... saved as
**glTF / GLB** (best: its textures inside), **FBX**, **OBJ** (with its .mtl) or **DAE**. Choose the file
together with its textures (Ctrl+click). The preview shows it next to JC (about 90 units tall); set its
**height** in units (a door is 128), **turn** it, **stand it up** (a model made with Z up comes lying
down), make it **two-sided** (leaves, cloth, thin panels). **Import**: Deus Ex's own importer makes it a
model of DeusEdix's package `DeusEdixModels` (in the game at once when it is closed, else with Install), and it is
ready to place. Up to 30000 triangles and 8 textures (made 256 colours, as the game's); transparent
parts of a picture become see-through (masked). Your models are listed at the bottom of the Import window,
where they can be deleted.

**Animated models.** A glTF/GLB, FBX or DAE with a skeleton (or shape keys) and animations keeps them. Deus
Ex's models have no bones: every animation of the game is a series of frames of the model's points. The
Import window lists the file's animations: tick the ones to keep and give each a name (the game's own names,
such as *Walk*, *Run* or *BreatheLight*, are offered), choose how many **frames a second** they are kept at
(15 by default; more is smoother and heavier) and which one the model **loops in the map**. Each animation is
played and recorded frame by frame into the model, as a sequence of its own. A placed model plays its loop in
the game (*IdleAnim* in its Properties, *IdleRate* for its speed); in the editor it shows its first frame. At
most 4000 frames, and 3 million frames x points per model: for a long animation, fewer frames a second or a
simpler model. A clip that walks away from its place (root motion) walks away in the game too: export it "in
place" (Mixamo has the option). Some files cannot be used as they are: an FBX the browser's FBX reader cannot
open (one with very many shape keys runs it out of memory) or one whose skeleton does not fit its model as
read (a scaled armature, two skeletons: the Import window says so and leaves the animations out). Saving the
model as glTF/GLB from Blender, with the armature's scale applied, solves both. A flat model (a rug, a panel)
takes the height you give as the size of its longest side.

**Simplify.** Today's models often have 100 000 triangles or more; Deus Ex's own characters about 1000. When a
model is too detailed for the game (more than 30000 triangles or 8191 points) the Import window says so and
offers **Simplify**: give the triangles to keep (3000 by default; 2000-3000 suits a character, a few thousand a
big object) and the model is made lighter where its shape changes least, its textures' layout counted too. It
keeps a part of the model's own points, so the textures, the skeleton, the shape keys and the animations stay
as they were. It also works on a model that is not too detailed, to make it lighter; **Original** goes back to
it as it was read. (The simplifier is meshoptimizer, MIT licence, Arseny Kapoulkine.) A model made of
thousands of separate small pieces, such as tufts of fur, keeps more points for its triangles.

## Zones: water, rooms of their own, rain and snow, the sky

Deus Ex divides a map into **zones**: closed areas, each with its own light, sound, fog, gravity, damage,
water. The editor makes them the way the game does.

- **+ Water** (bottom bar): click a floor: a pool 256 x 256, 96 deep, cut into it. Its surface is a zone
  portal, so the water is a zone of its own: JC swims and dives, the view turns blue under water. In its
  panel: the **liquid** (clean water, dirty water, toxic water that hurts with radiation, a burning liquid),
  where the **surface** is, a **place name**; untick *cut a pool* to fill a basin the map already has. Resize
  it with **R** or the numbers.
- **+ Portal**: click the floor in a doorway: an invisible sheet fills it exactly (it finds the walls and
  the top by itself). Put one in every opening of a room: the room becomes a zone of its own.
- **Objects > Zones**: put one inside the closed area. **Zone**: its *place name*, *ambient light* and
  *colour*, *sound of the zone* (heard everywhere in it), *hurts* (damage per second, kind of damage:
  radiation, burned, shocked, poison gas...; a message), *instant death*, *own gravity*, *ground friction*
  (0.2 = ice). **Rain zone** and **Snow zone** (Revision's): rain or snow falls round JC in the whole zone.
  **Water zone**, **Sky zone** for those who build them by hand.
- **Reverb** (a zone's Properties, as Unity's Audio Reverb Zone presets): how the zone echoes the sounds made in it.
  **None**, **Small room**, **Office**, **Hall**, **Tunnel / Sewer**, **Hangar** or **Cave** set it in one step (one
  `Ctrl+Z`): the zone's reverb as Unreal Engine 1 has it, the echo on, how loud the echoes are together, a cutoff
  (the echoes lose the sounds above it: bare walls give them back, carpet and rock swallow them) and six echoes,
  each when it comes back (milliseconds) and how loud (0-255). *Hall* is the game's own (NSF headquarters, the MJ12
  lab). **Custom** turns the echo on with the values as they are; **Values** (under the row, open by itself for
  Custom) shows them, a preset's too: change any of them. The original game's Galaxy audio plays these echoes.
  In **Revision** Galaxy plays them too and its OpenAL audio imitates them; a **RevZoneInfo** (and Revision's sound
  zone, water zone, rain and snow zones) also has an **OpenAL reverb**, one of OpenAL's EFX reverbs (cave, hangar,
  sewer pipe and over a hundred more) that its OpenAL audio uses instead: the presets set it with the echoes' delays,
  loudness and cutoff. A **water zone** keeps its own (underwater): the presets leave it, **None** puts it back. The
  echoes' gains stay the class's there (150 and 70, then none): such a zone's own *Gain* is OpenAL's and hides them,
  so its **Values** have no echo gains (one such a zone still has, from an older editor, is left out at **Rebuild**,
  and Messages says so). **Rebuild** puts the reverb in the map; the editor does not play it (only the game tells
  how it sounds).
- **The sky**: a **hole** in a ceiling (+ Hole, click the ceiling) with **open to the sky** ticked shows
  the sky through it. A map with no sky of its own gets a sky box (Hong Kong at night, New York at night,
  stars, sunset, clouds, bright clouds, orange haze: choose it in the hole's panel).
- **Map > Sky & time of day**: **Day**, **Sunset** or **Night**. It paints a sky of your own (its
  colours or stars), or uses a picture of yours or one of the game's skies, and sets the light:
  a sun shining in through every hole open to the sky, on the side of the sun, and the ambient light
  of the map. Deus Ex has no sun of its own: the sun is made of lights. **Rebuild** puts it in the game.
- **Clouds** (same window), over any of those skies: **None**, **Soft**, **Puffy**, **Streaks** (long
  wisps along the wind) or **Game's** (the game's own cloud textures: the Hong Kong cloud bank, the wide one,
  the fluffy blue ones, the subtle one), and ↻ for other painted clouds of the same kind. **Amount** and
  **Brightness** (painted clouds), **Size**, **Height** (how high the layer is: its far edge, in degrees over
  the horizon; low clouds reach down to it), **Wind** (how fast they move; 0 = still) and **Wind from** (the
  direction, measured like the sun's). The preview shows them as the game will, moving: drag it to look
  round and up. They are made the way the game's own levels make them (Wan Chai Street): a sheet in the sky
  box whose texture the engine moves (Auto U Pan, at the speed the sky zone gives), so they work the same in
  the original Deus Ex and in Revision. The painted sky keeps the far clouds under the layer's edge. The
  clouds go in the sky box the editor makes, so a map that has a sky of its own (most of the game's maps)
  keeps its own clouds.

After **Rebuild**, Messages say if a zone is not closed (it leaks into the zone round it, often the whole
map: its water, damage or fog would not be where you meant) or if the start of the map is inside a zone that does
something to JC at once (water, hurts, instant death, own gravity); one that only echoes, sounds or lights says
nothing.

## Packages of other mods

**Packages...** (bottom bar, next to *Characters...*) lists the packages (.u) in the game's folders
that the editor does not load yet (`Deus Ex\System`, `Revision\System`, `Revision\HDTP\System`),
and **Another .u file** takes one kept elsewhere. Tick them and **Apply**: the page loads again and
their actors are in the palette. Decorations, characters, weapons and items with a 3D model go to their
usual group, with the real model. Triggers, zones and other logic go under the package's name. They have
their Properties and Interactions, and are placed, saved and rebuilt like the game's own.

A map that uses them needs the package in the game too: a package kept outside the game's folders must
also be copied into `Deus Ex\System` (or `Revision\System`). Packages with only textures, sounds or
models (no actor classes) add nothing to the palette.

## Scripts and the Console

**Tools > Scripts...** writes UnrealScript inside the editor. A script is an invisible object placed
in the map (it extends `UCScript`): **Started** runs when the map starts, **Triggered** when a rule
switches it on (**Untriggered** when it switches it off), **Repeat** every few seconds. Helpers do the
common things: the player, say a line, find an object, read and set flags, give an item. **Compile**
builds the scripts' own package in a few seconds and lists the problems by line: click one to go
there. **Place in map** puts the script in the level and asks at once what sets it off: click a button,
a trigger, a timer... (or Esc, and connect it later like any object).

**A script as a block.** A script can be a block the rules use like a door or a keypad: its **inputs**
are what a rule can make it do, its **outputs** what it tells the rules. They are declared at the end
of the script, in its `defaultproperties`:

```unrealscript
Inputs(0)=(Id="Start",Label="Start it",Args="Seconds")
Outputs(0)=(Id="Done",Label="it is done")
```

and written in `Input(InputName, Args, Caller)` (a `switch` on the input's name; `ArgFloat(Args,
"Seconds")` reads an argument) and with `Output("Done")`. Then the Interactions offer *Start it* as
something to do to the script (with a field for each argument), and *it says "it is done"* as something
that can happen to it. The template **A block** of **+ New** has both. A `var()` of the script is set
per object in the Inspector.

The **Console** (a tab next to the Browser, or **Window > Console**) shows the game's log while the
game runs, as it is written: **Logic** shows what the rules and the scripts do, in words (*▶ L3 When
JC uses Button1: open Door3*, *→ open Door3*, *⏸ L4 did not run: only if JC carries Multitool, and that
does not hold*); a name selects that object in the map, a rule's id goes to its object. **Scripts** shows
only the lines from scripts (`log()`) and from the Console, **Problems** only errors and warnings.
As Unity's Console, **Collapse** shows identical lines as one, with how many came at its right (*×240*: a script
warning written at every frame is one line), and **Time** puts before each line the seconds since Play started
(*12.4*, *1:05.0*; the lines read back from an earlier log have none). Both stay as you leave them, and during Play
the Console follows the log even while it is hidden, so that each line has its time. **Copy** puts lines on the
clipboard as they read (with their time and count when shown): the lines picked (click a line, `Ctrl`+click one
more, `Shift`+click those in between) or, with none picked, every line shown (the filter and *Find in log* choose
them). In the log, `Ctrl+C` copies them too (a text selected with the mouse: that text), `Ctrl+A` picks every line
shown, `Up` / `Down` the line before or after (`Shift`: one more) and `Esc` lets them go: these keys stay the
Console's, the map's objects are not copied. The name of an object of the open map in any line is a link that
selects it, as in the logic lines (*ScriptWarning: DeusExMover 01_Lab.DeusExMover3 (Function ...) Accessed None*);
a name written with another map's name (Play went on to that map) is not one of this map's.
During **Play**, the line at the bottom sends a command to the game's own console (`summon`, `set`, a
cheat...). The game runs a cheat (`god`, `summon`, `fly`...) only with its cheats on: the first one you type turns
them on for that game, and the Console says so.

## Mods: export, install, play

When a campaign is finished, **File > Export mod...** saves it as one file (`.dxmod`) in
`Documents\DeusEdix Mods`: its maps, its packages, a picture (the view you frame in the 3D view), its
name, author and description, and the map it starts on. The editor refuses maps that need something the game does not have.

In the **Projects** window, **Mods** lists the mods installed in both games:

- **Install mod...**, or drop a `.dxmod` (or a downloaded mod's `.zip`) on the window. Classic mods
  for Deus Ex or Revision are installed from their zip too (maps and packages; programs inside them
  are not run nor copied; a mod that replaces the game's own packages needs its own installer).
- **Play** starts the game on the mod's first map, **Starts on** chooses another, **Remove** takes it
  away. A mod lives in its own folder (`DeusEdixMods`): the game's settings and other mods are not
  changed.

## Map settings

**Map** in the top bar:

- **Music**: Revision plays a track for every moment of the map: exploring (and the intro before
  it), combat, conversations, leaving the map, death. *Same as the map* takes the whole set of a map of
  the game; each moment can also be chosen on its own among every track of the game, and **▶** plays
  it. (The PS2 soundtrack option of Revision gets the same tracks, or the copied map's own PS2 set.)
- **Information**: the name of the place (*Place*: the save list, the DataVault), the author, and up
  to four **opening lines** written on the screen when JC arrives ("Liberty Island, New York").
- **Ambient light**: the light everything has where no lamp reaches, and its colour (Deus Ex maps
  use 0-20; maps with zones have their own in each zone).

**Apply**, then **Rebuild**. In the map they are its DeusExLevelInfo, its LevelInfo and a music actor
of the editor's own (`UCMusicInfo`, a DXOggMusicInfo of Revision).

### Player characters per map

Create and save a human character in **Characters...**, then choose **Use as player**
to use its appearance in the open map. Alternatively, open **Map settings > Player
character** and select it under **This map**. **Apply**, **Save**, then **Rebuild**.
The Player Start inspector has a **Change** shortcut to the same setting; Player
Start still chooses only where and in which direction the player appears.

For a campaign-wide choice, expand **Project default**, choose a character and press
**Set default**. Rebuild each affected map. A map may inherit that default or override
it with another character (including **JC Denton**). Thus map A can use one protagonist,
map B another, and returning to A restores its chosen appearance. Map overrides use
the map's normal Undo/Redo and Save; the project default is saved separately.

This first version changes the third-person body and eight skin slots only. Inventory,
health, credits, skills, augmentations and story flags stay shared. First-person weapon
hands, player voice, dialogue identity and mission scripts remain those of the game's
normal player; changing appearance does not rewrite the campaign. Separate protagonist
inventories are not available yet. All 17 human body templates in Character Creator
are supported, including the different builds, uniforms, dresses and smaller bodies.
Their gameplay collision and eye height remain those of the normal player: this is
an appearance change, not a different-sized player or a different playable species.
Imported arbitrary meshes and non-human bodies are not enabled by this feature.

Rebuild automatically adapts missing crouch-walk, weapon and other player motions
from the installed game's player animations, including one-frame NPC placeholders.
Existing usable animations, original frames and textures are preserved; the added
motions are retargeted approximations, not newly authored bespoke animations.
Footstep callbacks are retained. The copied body is stored in
the private map, never over the game's original package. Preparation is cached;
the first build of a body can take a few extra seconds. No game meshes or animation
frames are bundled with DeusEdix.

Each configured map exposes an automatic **Player is ...** condition to the story tools
(`UCEdPlayer_<character-id>`; hyphens become underscores). Only the current identity's
flag is true. The choice survives normal map travel and native Save/Load in Original
and Revision. Leaving configured project maps restores the original player's appearance.
The editor prevents deletion of characters used by a project default or saved map;
select a replacement first. A missing or unsupported character stops Rebuild with an
explanation. Ordinary maps which have never enabled player characters stay unchanged.

## Sounds

**Objects > Sounds > Ambient sound**: click where it should be heard (rain on a window, the hum of a
machine room, wind on a roof, a crowd), then **Choose...** its sound in its Properties: the list has
every sound of the game, the loops for places first; search by word (*rain*, *hum*, *wind*, *water*)
and **▶** listens to it. *Heard within* is how far (the sphere in the 3D view: drag its dots), *Volume*, *Pitch*.
Objects (a TV, a fridge, a generator) and lamps (the buzz of a neon) have the same **Sound** in their
Properties.

**Sound effects** (once, when something happens), in **Objects > Sounds**:

- **Sound effect: when JC walks in**: a zone (the purple cylinder, *Radius* and *Height* in its
  Properties): it plays when JC enters it. *Only once*, or again every time (*Again after* a few
  seconds).
- **Sound effect: when triggered**: it plays when something triggers it. It gets a Tag of its own
  (`SoundFX1`...): put that Tag in the **Event** of a door (it plays when the door has finished
  opening), a button, a keypad (right code), a **Trigger** (*Objects > Sounds > Trigger*: a zone JC
  walks into), or use it from the Story. The Connections show the arrow.
- After placing one, the sound list opens: choose its sound. In its Properties: *Heard in JC's head*
  (a radio, a voice: as loud wherever he is) or heard from its place within *Heard within* (the
  circles in the 3D view), *Volume*, *Pitch*. A sound effect that walks-in also triggers its own Event,
  like any trigger.
- **More sounds** (a playlist, like Unity's Audio Random Container): so a dog, a drip or a distant siren
  does not sound the same every time. Drop sounds from the browser on its last row (or **+ Add...**), up to 8
  with its *Sound*; each has **▶**, **↑ ↓** (its place in the list) and **✕**, and a sound dropped on one
  replaces it. Each time it plays it picks one: **Order** *Random* (never the same one twice in a row) or *In
  sequence*. **Pitch ±** and **Volume ±** vary each play by up to that much. **Repeats every** *a* to *b*
  seconds: once it has played, it plays again by itself after a random wait between them, a zone while JC
  stays in it, a triggered one until an interaction does *Stop its repeats* on it (or something untriggers
  it); walking in or a trigger again meanwhile does not play it sooner; *Only once* never repeats. **▶ Preview** plays four picks the way the game would (again: stop). A
  sound effect with one sound and none of these plays as it always did.

**Doors** have their sounds in their Properties (**Door sounds**): when it starts opening, when it is
open, when it starts closing, when it is shut, and over and over while it moves; *Heard within* and
*Volume*. The doors of the game have theirs already; a door copied from another map keeps them.

### Hear the map

**Hear the map** (the speaker at the end of the 3D view's toolbar, or **View > Hear the map**), as Unity's Scene view
audio: the map's ambient sounds play in the editor where they are, heard from the camera as you fly through the map,
to balance their reach and loudness by ear before a Rebuild. It is off at first and kept for the next time (in the
browser). While it is on:

- Every object with a **Sound** of its own loops it: ambient sounds, lamps (the buzz of a neon), decorations (a TV, a
  generator), and the objects whose kind has one in the game (a security camera's hum, a vending machine's). Each one
  is heard as the game does: all of it at its place, fading in a straight line to nothing at its *Heard within*
  (25 x (radius + 1) units: the sphere in the view), at its *Volume* (the game plays ambient sounds at 0.7 of it) and
  *Pitch* (64: as recorded). A change in its Properties, or a move, is heard at once.
- A zone's **Sound of the zone** is heard while the camera is in that zone, from the zone's object up to 6400 units,
  as the game does while JC's head is in it; out of its zone it is silent. Which zone the camera is in comes from the
  last **Rebuild**: before one (or in a map read by an older version of the editor) a zone's sound is heard within
  its own *Heard within*.
- The 16 nearest sounds play at once, each from its side.
- It is silent while **Play** runs, while the editor's tab is hidden and with no map open. The browser lets a page
  play sound only after a click or a key: opened with Hear the map on, the editor starts it at your first click.
- The sounds come from the game as ▶ gets them for a preview: the first time a sound takes a moment (one at a time,
  the nearest first; none while a Rebuild runs). A sound the browser cannot play is said once in Messages.

### Sounds in the browser, and your own

**Sounds** and **My sounds** use tiles like the object browser. Click a tile to select it and
inspect its duration, source, format, channels and sample rate. **Play** draws the real waveform
and playback position in both the tile and Inspector. The Inspector also offers seeking, preview
volume and loop preview; these controls do not change the sound in the game. **Find in map** there
shows the objects of the map that use the sound (the Hierarchy's search `snd=`, see *Searching the map*).
Select a scene object to return to its properties. Then drag a sound:

- onto the **3D view**: a sound effect there, that plays when JC walks into its zone and is heard within
  its radius (both in its Properties, with the circles in the view);
- onto a **door** or another object with sounds of its own: a menu asks which one (a door's opening,
  closing, moving sound; the hum of a lamp or a machine);
- onto a **sound in the Inspector**: it replaces that one.

**Your own sounds**: **Import...** (top of the browser), or drop the files anywhere on the editor:
WAV, MP3, OGG, FLAC. They are made mono (a sound heard from a place is mono in the game), 16 bit,
44.1 kHz, and become sounds of the editor's own package (*UCSounds* in DeusEdix,
*DeusEdixSounds* in DeusEdix), which the game plays like its own; it is installed with your maps. Up to
10 minutes each. Importing the same name creates a numbered copy and keeps the previous sound.
Drop one audio file on an object's sound field to import and assign it directly. Other file drops
import into the browser, with a visible drop hint. A cancelled asset drag never leaves placement
active. **Download WAV** in the imported sound's Inspector exports a usable file; dragging a
prepared imported tile to the desktop also works in browsers that support file drag-out.
**Delete sound…** in its Inspector removes it after confirmation (maps that use it lose it).

## Check map

**Check** in the top bar lists what is wrong or missing, with **go to**:

- errors: no Player start, a map exit to a map that does not exist, a character that patrols without a
  route, an object or a light inside a wall or a floor (as last rebuilt: stuck, invisible, or lighting
  nothing);
- warnings: an event (or a keypad's, a security computer's) that triggers nothing, a patrol point
  leading to no point, patrol points with the same Tag, no light in the map, characters but no AI paths;
- notes: a door whose key is not in this map (JC must bring it), unsaved changes.

It also looks at where things are, as Unity's Search finds objects overlapping others:

- **the same object twice at one spot**: two things of the same class within 2 units of each other,
  turned the same way and with the same properties (All properties too), probably a double paste (`Ctrl+D`,
  `Ctrl+V`, an `Alt`+drag let go where it began). In the game they are both there: two pickups, two lights, a
  door twice. **delete the extra one** deletes the copy added last (the one there first stays). Two sounds,
  triggers or lights put at one spot on purpose are set differently (another sound, Event, radius...), and are
  left alone;
- **a decoration or a thing to pick up left in the air**: its bottom more than 8 units above what is under
  it (the floor, a table, a block, another object: a ray straight down from its middle, as Drop to floor
  casts). What the 3D view hides (Isolate, the Show menu, an eye) counts too: a bottle on a table hidden in the
  view is on that table. The game drops these when the map starts. **drop to floor** does Drop to floor on it,
  onto what is under it whether the view shows it or not. Left out by
  what they are: the game's classes made to hang, to sit on a wall or to stay where they are put (their own
  *Physics* is not *Falling* in the game's classes: lamps on chains and hanging decorations, light bulbs,
  switches and buttons, taps and showers, fans, turrets, cameras and keypads, wall computers and ATMs,
  trees and outdoor things, vehicles, statues, Revision's ceiling lights and towel racks, and the
  editor's imported models), and anything whose *Physics* is set to something other than *Falling* (Stick
  to surface sets *None* on what it sticks to a wall) or whose *bCollideWorld* is *False*: set one of these
  on a thing that hangs on purpose and Check map leaves it alone;
- **a path node linked to no other point** (as the last Rebuild made the AI paths): no character goes
  there. Move it within reach of another one, on the floor with nothing in between, and Rebuild.

Each fix is one `Ctrl+Z`, and the list is checked again after it. The warnings of the **Build report** in
Messages (after a Rebuild: an object inside a wall, a zone that leaks...) end with a **Check map** link that
opens it.

What you added or changed is checked fully; the original objects of a map of the game only for what
breaks the map (they have links the story and the game's scripts use): two of the map's own objects at one
spot, or one of them in the air, are as the game has them.

## AI paths and patrols

The characters of Deus Ex walk on a network of **path nodes**: they go from node to node along
the links the editor of the game works out from them (UnrealEd's *Paths Define*). The map editor
makes that network at every **Rebuild**.

- **AI paths** in the top bar (or **P**) shows the network as the last rebuild made it: green lines
  are links both ways, yellow lines one way only. A place without lines is a place characters
  cannot find their way to (they can still walk there in a straight line when they see it).
- To add paths: **Objects > AI > Path node**, click the floor where characters must be able to
  walk (along corridors, through doors, round corners: one every 300-500 units, each in sight of the
  next), then **Rebuild**. The other points of the same group: *Patrol point*, *Wander point*
  (wandering characters stop there and look at its *Look at* Tag), *Hide point* (where scared
  characters hide).
- The points rest on the floor by themselves: Deus Ex makes no link from a point floating higher
  than about 20 units, so the rebuild puts every path point of your maps 15 units above the floor
  below it, as UnrealEd does. The original maps have their points higher (up to about 40 units): for
  the links the rebuild rests them on the floor too, then puts each back where it was. The links of an
  original map that the rebuild does not make again (Battery Park's subway stairs) are kept, as long as
  both their points are still where they were and nothing has been built across them.

**Navigation** (the route icon in the 3D view's toolbar, next to the icons button): the two layers of
navigation, each shown or hidden by itself, ticked in its menu: **AI paths** (the nodes' network, **P**)
and **Walkable area** (the navigation mesh), one, the other or both; then **Test route** and **Fill AI
paths**. The same are in the *View* and *Map* menus.

**Test route** (the Navigation menu, or *View > Test a route*): click where a character starts, then
where it must go. With the AI paths shown, the editor draws the way the game's AI would take, node to
node, with its length; if no path node is near one of the two places it says so. With the walkable area
alone, it draws the straight way on it. Click again for another test, **Esc** to close.

**Walkable area** (the Navigation menu, or *View > Walkable area*) shows where a man can walk in the
map: the editor makes a navigation mesh of the map's floors (with Recast, the library many games use
for this, which comes with the editor; it takes a second or two) and colours the floor JC can reach
from where he starts:

- **green**: near the AI paths, characters find their way there;
- **amber**: walkable, but far from any path node: put one there if characters must go;
- **red**: no path node reaches it: characters cannot find their way there.

Only the main network counts: path points the last rebuild left linked among themselves but not to
the rest (a group apart) do not make their floor green, and the status bar says how many there are.
Roofs and places JC cannot reach are not coloured; the status bar says how big they are. With the
walkable area shown, **Test route** also draws the straight way on it (in the accent colour) next to
the AI's node-to-node one, with its length: where the two are very different, the network makes the
characters walk round. The walkable area knows the map's walls and floors, not the furniture and the
other objects, so it can show a way through a crate or a barricade.

**Fill AI paths** (*Map > Fill AI paths*) puts the path nodes for you: one wherever JC can walk and no
node of the network is near enough, about 450 units apart, each where a man can walk straight to the
next one, away from the walls and outside the furniture. Where a group of points does not reach the
main network, it adds nodes along the way between them (at the corners). They are ordinary path nodes,
added as if placed by hand: **Ctrl+Z** takes them all away, and the next **Rebuild** (or *Map > Rebuild
AI paths*) links them; the walkable area counts them at once. After the rebuild, run it again: it joins
what the game left apart, and says which groups it cannot join (steep stairs or a ledge the game does
not link): put a few nodes there by hand, closer together. On Battery Park it adds about 170 nodes and
the floor goes from 23% to 97% green.

**Patrol route**: select a character; at the end of its Properties, **Draw route**, then click the
floor where they walk, point after point, and press **Enter** (or Esc). They walk it in a loop: after
the last point, back to the first. The route is drawn in orange with numbers; the dashed line is
where they start from. Every point has a **wait** (seconds they stop there, turned the way the point
faces: turn it with **E**) and **✕** takes it out of the route. **+ Add points** goes on drawing,
**Clear route** removes it. The character's *Orders* become *Patrolling* and its *Order target* the
first point; each patrol point's *Next point* is the following one (all of this is also in their
Properties, and in Connections).

## Animations

**What a character does when idle**: in its Properties, *Animation > When idle* lists the animations
of its model (breathing, idle gestures, sitting, cowering, dancing...) with their length; **▶** plays
it on the character in the 3D view. In the game they do it while standing (Orders *Standing*) or
while waiting at a patrol point, instead of breathing; *Speed* plays it slower or faster. In a
conversation, in a fight or running away they are as the game makes them.

**At a patrol point**: select the point, *Animation while waiting* (the animations of the characters
patrolling through it): they do it while they wait there. When the point had no wait, it gets one
long enough for the animation.

**When something happens** (an Interaction): *Play a body animation* on a character makes it play one when
JC uses a button, walks into a collision box, picks something up, when a timer runs out, a cutscene starts...
Choose the character as the target, then its **animation** (the model's own, or one of yours from the
Animation Studio: it is put on the character's models when you choose it), how many times (**once**, **over and
over** until *Stop its body animation*, or **over and over, for some seconds**), its **speed**, and whether it
**may keep walking** (off: it stands still while it plays; a patrol goes on afterwards). ▶ plays it on the
character in the 3D view. Whatever the game's AI plays meanwhile, the animation goes on where it was; at its
end the character does what it did before, and the rules *When it has finished its body animation* run (to
play another, say a line, open a door...).

All of these work through DeusEdix's package: `UCAnimSet` objects in the map (made by the rebuild), so the
package must be in the game (**Install** puts it there).

**Pose here** (*Animation > Pose here...* in a character's Properties, or right-click it): poses the
character where it stands, against the map around it, instead of in the Studio's empty room: a hand
on a railing or a desk, the back against a wall. The character shows its skeleton's handles: drag the
**hands** (orange) and the **feet** (blue) onto the map and they stick to what is under the pointer (a
hand lies on it, the palm against it, the fingers pointing on away from the shoulder; a foot stands on
it); **Alt** moves them freely. A handle that sticks stays where it touches, and grabbing it again moves
nothing until the pointer moves. A thin railing is easy to miss by a pixel: dragged near it, the hand
gets onto it, and slipping just past its edge does not drop the hand onto the floor behind it. The **hips**
(green) move the body (**Shift**: up and down) and, with **Ctrl**, the whole character moves in the map
to come closer to what it leans on, the hands that hold on staying where they are. A handle turns
red when the arm or the leg cannot reach. A hand that sticks closes by itself as on what it holds:
round a railing or an edge (the surface ends just past the fingers), relaxed on a table top; the
**Grip** sliders override it. **Start from** gives a ready pose, placed on what you click next:
**Railing** (both hands on it), **Elbows** (leaning on it), **Wall** (the back against it), **Table** (both
hands on the top) and **Sit** (on an edge, a crate, a bench, facing the camera): the character turns,
comes close enough for its arms to reach (never into what it holds; it leans more when it cannot come
closer) and puts its hands and feet down; a seat too high to sit on with the feet on the floor is said.
The panel leans, turns and bends the upper body, closes the hands (**Grip**) and keeps the character
breathing. **Save** makes it an animation of the Animation
Studio (`Pose<name>`), puts it on the character's models and gives it to the character as what it does
when idle, with *Stays put* (it never turns away from what it leans on); **Rebuild** puts it in the
map. Opening Pose here again on that character goes back to the same pose. **Animate in the Studio...**
saves the pose as a new animation with the name you give it, without changing the character, and opens it
in the Animation Studio: the pose is its first key, to go on animating from there. **Ctrl+Z** and **Ctrl+Y** (or
the arrows in the panel) step back and forth through the changes made while posing, the character's place
in the map included; *Reset* (standing again) is one of them, so a mistake never means starting over.
**Esc** or *Cancel* leaves without changing anything.

### Animation Studio

**Animations** in the top bar (or *Animation Studio...* in a character's Properties) opens the
Studio, to make new animations for the characters, change the game's, or bring in animations from
other programs.

Deus Ex animates its characters frame by frame, without a skeleton. The Studio finds a skeleton in
every model by itself, from the game's own animations: the parts of the body that always move
together are a bone, the points where two of them turn are the joints. It takes a moment the first
time a model is opened; *Make the skeleton again* redoes it.

Every human gets the same skeleton of 17 bones. The joints are placed where a body has them
(shoulders, elbows, hips, knees and ankles at their usual share of the height) and then fitted to the
model's own motion, so a long coat or a skirt does not move a knee; the knee sits on the line from
the hip to the ankle, a little forward. Children are the same skeleton, smaller.

The game's characters never bend their wrists, so the hands are found from the model itself: the
vertices of the lower arm with the skin's texture (the head's) are the hand, and the wrist is where
the sleeve ends; with gloves or bare arms, what lies past the wrist. The animations made before the
hands had bones (18 October 2026) keep the skeleton they were made with, so they look the same.

- **Character** and **Model**: the character to work on, and its model. A soldier of the game can
  have two: the original and the HDTP one (Revision's high definition models). The Studio shows the
  one the game shows and puts every animation on both.
- **Game animations**: click one to play it. **Copy** makes it an animation of yours, to change.
- **+ New**: an animation of your own, starting from the rest pose. Click a ball of the skeleton (or
  the body) to pick a bone and turn it with the rings; the hips also move (**G** or **W** move, **R** or
  **E** turn).
  Every change is a **key** at that frame (the yellow diamonds on the timeline); between keys the
  Studio moves smoothly. Go to another frame (the slider, the arrow keys), pose again. **Space**
  plays. **Delete** removes the key of the frame, *Mirror* swaps left and right, *Reset bone* puts a
  bone back, *From game ... Pose* copies the pose of a frame of a game animation. *Frames* and *fps*
  give its length, *loops* whether it repeats.
- **Import file**: an animation made elsewhere, on any human skeleton: **BVH** (motion capture: free
  libraries such as CMU's), **FBX** (for example from Mixamo: download it in FBX, with or without
  skin) or **glTF/GLB** (Blender exports it). The Studio recognises the bones by their usual names
  (Hips, Spine, LeftArm, LeftForeArm, LeftUpLeg, upperarm_l, thigh_l...) and moves each bone of the
  Deus Ex skeleton the way the file's does, whatever the file's rest pose (a T-pose too) and size. It
  stays in place: walking forward is the game's job. The bones the file does not have follow their
  parent (they are listed). A file on the Studio's own skeleton (see **Export .glb**) comes back as it
  was made: the body's motion and the frame rate too.
- **IK** (the buttons **L hand**, **R hand**, **L foot**, **R foot** under the frame's title): an arm
  or a leg moved by its hand or foot. A box at the hand or foot is the controller: **G** moves it and
  the limb follows, **R** turns the hand or foot; the diamond (the *pole*) is where the elbow or the
  knee points. The controller has keys of its own (its row in the list, *Key controller*), and a foot
  on IK stays where it is while the body moves. Clicking the button again goes back to turning the
  bones one by one (FK): the bones get keys holding the IK's poses.
- **Grip** (in the panel when a hand, or an arm's IK, is selected): how far the hand is closed, from 0
  (open) to 100. It is keyed on its own row (*Left grip*, *Right grip*) like a bone. The game's models
  have no fingers of their own, so the closing is the game's: the way the model's own animations close
  its hands (holding a rifle), so it looks as in the game. The HDTP models never close their hands in
  their animations: their fingers bend at the knuckles instead. Without grip keys the hands are as
  before.
- **Export .glb**: the character with its skeleton, its weights, its textures and the animation open,
  for Blender or any other program that reads glTF. In Blender set the scene to the
  animation's frame rate (the Studio says it), then *File > Import > glTF 2.0*. Animate there,
  export glTF again and **Import file** here.
- **Graph editor**: pick a bone and click its curves (or **Edit curves**) to adjust its X/Y/Z rotations
  in degrees. **Ctrl+Space** or the maximize button fills the Studio with it, and again gives the view
  back; it fits the curves when it opens.
  **Body position** edits the character's position (X forward, Y up, Z right). Opening the graph
  does not change an animation. Enabling curves retains its poses at every game frame, including
  imported motion; constant axes start with one key. The graph and the game bake use the same curves.
  Click or Shift-click keys, drag to change their frame/value, or type precise values. **Smooth**
  rounds the movement without overshooting the neighboring values, **Linear** maintains a constant
  speed, and **Hold** retains a value until the next key. Interpolation applies after the selected key.
  Add a key at the playhead, duplicate selected keys there, or delete them; collisions with other keys
  are rejected. Fit all/selected, mouse-wheel zoom and middle-button drag help navigate. Graph keys
  affect their selected channel; the yellow timeline keys remain whole poses.
- **Numbers**: hold the label of a number (X, Y, Z, Scale %, Frames, fps) and drag left or right; a
  faster mouse makes bigger steps, **Shift** is fine, **Esc** puts it back. One drag is one undo step.
- **Keys as in Blender**: **G** move, **R** rotate, **S** scale (props), **Alt+G / Alt+R / Alt+S**
  back to rest; **I** keys the bone (**Shift+I** the pose), **Alt+I** or **X** deletes the key;
  **Up / Down** the next and previous key, **Shift+Left / Right** the first and last frame;
  **Ctrl+C / Ctrl+V** copy and paste a pose (**Ctrl+Shift+V** mirrored); **F** or **Numpad .** looks at
  the selection; **Numpad 1 / 3 / 7** front, right and top (**Ctrl**: the other side). In the Graph:
  **A** all keys, **Alt+A** none, **G** moves the keys with the mouse (a click or Enter places them,
  Esc or a right click puts them back), **X** delete, **Shift+D** duplicate, **I** a key at the
  playhead, **T** easing, **Home** fit, **F** fit the selected keys.
- **Undo / Redo**: the Studio keeps its own history, including posing, curves and animation settings.
  Use the graph buttons or **Ctrl+Z**, **Ctrl+Shift+Z / Ctrl+Y**. One drag is one undo step.
- **Save** puts it in the game: it becomes frames of the model, like the game's own, for every model
  of the character (original and HDTP), in DeusEdix's package `DeusEdixAnims.u`, installed in the game when
  it is closed.

To use it: a character's Properties, *When idle*, the group *Animation Studio (yours)*. Every human
character can use it: the Studio puts it on that character's models when you choose it (a few
seconds). In the game the character gets a copy of its model with your animations added (all the
game's are still there), whatever model the game gave it (HDTP or not).

Animations are files in `tools\mapkit\anims\` (`<name>.json`: the keys of the bones), the
skeletons in `anims\rigs\`, the frames made for each model in `anims\baked\`.

### Props attached to bones

In Animation Studio, open **Props** and choose **+ Add prop**. Search the game's objects (for example
`Liquor40oz` for a bottle), select one and attach it. The selected bone is used; the default hips
selection attaches to **Right hand**. **Bone** can move the attachment to any other bone.

- **Click the prop in the view** to select it (a yellow box): the gizmo moves (**G**), turns (**R**)
  and scales (**S**) it in every direction; it stays in its bone's frame. **Alt+G / Alt+R / Alt+S**
  put its offset, turn or size back.
- **Offset** and **Rotation** fit the grip in bone-local axes (X forward, Y up, Z right at rest).
  **Scale %** changes the object's size. **Snap to bone** resets its offset and rotation.
- **Enabled** includes or excludes it in both the preview and game; **Remove** removes this attachment
  only. All prop edits support the Studio's Undo/Redo and stay with the saved animation.
- Pose the arm normally and scrub or play: the prop follows the bone. **Save**, assign the animation
  to the character, then **Rebuild** the map to include the attachments. Saving alone does not rebuild maps.

Props are visual accessories, not pickups: no collision, inventory or AI changes. They appear only
while the character plays that animation, follow its speed and loops, and disappear when it changes
animation or dies. Up to eight props per animation, on Original and HDTP character models. This first
version has a fixed grip throughout the animation: no keyed pickup/drop or hand switching yet.
The game's `Cigarettes` object is a packet, not a single cigarette.

## New map

**New map** (top bar, next to the list of maps) makes a map of your own:

- **Name** and **Mission**: the file becomes `<mission>_<name>.dx` (for example `06_Warehouse_9`).
  The map belongs to that part of the campaign: the mission's goals, flags and InfoLinks work in it.
  **Place name** is what the game shows as the location (optional).
- **An empty room** to build in: its size (width, depth, height; a door is 64 x 128) and the
  textures of floor, walls and ceiling (smooth concrete by default). It has lights, as bright and of the colour of
  the **Mood** you choose (Normal, Dark, Warm or Cold; in a Dark room some flicker: they blink at random in Revision,
  whose renderer never lights a flickering lamp), the start of the map and an arrival point called *Start*. It is a
  map script (`tools\mapkit\maps\new_<map>.py`) built at once: add Pieces, Objects, characters and blocks, then
  **Rebuild**.
- **A copy of a map**: any map of the game or of yours under the new name, as a map of your own
  (`maps\`): change it as you like, the original stays as it is.
- **A map template** of the project: its tile shows its picture and name, its description is under the tiles
  and in its tooltip. The new map is the template's base (the room of the map it was saved from, built at once,
  or a copy of that map) with what was made in it, under the new name, mission and place name; the pictures
  you imported are copied into the new map's own folder, and a map exit that led into the old map leads into
  the new one. **×** on a tile deletes the template (the maps made from it stay as they are).

**File > Save map as template...** (as Unity's *Save As Scene Template*) keeps the open map, as it is now
(saved or not), as a template of the project: give it a name and a description; the 3D view as you see it,
without the gizmo, outlines and icons, becomes its picture (frame a nice view first). It keeps the place:
blocks, drawings, structures (pasted and the map's own, moved or deleted), objects, lights, the start, map
exits, zones, sounds, the sky, the time of day and Map settings, folders, and the pictures they use. It leaves
out what belongs to that map's story: the characters (with their tactics and animations), Interactions (and
usable objects and scripting tags), cutscenes and their cameras, the texts of computers, books and data cubes,
the Story itself, the *Conversation name* (BindName) of any object, the place name and the opening lines of
Map settings; the walkable area is made again by the next Rebuild. Only maps made with New map (an empty room or
a copy) and the project's map files can be templates: a map built by a script of its own cannot.

**Install** puts the new map in the game.

## Links between maps

JC leaves a map through a **map exit**: he walks into it and the next map loads. He appears at an
**arrival point** of that map, or at its start (its PlayerStart). Both are in **Objects > Level**
(with *Player start*), or in the **Links** panel.

- Place a **Map exit** where it makes sense (a doorway, the end of an alley, the top of a stair).
  In its Properties, **Leads to** lists every map; **arriving at** lists the arrival points of the
  map you chose (the game's own ones too), or *the start of the map*.
- Place an **Arrival point** where JC should appear, turned the way he should look. Its Tag is its
  name: other maps lead to `<this map>#<Tag>`.
- **Links** (top bar) shows the ways out of this map (where each exit leads), its arrival points,
  and every map of the game or of yours with an exit that leads here.
- A dialogue or an event of the Story can also take JC to another map (action *Take JC to another
  map*).

**To put a new map in the campaign**: open the map of the campaign JC should come from (for
example `06_HongKong_WanChai_Market`; the editor makes your copy, the original stays as it is).
Place a map exit there, leading to your map at *Start*. In your map, place a map exit back to that
map, at one of its arrival points (the list shows the game's own) or at a new arrival point you place
there. Rebuild both maps and **Install**. **Play from here** lets you try the way in. The exits
are read from the built maps: after a Rebuild, Links and the lists show them.

## Mission graph (read only)

The map icon at the top of the **Inspector**, to the right of its padlock, opens **Mission graph**
in a separate analysis window. A pinned Inspector uses the object displayed there. The analyser reads
saved maps, characters, flags, conversations and scripts in the active project: Original, Revision
and UNATCO are analysed separately, without mixing their game variants.

### First inspection

1. Select Anna or another character and open **Mission graph**. The default view is **Rules**.
2. Choose **Mission** and **Map**. The mission starts from the selected map's number; **All missions**
   also shows later appearances. Rules are grouped by mission and map. **Map not resolved** means the
   scanner has not established a map, not that the rule runs everywhere.
3. Expand a rule card. **When**, **Conditions** and **Actions** describe the source block. **Reads flags**
   are states that it checks; **Writes flags** are states that it changes. These are not current values
   from a running save. Separate branches stay separate; conditions retain AND, OR and negation.
4. Click a flag. **Who writes it** and **Who checks it** list the scanned rules across all missions.
   Open an entry to see that rule, even if it concerns another character. **Back to Anna Navarre**
   (or your starting selection) restores the original subject and mission filter.
5. **Details → Source statements & conditions** shows the file, line and individual source spans.
   Notes explain actor loops, inherited script bindings, partial control flow and unresolved names.

For a first Anna exercise, choose **Mission 03**, map **03_NYC_UNATCOHQ**, and find **MS_AnnaDeskHome**.
The block checks **AnnaAtDesk** and **MS_AnnaDeskHome**, sets Anna's home position and marks the latter
flag true. Click **MS_AnnaDeskHome** to compare its readers and writers. Original and Revision may
both have source definitions in a Revision project; this does not prove that both execute.

Rules match the selected subject by explicit class, dialogue identity or actor reference. A flag whose
name starts with that identity is separately labelled **Matching flag name · not an actor reference**.
Unrelated flags from other branches of the same script are not automatically treated as this
character's rules. A script may select several instances of a class; a conversation owner is an
identity, not a guaranteed instance in the selected map.

**Who writes it** and **Who checks it** name scripts, conversations or authored rules, not necessarily
the character performing the action. No writer found does not mean that a flag is unused: the engine,
missing source code and computed flag names may add accesses that cannot be resolved statically.
Conversation events and choices are separate records; their branch order is not simulated.

**Connections** in the view selector keeps the previous graph available: **Dialogues**, **Behaviour**,
**Story states** and **Other appearances** open filterable reference lists. Select a reference to see
one path, then click an arrow for its explanation or expand **Direct connections** to continue.
**Clear path** clears that path. **Find…** searches project-wide; Back still restores your first object.
Other appearances are separate instances with a shared class or identity, not proof of a unique
character across maps. Shared scripts may also concern other characters. Arrows are references,
not execution order. Long lists use **Show more**.

### Findings and coverage

**Findings** lists issues on the current graph selection/path, with an expandable project list:

- **Error**: a verifiable saved-reference problem, such as a rule targeting an actor deleted from a
  fully decoded map.
- **Review**: a possible problem that needs checking, such as a destination outside scanned maps.
- **Unverified**: missing sources, incomplete maps, computed names or runtime actor selection.

**More → Coverage** reports what was scanned. Rule cards reconstruct literal access and lexical
if/else conditions, not full execution. Function calls, inherited dispatch, jumps, returns and switch
branches may need source review; partial control flow is marked. Map guards are explicit when found;
script bindings are candidate scopes, and numbered mission grouping follows the source/map naming.
Authored rule cards retain saved conditions/actions, including choices, without simulating them.

The graph is not a live debugger, a narrative consistency checker or a visual script editor. It cannot
prove that a rule runs, that branches conflict, or that changing a character is safe. No errors means
neither complete coverage nor no risk.

### Refreshing the analysis

**Refresh** reads saved project files again; reopening can reuse a cached scan. Unsaved changes are
not included. **More → Read game sources** explicitly reads installed packages into local analysis
caches when sources are missing or stale; progress stays visible. After an analysis-service update,
restart DeusEdix before refreshing so that the new backend is loaded.

Scanning never saves or Rebuilds maps, compiles runtime code, changes dialogue, writes flags or alters
a running game. Generated maps need an existing built snapshot; missing coverage is reported instead
of silently building one. **Esc** closes the window. Inspecting a rule does not apply any change.

## Story

**Story** (top bar), or **Dialogues...** on a selected character, opens the story of the map.
It has three lists: dialogues, InfoLinks and events. **Save** keeps your work; **Apply in game**
turns it into UnrealScript, compiles it into DeusEdix's package and installs it (the game must be
closed; it takes a few seconds).

Everything is checked before it is applied: an empty line, an answer that leads nowhere or a
missing character are listed under the panel.

### Dialogues as a graph, and Play-test

A dialogue opens as a **Graph** (the **List** button shows the same steps in order). Each step is a
node: a line in the colour of who speaks (JC blue, the character violet), JC's answers with an arrow
from each one, conditions with *Yes* and *No*; the arrows show where the dialogue goes on.

- **Drag the dot** under a step onto another step to connect them, or onto empty space to add the next
  step there (a menu offers every kind). **Double-click** empty space for a step on its own.
- **Double-click a line** to write it in the node itself: **Enter** goes on to the next line, said by the
  other speaker; **Shift+Enter** starts a new row of text; **Tab** gives the line to another speaker; **Esc** is
  done. Double-click one of JC's answers to write it there too: Enter goes to the next answer (from the last one,
  a new answer). A click on the name in a line chooses who says it.
- Every line shows the face of who says it: the game's own InfoLink portrait when the character has one
  (Alex Jacobson, Paul...), else a picture of the head of their model in the map, made by the editor.
- **Enter** on a selected step adds the next line, said by the other speaker, ready to write. **Delete** removes a step:
  what led to it goes on to where it went. **Ctrl+Z** undoes. **Fit** shows the whole dialogue,
  **Tidy** lays it out again.
- The selected step is edited at the side, with the same fields as in the List. Steps nothing reaches
  are faded; a step with a problem (an empty line, an answer that goes nowhere) is marked.

**Play-test** plays the dialogue in the editor as the game will: choose JC's answers, and the step it
is at lights up. At the side, the state it reads (flags, credits, health, skill points, what JC
carries): change it and the dialogue starts again with it. Answers the game would hide are greyed.

### Dialogues

A dialogue belongs to a character or an object. It starts **when JC talks to them** (a click) or
**when JC gets close** (within a distance, and only if the character can see him), once or every
time, and only if the flags under *Only if* have the given values. Steps play in order:

| Step | |
|---|---|
| Line | the speaker, JC or another character of the map says something |
| JC's answers | 2 to 6 answers; each one goes to its own label; an answer can show up only if a flag has a value |
| Label | a point the answers and jumps go to |
| If a flag... | jumps to a label if a flag has a value |
| Go to a label | jumps |
| Set a flag, Goal | changes the story's memory, adds or completes a goal |
| Trigger an event | triggers the objects with that Tag (a door, an alarm, a light) |
| Give JC an item | a weapon, ammo or an item; the game shows "Received" in the conversation |
| Actions | things that happen as soon as the dialogue ends (see Actions) |
| End of dialogue | closes the dialogue; put one at the end of every branch |

Characters keep the conversation name they have in the original game, so their original
dialogues keep working.

**Priority.** A character can have more than one dialogue (one if JC killed someone, one if
that someone is alive, one for everything else). When more than one could start, the **first from the
top** whose *Only if* conditions hold is the one that plays: put the most specific ones first
and the general one last. **▲ ▼** next to *Priority* move a dialogue before or after the same
character's other dialogues. A dialogue set to play once is skipped after it has played, and the
next one plays.

**Who is this?** The lists of characters show the name in the map, what they are, their
conversation name and the part of the map they are in (for example `UCRoofGuard0 (Special
Projects Security) · UCHKGuard — Roof access`). The target button next to a list (and **Show in
scene** next to the speaker) shows that character in the 3D view: the panel steps aside to a bar,
the character is selected with its properties on the right; **Back to the story** (or Esc)
brings the panel back as it was. The same button is next to the characters and doors of the
actions and of the event *a character dies*.

The Story panel shows your dialogues and a separate **Original conversations** list. Dialogues written directly in UnrealScript are not listed.

### Original conversations and Game voices

Open an original map, then **Map > Story...**. **Original conversations** lists its characters'
dialogues and the mission's InfoLinks. Select a character in the list, or select one in the 3D view
and open **Dialogues...**. The script shows how it starts, its flag conditions, speakers, answers,
jumps and other events. Click **▶** beside a line to hear its original voice; click again to stop.
Expand an event to inspect its details. Mission-wide InfoLinks are included because some are
started by mission scripts, so a listed call is not guaranteed to happen at that exact location.

In the media browser, **Game voices** searches by a sentence, a character or a conversation name.
Filter by **Mission** and **Character**, open a character and conversation, then listen to a line.
**Show more lines** loads the next results. **Voices** chooses an installed package: Revision's
normal JC, its female JC variant, or the original Deus Ex. The `F` packages are for female JC;
they are not French translations. Text and voices come from your installed packages.

Choose **Type > Ambient NPC phrases** in Game voices to find barks and non-interactive
reactions. The filter starts across all missions, then you can narrow it by character or
mission, search a phrase and play it. These reactions are read-only; their voices can still
be used by reference on your own Story lines.

Under Original conversations, **Mission flags** lists literal flag names used by the map's
actual mission script and its parent classes. Search names or functions, expand a flag to see
its operation, class, function and source line. Boolean flags also appear in Story suggestions
with their origin; integer counters are listed for reference, not offered as boolean switches.
These are references in the installed scripts, not live values from a save. Dynamic flag names
are not guessed. If a package has no script source, the panel reports that limitation.

Original flags, goal names and notes also appear in the Story suggestions, with conversation names
as their source. Characters with original conversations have a speech icon in the hierarchy.
Their **BindName** is read only in the Inspector because the game uses it to attach conversations.

**Replace a voice:** use **Record** or **Import...** under an original line, or drop one of your
sounds onto its voice bar. The original text and story logic stay intact. The same speaker saying
the same text uses the same recording, including occurrences in other conversations. **×** removes
that recording and restores the original voice. Close Revision and press **Apply in game** after
adding or removing a dub. The game uses the recording with its normal speaking animation; lines
without a dub keep their own original audio. Radio calls support replacement voices too.

**Use a game voice:** drag a line from **Game voices** onto one of your Story voice bars. You can
also click **Select voice** in the browser, then **Use game voice** on your line. Only a reference is
saved: the player's installed game supplies the audio. Changing the text or speaker clears this
reference so an old recording does not silently speak the wrong words. Your own recordings take
priority over references for the same speaker and text.

**Edit a copy** creates an editable dialogue with the original owner, activation rules, priority,
conditions and voice references. It keeps the original conversation name, so mission-script calls
and the game's “already played” flag still work. Edit its lines and steps, then **Save** and
**Apply in game**. Credits, skill points, inventory checks, choice requirements, animations, random
branches, trading events, notes and jumps into other conversations are preserved. The copy uses
the editor's automatic cameras; a notice explains this. Existing missing or repeated labels are
reported for review. An unsupported event blocks conversion and is listed instead of being dropped.

**Switch off** disables that conversation in this map. On an editable copy, the checkbox keeps its
steps so you can turn it back on. **Restore original** removes the map's override; apply again and
reopen the map in the game. Recordings for matching lines are separate: remove a dub from its voice
bar if you want its original audio as well. After changing compiled stories, test from a fresh map
start; saves made against an older version of your story can retain older state.

The original game packages stay unchanged. The catalogue and preview audio stay in the local
`editor/cache/_gamecons` and `editor/cache/_gamevoices` folders; neither is part of the editor's
repository or installer. Original voices are never imported into the editor's sound package.

### InfoLinks

An InfoLink is a radio call. It is **one-way**: only the caller speaks; JC never answers by
radio (if JC has to report something, set a flag). Choose the caller among the portraits of
the game (Alex Jacobson, Walton Simons, Jock, Paul Denton, Sam Carter, Jaime Reyes, Anna Navarre,
Gunther Hermann, Tracer Tong, Bob Page, Morgan Everett, Gary Savage, Stanton Dowd, Daedalus,
Icarus) or *someone else* with any name. Each line gets its own screen, timed like the game's.

An InfoLink never starts over a conversation or another InfoLink: it waits. As in Deus Ex, its
text goes to the history and its actions happen at the start, so an InfoLink cut short counts as
heard. Events and dialogues play it (action *Play an InfoLink*); **+ Event that plays it**
creates the event for you, and *Plays when* lists what plays it.

**No talking while it plays** (on unless you turn it off): while the call is on screen, clicking
people starts no dialogue, because a dialogue would hide the InfoLink window and the game would
cut the call. As soon as it ends, people can be talked to again. Turn it off for a call that may
play while JC is busy with someone.

### Events

An event happens **when JC gets close to a point**, **when a flag changes**, **at map start**,
**when a character dies or is knocked out**, **when a faction turns hostile to JC**, or **when JC has
an item**, once or every time, and
only if its conditions are met. For the point, select an object in the scene and press *Use the
selected object*, or look at the spot and press *Use the point in front of the camera*.

### Actions

Events, dialogues (step *Actions*) and InfoLinks can do:

| Action | |
|---|---|
| Set a flag, Goal, Datavault note, On-screen message | the story's memory and what the player reads |
| Start a dialogue, Play an InfoLink, Play a cutscene | |
| Trigger an event (Tag) | doors, alarms, lights of the map |
| A character... | walks or runs to a point, stops, wanders around, follows JC, becomes hostile to JC (attacks when he sees him), attacks JC right now, becomes neutral or friendly, vanishes, reappears, joins a faction |
| A faction... | becomes hostile, neutral or friendly towards JC or another faction (fixed or not) |
| A door... | opens, closes, locks, unlocks, blows up |
| Take JC to another map | with an arrival point (Tag) if you want |

Nobody vanishes or appears in front of JC: a character waits until JC cannot see that spot. To
make someone appear later, untick **There from the start** in their Inspector (Behaviour): they are
not in the map when it starts (the editor still shows them, in the Hierarchy too), and they come in
with *reappears* (a story event) or the interaction **Come back** (after a button, a zone...), then
**Walk to a place** sends them on.

**On the walkable area** (under *Walk / Run to a place*, in the Interactions and in the Story; on by
default for the ones you make now): the character finds the way on the walkable area (*View >
Walkable area*), the way a man would walk, and needs no path nodes on the way. Each **Rebuild** of a
map that uses it puts the walkable area into the map (*Walkable area for the game: N polygons* in
Messages). In the game DeusEdix's package plans the route (the corners where it turns) and the character walks it
with the game's own orders, so it opens the doors it can open and animates as always. If it gets held
up, it plans the route again from where it stands. Without a walkable area in the map, or with no
way on it, the character takes the AI paths as before. What it knows that the view does not:

- crates, barricades and the other blocking objects (JC climbs over them and squeezes past them;
  characters cannot), and the invisible walls for characters (*BlockAll*);
- locked doors, which are walls for characters. A Battery Park trooper cannot get into Castle Clinton:
  its two doors are locked.

Old actions (without the tick) and the characters of the original maps keep the AI paths. For
**Tools > Scripts**: *Map settings > walkable area in the game* puts it into the map even with no
action using it; then `class'UCNavRoute'.static.Send(somePawn, aPlace, bRun)` sends a character, and
`class'UCNavMesh'.static.Of(self).Route(a, b)` plans a route (`NumCorners`, `CornerAt(i)`).

### Flags

Flags are the story's memory: one dialogue sets them, another requires them. The flag field
suggests the flags already in use, plus two kinds the story makes by itself:
`UCEd<code>_<id>_Played` (a dialogue has been played) and `UCEd<code>_<id>_Heard` (an InfoLink
has been heard); the InfoLink panel shows its own.

**What happened to a character.** DeusEdix remembers, for the whole game, every character JC
killed or knocked out, in every map: no flag to set by hand. The **👤** button next to every flag
field (*Only if*, *If a flag...*, events, *Set a flag*) picks it: the map (this one or any other),
the character and *was killed*, *was knocked out*, *was killed or knocked out* or *is alive*. The
field then reads, for example, *👤 TriadRedArrow0 (06_HongKong_WanChai_Street) was killed*.
Example: two dialogues for Simons in a later map, the first *Only if* that Red Arrow member was
killed, the second with no condition: Simons brings it up only if JC killed him.

They are ordinary flags (`UCFate<map code>_<name>_Dead`, `_KO`, `_Down`), so a story can also
set them itself with **Set a flag**: a character who "dies" in a cutscene counts as killed. The
last value written wins. A knocked-out character that is killed later counts as killed; one
carried to another spot keeps its fate.

### Example: a guard gives JC a weapon, then a radio call

1. Select the guard in the scene and press **Dialogues...**: a new dialogue opens with the guard
   as the speaker. Set *Starts* to *when JC gets close*.
2. Write his line. Add **JC's answers** with three answers (GEP gun, crossbow, sniper rifle).
3. Each answer created its own branch at the bottom: a label (`answer1`, `answer2`...), a line
   and **End of dialogue**. In each branch add **Give JC an item** with that weapon and move it
   up (↑) under the label.
4. In each branch, before **End of dialogue**, add **Actions** with *A character... (the guard)
   walks to a point*, and pick the point.
5. Create an **InfoLink**: caller Alex Jacobson, one or two lines.
6. In the guard's dialogue, add to the **Actions** step *Play an InfoLink* (Alex's).
7. **Apply in game**, open the game and walk to the guard.

### When something does not start

The game's log (`Revision\System\Revision.log`) explains it, in lines starting with `UCEd:`:
why a "when JC gets close" dialogue did not start (JC out of sight, its conditions, the game
refusing it), where a character was sent, which door was used, which InfoLink played.

### Voices: dubbing the lines

Every line of a dialogue or an InfoLink can have its own voice, like the game's recorded lines:

- **● Record** under the line: the window shows the line to read (as in a dubbing room); **Record**,
  speak, **Stop**, **▶ Listen**, then **Use this take** (or **Again**). The silence before and after is
  cut, a quiet take is raised to the level of the game's voices. **⚙** next to Record (or **Settings >
  Microphone**) chooses the microphone.
- **Import...** takes a recorded file (WAV, MP3, OGG, FLAC); a file from Windows or one of **My sounds**
  can also be dropped on the line.
- **▶** listens to it, **✕** takes it away.

In the game the character says it **from their mouth, and the lips follow**: as in Deus Ex, there is
nothing to prepare for the lips, the engine moves the mouth (seven shapes: A, E, F, M, O, T, U and closed)
with the sound of the line while it plays. An InfoLink's voice comes over the radio, with the portrait.
The voice belongs to the line: change its text and the voice follows it when you **Save**. It plays after
**Apply in game**. Voices are kept in the editor's sounds package (*UCSounds* in DeusEdix,
*DeusEdixSounds* in DeusEdix), installed with your maps. A line too long for one subtitle (over about 250
letters) is shown in two parts: split it into two lines to give each its voice.

## Save, rebuild, test, install

| Button | |
|---|---|
| **Save** (`Ctrl+S`) | writes your changes to the map's changes file |
| **Rebuild** | saves and builds the map with your changes (about a minute), in the background: see *Rebuild in the background* below |
| **View in game** | opens the game on the last rebuilt map and shows a screenshot from where you are in the editor (the first time, the game has to start); **Close game** closes it |
| **Install** | puts the rebuilt map into the game (`Revision\DeusEdixMaps`); the game must be closed |
| **Revert all changes** (Changes panel) | forgets every change made on this map |

**View in game** shows the last rebuild: rebuild first to see your changes.

### Rebuild in the background

**Rebuild** (and *Full rebuild*, *Rebuild lighting*, *Rebuild AI paths* in the Map menu and the Rebuild
button's arrow) no longer covers the editor while it works. A chip beside the status in the menu bar says
the stage the build is at, the time so far and how long the last build of this map took (*last time
0:41*), with **Cancel**. The stages are the ones the build really has: *Saving* and *Walkable area* (the
page, before the engine), then *Preparing*, *Loading the map*, *Applying edits*, *CSG and BSP*, *AI paths*,
*Lighting* and *Writing the .dx*, read from the engine's own log as it works (a lighting-only build skips
CSG and BSP, a build of objects only skips most of them). The build works out of sight: it opens no window on
your screen, never takes the keyboard from the editor, and leaves alone the mouse of a game playing in its own
window.

While it runs the 3D view is **look-only**: you can fly, orbit, select (in the view or the Hierarchy), frame
with `F`, keep and recall views and selections (`1`…`9`), measure, switch the lighting and the AI paths,
and read the Inspector. Editing waits until the build ends: every object is locked as by its padlock (no
gizmo, the Inspector's fields greyed, the Hierarchy's drag and delete off), the asset browser is dimmed,
and the keys that change the map (`Delete`, `Ctrl+Z`, `Ctrl+V`, `Ctrl+D`, `End`, `B`...) only say so in the
status bar; `Tab` still moves through the editor, and `Enter` or `Space` press the button that has the focus (the
chip's **Cancel** too). What waits for an answer of the server (a texture applied, a sign's picture, the sky, Pose
here's Save, Paste T3D) is refused while the build runs, and so is its answer when the build started while it was
on its way, or when it comes while the map is being opened again after the build: the tool says so and nothing
changes (make it again when the map is open). A change a tool window or a menu command would still make is taken
back at once, and Messages says so, so the map stays the one being built (the build would not have it, and reloading
the map after it would lose it). The AI assistant's changes wait too (it is told a Rebuild runs). Save, Play, View
in game, Install, opening another map, closing this one and switching projects wait too, and a second Rebuild
cannot start (the server refuses it, from another tab as well) until this one ends. If the map cannot be saved
first, nothing is built, and Messages says so.

**Cancel** stops the build's own engine process (a map made by a script: the script and the engine it
started), never anything else and never the game, and puts the map's last build back: the 3D view, the
**Lit** view, Play and Install see the map exactly as before you pressed Rebuild. Your saved changes stay
saved, ready for the next Rebuild. Pressed while the map is still being saved or its walkable area made,
the build does not start at all. A build that compiles the project's player characters first (*Map
settings > Player characters*) stops when its engine starts.

At the end **Messages** gets the build's lines and a **Build report** on top of them: the time of each stage
(where the minute went: lighting or paths), what the engine counted (BSP nodes and surfaces and the zones
it found, after CSG; the lights it lit with; the AI path points, the reach specs it made and pruned and the
map's own links it put back), and the warnings (objects inside walls, zones that leak, stretched textures,
edits skipped...), each with a **Check map** link that opens Check map on the map just built.

### Play from here

**Play from here** opens the game on this map with JC standing on the floor below the camera,
looking where you look, and then the controls are yours: walk around, talk, test a dialogue or an
event. In its window (**Play settings...** in the Map menu and under the arrow between Rebuild and Play) you
choose, besides a play scenario (below):

- **Mission state**: *the map as it starts*.
- **Other flags**: any flag, as `Name=1` or `Name=0`, separated by commas.
- **Play in**: *Editor* (the game plays inside the editor: see *Play in the editor* below) or *Game window*
  (the game's own window). The **Play** button plays in the editor; **Play in editor** and **Play in game
  window** are also in the Map menu and under the arrow.

Play first saves the map and its Story, then prepares a temporary copy of the map for the game, so the map you
edit stays as it is: your latest dialogues are compiled into the project's package, the map is built with your
changes and the packages are installed in the game, each only when something changed (see *Play preparation*
below). On a test PC JC can move about 6 to 9 seconds after you press Play in Revision when the map has not
changed (13.6 seconds in earlier versions of the editor), and about 6 seconds in the original game (34 seconds in
earlier versions, which left DirectDraw on). Most of that time is the game's own start: Steam takes a second or
two to start it and the game a few seconds to load the map, while the editor's part, before Steam starts the
game, is under a second. A changed map adds its build.

For existing maps, **Install** keeps the previous copy in `maps\backup\`, refuses if your copy was changed by
something else since your rebuild, and archives the changes, which are now part of the map.

### Play in the editor, Stop and full screen

**Play** (or **Play in editor**) runs the game inside the editor, in the **Game view** over the 3D view; it needs
the DeusEdix app (in a browser, use **Play in game window**). Click the game to play; `Shift+F1` or **Release
mouse** gives the mouse back to the editor.

- **Your game's settings stay yours.** Every Play starts the game in a window, on its own copies of the game's
  settings files (Revision: `Revision.ini` and `RevisionUser.ini`; the original game: `DeusEx.ini` and
  `User.ini`), made from yours at each Play and removed after it. A Play never changes your own files: not your
  full-screen choice, your window size, your key bindings or the map your main menu shows, and the game saves in
  a save folder kept for the project, not in yours. Settings you change inside the game during a Play are not
  kept. The copies also turn DirectDraw off, which a game in a window does not need (with it on, the original
  game waited up to half a minute before its window opened).
- **No white flash.** While the game starts, the editor's window stays in front of the other windows, so the
  game's start-up screens and its window, white for a moment before its first picture, stay behind it: maximize
  the editor to hide them completely. This happens only when the editor is in front as the game starts, and it
  ends as soon as you switch to another program (Steam and your browser too) or click the desktop, when you
  minimize the editor, when the game shows an error box (which then comes to the front), and after 60 seconds
  at the latest. The game appears in the Game view about a second after its first picture. **Play in game
  window** shows the game's own start as it is.
- **Stop** (in the Game view's header) closes the game where it is: it asks the game to quit as its own menu's
  Quit does, so it closes in about a second and nothing is left behind. Only a game that does not close within a
  few seconds is closed by force. The game never changes your map: your edits stay as they were.
- **Continue in game window** moves the game out of the editor into its own window, in front of the others, and
  you play on there; **Stop** still closes it. The Game view offers it when it cannot show the game (the game
  opened full screen, keeps changing its window, or could not be taken in), with **Retry embedding** where that
  can help.
- **Full screen** works only in the game's own window: press `Alt+Enter` there (with **Play in game window**, or
  after **Continue in game window**). It lasts for that Play: the next one opens in a window again. `Alt+Enter`
  pressed while the game plays inside the editor first moves it into its own window, then switches it to full
  screen there. Full screen turned on in the game's video settings while it plays inside the editor stops the
  game with an error: the Game view says so and offers **Stop**.
- **A mod played from the Mods list** (**Projects > Mods > Play**) also starts on its own copies of the settings,
  but as you play the game yourself: full screen if you play full screen.
- If the editor ends unexpectedly while a game plays inside it, the game ends with it; a game in its own window
  keeps running.

### Play preparation: only what changed

Play leaves out what is already done. The compile of the project's package, the build of the map and the
install of the packages into the game are each left out when nothing they are made from has changed since they
last succeeded, and **Messages** says so: *Package unchanged since it was last compiled: not compiled again.*,
*Map unchanged since the last Play: not rebuilt.*, *Packages unchanged since the last Play: not installed
again.* The preparation of an unchanged map then takes less than half a second.

- **What counts as a change** is anything the map's build reads: the map itself (its script or `.dx`) and its
  saved changes, prefabs, imported textures, characters, models, animations, sounds and voices, the Story, the
  project's player character, the packages of other mods the project uses, the project's own packages and the
  editor itself (after an update of the editor each map is built once more). The map's own script, `.dx` and saved
  changes and the player character are compared by their text, so the same text saved again is no change there.
  Saving another map's changes or installing another map does not count (its Story does), nor do the editor's
  caches, the catalogs it fills from the game, or the file Steam rewrites at every start.
- **A Rebuild counts as Play's build**: after a Rebuild, in any mode, the next Play of the unchanged map does not
  build it again. A Rebuild in Full, Lighting or AI paths (the arrow beside Rebuild, or the Map menu) is
  remembered: when the map has to be built again, Play builds it the same way and says so, until you Rebuild in
  Automatic. A cancelled Rebuild leaves the map as it was (a player character's package compiled before the
  cancel is kept).

### Play scenarios and JC's loadout

As Unity's Play mode scenarios, a **play scenario** is a way to start Play kept under a name in the project, for
every map of it. The list right of **Play** in the menu bar chooses the one Play starts with: **Camera** (none: JC
below the camera, as the game starts him), one of the scenarios, or **Edit scenarios…**, which opens the Play window.
There **Scenario** picks the one to change; **Save** keeps the changes in it, **Save as…** keeps them under a new name
(a name already used is replaced; at most 30 scenarios) and makes it the one Play starts with, **Delete** deletes it.
**Play** in the window plays the choices as they are, kept or not. A scenario keeps:

- **JC starts**: *below the camera* (where you look when Play starts), *at the PlayerStart* (or where the mission
  preset puts him), or *at a point kept with the scenario*: **Here** keeps the place below the camera and where it
  looks. A point belongs to its map: on another map JC starts below the camera.
- the **Mission state** and the **Other flags**, as above;
- **JC's loadout**: **Items** (weapons, ammo and pickups of the game and of your project, each with how many: ammo is an
  item of its own), **Augmentations**, **Skills** (each at a level, *Untrained* to *Master*), **Skill points**,
  **Credits**, **Health** (1 to 100, every part of the body) and a **Cheat**: *God* (he takes no damage) or
  *Invisible* (enemies do not see him). An empty field is as the game starts him.

The game gives the loadout with its own console commands, before you get the controls. The items lie on the floor
in front of JC, not in his inventory (pick them up), at most 40 of them. Where JC starts says how: *below the
camera* or *at a point*, they are laid in rows across his view, each one taking half a second before you get the
controls; *at the PlayerStart*, the game's own `summon` puts each one in front of him, all at once with the other
commands. The rest goes straight on him. **Messages** lists every command Play sent (*Loadout: set DeusExPlayer bCheatsEnabled True | augadd AugCloak
| set SkillLockpicking CurrentLevel 3 | set DeusExPlayer Credits 500 | god*): `augadd`, `summon`, `god` and
`invisible 1` work only with the game's cheats on, which the loadout turns on for that game; credits, skill points,
health and skill levels are `set` on JC and his skills.

**Checked before Play**, as Unity checks a scenario: an item, an augmentation or a skill in neither the game nor your
project (a scenario from before a package was taken away), a mission preset that does not end in this map and a
point kept on another map are left out. The Play window says so under the loadout, Messages when Play starts, and
Play goes on without them; the server checks the classes again.

**While the game plays in the editor**, its header has **Pause** (the game's own pause), **Slow motion** (`slomo
0.25`; pressed again, `slomo 1`), **Ghost** (JC flies through walls; pressed again, `walk`) and **God**. Each sends
the game's console command through the Console's channel (the Console shows it) and stays pressed while it is on;
God starts pressed when the scenario gives it. The buttons wait for the game to run, and while the map is still
loading a command waits for it. The game keeps its speed in its settings (`slomo` saves it there), which during a
Play are the Play's own copies: the next game does not start slow.

### Known limits of Play

- After `Ctrl+Z` of a texture change made over another of your imported textures and already put in by a Rebuild,
  the next build (Play's or a Rebuild's) can show those objects with their original texture, and the Plays after
  it keep it: press **Rebuild** once more.
- In Revision, a new texture on an object that Revision draws with its own high-definition (HDTP) model (boxes,
  trash cans, baskets, some lamps and the like) does not show in the game, though the editor shows it.
- A texture put on **All uses in this map** (Texture Editor) reaches an object given another model, or one with a
  model of its own written into a map script since the last build, only from the second build, and the first
  build may put it on the part the old model wore it on, which then keeps it. Give the object its new model and
  Rebuild before you put the texture on every object; if a part took it by mistake, take the texture away,
  Rebuild, then put it on again. On an existing (`.dx`) map, an object of a pasted prefab with a model of its own
  is never reached.

## Where things are kept

Everything is in DeusEdix's folder (`%LOCALAPPDATA%\Programs\DeusEdix`), except the maps you install:

| | |
|---|---|
| `tools\mapkit\maps\<map>.edits.json` | your changes to a map |
| `maps\` | your maps; **Install** copies them into the game's `Revision\DeusEdixMaps` folder |
| `tools\mapkit\story\<map>.json` | the map's story; `UCEd_<map>.uc` in `src\DeusEdix\Classes` is generated from it |
| `tools\mapkit\textures\<map>\` | the pictures you imported or made in the Texture Editor; `textures\_library\` = My textures |
| `tools\mapkit\prefabs\` | what you copied with `Ctrl+C` |
| `tools\mapkit\maps\templates\` | your map templates (File > Save map as template...): a folder each with its edits, picture, the pictures it uses and, for a copied map, that map's file |
| `tools\mapkit\anims\` | the Animation Studio's animations, skeletons (`rigs`) and frames (`baked`); `dist\DeusEdixAnims.u` is made from them |
| `tools\mapkit\editor\cache\` | what the editor computed (models, textures, animations of the game, AI paths, class defaults); safe to delete |
| `tools\mapkit\editor\cache\game-revision\`, `game-vanilla\` | what is made from the game itself, once for every project of that game (object models and previews, the maps read for the Pieces, texture pictures, conversations, voices, animations, characters): a new project opens with it ready; safe to delete |
| `DevInstall\` | the workspace made from your game (links to its folders, copies of its settings) |
| `logs\` | what the program did, for when something goes wrong |

When you install a project, DeusEdix puts its maps in a folder of its own inside the game
(`DeusEdixProjects`) and adds it to the game's settings (`Revision.ini`, or `DeusEx.ini` for the original
game), so the game reads your maps before its own (a backup is kept: `Revision.ini.bak_projects`). The
installer also puts `DeusEdixNav.u` and `DeusEdixNav.dll` into each game's `System` folder: the characters of
DeusEdix maps and mods use them to find their way.

To uninstall DeusEdix, use **Start > Uninstall DeusEdix**, Windows' installed apps, or run the installer again
and choose **Uninstall**. It always takes DeusEdix's lines out of the games' settings and removes the workspace
and the caches. It also asks whether to remove everything else DeusEdix put into the games (the maps, saves and
mods it installed, and DeusEdixNav, which mods made with DeusEdix need); that is kept unless you tick it. Your
projects are never removed: they stay in the `Projects` folder for a later install.

## AI assistant (MCP)

An AI assistant can work in the editor with you: look at the open map, find objects, place and move them, change
their properties, write and play-test dialogues, save and rebuild. It goes through **MCP** (Model Context
Protocol), so any assistant that speaks it can connect: Claude Code, or another MCP client.

1. **Tools > AI assistant...**: tick **Let an AI assistant use this editor**. Until you do, no assistant can reach
   the editor; untick it and none can any more.
2. Connect the assistant once. The same window shows the command for your PC, for Claude Code:
   `claude mcp add deusedix -- "<DeusEdix>\deusedix-cli.exe" --run "<DeusEdix>\tools\mapkit\deusedix_mcp.py"`
   (the dialog shows your own folders as `%LOCALAPPDATA%`..., so a screenshot of it does not show your Windows user
   name; **Copy**, or copying the text, gives the real command)
   Other assistants start the same command as an MCP server (stdio).
3. Open a project and a map in DeusEdix and ask the assistant. The window says when it last called.

What it does happens in the editor as if you clicked: you see it at once, it is **unsaved** and **Ctrl+Z** takes
it back, until it or you save. It works on the project open in DeusEdix, and only while its page is open. When the
editor would ask you to confirm (deleting objects a mission uses), the assistant is told the question and has to
ask again saying yes. Its tools:

| | |
|---|---|
| `editor_state`, `list_maps`, `open_map` | what is open, unsaved changes, the selection, the last messages; open a map (with unsaved changes only if told to save or to discard them) |
| `find_objects`, `get_object`, `select_objects` | the map's objects by text, class or distance; one object's properties; select them and bring the camera there |
| `find_classes`, `find_textures` | what can be placed (as the Objects browser lists it), the game's textures by name |
| `place_object`, `move_object`, `set_properties`, `delete_objects` | as the Objects browser, the gizmo and the Inspector do; a block (`cls` "block") and a drawn piece's settings and textures too |
| `draw` | a wall, road, floor or ceiling through its points, stairs or a roof from A to B, as **Map > Draw** |
| `batch` | several of these in one call, in order, stopping at the first that fails |
| `undo`, `redo`, `save`, `rebuild` | as **Ctrl+Z**, **Ctrl+Y**, **Save** and **Rebuild** |
| `view` | a picture of the 3D view, from where the camera is, from a point towards another, or framing an object; without the gizmo and icons, Lit, Unlit or Shaded |
| `story_list`, `story_get`, `story_write`, `story_play` | the map's dialogues, one with its graph, change one or make a new one, **Play-test** it with flags and answers |
| `run_js`, `project_api` | advanced: the editor's page and the project's server, for what the other tools do not do |

**Advanced tools.** `run_js` (JavaScript in the editor's page) and `project_api` sending changes to the project's
server can do whatever the editor can. They work only while **Also allow advanced tools** is ticked in the same
window; otherwise `project_api` only reads. Keep them off unless you need them: an assistant reads the text of maps,
dialogues and mods, and text written by someone else could try to steer it ("prompt injection"). Without them, the
worst such text could make it do is an undoable, unsaved change.

**What keeps it safe.**
- The editor answers this PC only. It listens on `127.0.0.1`, and it refuses any request addressed to another
  name or sent by another site's page. A web page cannot reach it, even one that points its own name at your PC
  (DNS rebinding).
- Every request needs the session of the editor that is running, a new random one each time it starts.
- The editor's address and session are in `assistant.json` in your `AppData\Local\DeusEdix` folder, only while
  assistants are allowed. Unticking the box deletes them, and the editor checks the box at every call, not only
  the file.
- Each tool tells the assistant what it does. One that reads can be let through. One that loses or overwrites
  something (deleting, saving, Rebuild, discarding changes, rewriting a dialogue) is marked, so an assistant like
  Claude Code asks you first.
- While the assistant works, a badge in the corner of the editor says what it is doing.

## Local geometry (Experimental)

Enable **Settings > Editing > Local geometry (Experimental)**, then choose **Map > Local geometry (Experimental)** or the same command in the Rebuild menu. The tool opens a separate window with a private copy of the map currently shown. Rebuild normally first if you want to include saved editor changes; those changes are not applied automatically inside this tool. The temporary tutorial does not use it.

Select a source brush and enter its movement, scale or rotation. These transforms use that brush's pivot. **Before / After** show the compiled geometry after verification. The default **Area · Full check** reconstructs the affected area and still uses a Full rebuild to check the result. **Isolated box**, **Convex CSG** and **Buried detail** offer independent verification without Full only for supported geometry. Unsupported changes are refused; a successful edit on one brush does not imply that every edit on the map is supported.

It works the same for Deus Ex: Revision and the original Deus Ex. What the modes without Full accept: **Isolated box**, a plain box floating inside one room, on a map of at most 24 plain boxes; **Convex CSG**, a map of at most 24 plain convex brushes, lit or not, with one room and no portals, and an edit whose area leaves out at least one other brush; **Buried detail**, one detail (semisolid) brush that only grows inside solid. On a lit map the faces a result rebuilt have no light until you rebuild **Lighting**.

Results are experimental copies outside the normal project build. **Show result** opens their folder; **Continue from result** starts another edit from the verified copy. To keep one in your project, use **Open map > Browse .dx** to import it as a new map. Rebuild its **Lighting** and **Paths** before Play or Install. The tool does not replace the project's map or install a result automatically. Verification can take a few minutes and this preview is not a speed guarantee.

The feature uses the engine from your installed game. No game maps, packages, textures or engine DLLs are included in DeusEdix.

## Limits

- Some original maps cannot be rebuilt (Wan Chai Street): only objects can change there.
- A map's BSP has a limit (65536 nodes): Rebuild optimises it as UnrealEd did, so the big maps of
  Revision stay under it; a map that still goes over says so in Messages (fewer or simpler blocks there).
- Stretching a structure of an existing map needs a rebuild of its geometry, so it works only
  where the map can be rebuilt.
- The Animation Studio works on human characters (the skeleton has hips, spine, head, arms and
  legs): animals and robots can play and use the game's animations, not new ones. The fingers and the
  face do not move (Deus Ex has no bones for them: the mouth is the game's lip sync).
- New animations are as smooth as the frames of the model allow: a character with few vertices (the
  original models) bends at the joints like the game's own animations do.
- Original maps that cannot be rebuilt (Wan Chai Street) cannot get Pieces either (they need a
  rebuild of the geometry); a copy of such a map has the same limit.
- Characters of the Creator have no barks (the short lines the game's characters say by
  themselves) and keep the bodies of the game: new 3D models cannot be imported.
- The editor does not make voices by itself: record or import them for each line (see *Voices*).
- The **Lit** view is close to the game but not identical: lamps that flicker or pulse are shown
  steady (a flickering lamp lit, even in a Revision project, whose renderer leaves it dark) and coronas and zone fog
  are not drawn unless **View > Effects** is on, and then the walls take an estimate of each lamp's share (their
  lightmaps hold every lamp together), palette lamps and light effects (torch, searchlight) stay steady, a corona is
  a glow of its lamp's colour rather than its Skin texture and only walls hide it (in the game objects do too), and
  volumetric fog is not drawn; some objects can have a different skin in the game.
- Animations move objects, not characters (their AI walks them: give them orders and patrols). The keys of
  a door or an elevator are the engine's: at most 8, and the same curve for all of them.
- Imported models do not move by themselves (no skeletal animations: characters are made with the Character Creator), and their
  collision is a cylinder round them (untick *Solid* for a long table JC should reach over). A map that uses
  them needs `DeusEdixModels.u` (Install puts it in the game).
- **Hear the map** plays each sound as it is: no zone reverb, no walls in between, no Doppler. Robots and fires,
  whose Properties have no Sound, are heard only if the map gives them one. A zone's **Reverb** is heard only in the
  game, with an audio that plays reverb (Galaxy, or Revision's OpenAL audio with its reverb on).
- A zone works only when its area is closed: walls and zone portals all round. Water and portals change the
  geometry: they need a map that can be rebuilt.
- Interactions, stories, cutscenes and the editor's characters run through DeusEdix's package
  (`DeusEdix.u`, which Install puts in the game): a map that uses them needs it.
  Security cameras give no event when they see JC (the game has none): use a zone instead.
- A door opened by an interaction or a Story action behaves as when JC opens it (it triggers its Event
  when it has opened): a door that shuts by itself after some
  seconds (*stays open*) shuts again.
