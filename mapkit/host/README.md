# UCMapKitHost

The headless host: a console program that does the map editor's engine work without a window. The editor's
server starts it through `mapkit/kit.py`, sends it commands and reads its answers.

The host has two parts:

| File | What it is |
|---|---|
| `UCMapKitHost.cpp` → `UCMapKitHost.exe` | **The host.** It reads the commands, runs the session and writes the files. Standard C++17, with no engine header. |
| `bridge.h` | **The interface** between the host and an engine bridge, in plain C. |
| `UCEngineBridge.cpp` → `UCEngineBridge.dll` | **The bridge** for Deus Ex's own engine. It runs the editor engine of the SDK 1112f (`Editor.dll`, the engine UnrealEd uses) headless. It is the only code compiled against the engine's headers. |
| `PROTOCOL.md` | **The contract:** every command, its answers and the keys of its files. |

Another engine needs only another bridge, a DLL with the functions of `bridge.h`. It could be Surreal
Engine, or build tools written anew. The host chooses its bridge when it starts (`--bridge <dll>`). Because
the interface is plain C, each side can be built by any compiler with the settings it needs.

## Running it

| Command line | What it does |
|---|---|
| `UCMapKitHost.exe <command file>` | Runs the file's commands, one a line. It stops at the first one that fails (exit code 4). |
| `UCMapKitHost.exe -` | Interactive: commands on stdin, each answered by a block ending in `UCMapKit\|ready`. A failed command is reported and the session goes on; `UC_QUIT` ends it. |
| `UCMapKitHost.exe --make [DeusEx.ini]` | The UnrealScript compiler (`Editor.MakeCommandlet`), as `ucc make` runs it: every package of the ini's `EditPackages` whose `.u` is missing. |
| `--bridge <dll>` | Before any of the above: another engine bridge. The default is `UCEngineBridge.dll` next to the host, loaded by its full path. |

`kit.Session` runs it in a folder of its own whose `System` links to the game's files, so the game's own
folders are only read.

## The flow of a command

`main()` puts the process in its job (see "Security" below), loads the bridge and starts it. The bridge
starts the engine: `appInit`, then a `UEditorEngine`, then the two in-memory fixes described below. Then
`main()` reads one line at a time:

1. It prints `UCMapKit|command|<line>`.
2. `runCommand()` splits the line into its words (`Args`) and looks the first one up in the `Commands` table.
   The table checks the arguments and calls the bridge's function for that command, with typed values.
   Anything else goes to UnrealEd's own command line, through the bridge's `exec` (`MAP LOAD`,
   `BRUSH ADD`, `BSP REBUILD`, `LIGHT APPLY`, `MAP SAVE`...).
3. The command runs inside a structured exception handler. A crash in the engine becomes
   `UCMapKit|fault|<code>` (with `UCMapKit|av|<module>+<offset>` for an access violation) instead of
   ending the session.
4. It prints `UCMapKit|actors|<count>` and `UCMapKit|complete|<milliseconds>`.

The bridge never writes to the console or to a file itself. It prints its answers
(`UCMapKit|<what>|<fields...>`) and the engine's log through the host. It hands the host JSON rows for the
files, and the host writes them.

Most files are **JSON lines**: one JSON value a line, built with nlohmann/json, and read on the Python side
with `kit.rows()`. The bulk dumps of a whole map (`UC_BSPDUMP`, `UC_MESHES`, `UC_LIGHTDUMP`) are not: a
JSON header line with their strings and the list of their arrays, then the numbers as flat binary arrays
(`Arrays` in UCEngineBridge.cpp, `kit.arrays()` in Python), no JSON value per number. Two more carry binary
data after a JSON header line: `UC_TEXDUMP` (the RGBA pixels) and `UC_ANIMDUMP` (the model's arrays, after
the line `data`). `PROTOCOL.md` lists every command and its
rows. Numbers keep the precision the dumps always had (`digits()`, `decimals()`), so the editor reads the
same values and the files stay small.

## Reading and writing the engine's data (the bridge)

- **SDK headers.** The bridge compiles against the headers of the Deus Ex SDK 1112f, including those of
  the `Extension` and `ConSys` packages. They are included with the engine's 4-byte packing (the
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
- **The engine's devices** (allocator, log, error, files) are made once and never destroyed. A DLL's
  static objects are destroyed at the process's exit, before the engine's own DLLs, which still use
  them. A critical error ends the process at once, with exit code 1, without the engine's shutdown code.

## The engine's code changed in memory

Two fixes, both made only in the process's own memory, never in a file:

1. **`UEditorEngine::Draw` returns at once.** Headless, it would paint viewports through UnrealEd's
   front-end, which is not there. It crashed on the toolbar buttons of the viewport `LIGHT APPLY`
   opens.
2. **Revision's `WinDrvLite.dll` accepts temporary viewports.** Its `UWindowsViewportLite::OpenWindow`
   asserts `!IsTemporary`, which stops `LIGHT APPLY`. The fix turns one conditional jump over that
   assertion into an unconditional one, and only when the surrounding bytes are those of the known
   build. The instructions are listed above `patchTemporaryViewport()`. With another build of the
   DLL nothing is changed, and `LIGHT APPLY` is refused with a message.

## Security

The engine is 2000-era code, and it reads maps and packages that can come from other people's mods. The
host limits what a malicious file could do through it:

- **The process runs in a job of its own** (`isolate()`). It cannot start another process or reach the
  clipboard, the display settings or other desktops. A crash ends it instead of leaving it waiting on an
  error dialog.
- **Built with:** `/sdl` (the compiler's extra security checks), Control Flow Guard, CET shadow stacks
  (`/CETCOMPAT`), ASLR and DEP. They protect the host and the bridge; the game's own DLLs keep what
  their 2000 build gave them.
- **A critical engine error ends the process at once**, with exit code 1, instead of running the engine's
  shutdown code on a failed engine.

## Building

`dev/prepare_sdk.py` puts the SDK headers and the import libraries in `build_tools/sdk`. It also adapts
three loops of the headers, so they build without the deprecated `/Zc:forScope-`. Then:

```bat
powershell -ExecutionPolicy Bypass -File mapkit\host\build_host.ps1
```

This needs Visual Studio or the Build Tools with the x86 C++ compiler. It builds the bridge first and the
host second, both into `mapkit/bin`:

- **The host:** standard C++17, with no compatibility option.
- **The bridge:** needs `/Zc:wchar_t-`. The game's DLLs were built by Visual C++ 6, whose `wchar_t` was an
  `unsigned short`; their exported functions are named with it. Also, the headers' `guard()` fills
  `TCHAR` arrays with wide literals in every function. That option, the engine's ABI, is confined to the
  bridge.

**Third-party code:** `third_party/nlohmann/json.hpp` is nlohmann/json 3.11.3 (MIT,
`third_party/nlohmann/LICENSE.MIT`).
