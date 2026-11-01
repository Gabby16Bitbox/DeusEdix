# Full build: geometry searches and bounded realloc capacity

These optimizations run in the private native compiler process during `MAP
REBUILD`, `BSP REBUILD OPTIMAL BALANCE=15`, and `UC_WORLD finish`. They supplement
the GPU splitter scoring in [GPU_BSP.md](GPU_BSP.md). They do not skip geometry,
zones, collision, paths or lighting, and do not change Local geometry proofs.
There is no UI change or cross-process resident service.

## Near-point search

The SDK's `MergeNearPoints` compares each point against earlier points until the
first point strictly inside the distance threshold is found. A spatial hash
reduces candidate comparisons while retaining that exact first index. Merged
points are inserted too, preserving the native non-transitive mapping.

Cells have a power-of-two width at least equal to the tolerance; all 27 adjacent
cells are considered. The predicate evaluates `(dz*dz + dy*dy) + dx*dx` in native
53-bit, round-to-nearest order. Coordinates must be finite and within +/-131072,
the tolerance between 0.000001 and 1024, and the model between 256 and 2,000,000
points. Other inputs and allocation failures use the native loop.

Only the search is bypassed. Native code allocates and consumes the remap,
updates vertex/surface references and handles degenerate nodes. The hook is
before the loop, avoiding internal back-edge targets. Verification mode runs
the real native loop and compares the complete predicted remap before the
temporary memory is freed.

## Vector search

The native vector append helper's two-sided strict tolerance comparisons are
retained. An SSE broad-phase checks four X coordinates at a time with an
inclusive float comparison; every candidate is rechecked on all three axes in
double precision. Inclusive comparison cannot reject a matching native result
under nearest rounding. Array reads do not exceed the current array length.
There is no cached index to invalidate after compaction or in-place edits.
New entries are appended by the original helper itself, with its search off.

Unsupported floating-point state (including SSE denormals-as-zero/flush and
rounding changes), invalid input, and short arrays use the original function.
In verification mode every eligible lookup also calls the original helper and
compares the returned index. SSE is already a platform requirement of the
modern bridge build; this adds no CUDA/vendor requirement.

## Version and lifetime guards

`DEUSEDIX_GEOMETRY_SEARCH=off` uses native searches, `verify` compares predictions
while returning native results, and the default enables the optimizations.
The same exact Editor/Engine SHA-256 allowlist as GPU BSP is required. Unknown
SDK files use stock geometry. Original instructions at all hook sites are also
checked. The temporary patches are restored in `__finally` before returning,
including on native exceptions. Restoration failures terminate only the private
compiler process. No installed game DLL is edited on disk.

Pinned Editor RVAs: near-loop setup `0x45954`, continuation `0x4595a`, native
consumer `0x459cf`; verification point `0x45a90`; vector thunk `0x16bd` to native
helper `0x3f990`. Native `MergeNearPoints` starts at `0x45900`.

## Reallocation reserve

The private process's `FMallocBuild` retains a small amount of spare capacity
when resizing large blocks during geometry commands. This prevents repeatedly
shrinking and regrowing the same arrays. Their logical sizes, native contents,
alignment and ownership stay unchanged. All blocks still use the same CRT
allocation family; every free really frees its block.

At most 256 blocks are tracked without dynamic metadata allocation. Blocks
must request at least 64 KiB; growth adds at most 25% or 1 MiB, whichever is
smaller. Total retained spare capacity is capped at **32 MiB**. Substantial
shrinks and requests outside build commands return to ordinary reallocation.
Failure to reserve extra space retries the exact requested size. If that fails,
the original allocation and accounting remain valid, following the
[CRT realloc contract](https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/realloc).

A lock protects bookkeeping; only the active build thread reserves extra space.
Free or resize from other threads still updates tracked entries. Ending a build
disables new reservations, and all storage dies with the private process. There
is no cache in the user's editor or on disk. Existing reserved blocks may stay
until their next resize/free; the cap still applies. `DEUSEDIX_BUILD_ALLOCATOR=off`
disables reservations independently of geometry search and GPU BSP.

Log `reused requested bytes` is the sum of resize request sizes served in place,
not a measured number of bytes copied by the previous CRT. `spare peak` measures
this allocator's reserve, not overall process RAM or GPU memory.

## Validation

`build_host.ps1 -BspTests` also includes `UC_GEOMETRY_SEARCH_TEST`. Use only private
test sessions; normal release builds omit it. Tests compare **16,384 point
remaps** and **26,000 vector lookups** with actual native functions, including
threshold neighbors, negative cells, chains, earliest-index ties, array lengths
and same-size mutations. Reserve tests exercise preserved bytes through growth,
shrinks, free, table saturation, the 32 MiB cap and release outside a build.

Full native builds are compared on private Original/Revision UNATCO HQ maps and
a saved rooftop test map. All referenced data, collision hulls, baked lighting,
and BSP/brush/light/path/T3D exports must match. HQ model payloads match byte for
byte. The rooftop contains unused `Verts` slots with uninitialized values even
under native-only searches; the comparator masks only vertex/side index pairs
unreferenced by every BSP node. It still compares every other model byte. The
two native texture `InternalTime` values are compared separately from texture
pixels. These exceptions are recorded, never hidden behind a visual-only check.

On the test RTX 3080/i9-12900K, paired release builds of Revision UNATCO HQ went
from about 27 seconds (GPU BSP already active) to about 20 seconds. Samples are
small and depend on the map/system. Timings include the full native build,
save, validation exports and host exit; they exclude script generation and
opening/rendering the browser viewport. No installer or app restart is implied.
