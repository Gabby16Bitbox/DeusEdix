# DeusEdix projects

A project keeps one campaign's maps, story and imported assets together. Start with **New project** for an independent campaign, **Deus Ex story** to work with the original missions, or **Training** for Dr. Hale's tutorial. **Open project** opens an existing project folder.

The **Existing workspace** entry keeps the work made before projects were introduced in its original location. It is registered in place; creating a project does not move or replace it.

## Working in a project

- Create maps with chapter numbers starting at 1. Two projects can both contain `01_SharedRoom` without sharing its edits, dialogue or imported assets.
- Custom projects list their own maps. Copying an original map or browsing to a `.dx` file creates a private copy. The original mission script and conversation package are detached; exits to maps outside the project are cleared. Local teleports and valid project destinations remain usable. The source file stays untouched.
- The **Deus Ex story** project keeps the original mission defaults. Original game maps are edited through private copies.
- Training has its own maps and progress. Starting it does not add tutorial content to a new campaign.
- Finish the current build and close a running game before switching projects. The editor saves pending project preferences before switching. A tab from a closed session must be reopened from Projects.

The game still supplies models, textures, sounds and original text as reference material. Using an original voice keeps a reference to the player's installed game. These shared references do not merge campaign data.

## Files and backups

Each project has an immutable ID in `deusedix-project.json`. Keep this file with the project, and use **Open project** after moving its folder. Do not duplicate or edit the ID to make another campaign.

| Content | Location within a managed project |
| --- | --- |
| Imported maps and editable source copies | `maps/`, including `maps/.authoring/` |
| Generated map scripts and edits | `tools/mapkit/maps/` |
| Story and dialogue | `tools/mapkit/story/` |
| Imported audio and dialogue recordings | `tools/mapkit/sounds/`, `tools/mapkit/dubs/` |
| Animator clips, rigs and baked frames | `tools/mapkit/anims/` |
| Models, textures, characters and copied pieces | Corresponding folders under `tools/mapkit/` |
| Runtime source and compiled packages | `src/`, `dist/` |
| Map builds, working exports and logs | `tools/mapkit/out/`, `tools/mapkit/editor/cache/`, `logs/` |

Back up the manifest, `deusedix.json`, authored content and runtime sources together. `DevInstall` contains links to installed game resources; it is a rebuildable workspace, not a portable copy of the game. Preserve imported resource sources even when a compiled package already exists.

Editor appearance, shortcuts and panel layout are shared preferences. Map state, recent maps, visibility/selection locks and tutorial progress are stored for the project. The application keeps its project list separately from project content.

## Implementation notes

Every project runs in a separate editor process with fixed paths. A session header binds API requests to that process; late saves from a previous session cannot target the newly opened project. Project code is copied from an allowlist. Updates compare ownership hashes and stop on locally changed application files. User assets, generated story classes and extended catalog caches are preserved.

Managed runtime packages use `DXP_<project ID>`; audio, models and animation packages append `Sounds`, `Models` and `Anims`. Installed builds and game saves use `Revision/DeusEdixProjects/<project ID>/`. Activating one project's game paths does not delete another project's build.

`PROJECT_KIND` is `custom`, `original` or `tutorial`; a workspace without a project manifest remains `legacy`. Custom and tutorial maps have no automatic original mission or dialogue hooks. Their flag suggestions come from authored story data. Mission-script inspection follows the map's actual `Script` property, not its chapter prefix.

Validation covers a native runtime compile and map build, two campaigns with identical map/voice names, duplicate asset names, refresh preservation, and rejection of stale HTTP sessions. Storage tests for imported models and audio skip package compilation; they do not constitute an in-game playback test.
