"""The Engine.dll builds whose native code the certificates were checked against, by SHA-256.

The certificates rely on the engine's own collision and BSP code: PointCheck, LineCheck and its .5 backoff,
PointRegion, and the extent trace whose bytes the host instruments at fixed addresses. Two builds carry exactly
that code: the Deus Ex SDK copy in Revision's DevInstall (the build these modules were first pinned to) and the
original game's Engine.dll (Deus Ex 1112fm). They differ in a single byte, at RVA 0x7ae18: the memory
FMovingBrushTracker's constructor reserves for the movers' tracker (0x40000 against 0x10000), a structure none of
the certificates reads (byte compare, 24 Oct 2026). Any other build is refused.
"""

KNOWN = {
    'd66b689bbe95d7350b9f348da2273383c642e22e53dd56bd1bcf76ec322aa848': 'Deus Ex SDK (Revision DevInstall)',
    '0c3a8b18239ca98ae132506a1bd966cb5d91c6852e650e179cb15860832c20b4': 'Deus Ex 1112fm (the original game)',
}
