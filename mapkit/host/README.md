# UCMapKitHost

The headless host: a console program that runs the editor engine that comes with the game (`Editor.dll`, the
engine UnrealEd uses) without a window. The editor's server starts it through `mapkit/kit.py`, sends it
commands and reads its answers. Everything is in `UCMapKitHost.cpp`.

## Running it

| Command line | What it does |
|---|---|
| `UCMapKitHost.exe <command file>` | Runs the file's commands, one a line. It stops at the first one that fails (exit code 4). |
| `UCMapKitHost.exe -` | Interactive: commands on stdin, each answered by a block ending in `UCMapKit\|ready`. A failed command is reported and the session goes on; `UC_QUIT` ends it. |
| `UCMapKitHost.exe --make [DeusEx.ini]` | The UnrealScript compiler (`Editor.MakeCommandlet`), as `ucc make` runs it: every package of the ini's `EditPackages` whose `.u` is missing. |

`kit.Session` runs it in a folder of its own whose `System` links to the game's files, so the game's own
folders are only read.

## The flow of a command

`main()` starts the engine (`appInit`, then a `UEditorEngine`), makes the two in-memory fixes described
below, and then reads one line at a time:

1. It prints `UCMapKit|command|<line>`.
2. `runCommand()` splits the line into its words (`Args`) and looks the first one up in the `Commands` table,
   which gives each `UC_...` command its function. Anything else goes to UnrealEd's own command line
   (`GEditor->Exec`: `MAP LOAD`, `BRUSH ADD`, `BSP REBUILD`, `LIGHT APPLY`, `MAP SAVE`...).
3. The command runs inside a structured exception handler. A crash in the engine becomes
   `UCMapKit|fault|<code>` (with `UCMapKit|av|<module>+<offset>` for an access violation) instead of
   ending the session.
4. It prints `UCMapKit|actors|<count>` and `UCMapKit|complete|<milliseconds>`.

Answers are lines of the form `UCMapKit|<what>|<fields...>` on stdout. The engine's own log lines
come in between, in UTF-8.

Larger results go to a file named in the command. Every such file is **JSON lines**: one JSON value a
line, written with nlohmann/json through `JsonLines`, and read on the Python side with `kit.rows()`. Two
of them carry binary data after a JSON header line:
- `UC_TEXDUMP`: the RGBA pixels;
- `UC_ANIMDUMP`: the model's arrays, after the line `data`.

The comment above each command's function lists the keys of its rows. Numbers keep the precision the
dumps always had (`digits()`, `decimals()`), so the editor reads the same values and the files stay small.

## Commands

| Group | Commands |
|---|---|
| Level geometry | `UC_POINT`, `UC_TRACE`, `UC_BSPDUMP`, `UC_BRUSHES`, `UC_UNLINK`, `UC_WORLD finish`, `UC_SIZES`, `UC_ACTORS check` |
| Lighting | `UC_LIGHTDUMP`, `UC_LIGHTSTATS`, `UC_CAMERAS clear` |
| Actors and properties | `UC_SET`, `UC_DEL`, `UC_PROP`, `UC_OBJPROP`, `UC_TEXTHEX`, `UC_SCALE`, `UC_MOVER` |
| Surfaces | `UC_SURFTEX`, `UC_SURFACE` |
| AI paths | `UC_PATHS`, `UC_NAVDROP`, `UC_NAVLIFT`, `UC_KEEPPATHS` |
| Game content (read only) | `UC_CLASSES`, `UC_DEFAULTS`, `UC_CLASSPROPS`, `UC_TEXDUMP`, `UC_TEXFLAGS`, `UC_SOUNDS`, `UC_MESHES`, `UC_MESHLIST`, `UC_ANIMDUMP`, `UC_SCRIPTDUMP`, `UC_TEXTDUMP`, `UC_CONDUMP`, `UC_CONSOUND` |
| Packages and models | `UC_LOADPKG`, `UC_MESHIMPORT`, `UC_SAVEPKG`, `UC_ANIMNEW`, `UC_ANIMSAVE` |

Each command's arguments and output are described in the comment above its function.

## Reading and writing the engine's data

- **SDK headers.** The host compiles against the headers of the Deus Ex SDK 1112f, including those of the
  `Extension` and `ConSys` packages. They are included with the engine's 4-byte packing (the
  `#pragma pack` at the top of the file), so their classes and structs match the game's memory.
- **Known members.** Members known when compiling are read through those classes and structs, for example
  `UTexture::Mips` (`FMipmap`), `XExtString::GetText()` and `DConEventRandomLabel::labels`.
- **Game classes.** Classes of other packages are found by name with `nativeClass()`. It accepts a class
  only when it is native and its size equals the header's, so another build of the game is refused
  instead of misread.
- **Properties named at run time** (the editor's Properties panel) go through the engine's reflection:
  `FindField<UProperty>` and `propertyData()` (the property's `Offset` and `ElementSize`), with
  `ImportText` and `ExportText`.
- **Other packages' methods.** C++ methods of other packages are linked through import libraries made from
  the game's DLL exports (`dev/prepare_sdk.py`). Those DLLs are delay-loaded: `Extension.dll` and
  `ConSys.dll` load at the first call, when the engine has already loaded them for their packages.
- **No script calls.** No UnrealScript function is called from C++.
- **File layouts** read or written are structs: texture pixels, DXT1 blocks, animation frames.
- **Text** is UTF-8 outside the engine and UTF-16 inside it. `Utf8` and `Wide` convert it, in a buffer
  on the stack, or on the heap only for long text. Names are compared as the engine's text
  (`appStricmp`). State kept between commands, such as the points `UC_NAVDROP temp` lowered or the reach
  specs `UC_KEEPPATHS save` kept, lives in `std::vector` and `FString`.

## The engine's code changed in memory

Two fixes, both made only in the host's own memory, never in a file:

1. **`UEditorEngine::Draw` returns at once.** Headless, it would paint viewports through UnrealEd's
   front-end, which is not there. It crashed on the toolbar buttons of the viewport `LIGHT APPLY`
   opens.
2. **Revision's `WinDrvLite.dll` accepts temporary viewports.** Its `UWindowsViewportLite::OpenWindow`
   asserts `!IsTemporary`, which stops `LIGHT APPLY`. The fix turns one conditional jump over that
   assertion into an unconditional one, and only when the surrounding bytes are those of the known
   build. The instructions are listed above `patchTemporaryViewport()`. With another build of the
   DLL nothing is changed, and `LIGHT APPLY` is refused with a message.

## Building

`dev/prepare_sdk.py` puts the SDK headers and the import libraries in `build_tools/sdk`. Then:

```bat
powershell -ExecutionPolicy Bypass -File mapkit\host\build_host.ps1
```

This needs Visual Studio or the Build Tools with the x86 C++ compiler.

**Third-party code:** `third_party/nlohmann/json.hpp` is nlohmann/json 3.11.3 (MIT,
`third_party/nlohmann/LICENSE.MIT`).
