# Native lighting build optimizations

`LIGHT APPLY` retains the game's full visibility and shadow build. This is a CPU
lighting optimization, alongside the existing GPU BSP scoring; it is not a GPU
lightmap baker. Light resolution, sampling, attenuation, occlusion, movers and
light colors are not approximated or reduced.

## Temporary viewport setup

The known Revision OpenGL renderer enumerates fullscreen display modes in every
`Init`, even for the hidden windowed viewport used to collect lighting visibility.
On the measured machine this costs about two seconds. Enumeration is unnecessary
for that windowed path. Only the enumeration call in this known renderer's Init
is intercepted; the renderer, viewport dimensions and visibility pass remain.
The stub checks Init's actual `Fullscreen` argument. Fullscreen calls go through
the original Windows API. Windowed calls terminate only the mode-list loop.

The driver class is loaded through the engine's `StaticLoadClass`, not raw
`LoadLibrary`: native package registration must be respected. Engine ownership
and lifetime remain unchanged. The driver fingerprint and relocated call bytes
are checked before altering process memory. Unknown renderers use their normal
initialization. Original's software renderer needs no viewport patch.

Pinned OpenGLDrv SHA-256:
`c47b639fd90250ebf8bc6a9d2c013720628751dae163416a1f44b1b1953fb93b`.
Call RVA `0xb846`, EnumDisplaySettingsA import slot `0x1f370`.
No display mode is set or modified by the optimization.
See the [Windows EnumDisplaySettings documentation](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumdisplaysettingsa)
for the native mode enumeration contract.

## Shadow-ray comparisons

The pinned Engine's line-check traversal uses the classic x87 sequence `FCOMP`,
`FNSTSW AX`, `TEST AH` before conditional jumps at five frequently visited sites.
The status-word transfer is expensive when repeated across millions of rays.
`FCOMIP` performs the same ordered comparison and exposes its result directly to
conditional jumps, without that transfer. It does not substitute single-precision
math for native math. Dot products, intersection calculations, BSP traversal,
node flags and collision output remain native.

The replacement loads the same double threshold before the same float value,
compares with x87, and pops both temporaries. Its stack depth at exit is unchanged.
`JBE` matches the old C0-or-C3 test; `JAE` matches the old negated C0 test.
Unordered values retain the old branch direction. These sites do not use the old
AX status-word residue or x87 condition bits after the branch; each successor
overwrites the relevant integer flags before further tests. x87 arithmetic,
precision and rounding mode remain untouched. CPU FPU/CMOV feature bits are
checked for support of the FCOMI instruction family.

See [Intel SDM volume 1, x87 comparison instructions](https://cdrdv2-public.intel.com/789574/253665-sdm-vol-1.pdf)
for the legacy and direct-EFLAGS x87 comparison tables.

Engine RVAs: `0xf3703`, `0xf3714`, `0xf3768`, `0xf3779`, `0xf387f`.
Each site is 17 bytes. Relocated constant addresses and original instructions
must match. The exact Editor/Engine SHA allowlist is shared with GPU BSP and
geometry search, covering the tested Original and Revision SDKs.

## Controls and lifetime

- `DEUSEDIX_LIGHT_BUILD=auto` (default): both optimizations when supported.
- `off`: ordinary native lighting, including viewport initialization.
- `viewport`: only skip windowed fullscreen-mode enumeration.
- `rays`: only direct x87 comparison flags.

All patches are confined to `LIGHT APPLY` in the private compiler process and
restored in `__finally`, including native exceptions. Original bytes and page
protection are restored; failed restoration ends only the private compiler.
No installed game DLL is patched on disk. Other commands and the game remain
unchanged. No lighting cache, resident process or additional disk cache is added;
each invocation computes from the current map and lights.

## Verification

`build_host.ps1 -BspTests` also enables `UC_LIGHT_BUILD_TEST`; release builds omit
the command. The test executes the old and new instruction sequences across
4,718,592 cases: all x87 precision/rounding modes, threshold neighbors, signed
zero, subnormals, infinities, and quiet/signaling NaNs with exceptions masked.
The old and new branch decisions must be identical.

Release map tests rebuild private Original/Revision HQ and rooftop test map copies
with acceleration off/on. Every serialized export is compared, including model
geometry, collision and baked light masks, plus BSP/brush/light/path/T3D exports.
The established comparator records native texture clock fields and any truly
unreferenced vertex-slot differences separately. It does not mask lightmap data.
Additional cases change a light and build lighting again within one process,
and alter private DLL checksums to verify unsupported-version fallback.

Performance varies by map, CPU, display driver and renderer. The lighting phase
and whole native pipeline are timed separately; these exclude authoring-script
generation and browser viewport opening. Never report lighting-only speedups as
the total editor speedup.
