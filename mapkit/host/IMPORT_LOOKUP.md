# Import lookup and authoring preparation

These optimizations preserve full geometry, lighting, paths and imported actors.
No GPU approximation or persistent actor cache is introduced.

## Native object-name prefilter

Sampling a generated rooftop test map's `MAP IMPORTADD actors.t3d` showed most
samples in `UObject::StaticFindObject`'s ANY_PACKAGE object iterator. The iterator
walks each object's class ancestry before testing the requested FName. The
prefilter rejects objects whose FName differs before walking that ancestry.
Candidates with the same name retain all original class, outer and inheritance
tests and the original order. Null entries retain the native skip behavior.

`import_lookup.h` wraps only MAP IMPORT commands in the private compiler. It
does not alter DLL files, the game, map formats, or the bridge ABI. The five
bytes replaced in memory are restored in `__finally`, including failed commands.
Failure to restore terminates that compiler process rather than leaving it with
an unknown hook. `DEUSEDIX_IMPORT_LOOKUP=off` disables the optimization.

The hook requires the supported Editor/Engine pair and one of these Core builds:

* Revision: `c640fd28fcfe84ac616a37eccd248d665e4008b9554bb87f6437385248c42417`
* Original: `8bf3039e14f849942ee70a95bdf26cf1f636245926e30106bbe58b7097eba7e4`

The relevant loop is identical in both builds; their surrounding exception
handler addresses differ. Unknown binaries or unexpected instruction bytes use
the native code. The patch is at Core RVA `0x51f68`, the array load and null test
(`8b049685c0`). The continuation is `0x51f6d`, the rejection is `0x51f5b`.
In particular, `0x51f6f` must NOT be patched: its class-ancestry loop jumps back
into `0x51f72`. The prefilter preserves all registers and the continuation's
test flags; it reads the FName at `[object+0x20]` and the native resolved name at
`[ebp-0x14]`.

With `build_host.ps1 -BspTests`, `UC_IMPORT_LOOKUP_TEST` compares native lookup
results before and during the hook over loaded objects, all/current/null outers,
exact/inherited class queries, duplicate names and missing names, then checks
restoration. This command is not included in the release bridge.

## Python preparation

* `dxmaps.reference` supplies a lazy actor reader. `structures` evaluates it
  only when its existing source hash or analysis-version checks require fresh
  analysis. Existing callers may still supply actor lists.
* `t3d.actors` tracks all block nesting but retains only actor fields, own
  properties and source offsets. It no longer constructs unused Polygon/Brush
  objects. The generic `blocks` reader remains available and serves as an
  independent test oracle, including malformed blocks and raw-text boundaries.
* Request-local `build_cache` keys use a lexical absolute path and file stat,
  avoiding repeated junction resolution. File identity also detects atomic
  replacement preserving size and timestamp. Different aliases can have
  separate cache entries. Actor indexes include their parser identity.
* The Scene editor-module path is computed once on module import.

Caches still expire at the end of a build. There is no cross-project cache and
no relaxation of source/dependency or preview-bundle checks. Procedural texture
generation, PNG compression, and browser rendering are unchanged.

## Validation and comparison limits

The actor reader matches full-tree parsing on Original HQ, Revision HQ, current
a rooftop test map and Wan Chai Street, plus 2,500 malformed/whitespace cases.
Regression tests cover clipboard geometry, activation, cache isolation,
replacement invalidation and lazy structure-analysis invalidation.

Native before/after builds compare BSP, brush, lighting, path and T3D exports,
package name/import tables, and serialized exports. Native texture clocks and
unused BSP vertex slots follow the existing strict comparison rules. Fresh map
imports also expose an SDK constructor defect: `FStateFrame` initializes Node,
StateNode and ProbeMask but leaves LatentAction uninitialized. A stock-versus-
stock control reproduces differing bytes there. The comparator may normalize
only those four bytes when both frames point to their actor class, ProbeMask is
all ones, and the code offset is -1 (no executing state). Actor properties and
all remaining bytes are still compared. This is a comparison-only rule; the
optimizer does not rewrite that field or any saved actor state.
