# Surface tools verification — 14 October 2026

Completed the user's selected scope: face selection / texture alignment and shadow detail
(items 1–2 of `CODEX_UED22_FEATURES.md`). The other phase 1 features are outside this change.

- `test_surfaces.py`: 15 engine cases passed. Floor, wall, tile, tile-u, tile-v, pan, scale,
  rotate, flips, texture, low/normal/high shadows and cylinder wrap. Checks persistence through
  save/reload and BSP rebuild, unchanged unselected mappings, tile proportions and cylinder seams.
- `test_surface_builds.py`: passed in development and staged standalone mode. Script builds force
  lighting for UV edits; existing-map builds preserve BSP/paths, replay relative edits once per
  fresh source, and leave source SHA256 unchanged. Also tests a moved/rotated/nonuniformly scaled brush.
- Browser: Alt+click, Shift multi-selection, Edit > Face selection, whole-structure selection and
  shadows, Undo, Save and Rebuild passed on the generated SurfaceTest map. The original fixture's
  SHA256 remained unchanged. On the user's rooftop map, selection opens Surface without adding edits.
- Fixed Alt+click starting an object gizmo drag, and the missing edits directory on first standalone
  startup. The host now applies the known WinDrvLite temporary-lighting-viewport fix in memory, with
  instruction-byte checks. The game's DLL and its linked standalone copy remain byte-identical.
- Host compiled; Python syntax and changed JavaScript syntax checked. Guide and installer built.
  Installer: `build/installer/DeusEdix-Setup-0.1.0-surfaces-20261014.exe` (in the DeusEdix repository).
  SHA256: `c69b47b52f1d0bdd31dc2db5ffed8e18c2ebe14b0fb8ebf2a6a16392e426c5e8`.
  The release contains no game maps, texture packages or compiled game packages.

Backups: `tools/mapkit/backup/editor_20261014-130504_surfaces` (including the previous standalone files).
Engine/browser logs and `surface-editor-preview.png` are alongside this report.

The installer matches the tested standalone snapshot. Concurrent tutorial additions appeared later
in the shared `server.py`, `app.js` and `menubar.js`; they were preserved and not pulled into this
installer while that separate work was in progress.

Stored surface operations use source brush names and source polygon indices. Cylinder wrapping
requires one closed vertical side outline with a shared texture. Surface edits are shown after
Rebuild; selecting highlights the source face, including its BSP fragments. External replacement
of source brush topology requires selecting the new faces again.
