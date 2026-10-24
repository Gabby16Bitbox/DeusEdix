# DeusEdixNav: the walkable area's routes in C++

When a map sends a character somewhere "on the walkable area" (an Interaction's Walk / Run to a place, a Story
action, `class'UCNavRoute'.static.Send` in a script), the game asks the map's `UCNavMesh` for the route. The search
runs in C++: `UCNavNative.Route`, in the package **DeusEdixNav** (`DeusEdixNav.u` and `DeusEdixNav.dll`). It does
A* over the polygons the editor baked (Recast, View > Walkable area), then the funnel, which gives the straight
line that cuts the corners, as Detour does.

`UCNavMesh` (runtime class of every project) now keeps only the map's data and the last route:

| Property | What |
|---|---|
| `NumPolys` | the polygons, at most 2048 |
| `Sides[2048]` (byte) | polygon p's number of corners, 3 to 6; 0 for a polygon left out |
| `CornerX/Y/Z[12288]` (float) | corner k of polygon p at `p * 6 + k`, Unreal units, on the floor |
| `Across[12288]` (int) | the polygon across the edge from corner k to k + 1, or -1 |
| `Corner[64]`, `NumCorners` (transient) | the last route, written by the C++ |

`editor/navbake.py` writes them as numbers when the map is rebuilt. Earlier versions kept each polygon as a string,
parsed in UnrealScript at the first route, plus UnrealScript copies of everything for the search. Per map,
`UCNavMesh` took about 420 KB plus the strings; now it takes about 200 KB. UnrealScript has no dynamic arrays, so
the arrays have the size of the largest walkable area.

## Files

| File | What |
|---|---|
| `NavRoute.h` | the search and the funnel: plain C++, no engine header |
| `DeusEdixNav.cpp` | the DLL: `UCNavNative`, reads a `UCNavMesh`'s arrays where they are (properties found by name once per class, checked for type and size) |
| `DeusEdixNav/Classes/UCNavNative.uc` | the class, `native static final function int Route(Object Mesh, vector From, vector To)` |
| `build_native.ps1` | builds `bin/DeusEdixNav.dll` and `bin/nav_test.exe` (Visual Studio Build Tools, the SDK headers) |
| `build_package.py` | builds `bin/DeusEdixNav.u` with the editor's engine (`--make`), in a private run |
| `nav_test.cpp` | `NavRoute.h` alone, for the checks |
| `check_routes.py`, `edge_cases.py` | the checks (below) |

## What the engine requires (each point tested)

- **The DLL must be in the game's System folder,** the folder of `Revision.exe` or `DeusEx.exe`. The `.u` can be
  anywhere in the Paths, but the engine looks for a package's DLL only there. With the DLL next to the `.u` outside
  System, the engine stops: `'DeusEdixNav' is not a DLL package; can't find export 'intUUCNavNativeexecRoute'`.
- **A missing DLL is a critical error,** raised when the package loads, and the compiler stops the same way.
  UnrealScript cannot check for the file first, so a script fallback is not possible. DeusEdixNav is a required
  file, like any `.u`.
- **One DLL serves both games.** Revision rebuilt Core.dll and Engine.dll, but they export exactly the same names
  as the original game's (Core 2005, Engine 2370, no difference). The DLL bound in Revision itself, and with the
  original game's Core.dll in the editor's engine.
- **The DLL links to Core alone.** `UCNavNative` extends `Object`, not `Actor`, because Revision's rebuilt Engine
  may not have the SDK's `Actor` layout. `IMPLEMENT_CLASS` is written out by hand: its `_MSC_VER` branch only
  compiled with Visual C++ 6.
- **The compiler loads DeusEdixNav, with its DLL, before the package that uses it.** It must be in the
  `EditPackages` before that package.

## Where DeusEdix puts it

| Where | What |
|---|---|
| The editor's engine runs (`kit.new_run`, `editor/convert.py`) | DeusEdixNav.u and .dll copied into the run's System |
| A project's workspace (`workspace.py`) | copied into its System; `EditPackages=DeusEdixNav` before the project's package; part of the runtime's fingerprint |
| Play / Install (`workspace.install`) | both files into the game's System folder (`kit.install_native`) |
| A `.dxmod` | never: a mod file does not carry a DLL. Installing a mod puts DeusEdix's own build in the game's System |
| A new project (`projects.py`) | the two files with the host |
| The mod's scripts (`build.ps1`, `make-ini.ps1`, `install.ps1`, `tools/build_vanilla.ps1`, `install-vanilla.ps1`) | the same for its Revision and original-game builds |

## Tests

### 1. The C++ against the UnrealScript it replaced: `check_routes.py`

`ScriptRouter` is the UnrealScript version of `UCNavMesh` (Load, Inside, PolyDist, FindPoly, the heap, FindWay,
Portal, AddCorner, MakeCorners, Route), written again line for line. Every operation is rounded to a 32-bit
float, as UnrealScript computes it. For each route, the corners from `nav_test.exe` must be the same floats.

Test set: the baked walkable area of a project map (25 polygons) and four mazes of 41 to 1344 polygons (grids
with holes, ramps, cells cut into triangles).

Result: 2,800 routes, 14,197 corners, all identical.

One limit: in the game, `VSize` adds its squares in the x87's extended precision. Where UnrealScript used it (the
20-unit inset of a corner, the last corner's check), a corner may differ in the last bit of a float, about a
millionth of a unit.

### 2. The edges: `edge_cases.py`

Each case must give the same result as the UnrealScript. Every route must also end at its place, have at most 64
corners and contain no NaN. All cases pass.

| Walkable area | Polygons | Queries | No way | Most corners |
|---|---|---|---|---|
| strip: border, edges, heights | 10 | 24 | 6 | 2 |
| grid: shared corners | 64 | 45 | 0 | 7 |
| grid: mixed winding | 64 | 200 | 0 | 5 |
| fan: one corner for all | 6 | 44 | 0 | 4 |
| floors over floors (switchback) | 7 | 8 | 1 | 5 |
| degenerate polygons | 7 | 8 | 1 | 3 |
| wrong data | 6 | 6 | 4 | 1 |
| islands | 2 | 3 | 2 | 1 |
| spiral | 479 | 3 | 0 | 58 |
| serpentine: 90 turns | 404 | 2 | 0 | 64 |
| a corridor 10 wide | 10 | 3 | 0 | 1 |
| ramps under the corners | 36 | 2 | 0 | 5 |
| 2560 polygons | 2048 | 4 | 2 | 10 |
| no polygons | 0 | 1 | 1 | 0 |

What the routes do at the edges. All of it is the same as the UnrealScript version, except the last point:

- **Off the area.**
  - A start or end up to 200 units off the border snaps to the nearest polygon; at 201 there is no route.
  - In height, a place counts on a polygon from 40 units below its lowest corner to 140 above its highest. In the
    test: -39 and +139.75 route, -41 and +140.25 do not.
- **On shared edges and corners.** A place exactly on a shared edge or corner belongs to one polygon (the nearest
  in height, then the first) and routes normally.
- **A corner shared by many polygons.** Corners keep 20 units from the end of every edge the route crosses, even
  an end shared by walkable polygons. In a fan, a route across the shared corner wiggles 20 units round it instead
  of going straight through.
- **Floors over floors.** The polygon whose middle is nearest in height (45 units over its floor) is taken. Between
  two floors 256 apart, a place has no polygon from 140 over the lower floor to 40 under the upper one. A route from
  the lower floor to the upper one goes up the ramp: 5 corners in the switchback.
- **Thin and huge polygons.** A sliver 1 unit wide is walked through. A corner moves into its edge by 20 units, by
  half the width when the edge is narrower than 40, and not at all at 1 unit or less: here it stays at the end. A
  100,000-unit polygon routes.
- **Wrong links** are ignored: -5, 9999, a polygon's link to itself, a link to a left-out polygon. A link one way
  only is followed one way only. A polygon with 2 or 7 sides is left out.
- **Islands.** No route. `UCNavRoute.Send` returns False and `NpcWalk` falls back to the AI paths (`NpcGo`).
- **More than 63 turns.** A route keeps the first 63 corners, then its place. The character follows them and, held
  up on the last leg, asks for the way again from where it is (`UCNavRoute`).
- **More than 2048 polygons.** Only the first 2048 are used; `navbake.py` writes no more than that.
- **Polygons with no area.** A point or a line seen from above passes the inside test anywhere near it, so it could
  take a start that belongs to a real polygon. Recast never makes one, and since 24 Oct 2026 `navbake.fields`
  leaves them out (`Sides` 0).

### 3. In the game

Revision, 24 Oct 2026, on a test map (`maps/zz_navmesh_test.py`): a room with a pillar, its walkable area a ring
kept 40 units from the walls, a UNATCO trooper. The photographer (`UCShotRunner`) has two actions for this:
`navroute` writes a route's corners in the log, `navgo` sends a character.

- **Loading:** `Bound to DeusEdixNav.dll`, `UCNavMesh: 8 polygons`.
- **Routes:** 5 routes in the game (round the pillar both ways, inside one polygon, off the map, across) gave the
  same corners as `nav_test.exe` and the UnrealScript model.
- **Walking:** the trooper, sent to the opposite corner, walked round the pillar (GoingTo, 4 points). Sent back
  running, he arrived 5 units from the place and stood.
- **A lesson from the first try.** A walkable area drawn by hand that touches the walls sends corners 20 units
  from a wall, and a character 20 wide scrapes it and is held up. Recast keeps the area a character's width from
  the walls, which is why the editor's bake works.

### 4. Speed

`nav_test.exe`, 5000 routes on 2048 polygons: 0.03 ms a route, reading the area included. The same steps in the
Python model take 4.7 ms a route on 1311 polygons. The UnrealScript version was not timed in the game.

## Building

```
powershell -File native\build_native.ps1      # DeusEdixNav.dll, nav_test.exe (needs the SDK headers: dev\prepare_sdk.py)
python native\build_package.py                # DeusEdixNav.u
python native\check_routes.py                 # the C++ against the UnrealScript steps
python native\edge_cases.py                   # the edges
```
