# The host's protocol

This is the contract between the map editor (Python, `mapkit/kit.py`) and the headless host. Any backend that
implements it can replace the host, whether it is the host with another engine bridge (`bridge.h`) or a
different program. The source of truth is the code: each command's function in `UCEngineBridge.cpp` repeats its
part of this page above it.

## Session

- **Starting it:** `UCMapKitHost.exe [--bridge <dll>] -` starts a session on stdin. With a file instead of `-`,
  the host runs that file's commands and stops at the first failure (exit code 4).
- **Compiling:** `UCMapKitHost.exe [--bridge <dll>] --make [ini]` runs the UnrealScript compiler. The exit code is
  0 on success, 5 on errors and 7 on a crash. The last line is `Success - N error(s), M warnings` or
  `Failure - ...`.
- **Commands:** one per line, in UTF-8. Words are separated by spaces or tabs, and a numeric word must be a
  whole, finite number. Empty lines and lines starting with `#` are skipped. `UC_QUIT` ends a session.
- **Answers:** stdout lines of the form `UCMapKit|<what>|<fields>`, with the engine's own log lines in
  between. For each command:

  ```
  UCMapKit|command|<the line>
  ... the command's answers ...
  UCMapKit|failed|<the line>        when it failed
  UCMapKit|actors|<count>           when a level is loaded
  UCMapKit|complete|<ms> ms
  UCMapKit|ready                    in a session
  ```

- **Other lines:**
  - `UCMapKit|initializing SDK` comes first, and `UCMapKit|ready` once the engine is up.
  - `UCMapKit|fault|0x<code>` means the engine crashed in a command. The session goes on.
  - `UCMapKit|av|<module>+0x<offset>|read|write 0x<address>` reports an access violation, for diagnostics.
- **Other lines:** any line that is not a `UC_` command is UnrealEd's own: `MAP LOAD FILE=...`,
  `BRUSH ADD`, `BSP REBUILD`, `LIGHT APPLY`, `PATHS DEFINE`, `MAP SAVE FILE=...` and the rest.

## Files

Every file a command writes is **JSON lines**: one JSON object per line, in UTF-8. Numbers keep a fixed
precision: 6 significant digits, unless a key below gives decimals (`.1`, `.2`, `.3`, `.4`). Rows with a
`kind` key come in several shapes in the same file. Two files carry binary data after a JSON header line:

- `UC_TEXDUMP`: the line `{width, height}`, then `width * height` RGBA pixels (4 bytes each), row by row.
- `UC_ANIMDUMP`: the header line, the line `data`, then the arrays (little endian):
  - faces `{uint16 wedge0, wedge1, wedge2, material}`;
  - wedges `{uint16 vertex, uint8 u, uint8 v}`;
  - special faces, like faces;
  - vertices `{int16 x, y, z}`, frame after frame.

## Commands

| Command | Answers | File rows |
|---|---|---|
| **Level geometry** | | |
| `UC_POINT x y z` | `point\|x y z\|leaf N\|zone N\|<zone name or none>` (leaf -1: in solid) | |
| `UC_TRACE x0 y0 z0 x1 y1 z1` | `trace\|hit\|x y z (.2)\|nx ny nz (.3)` or `trace\|none` | |
| `UC_BSPDUMP <file>` | `bsp\|N polygons` | `{texture, flags, base, textureU, textureV, pan [u, v], size [w, h], vertices [x, y, z, ...], brush, surface, brushPoly}` |
| `UC_BRUSHES <file>` | `brushes\|N` | `{ord, name, csg, flags, group, location, rotation [pitch, yaw, roll], prePivot}` |
| `UC_UNLINK <model prefix>` | `unlink\|N brushes\|N polygons` | |
| `UC_WORLD finish` | `world\|N nodes\|N surfs\|N zones` | |
| `UC_SIZES <file>` | | `{class, radius (.2), height (.2)}` |
| `UC_ACTORS check` | `in solid\|class\|name\|x y z` ..., `actors\|N checked\|N in solid` | |
| **Lighting** | | |
| `UC_LIGHTDUMP <file>` | `lights\|N surfaces\|mapping N/N\|N objects lit by their floor` | see the first table below |
| `UC_LIGHTSTATS` | `lightstats\|lightmaps\|samples\|bytes` | |
| `UC_CAMERAS clear` | `cameras removed\|N` | |
| **Actors and properties** | | |
| `UC_SET <name> x y z pitch yaw roll` | `set\|ok\|name` or `set\|missing\|name` | |
| `UC_DEL <name>` | `del\|ok\|name` or `del\|missing\|name` | |
| `UC_PROP <name or @Class or @@Class> <property>[(index)] <value...>` | `prop\|ok\|missing\|noprop\|failed\|...`, for `@@`: `prop\|all\|Class\|N` | |
| `UC_TEXTHEX <name> <property> <hex of UTF-8>` | as `UC_PROP` | |
| `UC_SCALE <name> <factor>` | `scale\|ok\|name\|drawScale\|radius\|height` | |
| `UC_OBJPROP <object> <property> <value...>` | `objprop\|ok\|missing\|noprop\|failed\|...` | |
| `UC_MOVER <bounds\|prep> <name> x y z` | `mover\|name\|operation\|polygons` | |
| `UC_MESHES <file>` | `meshes\|N actors\|N triangles`, `mesh fault\|name` | `{actor, class, kind (mesh, mover), style, triangles [{texture, flags, corners [x y z (.2) u v (.4) x3], slot (meshes only)}]}` |
| **Surfaces** | | |
| `UC_SURFTEX <brush or *> <old texture or *> <new texture>` | `surftex\|ok\|brush\|N`, `surftex\|missing\|...`, `surftex\|notexture\|...` | |
| `UC_SURFACE <brush> <polygon or *> <mode> [args]`, where mode is floor, wall, tile, tile-u, tile-v, cylinder, pan x y, scale x y, rotate, flip-u, flip-v, texture <name>, shadows <low\|normal\|high> or flags <set> <clear> | `surface\|ok\|mode\|N`, `failed\|surface\|<reason>` | |
| **AI paths** | | |
| `UC_PATHS <file>` | `paths\|N points\|N links` | `{kind: point, name, class, location (.1)}`, `{kind: link, start, end, distance, flags, radius, height}` |
| `UC_NAVDROP <* \| name ...>` | `navdrop\|name\|z -> z`, `navdrop\|N checked\|N moved` | |
| `UC_NAVDROP temp` / `UC_NAVLIFT` | `navdrop temp\|...`, `navlift\|N of N back` | |
| `UC_KEEPPATHS save` / `restore` | `keeppaths\|N saved`, `keeppaths\|back\|a\|b`, `keeppaths\|N of N put back\|...` | |
| **Game content (read only)** | | |
| `UC_CLASSES <file>` | `classes\|N` | `{class, package, flags, drawType, mesh, radius (.2), height (.2), parents, itemName, familiarName, drawScale (.4)}` |
| `UC_DEFAULTS <file> <prop,prop,...>` | `defaults\|N` | `{kind: class, class, parents, properties [{name, index, type, value}]}`, `{kind: enum, property, values}` |
| `UC_CLASSPROPS <file> <class>` | `classprops\|N`, `classprops\|missing\|class` | `{kind: property, name, index, type, category, default}`, `{kind: enum, property, values}` |
| `UC_TEXDUMP <texture> <file> [largest side]` | `texdump\|info\|...`, `texdump\|ok\|missing\|nodata\|format\|...` | binary, see above |
| `UC_TEXFLAGS <file>` | `texflags\|N of N textures` | `{texture, flags}` |
| `UC_SOUNDS <file>` | `sounds\|N` | `{sound, bytes}` |
| `UC_MESHLIST <file>` | `meshlist\|N` | `{package, mesh, class, triangles, frames, sequences}` |
| `UC_ANIMDUMP <mesh> <file>` | `anim\|mesh\|N sequences\|N frames\|N verts` | binary, see above |
| `UC_SCRIPTDUMP <package> <file>`, `UC_TEXTDUMP <package> <file>` | `scripts\|N`, `texts\|N` | `{path, parent, text}` |
| `UC_CONDUMP <file>` | `condump\|N\|property errors N` | `{class, path, properties {name: text or null}, labels}` |
| `UC_CONSOUND <conversation> <sound id> <file>` | `consound\|conversation\|id\|found or missing` | one row added: `{conversation, id, sound}` |
| **Packages and models** | | |
| `UC_LOADPKG <path>` | `loadpkg\|ok or failed\|path` | |
| `UC_MESHIMPORT <package> <name> <aniv file> <data file> [old [lod]]` | `meshimport\|name\|ok\|N verts\|N frames\|N faces` | |
| `UC_SAVEPKG <package> <file>` | `savepkg\|file\|ok` | |
| `UC_ANIMNEW <source mesh> <package> <name> <file>` | `animnew\|package.name\|N sequences\|...` | reads a file: the line `{sequences: [{name, group, frames, rate}]}`, the line `data`, then int16 xyz frames |
| `UC_ANIMSAVE <file>` | `animsave\|file\|ok` | |

The rows of `UC_LIGHTDUMP`:

| Row | Keys |
|---|---|
| `kind: surface` | `surface, size [w, h], pan [u, v], scale [u, v], rgb [r, g, b, ...]`: the lightmap, row by row, lighting 0..2 as 0..255 |
| `kind: light` | `location (.1), colour (.4), radius (.1), effect, direction (.4), cone`: every light, numbered from 0 in order |
| `kind: actor` | `actor, light (.3), ambient (.3), lights [numbers]`: how a mesh actor or mover is lit |
| `kind: mapping` | `fit, checked`: surfaces whose polygons fall inside their lightmap |
