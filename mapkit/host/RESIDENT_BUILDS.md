# Resident full-build worker

The editor can retain one private native compiler per project server for complete
generated-map builds. Python map scripts still execute in fresh processes. This
is a startup/package reuse optimization: CSG, BSP, navigation and lighting commands
are executed on every requested Full build, with the existing quality settings.
Imported-map builds and unsupported command sets keep the ordinary fresh process.

`resident_build.py` owns the child. Each script receives a private local named-pipe
capability. Bounded JSON carries a private batch filename, not Python pickle data.
`UCMapKitHost --build-worker` executes batches sequentially, fails on a failed native
command and emits a unique completion token. The native bridge resets map objects,
standalone map assets and class naming counters between builds. Cached external
game packages remain loaded. Only the known compatible Core/Editor binaries opt in.

The editor retires its worker on cancellation, a failed or timed-out batch, changed
project/package/native/configuration identity, after 20 builds, or after 120 seconds
idle. It also retires above 2.75 GiB private memory or below 2 GiB available physical
memory. The source run holds a Windows byte-range lease so pruning does not remove
loaded package files. Closing the editor closes its stdin; no network service or
global daemon is installed. Set `DEUSEDIX_BUILD_RESIDENT=off` to use fresh compilers.

Package identity includes file size, modification/creation times and file identity,
all game search paths (including sounds/music), explicit package paths, native binary
hashes and native build modes. Atomic replacement of a package invalidates reuse.
Package files must not be changed in place while preserving every identity field.

## Validation, 28 October 2026

On a private rooftop test map, the backend including Python preparation,
full native rebuild and preview preparation measured 10.42–10.65 seconds fresh-worker
versus 7.54–7.68 seconds with the worker retained. Initial cold runs measured 12.43
and 13.06 seconds respectively. These timings exclude browser transfer/rendering;
they are not a five-second guarantee and do not describe all maps or hardware.
The loaded UNATCO process used about 2.44 GiB of private committed memory.

Verified:

- An A → edited B → A sequence changed geometry, moved/recolored a light, deleted
  an actor, added another, and changed a local texture under its existing name.
  Both retained-worker results matched freshly built versions.
- Saved packages were reopened in fresh engine processes. Native serialization
  was compared with resolved object/name references, covering all 2,404 objects.
  Only the native texture tick clock and the already uninitialized initial
  FStateFrame.LatentAction field were normalized; no gameplay or geometry fields
  were excluded. All native BSP/light/path exports and T3D matched.
- Original and Revision generated-room tests matched on repeated builds.
- The final UNATCO preview matched all 11 JSON files, T3D and the pixels of all
  230 textures plus the lighting atlas against the ordinary fresh build.
- Separate script workers reused the same owned native process. An intentional
  bad command retired it; the next build started a fresh process. Cancellation,
  idle expiry, changed configuration, missing dependency, low memory and a
  cancellation at completion were exercised.

Tests: `tests/test_resident_build.py` plus existing prepared-build, build-job,
trace, payload and rebuild-option regressions. The diagnostic serialization oracle
and benchmark maps are private research tools, not part of the distribution.
