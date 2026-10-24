# DeusEdix

A map editor for **Deus Ex** (Game of the Year Edition) and **Deus Ex: Revision**. Build and change
maps without opening UnrealEd: fly through the level in 3D, place any class of the game, draw walls,
floors, stairs and roofs, write interactions ("when this happens, do that"), dialogues, InfoLinks and
cutscenes, import models and sounds, then rebuild and start the game on the map in a couple of clicks.

> **Not affiliated with, endorsed or supported by the Deus Ex: Revision team (Caustic Creative),
> Eidos, Square Enix or Ion Storm.** DeusEdix ships nothing of the games: no map, texture, sound,
> mesh, package or binary of theirs. It works on top of your own installed copies, read in place on
> your PC. See [NOTICE.md](NOTICE.md).

**Status:** preview (0.1.x). Things change quickly and some features are marked experimental.

## What you need

- **Windows 10 or 11** (64-bit).
- **Deus Ex: Game of the Year Edition** (Steam or GOG), patched to 1112fm as the stores ship it.
- **Deus Ex: Revision** (Steam, optional), installed in the same `Deus Ex` folder, to make maps for
  Revision too. Each project is made for one of the two games.
- **Microsoft Edge WebView2** for the editor's window (already part of Windows 11 and of up-to-date
  Windows 10). Without it DeusEdix opens in your web browser instead.

The Deus Ex SDK, UnrealEd and UCC are not needed to *use* DeusEdix.

## Installing (players and mappers)

Download `DeusEdix-Setup-<version>.exe` from the [Releases](../../releases) page and run it. It
installs for your Windows user only (no administrator rights) in `%LOCALAPPDATA%\Programs\DeusEdix`,
finds your `steamapps\common\Deus Ex` folder (or lets you pick it) and links to the store pages of
what is missing.

The first start takes a few seconds more: DeusEdix prepares its workspace from your game (links and
copies inside its own folder: nothing in the game is changed) and compiles its UnrealScript package.
Opening a map for the first time extracts what the 3D view needs from your game; those caches stay on
your PC.

When you install a project from the editor, its maps go to a folder of its own in the game
(`DeusEdixProjects\<id>` for the original game, `Revision\DeusEdixProjects\<id>` for Revision), which
DeusEdix adds to the game's settings (a backup of the ini is kept). Play starts the game with copies
of the settings made for that launch. The installer also puts `DeusEdixNav.u` and `DeusEdixNav.dll` (the
characters' route finding) into each game's `System` folder.

Uninstalling (Start > Uninstall DeusEdix, or the installer itself when DeusEdix is already installed) takes
DeusEdix's lines out again and removes the workspace and the caches. It asks whether to remove everything
else it put into the games (installed maps, saves and mods, DeusEdixNav); that stays unless you tick it. Your
projects are never removed.

The editor has an interactive tutorial (Help > Interactive tutorial) and a full guide (Help > Guide,
also in [docs/guide/guide.md](docs/guide/guide.md)).

## How it works

- **The window** (`launcher/deusedix.py`, built into `DeusEdix.exe`): the editor's page in a WebView2
  window (pywebview).
- **The editor's page** (`mapkit/editor/static`): HTML, CSS and JavaScript with three.js. No build
  step: the files are served as they are.
- **The local server** (`mapkit/editor/server.py`, Python): keeps your changes as text (JSON) next to
  each map, runs builds, installs maps and starts the game.
- **The headless host** (`mapkit/host/UCMapKitHost.cpp`, C++): loads the editor engine that comes
  with the game (`Editor.dll`) without a window. It opens a map, applies the changes, rebuilds
  geometry, paths and lighting and saves the result. It also compiles UnrealScript.
- **DeusEdix's package** (`runtime/DeusEdix`, UnrealScript): what the editor's features need inside
  the game (interactions, stories, cutscenes, collision boxes, sounds, moving objects, characters,
  InfoLinks). It is compiled on the user's PC. Every map the editor builds carries a `UCBoot` actor
  that starts the map's story and texts. (The `UC` prefix of the class names is historical.)

## Building from source

You need, besides the game:

- **Python 3.10** (64-bit) for the editor and the build scripts.
- **Visual Studio 2019 or later, or the Build Tools**, with "Desktop development with C++" (the x86
  compiler) for the host.
- The official **Deus Ex SDK 1112f** (`DeusExSDK1112f.exe`, freely available from the usual Deus Ex
  sites). Only its `Headers\DxHeaders.zip` is used. Not included here: get it yourself.
- **Inno Setup 6** only to make the installer.

```bat
py -3.10 -m venv .venv
.venv\Scripts\pip install -r requirements.txt

rem 1. the engine's headers and import libraries (from the SDK and your own game DLLs) -> build_tools\sdk
.venv\Scripts\python dev\prepare_sdk.py --headers "C:\path\to\DxHeaders.zip" --game "C:\Program Files (x86)\Steam\steamapps\common\Deus Ex"

rem 2. the headless host -> mapkit\bin\UCMapKitHost.exe
powershell -ExecutionPolicy Bypass -File mapkit\host\build_host.ps1

rem 3. the program's folder as it is installed, with a deusedix.json pointing at your game -> build\app
.venv\Scripts\python dev\stage.py --clean --game "C:\Program Files (x86)\Steam\steamapps\common\Deus Ex"

rem 4. start it from source
.venv\Scripts\python launcher\deusedix.py
```

To make the installer (`build\installer\DeusEdix-Setup-<version>.exe`), put Inno Setup 6 in
`build_tools\InnoSetup6` and run:

```bat
.venv\Scripts\python dev\build_installer.py --version 0.1.38 --no-sync
```

`dev/make_bootloader.py` builds PyInstaller's bootloader from source once (fewer antivirus false
positives than the stock one); `build_installer.py` refuses to run without it.

Tests: `mapkit/tests` (Python `unittest` files and Node `.mjs`/`.cjs` files, run with
`python -m unittest` and `node --test`).

## Contributing

Issues and pull requests are welcome. Please:

- never commit anything taken from the games or from Revision (maps, textures, sounds, meshes, `.u`
  packages, extracted caches, screenshots of copyrighted art used as assets);
- keep the game's names and folders coming from `mapkit/settings.py`, never written into the code;
- follow `mapkit/editor/DESIGN.md` for UI changes.

## Licence

DeusEdix is free software under the **GNU General Public License v3.0** ([LICENSE](LICENSE)): you
may use, change and share it, and versions you distribute must stay under the same licence with
their source. Third-party parts keep their own licences, listed in [NOTICE.md](NOTICE.md).
