# GPU scoring in a complete BSP rebuild

`BSP REBUILD OPTIMAL BALANCE=15` can score candidate splitter planes on a hardware
Direct3D 11 compute device. This is actual work inside the native full BSP build;
it does not replace the preview UV helper or the separate Local geometry tool.
The original SDK still splits polygons and builds BSP nodes. CSG (`MAP REBUILD`),
zones, collision hulls, paths and baked lighting continue to run normally.

## Automatic selection

`DEUSEDIX_BSP_COMPUTE` controls this process:

- `auto` (default): measure 32 evenly spaced native candidate rows before paying
  for D3D startup. Branches estimated below 0.35 seconds stay native. Compare the
  GPU rows against that sample and retain the GPU only when the complete batch,
  including setup, upload, readback, packing and ambiguous-row work, is at least
  20% faster than the estimated native batch. Subsequent branches below 512
  polygons remain native; branches above 32768 also remain native.
- `off`: stock compiler, no hook or D3D startup.
- `gpu`: request the hardware path without the timing threshold; numerical,
  SDK and device guards still apply. This is useful for testing small maps.
- `verify`: run the hardware scoring and the stock splitter for each eligible
  branch. Log a mismatch and disable GPU choices if they disagree. Always return
  the stock choice. This mode is intentionally slower.
- `profile`: measure stock splitter work and dump the largest input to the
  private run's `Output/splitter-input.bin`. Results remain stock.

No WARP/software device is selected. Graphics libraries are delay-loaded, so
an unavailable runtime/device does not prevent ordinary CPU builds. Device
creation, shader compilation and readback failures fall back to stock scoring.
All GPU allocations stay in the private compiler process, with no shared cache
or per-map setting. The installed game's DLLs are never edited on disk.

## Compatibility and numerical guard

The hook is a single call site inside the SDK's recursive BSP builder, scoped to
one command and restored in `__finally`. It requires exact SHA-256 fingerprints
of Editor.dll and one of the two verified Engine.dll builds (Original 1112fm or
Revision SDK), plus the PE identity and original call-site bytes. Unknown builds
execute the original command. There is no interface/bridge ABI change.

Pinned Editor.dll: `93e31b3e401880ab17ab4561c3fd4d2baa530fbe25ccb5154911ebad60fff035`.
The call at RVA `0x409f6` calls the native chooser through `0x1f28`, whose target
is `0x405d0`. Its four cdecl parameters are count, polygon pointer array,
optimization and balance. Only optimization 2 is accelerated. Native eligibility
for semi/non-solid/portal polygons, portal split weight 16, float best-score
storage and first-winner tie order are preserved.

Each GPU group scores one candidate. It reports front, back and weighted split
counts; it never generates vertices. A conservative error interval around each
dot product encloses single-precision shader and native extended computations.
If that interval can change the classification at the SDK's +/-0.25 thresholds,
the entire candidate row uses `FPoly::SplitWithPlaneFast` on the CPU. Guaranteed
front and back vertices suffice to classify a split despite other uncertain
vertices. All coordinates/plane components must be finite, bounded by 131072,
and non-denormal (or zero); the native x87 mode must be 53-bit nearest rounding.
Other inputs stay native. D3D calls restore the compiler's floating-point state.

The shader uses `precise` and IEEE strict compilation. See Microsoft's
[D3D11 floating point rules](https://microsoft.github.io/DirectX-Specs/d3d/archive/D3D11_3_FunctionalSpec.htm#3.1%20Floating%20Point%20Rules).

## Tests and measurements (28 October 2026)

On an RTX 3080 / i9-12900K, private full rebuilds of Revision UNATCO HQ went from
38–39 seconds to about 30–31 seconds (roughly 20% overall). Geometry, collision,
zone and light data in all 1923 serialized Model exports matched byte for byte;
every other export, import/name table and BSP/brush/light/path/T3D dump matched.
The first native verification compared all 62 eligible branches without a
different winning plane. The timing is native full build plus validation dumps;
it does not measure browser rendering or promise the same gain for every map.

Original UNATCO HQ and a saved rooftop test map are smaller and remain on the
CPU in automatic mode; startup overhead is avoided. Forced verification on
Original passed all 14 eligible branches. Outputs matched, including all 749
Original and 625 rooftop models. The rooftop's embedded texture InternalTime[0/1]
changes between runs; all other serialized texture bytes match. A private copy
with an altered PE checksum exercised the unknown-SDK fallback successfully.

`build_host.ps1 -BspTests` includes the diagnostic command
`UC_BSP_COMPUTE_TEST`. Run it in a **private test session**, after a verified
`BSP REBUILD OPTIMAL BALANCE=15`, with `DEUSEDIX_BSP_COMPUTE=verify`. It compares
four 512-polygon datasets against the native classifier: threshold neighbors,
large cancellation, tiny values, mixed detail/portal flags, 3–16 vertices and
21 balance values. Verified 1024 unambiguous rows, 1024 ambiguous rows handled by
the native fallback, and 84 winning choices. Normal release builds omit the
diagnostic command. Rebuild without `-BspTests` before distributing.

Further work remains in CSG, world finalization and lighting. This implementation
accelerates the costly optimal BSP scoring phase; it is not a complete GPU port
of UnrealEd's compiler.
