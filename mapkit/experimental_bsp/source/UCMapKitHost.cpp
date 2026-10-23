// UCMapKitHost: the SDK editor engine (Editor.dll of the Deus Ex SDK) run headless, driven by a
// command file. Used by tools\mapkit to build new maps: brushes, actors, BSP rebuild and the
// real lighting build (LIGHT APPLY), then MAP SAVE.
//
// Derived from tools\editor_bridge\editor_src\UCEditorSdkHost.cpp (Codex's verified host), which
// stays untouched. Differences:
//  - UEditorEngine::Draw is turned into a no-op. LIGHT APPLY opens a temporary viewport to
//    compute light visibility; its first repaint goes through the editor's viewport drawing
//    (toolbar buttons), which crashes without the UnrealEd front-end. The lighting itself does
//    not need that repaint.
//  - every command runs inside a structured exception handler that prints the fault.
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <malloc.h>
#include <float.h>
#define EDITOR_API __declspec(dllimport)
// The engine is built with 4-byte packing: without it every class member after a DOUBLE (UBitmap's
// LastUpdateTime: a texture's Scale, its Mips...) is read 4 bytes too far.
#pragma pack(push, 4)
#include "Editor.h"
#include "FMallocAnsi.h"
#include "FFileManagerWindows.h"
#include "FConfigCacheIni.h"
#include "FOutputDeviceFile.h"
#include "FOutputDeviceAnsiError.h"
#include "FFeedbackContextAnsi.h"
#pragma pack(pop)

static void printUtf8(const TCHAR* text, FILE* stream) {
    char buffer[16384];
    int count = WideCharToMultiByte(CP_UTF8, 0, (const WCHAR*)text, -1,
        buffer, sizeof(buffer), NULL, NULL);
    if (count) fwrite(buffer, 1, count - 1, stream);
    fputc('\n', stream); fflush(stream);
}
class Utf8Log : public FOutputDevice {
public:
    void Serialize(const TCHAR* text, EName event) { printUtf8(text, stdout); }
};
class Utf8Feedback : public FFeedbackContextAnsi {
public:
    int Errors, Warnings;           // counted for --make (the compiler reports through GWarn)
    Utf8Feedback() : Errors(0), Warnings(0) {}
    void Serialize(const TCHAR* text, EName event) {
        int warning = event == NAME_Warning || event == NAME_ExecWarning || event == NAME_ScriptWarning;
        if (event == NAME_Error) Errors++;
        else if (warning) Warnings++;
        // like UCC: "<file>(<line>) : Error, <message>" when the compiler says where it is
        if ((event == NAME_Error || warning) && Context) {
            TCHAR temp[2048];
            appSprintf(temp, TEXT("%s : %s, %s"), *Context->GetContext(), *FName(event), text);
            printUtf8(temp, stdout);
            return;
        }
        printUtf8(text, stdout);
    }
};
class Utf8Error : public FOutputDeviceError {
public:
    void Serialize(const TCHAR* text, EName event) { printUtf8(text, stderr); appRequestExit(1); }
    void HandleError() { printUtf8(GErrorHist, stderr); }
};

// Patch the first bytes of an exported function of a loaded module.
static int patchExport(const char* module, const char* symbol, const unsigned char* bytes, int count) {
    HMODULE handle = GetModuleHandleA(module);
    if (!handle) return 0;
    unsigned char* code = (unsigned char*)GetProcAddress(handle, symbol);
    if (!code) return 0;
    DWORD old;
    if (!VirtualProtect(code, count, PAGE_EXECUTE_READWRITE, &old)) return 0;
    memcpy(code, bytes, count);
    VirtualProtect(code, count, old, &old);
    FlushInstructionCache(GetCurrentProcess(), code, count);
    printf("UCMapKit|patched|%s|%s\n", module, symbol); fflush(stdout);
    return 1;
}

// Revision's WinDrvLite rejects the temporary viewport LIGHT APPLY needs. The development
// workspace already has this fix (tools/patch-windrvlite.ps1); installed DeusEdix reads the
// original DLL. Apply only the known, byte-checked fix in this process, never to a game file.
static int temporaryViewportReady = 1;
static int patchTemporaryViewport() {
    unsigned char* base = (unsigned char*)GetModuleHandleA("WinDrvLite.dll");
    if (!base) return 1; // another viewport manager
    IMAGE_DOS_HEADER* dos = (IMAGE_DOS_HEADER*)base;
    IMAGE_NT_HEADERS* nt = (IMAGE_NT_HEADERS*)(base + dos->e_lfanew);
    if (nt->OptionalHeader.SizeOfImage < 0x16490) return 0;
    unsigned char* code = base + 0x1647e;
    const unsigned char prefix[] = {0x39, 0x7d, 0x0c};
    const unsigned char suffix[] = {0x18, 0x68, 0xe6, 0x00, 0x00, 0x00};
    if (memcmp(code, prefix, sizeof(prefix)) || memcmp(code + 4, suffix, sizeof(suffix))) return 0;
    if (code[3] == 0xeb) return 1;
    if (code[3] != 0x74) return 0;
    DWORD old;
    if (!VirtualProtect(code + 3, 1, PAGE_EXECUTE_READWRITE, &old)) return 0;
    code[3] = 0xeb;
    VirtualProtect(code + 3, 1, old, &old);
    FlushInstructionCache(GetCurrentProcess(), code + 3, 1);
    puts("UCMapKit|patched|WinDrvLite.dll|temporary lighting viewport (memory only)");
    return 1;
}

static int editMover(const char* line) {
    char operation[32], name[128], trailing;
    float x, y, z;
    if (sscanf(line, "UC_MOVER %31s %127s %f %f %f %c", operation, name, &x, &y, &z, &trailing) != 5)
        return 0;
    if (!_finite(x) || !_finite(y) || !_finite(z) || !GEditor->Level) return 0;
    unsigned short wide[128];
    int i;
    for (i=0; name[i]; i++) wide[i] = (unsigned char)name[i];
    wide[i] = 0;
    AMover* mover = NULL;
    for (i=0; i<GEditor->Level->Actors.Num(); i++) {
        AActor* actor = GEditor->Level->Actors(i);
        if (actor && !appStricmp(actor->GetName(), (const TCHAR*)wide)) {
            if (!actor->IsA(AMover::StaticClass())) return 0;
            mover = (AMover*)actor;
            break;
        }
    }
    if (!mover || !mover->Brush || !mover->Brush->Polys) return 0;
    if (!strcmp(operation, "bounds")) {
        GEditor->bspBuildBounds(mover->Brush);
        mover->Brush->BuildBound();
    } else if (!strcmp(operation, "prep")) {
        GEditor->csgPrepMovingBrush(mover);
        mover->Brush->BuildBound();
    } else return 0;
    printf("UCMapKit|mover|%s|%s|%d\n", name, operation, mover->Brush->Polys->Element.Num());
    return 1;
}

// Zones, visibility and collision bounds for the whole level, after CSG.
static int finishWorld() {
    if (!GEditor->Level || !GEditor->Level->Model) return 0;
    UModel* model = GEditor->Level->Model;
    GEditor->bspRefresh(model, 1);
    GEditor->TestVisibility(GEditor->Level, model, 0, 0);
    GEditor->bspBuildBounds(model);
    printf("UCMapKit|world|%d nodes|%d surfs|%d zones\n", model->Nodes.Num(), model->Surfs.Num(), model->NumZones);
    return model->NumZones > 0;
}

// The lighting build spawns a view actor (Camera) for its temporary viewport: never save it.
static int clearCameras() {
    if (!GEditor->Level) return 0;
    int removed = 0;
    for (int i=0; i<GEditor->Level->Actors.Num(); i++) {
        AActor* actor = GEditor->Level->Actors(i);
        if (actor && actor->IsA(ACamera::StaticClass())) {
            GEditor->Level->DestroyActor(actor);
            removed++;
        }
    }
    printf("UCMapKit|cameras removed|%d\n", removed);
    return 1;
}

// Every non-brush actor whose origin lies inside solid geometry: a light there lights
// nothing, a pawn or pickup there is stuck. Printed as UCMapKit|in solid|Class|Name|x y z.
static int checkActors() {
    if (!GEditor->Level || !GEditor->Level->Model) return 0;
    UModel* model = GEditor->Level->Model;
    int checked = 0, buried = 0;
    for (int i=0; i<GEditor->Level->Actors.Num(); i++) {
        AActor* actor = GEditor->Level->Actors(i);
        if (!actor || actor->IsA(ABrush::StaticClass()) || actor->IsA(ACamera::StaticClass())) continue;
        if (actor->IsA(ALevelInfo::StaticClass())) continue;
        checked++;
        FPointRegion region = model->PointRegion(GEditor->Level->GetLevelInfo(), actor->Location);
        if (region.iLeaf != INDEX_NONE) continue;
        buried++;
        char cls[128], name[128];
        WideCharToMultiByte(CP_UTF8, 0, (const WCHAR*)actor->GetClass()->GetName(), -1, cls, sizeof(cls), NULL, NULL);
        WideCharToMultiByte(CP_UTF8, 0, (const WCHAR*)actor->GetName(), -1, name, sizeof(name), NULL, NULL);
        printf("UCMapKit|in solid|%s|%s|%.0f %.0f %.0f\n", cls, name, actor->Location.X, actor->Location.Y, actor->Location.Z);
    }
    printf("UCMapKit|actors|%d checked|%d in solid\n", checked, buried);
    return 1;
}

// UC_POINT x y z: which BSP leaf and zone a point falls in (leaf -1 = inside solid).
static int probePoint(const char* line) {
    float x, y, z;
    if (sscanf(line, "UC_POINT %f %f %f", &x, &y, &z) != 3) return 0;
    if (!GEditor->Level || !GEditor->Level->Model) return 0;
    FPointRegion region = GEditor->Level->Model->PointRegion(GEditor->Level->GetLevelInfo(), FVector(x, y, z));
    char zone[128] = "none";
    if (region.Zone)
        WideCharToMultiByte(CP_UTF8, 0, (const WCHAR*)region.Zone->GetName(), -1, zone, sizeof(zone), NULL, NULL);
    printf("UCMapKit|point|%.0f %.0f %.0f|leaf %d|zone %d|%s\n", x, y, z, region.iLeaf, region.ZoneNumber, zone);
    return 1;
}

// UC_TRACE x0 y0 z0 x1 y1 z1: first level-geometry hit on the segment (like dropping or pushing an
// object until it touches something, as in the modern editors). Prints the hit point and normal.
static int traceLine(const char* line) {
    float a[6];
    if (sscanf(line, "UC_TRACE %f %f %f %f %f %f", &a[0], &a[1], &a[2], &a[3], &a[4], &a[5]) != 6) return 0;
    if (!GEditor->Level || !GEditor->Level->Model) return 0;
    FCheckResult hit(1.f);
    FVector start(a[0], a[1], a[2]), end(a[3], a[4], a[5]);
    UBOOL clear = GEditor->Level->SingleLineCheck(hit, NULL, end, start, TRACE_Level, FVector(0, 0, 0), 0);
    if (clear)
        printf("UCMapKit|trace|none\n");
    else
        printf("UCMapKit|trace|hit|%.2f %.2f %.2f|%.3f %.3f %.3f\n", hit.Location.X, hit.Location.Y, hit.Location.Z,
            hit.Normal.X, hit.Normal.Y, hit.Normal.Z);
    return 1;
}

// UC_BSPDUMP <file>: the final world geometry (every visible BSP polygon) with its texture and
// mapping, for the 3D view of the map editor (tools\mapkit\editor). One line per polygon:
// P <texture path> <flags> <base xyz> <U xyz> <V xyz> <panU> <panV> <tile w> <tile h> <n> <vertices xyz...> <brush>
static int dumpBsp(const char* line) {
    char path[512];
    if (sscanf(line, "UC_BSPDUMP %511s", path) != 1) return 0;
    if (!GEditor->Level || !GEditor->Level->Model) return 0;
    UModel* m = GEditor->Level->Model;
    FILE* f = fopen(path, "wt");
    if (!f) return 0;
    // static brushes in creation order (= the order of the map script's operations), builder excluded:
    // each polygon ends with the ordinal of the brush that made it (-1 when unknown)
    TArray<ABrush*> brushes;
    for (int i = 0; i < GEditor->Level->Actors.Num(); i++) {
        AActor* a = GEditor->Level->Actors(i);
        if (a && a->IsStaticBrush() && a != GEditor->Level->Brush()) brushes.AddItem((ABrush*)a);
    }
    TArray<INT> surfBrush;
    surfBrush.Add(m->Surfs.Num());
    for (int i = 0; i < m->Surfs.Num(); i++) {
        surfBrush(i) = -1;
        for (int k = 0; k < brushes.Num(); k++)
            if (brushes(k) == m->Surfs(i).Actor) { surfBrush(i) = k; break; }
    }
    int count = 0;
    for (int i = 0; i < m->Nodes.Num(); i++) {
        FBspNode& n = m->Nodes(i);
        if (n.NumVertices < 3 || n.iSurf < 0) continue;
        FBspSurf& s = m->Surfs(n.iSurf);
        if (s.PolyFlags & (PF_Invisible | PF_Portal)) continue;
        char tex[256] = "none";
        float tw = 128, th = 128;
        if (s.Texture) {
            WideCharToMultiByte(CP_UTF8, 0, (const WCHAR*)s.Texture->GetPathName(), -1, tex, sizeof(tex), NULL, NULL);
            float sc = s.Texture->Scale > 0 ? s.Texture->Scale : 1.f;
            tw = s.Texture->USize * sc;
            th = s.Texture->VSize * sc;
        }
        FVector b = m->Points(s.pBase), u = m->Vectors(s.vTextureU), v = m->Vectors(s.vTextureV);
        fprintf(f, "P %s %lu %g %g %g %g %g %g %g %g %g %d %d %g %g %d", tex, (unsigned long)s.PolyFlags,
                b.X, b.Y, b.Z, u.X, u.Y, u.Z, v.X, v.Y, v.Z, (int)s.PanU, (int)s.PanV, tw, th, (int)n.NumVertices);
        for (int k = 0; k < n.NumVertices; k++) {
            FVector& p = m->Points(m->Verts(n.iVertPool + k).pVertex);
            fprintf(f, " %g %g %g", p.X, p.Y, p.Z);
        }
        fprintf(f, " %d %d %d\n", surfBrush(n.iSurf), n.iSurf, s.iBrushPoly); // stable source face, not a transient BSP index
        count++;
    }
    fclose(f);
    printf("UCMapKit|bsp|%d polygons\n", count);
    return 1;
}

// UC_LIGHTDUMP <file>: the lighting of the map as the game draws it, for the map editor's "Lit" view.
// The SDK keeps, per lit surface, the shadow bits of every light that reaches it (LightBits, built by
// LIGHT APPLY); the game adds the lights up while drawing. Here: the same sum (light colour and
// brightness, radius falloff, angle of incidence, spotlight cone, shadow bits) plus the zone ambient.
//   S <surf> <w> <h> <pan u> <pan v> <uscale> <vscale> <hex RGB texels>   lattice point (i,j) where the
//       surface's texture coordinates are (pan u + i*uscale, pan v + j*vscale); RGB: lighting 0..2 as 0..255
//   A <actor> <r> <g> <b>   light on a mesh actor or mover: the brighter of the lights that see its centre
//       and the light of the floor under it (from the lightmap, so with the real shadows), + ambient
//   L <x> <y> <z> <r> <g> <b> <radius> <effect> <dir x> <dir y> <dir z> <cone>   every light (colour with the
//       brightness curve), numbered from 0 in order, for the editor's own per-vertex lighting of the objects
//   V <actor> <ambient r g b> <light numbers, comma separated, or ->   what the game lights an object with:
//       its zone's ambient (+ what the floor under it adds, when its centre sees no light) and the lights
//       that see its centre (the engine lights meshes per vertex, each light all or nothing)
//   C <mapping check: surfaces whose polygons fall inside their lightmap> <surfaces>
static void wtext(const TCHAR* s, char* out, int size);

static FVector lightColour(BYTE H, BYTE S, BYTE V) {
    FVector hue = H < 86 ? FVector((85 - H) / 85.f, H / 85.f, 0)
                : H < 171 ? FVector(0, (170 - H) / 85.f, (H - 85) / 85.f)
                : FVector((H - 170) / 85.f, 0, (255 - H) / 85.f);
    // the engine's brightness curve (FGetHSV): dim lights and ambients count for much more than V/255
    float b = V * 1.4f / 255.f;
    b *= 0.70f / (0.01f + appSqrt(b));
    b = Clamp(b, 0.f, 1.f);
    return (hue + (FVector(1, 1, 1) - hue) * (S / 255.f)) * b;
}

static FVector lightAt(AActor* l, const FVector& p, const FVector* normal) {
    if (!l || l->LightType == 0 || l->LightBrightness == 0) return FVector(0, 0, 0);
    FVector d = l->Location - p;
    float dist = d.Size(), radius = 25.f * (l->LightRadius + 1);
    if (dist >= radius) return FVector(0, 0, 0);
    float f = 1.f - dist / radius;
    if (normal && l->LightEffect != 13 /* LE_NonIncidence */ && dist > 0.01f) {
        float inc = (d | *normal) / dist;
        if (inc <= 0) return FVector(0, 0, 0);
        f *= inc;
    }
    if ((l->LightEffect == 12 /* LE_Spotlight */ || l->LightEffect == 8 /* LE_StaticSpot */) && dist > 0.01f) {
        float c = -(d | l->Rotation.Vector()) / dist;
        float edge = appCos(l->LightCone * PI / 512.f);
        if (c <= edge) return FVector(0, 0, 0);
        f *= Min(1.f, (c - edge) / Max(0.05f, 1.f - edge) * 2.f);
    }
    return lightColour(l->LightHue, l->LightSaturation, l->LightBrightness) * f;
}

static FVector ambientOf(AZoneInfo* z) {
    if (!z) z = GEditor->Level->GetLevelInfo();
    return z ? lightColour(z->AmbientHue, z->AmbientSaturation, z->AmbientBrightness) : FVector(0, 0, 0);
}

// a point in the XY projection of a (convex) BSP polygon
static int insideXY(UModel* m, FBspNode& n, float x, float y) {
    int pos = 0, neg = 0;
    for (int k = 0; k < n.NumVertices; k++) {
        FVector a = m->Points(m->Verts(n.iVertPool + k).pVertex);
        FVector b = m->Points(m->Verts(n.iVertPool + (k + 1) % n.NumVertices).pVertex);
        float c = (b.X - a.X) * (y - a.Y) - (b.Y - a.Y) * (x - a.X);
        if (c > 0.01f) pos++; else if (c < -0.01f) neg++;
    }
    return n.NumVertices >= 3 && !(pos && neg);
}

static int dumpLights(const char* line) {
    char path[512];
    if (sscanf(line, "UC_LIGHTDUMP %511s", path) != 1) return 0;
    if (!GEditor->Level || !GEditor->Level->Model) return 0;
    UModel* m = GEditor->Level->Model;
    FILE* f = fopen(path, "wt");
    if (!f) return 0;
    int surfs = 0, fit = 0, checked = 0;
    static char hex[] = "0123456789abcdef";
    TArray<INT> firstNode;
    firstNode.Add(m->Surfs.Num());
    for (int i = 0; i < m->Surfs.Num(); i++) firstNode(i) = INDEX_NONE;
    for (int i = 0; i < m->Nodes.Num(); i++)
        if (m->Nodes(i).iSurf >= 0 && firstNode(m->Nodes(i).iSurf) == INDEX_NONE) firstNode(m->Nodes(i).iSurf) = i;
    // the lighting of every lattice point (ambient, lights not doubled) kept for the floors under the objects
    TArray<INT> texelAt;
    TArray<FVector> texels, ambients;
    texelAt.Add(m->Surfs.Num());
    ambients.AddZeroed(m->Surfs.Num());
    for (int s = 0; s < m->Surfs.Num(); s++) texelAt(s) = INDEX_NONE;
    for (int s = 0; s < m->Surfs.Num(); s++) {
        FBspSurf& surf = m->Surfs(s);
        if (surf.iLightMap == INDEX_NONE || surf.iLightMap >= m->LightMap.Num()) continue;
        FLightMapIndex& lm = m->LightMap(surf.iLightMap);
        int w = lm.UClamp, h = lm.VClamp;
        if (w <= 0 || h <= 0 || w > 1024 || h > 1024) continue;
        // lightmap coordinates live in the surface's texture space (checked on every surface of a map):
        //   u = ((P - Base) . TextureU - Pan.X) / UScale,  v = ((P - Base) . TextureV - Pan.Y) / VScale
        // the world point of lattice point (i, j): the plane point with those texture coordinates
        FVector normal = m->Vectors(surf.vNormal), base = m->Points(surf.pBase);
        FVector tu = m->Vectors(surf.vTextureU), tv = m->Vectors(surf.vTextureV);
        FVector bxc = tv ^ normal, cxa = normal ^ tu, axb = tu ^ tv;
        float det = tu | bxc;
        if (Abs(det) < 1e-6f) continue;
        if (firstNode(s) != INDEX_NONE) {
            FBspNode& n = m->Nodes(firstNode(s));
            int inside = 1;
            for (int k = 0; k < n.NumVertices; k++) {
                FVector d = m->Points(m->Verts(n.iVertPool + k).pVertex) - base;
                float u = ((d | tu) - lm.Pan.X) / lm.UScale, v = ((d | tv) - lm.Pan.Y) / lm.VScale;
                if (u < -1.5f || v < -1.5f || u > w + 1.5f || v > h + 1.5f) inside = 0;
            }
            fit += inside;
            checked++;
        }
        AZoneInfo* zone = NULL;
        if (firstNode(s) != INDEX_NONE) zone = m->Zones[m->Nodes(firstNode(s)).iZone[1]].ZoneActor;
        FVector ambient = ambientOf(zone);
        // the lights of this surface: Lights(iLightActors...) up to a NULL, one shadow mask each
        TArray<AActor*> lights;
        if (lm.iLightActors != INDEX_NONE)
            for (int k = lm.iLightActors; k < m->Lights.Num() && m->Lights(k); k++) lights.AddItem(m->Lights(k));
        int stride = (w + 7) / 8;
        texelAt(s) = texels.Num();
        ambients(s) = ambient;
        texels.AddZeroed(w * h);
        fprintf(f, "S %d %d %d %g %g %g %g ", s, w, h, lm.Pan.X, lm.Pan.Y, lm.UScale, lm.VScale);
        for (int j = 0; j < h; j++) {
            for (int i = 0; i < w; i++) {
                float r1 = lm.Pan.X + i * lm.UScale, r2 = lm.Pan.Y + j * lm.VScale;
                FVector p = base + (bxc * r1 + cxa * r2) / det + normal * 2.f;
                FVector lit(0, 0, 0);
                for (int k = 0; k < lights.Num(); k++) {
                    int byte = lm.DataOffset + k * stride * h + j * stride + (i >> 3);
                    if (byte < 0 || byte >= m->LightBits.Num()) continue;
                    if (!(m->LightBits(byte) & (1 << (i & 7)))) continue;     // in shadow
                    lit += lightAt(lights(k), p, &normal);
                }
                texels(texelAt(s) + j * w + i) = lit;
                FVector c = ambient + lit * 2.f;     // the lights are overbright on the surfaces (ambient is not)
                BYTE rgb[3] = { (BYTE)Clamp(appFloor(c.X * 127.5f), 0, 255), (BYTE)Clamp(appFloor(c.Y * 127.5f), 0, 255),
                                (BYTE)Clamp(appFloor(c.Z * 127.5f), 0, 255) };
                for (int q = 0; q < 3; q++) { fputc(hex[rgb[q] >> 4], f); fputc(hex[rgb[q] & 15], f); }
            }
        }
        fputc('\n', f);
        surfs++;
    }
    // every light, numbered, for the V lines
    TArray<AActor*> allLights;
    for (int k = 0; k < GEditor->Level->Actors.Num(); k++) {
        AActor* l = GEditor->Level->Actors(k);
        if (!l || !l->LightType || !l->LightBrightness) continue;
        FVector col = lightColour(l->LightHue, l->LightSaturation, l->LightBrightness), dir = l->Rotation.Vector();
        fprintf(f, "L %.1f %.1f %.1f %.4f %.4f %.4f %.1f %d %.4f %.4f %.4f %d\n", l->Location.X, l->Location.Y,
                l->Location.Z, col.X, col.Y, col.Z, 25.f * (l->LightRadius + 1), (int)l->LightEffect, dir.X, dir.Y, dir.Z,
                (int)l->LightCone);
        allLights.AddItem(l);
    }
    // objects and doors: the lights that see their centre (walls cast shadows; x2 overbright, x0.5 the
    // average angle on a body) plus the ambient of their zone. A centre that is inside or behind something
    // (a barrel against a grille, a lamp inside its fitting) would leave it black: the light of the floor
    // under it (the lightmap: the real shadows, lights not doubled) is the lower bound.
    int floors = 0;
    for (int i = 0; i < GEditor->Level->Actors.Num(); i++) {
        AActor* a = GEditor->Level->Actors(i);
        if (!a || !((a->DrawType == DT_Mesh && a->Mesh) || a->IsMovingBrush())) continue;
        FVector c = ambientOf(a->Region.Zone), zoneAmbient = c;
        char seen[4096];
        int used = 0;
        seen[0] = 0;
        for (int k = 0; k < allLights.Num(); k++) {
            AActor* l = allLights(k);
            if (l != a && (l->Location - a->Location).SizeSquared() < Square(25.f * (l->LightRadius + 1))
                && m->FastLineCheck(a->Location, l->Location)) {
                c += lightAt(l, a->Location, NULL);
                if (used < (int)sizeof(seen) - 16) used += sprintf(seen + used, used ? ",%d" : "%d", k);
            }
        }
        // the floor: the highest upward polygon with a lightmap between the centre and a little under the feet
        float x = a->Location.X, y = a->Location.Y, top = a->Location.Z + 4.f;
        float low = a->Location.Z - Max(a->CollisionHeight, 16.f) - 48.f, best = -1e9f;
        int bestNode = INDEX_NONE;
        for (int n = 0; n < m->Nodes.Num(); n++) {
            FBspNode& node = m->Nodes(n);
            if (node.iSurf < 0 || texelAt(node.iSurf) == INDEX_NONE || Abs(node.Plane.Z) < 0.5f) continue;
            if (m->Vectors(m->Surfs(node.iSurf).vNormal).Z < 0.5f) continue;
            float z = (node.Plane.W - node.Plane.X * x - node.Plane.Y * y) / node.Plane.Z;
            if (z > top || z < low || z <= best || !insideXY(m, node, x, y)) continue;
            best = z;
            bestNode = n;
        }
        FVector occl = c, fl(-1, -1, -1);
        if (bestNode != INDEX_NONE) {
            int s = m->Nodes(bestNode).iSurf;
            FBspSurf& surf = m->Surfs(s);
            FLightMapIndex& lm = m->LightMap(surf.iLightMap);
            int w = lm.UClamp, h = lm.VClamp;
            FVector d = FVector(x, y, best) - m->Points(surf.pBase);
            float u = Clamp(((d | m->Vectors(surf.vTextureU)) - lm.Pan.X) / lm.UScale, 0.f, (float)(w - 1));
            float v = Clamp(((d | m->Vectors(surf.vTextureV)) - lm.Pan.Y) / lm.VScale, 0.f, (float)(h - 1));
            int i0 = Min(appFloor(u), w - 1), j0 = Min(appFloor(v), h - 1), i1 = Min(i0 + 1, w - 1), j1 = Min(j0 + 1, h - 1);
            float fu = u - i0, fv = v - j0;
            FVector* t = &texels(texelAt(s));
            FVector lit = t[j0 * w + i0] * ((1 - fu) * (1 - fv)) + t[j0 * w + i1] * (fu * (1 - fv))
                        + t[j1 * w + i0] * ((1 - fu) * fv) + t[j1 * w + i1] * (fu * fv);
            fl = ambients(s) + lit;
            if (fl.X + fl.Y + fl.Z > c.X + c.Y + c.Z) { c = fl; floors++; }
        }
        // the floor's extra light (when it is brighter than the lights the centre sees) as flat light
        FVector extra = c - occl;
        FVector amb = zoneAmbient + FVector(Max(extra.X, 0.f), Max(extra.Y, 0.f), Max(extra.Z, 0.f));
        char name[128];
        wtext(a->GetName(), name, sizeof(name));
        fprintf(f, "A %s %.3f %.3f %.3f\n", name, c.X, c.Y, c.Z);
        fprintf(f, "V %s %.3f %.3f %.3f %s\n", name, amb.X, amb.Y, amb.Z, used ? seen : "-");
    }
    fprintf(f, "C %d %d\n", fit, checked);
    fclose(f);
    printf("UCMapKit|lights|%d surfaces|mapping %d/%d|%d objects lit by their floor\n", surfs, fit, checked, floors);
    return 1;
}

// UC_MESHES <file>: the real look of every mesh actor (crates, barrels, people, the helicopter) and of
// every mover (doors), for the 3D view of the map editor. Coordinates relative to the actor's
// Location, unrotated, with its DrawScale, skins and current animation frame. One header line per
// actor, then one line per triangle with texture, flags and normalised UVs:
// A <name> <class> <mesh|mover> <style> <triangles>
// T <texture path> <flags> x y z u v  x y z u v  x y z u v
static void wtext(const TCHAR* s, char* out, int size) {
    WideCharToMultiByte(CP_UTF8, 0, (const WCHAR*)s, -1, out, size, NULL, NULL);
}

// SEH helpers (no C++ objects to unwind in these frames)
static int safeFrame(UMesh* mesh, ULodMesh* lod, FVector* out, AActor* a) {
    __try {
        if (lod) {
            INT request = lod->ModelVerts;
            lod->GetFrame(out, sizeof(FVector), GMath.UnitCoords, a, request);
        } else {
            mesh->Tris.Load();
            mesh->GetFrame(out, sizeof(FVector), GMath.UnitCoords, a);
        }
    } __except (EXCEPTION_EXECUTE_HANDLER) { return 0; }
    return 1;
}

static UTexture* safeTexture(UMesh* mesh, int index, AActor* a) {
    __try { return mesh->GetTexture(index, a); } __except (EXCEPTION_EXECUTE_HANDLER) { return NULL; }
}

static int dumpMeshes(const char* line) {
    char path[512];
    if (sscanf(line, "UC_MESHES %511s", path) != 1) return 0;
    if (!GEditor->Level) return 0;
    FILE* f = fopen(path, "wt");
    if (!f) return 0;
    int actors = 0, tris = 0;
    for (int i = 0; i < GEditor->Level->Actors.Num(); i++) {
        AActor* a = GEditor->Level->Actors(i);
        if (!a) continue;
        char name[128], cls[128];
        wtext(a->GetName(), name, sizeof(name));
        wtext(a->GetClass()->GetName(), cls, sizeof(cls));
        if (a->DrawType == DT_Mesh && a->Mesh) {
            UMesh* mesh = a->Mesh;
            FVector loc = a->Location;
            FRotator rot = a->Rotation;
            a->Location = FVector(0, 0, 0);
            a->Rotation = FRotator(0, 0, 0);
            ULodMesh* lod = mesh->IsA(ULodMesh::StaticClass()) ? (ULodMesh*)mesh : NULL;
            int count = mesh->FrameVerts + (lod ? lod->ModelVerts + lod->SpecialVerts : 0) + 64;
            FVector* verts = (FVector*)calloc(count, sizeof(FVector));
            int ok = safeFrame(mesh, lod, verts, a);
            a->Location = loc;
            a->Rotation = rot;
            if (!ok) { free(verts); printf("UCMapKit|mesh fault|%s\n", name); continue; }
            int n = lod ? lod->Faces.Num() : mesh->Tris.Num();
            fprintf(f, "A %s %s mesh %d %d\n", name, cls, (int)a->Style, n);
            for (int k = 0; k < n; k++) {
                int iv[3], material;
                float uv[3][2];
                DWORD flags;
                if (lod) {
                    FMeshFace& face = lod->Faces(k);
                    for (int j = 0; j < 3; j++) {
                        FMeshWedge& w = lod->Wedges(face.iWedge[j]);
                        // GetFrame puts the special verts (weapon attach triangles of the characters)
                        // first; the wedges count the regular verts after them
                        iv[j] = w.iVertex + lod->SpecialVerts;
                        uv[j][0] = w.TexUV.U / 256.f;
                        uv[j][1] = w.TexUV.V / 256.f;
                    }
                    FMeshMaterial& m = lod->Materials(face.MaterialIndex);
                    material = m.TextureIndex;
                    flags = m.PolyFlags;
                } else {
                    FMeshTri& t = mesh->Tris(k);
                    for (int j = 0; j < 3; j++) {
                        iv[j] = t.iVertex[j];
                        uv[j][0] = t.Tex[j].U / 256.f;
                        uv[j][1] = t.Tex[j].V / 256.f;
                    }
                    material = t.TextureIndex;
                    flags = t.PolyFlags;
                }
                char tex[256] = "none";
                UTexture* texture = safeTexture(mesh, material, a);
                if (texture) wtext(texture->GetPathName(), tex, sizeof(tex));
                fprintf(f, "T %s %lu", tex, (unsigned long)flags);
                for (int j = 0; j < 3; j++) {
                    FVector p = (iv[j] >= 0 && iv[j] < count) ? verts[iv[j]] : FVector(0, 0, 0);
                    fprintf(f, " %.2f %.2f %.2f %.4f %.4f", p.X, p.Y, p.Z, uv[j][0], uv[j][1]);
                }
                fprintf(f, " %d\n", material);          // the skin slot (MultiSkins index) of this face
                tris++;
            }
            free(verts);
            actors++;
        } else if (a->IsMovingBrush() && a->Brush && a->Brush->Polys) {
            TTransArray<FPoly>& polys = a->Brush->Polys->Element;
            int n = 0;
            for (int k = 0; k < polys.Num(); k++) n += polys(k).NumVertices >= 3 ? polys(k).NumVertices - 2 : 0;
            fprintf(f, "A %s %s mover %d %d\n", name, cls, (int)a->Style, n);
            for (int k = 0; k < polys.Num(); k++) {
                FPoly& p = polys(k);
                char tex[256] = "none";
                float tw = 128, th = 128;
                if (p.Texture) {
                    wtext(p.Texture->GetPathName(), tex, sizeof(tex));
                    float sc = p.Texture->Scale > 0 ? p.Texture->Scale : 1.f;
                    tw = p.Texture->USize * sc;
                    th = p.Texture->VSize * sc;
                }
                for (int j = 1; j + 1 < p.NumVertices; j++) {
                    int idx[3] = {0, j, j + 1};
                    fprintf(f, "T %s %lu", tex, (unsigned long)p.PolyFlags);
                    for (int q = 0; q < 3; q++) {
                        FVector v = p.Vertex[idx[q]];
                        FVector d = v - p.Base;
                        float u = ((d | p.TextureU) + p.PanU) / tw, w = ((d | p.TextureV) + p.PanV) / th;
                        FVector l = v - a->PrePivot;
                        fprintf(f, " %.2f %.2f %.2f %.4f %.4f", l.X, l.Y, l.Z, u, w);
                    }
                    fputc('\n', f);
                    tris++;
                }
            }
            actors++;
        }
    }
    fclose(f);
    printf("UCMapKit|meshes|%d actors|%d triangles\n", actors, tris);
    return 1;
}

// UC_TEXDUMP <texture path> <file>: a texture as raw RGBA (the largest mip up to 256 pixels), also
// for the compressed (DXT1) and true-colour textures of Revision that OBJ EXPORT writes as empty files.
// File: "UCTEX <w> <h>\n" then w*h*4 bytes.
static void dxt1Block(const BYTE* b, BYTE out[16][4]) {
    WORD c0 = b[0] | (b[1] << 8), c1 = b[2] | (b[3] << 8);
    BYTE col[4][4];
    for (int i = 0; i < 2; i++) {
        WORD c = i ? c1 : c0;
        col[i][0] = (BYTE)(((c >> 11) & 31) * 255 / 31);
        col[i][1] = (BYTE)(((c >> 5) & 63) * 255 / 63);
        col[i][2] = (BYTE)((c & 31) * 255 / 31);
        col[i][3] = 255;
    }
    for (int k = 0; k < 3; k++) {
        if (c0 > c1) {
            col[2][k] = (BYTE)((2 * col[0][k] + col[1][k]) / 3);
            col[3][k] = (BYTE)((col[0][k] + 2 * col[1][k]) / 3);
        } else {
            col[2][k] = (BYTE)((col[0][k] + col[1][k]) / 2);
            col[3][k] = 0;
        }
    }
    col[2][3] = 255;
    col[3][3] = c0 > c1 ? 255 : 0;
    DWORD bits = b[4] | (b[5] << 8) | (b[6] << 16) | ((DWORD)b[7] << 24);
    for (int i = 0; i < 16; i++) {
        int idx = (bits >> (2 * i)) & 3;
        for (int k = 0; k < 4; k++) out[i][k] = col[idx][k];
    }
}

// The mip table of a loaded texture, read at the place the engine really keeps it: in this engine
// UTexture::Mips sits 4 bytes before the SDK header's field (worked out from the bytes: the header's
// "Data" read the real ArrayNum). Each mip is 40 bytes: DataPtr, USize, VSize, UBits, VBits (16),
// the lazy loader (vtable, archive, SavedPos: negative once loaded), then Data, Num, Max.
struct UCMip { int usize, vsize, savedPos, num; BYTE* data; };

static int readMipAt(UTexture* t, int shift, int index, UCMip* out) {
    __try {
        BYTE* mipsField = (BYTE*)&t->Mips + shift;
        BYTE* base = *(BYTE**)mipsField;
        int count = *(int*)(mipsField + 4);
        if (!base || count <= 0 || count > 16 || index < 0 || index >= count) return 0;
        if (IsBadReadPtr(base, 40 * count)) return 0;
        BYTE* e = base + index * 40;
        out->usize = *(int*)(e + 4);
        out->vsize = *(int*)(e + 8);
        out->savedPos = *(int*)(e + 0x18);
        out->data = *(BYTE**)(e + 0x1c);
        out->num = *(int*)(e + 0x20);
        return out->usize > 0 && out->vsize > 0 && out->data != NULL;
    } __except (EXCEPTION_EXECUTE_HANDLER) { return 0; }
}

// the mip table where it really is: at the header's place when the host is built with the engine's
// 4-byte packing (/Zp4), 4 bytes earlier with the compiler's default; checked against the texture size
static int mipShift = 1;
static int readMip(UTexture* t, int index, UCMip* out) {
    if (mipShift == 1) {
        UCMip m0;
        mipShift = (readMipAt(t, 0, 0, &m0) && m0.usize == t->USize && m0.vsize == t->VSize) ? 0 : -4;
    }
    return readMipAt(t, mipShift, index, out);
}
// a mip not loaded yet (lazy: SavedPos > 0) is loaded through its own TLazyArray (the loader sits at
// +0x10 of the 40 bytes, its virtual Load is the engine's)
static int loadMip(UTexture* t, int index) {
    __try {
        BYTE* mipsField = (BYTE*)&t->Mips + (mipShift == 1 ? 0 : mipShift);
        BYTE* base = *(BYTE**)mipsField;
        if (!base) return 0;
        FLazyLoader* lazy = (FLazyLoader*)(base + index * 40 + 0x10);
        lazy->Load();
    } __except (EXCEPTION_EXECUTE_HANDLER) { return 0; }
    return 1;
}

// UC_TEXFLAGS <file>: the PolyFlags of every loaded texture that has some ("<path> <flags>" per line).
// The renderer adds them to the flags of the surface: a fence texture is masked by itself even when the
// surfaces it is on are not (the map editor needs them to draw its transparent parts).
static int dumpTexFlags(const char* line) {
    char path[512];
    if (sscanf(line, "UC_TEXFLAGS %511s", path) != 1) return 0;
    FILE* f = fopen(path, "wt");
    if (!f) return 0;
    int n = 0, all = 0;
    for (TObjectIterator<UTexture> It; It; ++It) {
        all++;
        DWORD flags = It->PolyFlags;
        if (!flags) continue;
        char name[256];
        wtext(It->GetPathName(), name, sizeof(name));
        fprintf(f, "%s %lu\n", name, (unsigned long)flags);
        n++;
    }
    fclose(f);
    printf("UCMapKit|texflags|%d of %d textures\n", n, all);
    return 1;
}

static int dumpTexture(const char* line) {
    char name[256], path[512];
    int maxSize = 256;                              // UC_TEXDUMP <tex> <file> [largest side]: 256 by default
    if (sscanf(line, "UC_TEXDUMP %255s %511s %d", name, path, &maxSize) < 2) return 0;
    TCHAR wname[256];
    MultiByteToWideChar(CP_UTF8, 0, name, -1, (LPWSTR)wname, 256);
    UTexture* t = (UTexture*)UObject::StaticLoadObject(UTexture::StaticClass(), NULL, wname, NULL, LOAD_NoWarn | LOAD_Quiet, NULL);
    if (!t) { printf("UCMapKit|texdump|missing|%s\n", name); return 1; }
    printf("UCMapKit|texdump|info|%s|%dx%d|scale %g|format %d\n", name, t->USize, t->VSize, t->Scale, (int)t->Format);
    // the largest mip up to maxSize pixels whose size checks out against the texture's own
    UCMip m, pick;
    int found = 0, at = 0;
    for (int i = 0; i < 16 && readMip(t, i, &m); i++) {
        if (m.usize != (t->USize >> i) && i == 0) break;           // layout not as expected: give up
        pick = m;
        at = i;
        found = 1;
        if (m.usize <= maxSize && m.vsize <= maxSize) break;
    }
    if (found && pick.savedPos > 0 && loadMip(t, at)) readMip(t, at, &pick);
    if (!found || pick.savedPos > 0) { printf("UCMapKit|texdump|nodata|%s\n", name); return 1; }
    int w = pick.usize, h = pick.vsize;
    BYTE* rgba = (BYTE*)calloc(w * h, 4);
    BYTE* d = pick.data;
    int n = pick.num, ok = 1;
    if (t->Format == TEXF_P8 && t->Palette && n >= w * h) {
        int masked = (t->PolyFlags & PF_Masked) != 0;          // colour 0 of a masked texture is see-through
        for (int i = 0; i < w * h; i++) {
            FColor c = t->Palette->Colors(d[i]);
            rgba[i * 4 + 0] = c.R; rgba[i * 4 + 1] = c.G; rgba[i * 4 + 2] = c.B;
            rgba[i * 4 + 3] = (masked && d[i] == 0) ? 0 : 255;
        }
    } else if (t->Format == TEXF_DXT1 && w >= 4 && h >= 4 && n >= (w / 4) * (h / 4) * 8) {
        BYTE block[16][4];
        for (int by = 0; by < h / 4; by++)
            for (int bx = 0; bx < w / 4; bx++) {
                dxt1Block(d + (by * (w / 4) + bx) * 8, block);
                for (int i = 0; i < 16; i++) {
                    int x = bx * 4 + (i & 3), y = by * 4 + (i >> 2);
                    memcpy(rgba + (y * w + x) * 4, block[i], 4);
                }
            }
    } else if (t->Format == TEXF_RGBA8 && n >= w * h * 4) {
        for (int i = 0; i < w * h; i++) {          // stored B, G, R, A
            rgba[i * 4 + 0] = d[i * 4 + 2]; rgba[i * 4 + 1] = d[i * 4 + 1]; rgba[i * 4 + 2] = d[i * 4 + 0];
            rgba[i * 4 + 3] = d[i * 4 + 3];
        }
    } else if (t->Format == TEXF_RGB8 && n >= w * h * 3) {
        for (int i = 0; i < w * h; i++) {
            rgba[i * 4 + 0] = d[i * 3 + 2]; rgba[i * 4 + 1] = d[i * 3 + 1]; rgba[i * 4 + 2] = d[i * 3 + 0];
            rgba[i * 4 + 3] = 255;
        }
    } else ok = 0;
    if (ok) {
        FILE* f = fopen(path, "wb");
        if (f) {
            fprintf(f, "UCTEX %d %d\n", w, h);
            fwrite(rgba, 4, w * h, f);
            fclose(f);
        }
        printf("UCMapKit|texdump|ok|%s|%d %d|format %d\n", name, w, h, (int)t->Format);
    } else {
        printf("UCMapKit|texdump|format|%s|%d\n", name, (int)t->Format);
    }
    free(rgba);
    return 1;
}

// UC_CLASSES <file>: every actor class loaded (for the editor palette: all the objects of the game),
// one tab-separated line: C name package flags drawtype mesh radius height parents itemname familiarname
static int safeTextProp(UClass* c, BYTE* obj, const TCHAR* field, TCHAR* out) {
    out[0] = 0;
    __try {
        UProperty* p = FindField<UProperty>(c, field);
        if (!p) return 0;
        p->ExportText(0, out, obj, NULL, 0);
    } __except (EXCEPTION_EXECUTE_HANDLER) { out[0] = 0; return 0; }
    return 1;
}

static int listClasses(const char* line) {
    char path[512];
    if (sscanf(line, "UC_CLASSES %511s", path) != 1) return 0;
    FILE* f = fopen(path, "wt");
    if (!f) return 0;
    int n = 0;
    for (TObjectIterator<UClass> It; It; ++It) {
        UClass* c = *It;
        if (!c->IsChildOf(AActor::StaticClass())) continue;
        AActor* d = (AActor*)c->GetDefaultObject();
        if (!d) continue;
        char name[128], pkg[128], mesh[256] = "None", parents[1024] = "", item[256] = "", fam[256] = "";
        wtext(c->GetName(), name, sizeof(name));
        wtext(c->GetOuter()->GetName(), pkg, sizeof(pkg));
        if (d->Mesh) wtext(d->Mesh->GetPathName(), mesh, sizeof(mesh));
        for (UClass* s = c->GetSuperClass(); s && s != AActor::StaticClass(); s = s->GetSuperClass()) {
            char sn[128];
            wtext(s->GetName(), sn, sizeof(sn));
            if (strlen(parents) + strlen(sn) + 2 < sizeof(parents)) { strcat(parents, sn); strcat(parents, "/"); }
        }
        TCHAR buf[512];
        if (safeTextProp(c, (BYTE*)d, TEXT("ItemName"), buf)) wtext(buf, item, sizeof(item));
        if (safeTextProp(c, (BYTE*)d, TEXT("FamiliarName"), buf)) wtext(buf, fam, sizeof(fam));
        for (char* q = item; *q; q++) if (*q == '\t' || *q == '\n') *q = ' ';
        for (char* q = fam; *q; q++) if (*q == '\t' || *q == '\n') *q = ' ';
        fprintf(f, "C\t%s\t%s\t%lu\t%d\t%s\t%.2f\t%.2f\t%s\t%s\t%s\t%.4f\n", name, pkg, (unsigned long)c->ClassFlags,
                (int)d->DrawType, mesh, d->CollisionRadius, d->CollisionHeight, parents, item, fam, d->DrawScale);
        n++;
    }
    fclose(f);
    printf("UCMapKit|classes|%d\n", n);
    return 1;
}

// UC_DEFAULTS <file> <prop,prop,...>: the class defaults of those properties for every actor class (the
// map editor's Properties panel: a map's T3D only has what differs from the class). Lines:
//   C <class> <parents a/b/c/>          P <class> <prop> <index> <property type> <value>
//   E <prop> <enum value names separated by |>   (byte properties with an enum, once per property)
// ExportText adds the property's offset itself; Delta == Data exports even zero values (False, 0, None).
static int safeExport(UProperty* p, INT index, BYTE* obj, TCHAR* out) {
    out[0] = 0;
    __try { p->ExportText(index, out, obj, obj, 0); }
    __except (EXCEPTION_EXECUTE_HANDLER) { out[0] = 0; return 0; }
    return 1;
}

// Conversation data stays in a local cache. Export reflected properties, including zero/default
// values and full object paths, so Python can follow the native linked lists without guessing layouts.
static void conJsonText(FILE* f, const TCHAR* value) {
    int n = WideCharToMultiByte(CP_UTF8, 0, (LPCWSTR)value, -1, NULL, 0, NULL, NULL);
    char* text = (char*)malloc(n > 0 ? n : 1);
    if (n > 0) WideCharToMultiByte(CP_UTF8, 0, (LPCWSTR)value, -1, text, n, NULL, NULL);
    else text[0] = 0;
    fputc('"', f);
    for (unsigned char* p = (unsigned char*)text; *p; ++p) {
        if (*p == '"' || *p == '\\') { fputc('\\', f); fputc(*p, f); }
        else if (*p < 32) fprintf(f, "\\u%04x", *p);
        else fputc(*p, f);
    }
    fputc('"', f); free(text);
}

static void conReadFunction(UObject* obj, UFunction* fun, void* params, void* result) {
    // UE1 ProcessEvent skips these final native functions. Invoke the reflected native thunk with
    // the same literal-int argument stream the VM uses (only the three read-only ConSys accessors).
    BYTE code[6]; INT used = 0;
    if (fun->ReturnValueOffset == sizeof(INT)) {
        code[used++] = EX_IntConst; memcpy(code + used, params, sizeof(INT)); used += sizeof(INT);
    }
    code[used] = EX_EndFunctionParms;
    FFrame frame(obj); frame.Node = fun; frame.Code = code;
    (obj->*fun->Func)(frame, result);
}

// Read only: text assets and the script source stored in installed packages. Keep the native
// ExtString accessor so neither Python nor the host guesses a private serialization layout.
static int dumpGameContent(const char* line, int scripts) {
    char package[128], path[512];
    if (sscanf(line, scripts ? "UC_SCRIPTDUMP %127s %511s" : "UC_TEXTDUMP %127s %511s", package, path) != 2) return 0;
    TCHAR pkg[128]; MultiByteToWideChar(CP_UTF8, 0, package, -1, (LPWSTR)pkg, 128);
    UObject* outer = FindObject<UPackage>(NULL, pkg);
    if (!outer) return 0;
    UClass* base = scripts ? UClass::StaticClass() : FindObject<UClass>(ANY_PACKAGE, TEXT("Extension.ExtString"));
    if (!base) return 0;
    FILE* f = fopen(path, "wb"); if (!f) return 0;
    int count = 0;
    for (TObjectIterator<UObject> it; it; ++it) {
        UObject* obj = *it;
        if (!obj->IsA(base) || !obj->IsIn(outer)) continue;
        FString value, parent;
        if (scripts) {
            UClass* cls = (UClass*)obj;
            if (!cls->ScriptText) continue;
            value = cls->ScriptText->Text;
            if (cls->GetSuperClass()) parent = cls->GetSuperClass()->GetPathName();
        } else {
            UFunction* fun = obj->FindFunction(TEXT("GetText"));
            if (!fun || !fun->Func) { fclose(f); return 0; }
            BYTE code[] = { EX_EndFunctionParms };
            FFrame frame(obj); frame.Node = fun; frame.Code = code;
            (obj->*fun->Func)(frame, &value);
        }
        fputs("{\"path\":", f); conJsonText(f, obj->GetPathName());
        fputs(",\"parent\":", f); conJsonText(f, *parent);
        fputs(",\"text\":", f); conJsonText(f, *value); fputs("}\n", f); ++count;
    }
    fclose(f); printf("UCMapKit|%s|%d\n", scripts ? "scripts" : "texts", count);
    return count > 0;
}

static int dumpConversations(const char* line) {
    char path[512];
    if (sscanf(line, "UC_CONDUMP %511s", path) != 1) return 0;
    UClass* base = FindObject<UClass>(ANY_PACKAGE, TEXT("ConSys.ConObject"));
    if (!base) return 0;
    FILE* f = fopen(path, "wb");
    if (!f) return 0;
    static TCHAR value[65536];
    int count = 0, errors = 0;
    for (TObjectIterator<UObject> it; it; ++it) {
        UObject* obj = *it;
        if (!obj->IsA(base)) continue;
        fputs("{\"class\":", f); conJsonText(f, obj->GetClass()->GetName());
        fputs(",\"path\":", f); conJsonText(f, obj->GetPathName());
        fputs(",\"properties\":{", f);
        int first = 1;
        for (TFieldIterator<UProperty> p(obj->GetClass()); p; ++p) {
            for (INT i = 0; i < p->ArrayDim; ++i) {
                if (!first) fputc(',', f); first = 0;
                TCHAR key[256];
                if (p->ArrayDim > 1) appSprintf(key, TEXT("%s(%d)"), p->GetName(), i);
                else appStrcpy(key, p->GetName());
                conJsonText(f, key); fputc(':', f);
                // Some original camera transitions contain an out-of-range enum byte. Export the
                // stored number in that case; ExportText would index past the enum's names.
                UByteProperty* byte = Cast<UByteProperty>(*p);
                INT raw = byte ? *((BYTE*)obj + p->Offset + i * p->ElementSize) : 0;
                if (byte && byte->Enum && raw >= byte->Enum->Names.Num()) {
                    appSprintf(value, TEXT("%d"), raw); conJsonText(f, value);
                }
                else if (safeExport(*p, i, (BYTE*)obj, value)) conJsonText(f, value);
                else { fputs("null", f); ++errors; }
            }
        }
        fputc('}', f);
        if (!appStricmp(obj->GetClass()->GetName(), TEXT("ConEventRandomLabel"))) {
            // The native DynamicArray property exposes its header, not its strings. Use ConSys'
            // read-only accessors for the actual random/cyclic jump targets.
            UFunction* sizeFn = obj->FindFunction(FName(TEXT("GetLabelCount")), 0);
            UFunction* itemFn = obj->FindFunction(FName(TEXT("GetLabel")), 0);
            INT size = 0;
            if (!sizeFn || !itemFn || sizeFn->ParmsSize != sizeof(INT)) { fclose(f); return 0; }
            conReadFunction(obj, sizeFn, &size, &size);
            if (size < 0 || size > 4096) { fclose(f); return 0; }
            fputs(",\"labels\":[", f);
            for (INT i = 0; i < size; ++i) {
                struct LabelParams { INT index; FString result; } params;
                if (itemFn->ParmsSize != sizeof(params) || itemFn->ReturnValueOffset != sizeof(INT)) { fclose(f); return 0; }
                params.index = i; conReadFunction(obj, itemFn, &params, &params.result);
                if (i) fputc(',', f); conJsonText(f, *params.result);
            }
            fputc(']', f);
        }
        fputs("}\n", f); ++count;
    }
    fclose(f);
    printf("UCMapKit|condump|%d|property errors %d\n", count, errors);
    return errors == 0 && count > 0;
}

// Resolve through ConSys itself, rather than infer sound names from a speech number.
static int conversationSound(const char* line) {
    char name[512], path[512]; INT id;
    if (sscanf(line, "UC_CONSOUND %511s %d %511s", name, &id, path) != 3 || id < 0) return 0;
    TCHAR wname[512];
    MultiByteToWideChar(CP_UTF8, 0, name, -1, (LPWSTR)wname, 512);
    UObject* obj = FindObject<UObject>(ANY_PACKAGE, wname);
    if (!obj) return 0;
    UFunction* fun = obj->FindFunction(FName(TEXT("GetSpeechAudio")), 0);
    if (!fun || fun->ParmsSize > 64 || fun->ReturnValueOffset + sizeof(UObject*) > fun->ParmsSize) return 0;
    BYTE params[64] = {0};
    UProperty* arg = FindField<UProperty>(fun, TEXT("soundID"));
    if (!arg || arg->Offset + sizeof(INT) > fun->ParmsSize) return 0;
    *(INT*)(params + arg->Offset) = id;
    conReadFunction(obj, fun, params, params + fun->ReturnValueOffset);
    UObject* sound = *(UObject**)(params + fun->ReturnValueOffset);
    FILE* f = fopen(path, "ab");
    if (!f) return 0;
    fputs("{\"conversation\":", f); conJsonText(f, wname);
    fprintf(f, ",\"id\":%d,\"sound\":", id);
    if (sound && sound->IsA(USound::StaticClass())) conJsonText(f, sound->GetPathName());
    else fputs("null", f);
    fputs("}\n", f); fclose(f);
    printf("UCMapKit|consound|%s|%d|%s\n", name, id, sound ? "found" : "missing");
    return 1;
}

static int dumpDefaults(const char* line) {
    // the Properties panel's names: 87 on 13 Oct 2026 (it was cut at 64, so some fields never showed)
    static char list[7680];
    char path[512];
    if (sscanf(line, "UC_DEFAULTS %511s %7679s", path, list) != 2) return 0;
    FILE* f = fopen(path, "wt");
    if (!f) return 0;
    static char props[256][64];
    int np = 0;
    for (char* t = strtok(list, ","); t && np < 256; t = strtok(NULL, ",")) { strncpy(props[np], t, 63); props[np][63] = 0; np++; }
    char enumsDone[256] = { 0 };
    static TCHAR buf[16384];
    int n = 0;
    for (TObjectIterator<UClass> It; It; ++It) {
        UClass* c = *It;
        if (!c->IsChildOf(AActor::StaticClass())) continue;
        BYTE* d = (BYTE*)c->GetDefaultObject();
        if (!d) continue;
        char name[128], parents[1024] = "";
        wtext(c->GetName(), name, sizeof(name));
        for (UClass* s = c->GetSuperClass(); s; s = s->GetSuperClass()) {
            char sn[128];
            wtext(s->GetName(), sn, sizeof(sn));
            if (strlen(parents) + strlen(sn) + 2 < sizeof(parents)) { strcat(parents, sn); strcat(parents, "/"); }
        }
        fprintf(f, "C\t%s\t%s\n", name, parents);
        for (int k = 0; k < np; k++) {
            unsigned short wprop[64];
            MultiByteToWideChar(CP_UTF8, 0, props[k], -1, (LPWSTR)wprop, 64);
            UProperty* p = FindField<UProperty>(c, (const TCHAR*)wprop);
            if (!p) continue;
            char type[64];
            wtext(p->GetClass()->GetName(), type, sizeof(type));
            if (!enumsDone[k] && p->IsA(UByteProperty::StaticClass()) && ((UByteProperty*)p)->Enum) {
                UEnum* e = ((UByteProperty*)p)->Enum;
                fprintf(f, "E\t%s\t", props[k]);
                for (int i = 0; i < e->Names.Num(); i++) {
                    char en[128];
                    wtext(*e->Names(i), en, sizeof(en));
                    fprintf(f, "%s%s", i ? "|" : "", en);
                }
                fprintf(f, "\n");
                enumsDone[k] = 1;
            }
            int dim = p->ArrayDim > 8 ? 8 : p->ArrayDim;
            for (int i = 0; i < dim; i++) {
                if (!safeExport(p, i, d, buf)) continue;
                char value[4096];
                wtext(buf, value, sizeof(value));
                for (char* q = value; *q; q++) if (*q == '\t' || *q == '\n' || *q == '\r') *q = ' ';
                fprintf(f, "P\t%s\t%s\t%d\t%s\t%s\n", name, props[k], i, type, value);
            }
        }
        n++;
    }
    fclose(f);
    printf("UCMapKit|defaults|%d\n", n);
    return 1;
}

// Editing existing maps (the map editor on any .dx): actors and brushes are found by name.
// by name, or "@<Class>": the first actor of that class (or a subclass); "@LevelInfo" is the map's own
// (after MAP NEW the level's actors are not named as in the saved map)
static AActor* findActor(const char* name) {
    if (name[0] == '@') {
        if (!_stricmp(name + 1, "LevelInfo")) return GEditor->Level->GetLevelInfo();
        for (int i = 0; i < GEditor->Level->Actors.Num(); i++) {
            AActor* a = GEditor->Level->Actors(i);
            if (!a) continue;
            for (UClass* c = a->GetClass(); c; c = c->GetSuperClass()) {
                char n[128];
                wtext(c->GetName(), n, sizeof(n));
                if (!_stricmp(n, name + 1)) return a;
            }
        }
        return NULL;
    }
    for (int i = 0; i < GEditor->Level->Actors.Num(); i++) {
        AActor* a = GEditor->Level->Actors(i);
        if (!a) continue;
        char n[128];
        wtext(a->GetName(), n, sizeof(n));
        if (!_stricmp(n, name)) return a;
    }
    return NULL;
}

// UC_SET <name> x y z pitch yaw roll: place an actor or a brush (doors keep their base with them).
static int setActor(const char* line) {
    char name[128];
    float x, y, z;
    int p, yw, r;
    if (sscanf(line, "UC_SET %127s %f %f %f %d %d %d", name, &x, &y, &z, &p, &yw, &r) != 7) return 0;
    if (!GEditor->Level) return 0;
    AActor* a = findActor(name);
    if (!a) { printf("UCMapKit|set|missing|%s\n", name); return 1; }
    a->Location = FVector(x, y, z);
    a->Rotation = FRotator(p, yw, r);
    if (a->IsA(AMover::StaticClass())) {
        AMover* m = (AMover*)a;
        m->BasePos = a->Location;
        m->BaseRot = a->Rotation;
        m->OldPos = a->Location;
        m->SavedPos = a->Location;
    }
    printf("UCMapKit|set|ok|%s\n", name);
    return 1;
}

// UC_DEL <name>: remove an actor or a brush.
static int deleteActor(const char* line) {
    char name[128];
    if (sscanf(line, "UC_DEL %127s", name) != 1) return 0;
    if (!GEditor->Level) return 0;
    AActor* a = findActor(name);
    if (!a) { printf("UCMapKit|del|missing|%s\n", name); return 1; }
    GEditor->Level->DestroyActor(a);
    printf("UCMapKit|del|ok|%s\n", name);
    return 1;
}

// UC_PROP <name> <property>[(index)] <value...>: one property of an actor as text, the way the property
// window of UnrealEd sets it (DrawScale 1.5, MultiSkins(1) Texture'MyLevel.UCTex1', BindName "Guard").
static int safeImport(UProperty* p, const TCHAR* text, BYTE* data) {
    __try {
        return p->ImportText(text, data, 0) != NULL;
    } __except (EXCEPTION_EXECUTE_HANDLER) { return 0; }
}

static int setPropOn(AActor* a, const char* name, char* prop, const char* value);
static int setProp(const char* line) {
    char name[128], prop[128];
    int used = 0;
    if (sscanf(line, "UC_PROP %127s %127s %n", name, prop, &used) < 2 || !used) return 0;
    if (!GEditor->Level) return 0;
    if (name[0] == '@' && name[1] == '@') {         // "@@<Class>": every actor of that class
        int n = 0;
        for (int i = 0; i < GEditor->Level->Actors.Num(); i++) {
            AActor* a = GEditor->Level->Actors(i);
            if (!a) continue;
            for (UClass* c = a->GetClass(); c; c = c->GetSuperClass()) {
                char cn[128];
                wtext(c->GetName(), cn, sizeof(cn));
                if (!_stricmp(cn, name + 2)) { char pr[128]; strcpy(pr, prop); setPropOn(a, name, pr, line + used); n++; break; }
            }
        }
        printf("UCMapKit|prop|all|%s|%d\n", name + 2, n);
        return 1;
    }
    return setPropOn(findActor(name), name, prop, line + used);
}
static int setPropOn(AActor* a, const char* name, char* prop, const char* value) {
    if (!a) { printf("UCMapKit|prop|missing|%s\n", name); return 1; }
    int index = 0;
    char* paren = strchr(prop, '(');
    if (paren) { index = atoi(paren + 1); *paren = 0; }
    // a value can be long: the text of a book or a datacube (the command line is up to 8 KB)
    unsigned short wprop[128], wvalue[8192];
    MultiByteToWideChar(CP_UTF8, 0, prop, -1, (LPWSTR)wprop, 128);
    MultiByteToWideChar(CP_UTF8, 0, value, -1, (LPWSTR)wvalue, 8192);
    UProperty* p = FindField<UProperty>(a->GetClass(), (const TCHAR*)wprop);
    if (!p || index < 0 || index >= p->ArrayDim) { printf("UCMapKit|prop|noprop|%s|%s\n", name, prop); return 1; }
    if (!safeImport(p, (const TCHAR*)wvalue, (BYTE*)a + p->Offset + index * p->ElementSize)) {
        printf("UCMapKit|prop|failed|%s|%s\n", name, prop);
        return 1;
    }
    printf("UCMapKit|prop|ok|%s|%s\n", name, prop);
    return 1;
}

// Lossless string chunks: T3D has no reliable quote escaping, and UC_PROP's tokenization consumes
// leading whitespace. Hex transports UTF-8 without changing it; ImportText with flags=0 reads raw.
static int setTextHex(const char* line) {
    char name[128], prop[128], value[4096]; int used = 0;
    if (sscanf(line, "UC_TEXTHEX %127s %127s %n", name, prop, &used) < 2 || !used) return 0;
    const char* hex = line + used; size_t len = strlen(hex);
    if (len % 2 || len / 2 >= sizeof(value)) return 0;
    for (size_t i = 0; i < len; i += 2) {
        int a = hex[i] >= '0' && hex[i] <= '9' ? hex[i]-'0' : hex[i] >= 'a' && hex[i] <= 'f' ? hex[i]-'a'+10 : -1;
        int b = hex[i+1] >= '0' && hex[i+1] <= '9' ? hex[i+1]-'0' : hex[i+1] >= 'a' && hex[i+1] <= 'f' ? hex[i+1]-'a'+10 : -1;
        if (a < 0 || b < 0 || (a == 0 && b == 0)) return 0;
        value[i/2] = (char)((a << 4) | b);
    }
    value[len/2] = 0;
    return setPropOn(findActor(name), name, prop, value);
}

// UC_OBJPROP <object> <property> <value...>: a property of any object found by name (an imported
// texture's DrawScale), the same way as UC_PROP.
static int setObjProp(const char* line) {
    char name[256], prop[128];
    int used = 0;
    if (sscanf(line, "UC_OBJPROP %255s %127s %n", name, prop, &used) < 2 || !used) return 0;
    unsigned short wname[256], wprop[128], wvalue[1024];
    MultiByteToWideChar(CP_UTF8, 0, name, -1, (LPWSTR)wname, 256);
    MultiByteToWideChar(CP_UTF8, 0, prop, -1, (LPWSTR)wprop, 128);
    MultiByteToWideChar(CP_UTF8, 0, line + used, -1, (LPWSTR)wvalue, 1024);
    UObject* o = UObject::StaticFindObject(UObject::StaticClass(), ANY_PACKAGE, (const TCHAR*)wname);
    if (!o) { printf("UCMapKit|objprop|missing|%s\n", name); return 1; }
    UProperty* p = FindField<UProperty>(o->GetClass(), (const TCHAR*)wprop);
    if (!p) { printf("UCMapKit|objprop|noprop|%s|%s\n", name, prop); return 1; }
    if (!safeImport(p, (const TCHAR*)wvalue, (BYTE*)o + p->Offset)) { printf("UCMapKit|objprop|failed|%s|%s\n", name, prop); return 1; }
    printf("UCMapKit|objprop|ok|%s|%s\n", name, prop);
    return 1;
}

// UC_SCALE <name> <factor>: an object made bigger or smaller (map editor, R): its DrawScale and its
// collision cylinder are multiplied, starting from what the engine has (class defaults included).
static int scaleActor(const char* line) {
    char name[128];
    float f;
    if (sscanf(line, "UC_SCALE %127s %f", name, &f) != 2 || !(f > 0.01f && f < 100.0f)) return 0;
    if (!GEditor->Level) return 0;
    AActor* a = findActor(name);
    if (!a) { printf("UCMapKit|scale|missing|%s\n", name); return 1; }
    a->DrawScale *= f;
    a->CollisionRadius *= f;
    a->CollisionHeight *= f;
    a->PrePivot *= f;               // a model centred on its cylinder (the editor's Models) stays centred
    printf("UCMapKit|scale|ok|%s|%.3f|%.2f|%.2f\n", name, a->DrawScale, a->CollisionRadius, a->CollisionHeight);
    return 1;
}

// UC_SURFTEX <brush> <old texture name or *> <new texture>: retexture the faces of one brush (its polys
// and the BSP surfaces it made) without a rebuild, so the lighting of an original map stays.
static int retextureBrush(AActor* a, const char* oldt, UTexture* tex) {
    int all = !strcmp(oldt, "*"), n = 0;
    char tn[256];
    if (a->Brush && a->Brush->Polys) {
        for (int i = 0; i < a->Brush->Polys->Element.Num(); i++) {
            FPoly& poly = a->Brush->Polys->Element(i);
            if (!poly.Texture) continue;
            wtext(poly.Texture->GetName(), tn, sizeof(tn));
            if (all || !_stricmp(tn, oldt)) { poly.Texture = tex; n++; }
        }
    }
    UModel* model = GEditor->Level->Model;
    for (int i = 0; i < model->Surfs.Num(); i++) {
        FBspSurf& s = model->Surfs(i);
        if ((AActor*)s.Actor != a || !s.Texture) continue;
        wtext(s.Texture->GetName(), tn, sizeof(tn));
        if (all || !_stricmp(tn, oldt)) { s.Texture = tex; n++; }
    }
    return n;
}

static int setSurfTexture(const char* line) {
    char name[128], oldt[128], newt[256];
    if (sscanf(line, "UC_SURFTEX %127s %127s %255s", name, oldt, newt) != 3) return 0;
    if (!GEditor->Level || !GEditor->Level->Model) return 0;
    unsigned short wnew[256];
    MultiByteToWideChar(CP_UTF8, 0, newt, -1, (LPWSTR)wnew, 256);
    UTexture* tex = (UTexture*)UObject::StaticFindObject(UTexture::StaticClass(), ANY_PACKAGE, (const TCHAR*)wnew);
    if (!tex) { printf("UCMapKit|surftex|notexture|%s\n", newt); return 1; }
    int n = 0;
    if (!strcmp(name, "*")) {                  // every brush of the map (and every mover)
        for (int i = 0; i < GEditor->Level->Actors.Num(); i++) {
            AActor* a = GEditor->Level->Actors(i);
            if (a && a->Brush && a != GEditor->Level->Brush() && (a->IsStaticBrush() || a->IsA(AMover::StaticClass())))
                n += retextureBrush(a, oldt, tex);
        }
    } else {
        AActor* a = findActor(name);
        if (!a || !a->Brush) { printf("UCMapKit|surftex|missing|%s\n", name); return 1; }
        n = retextureBrush(a, oldt, tex);
    }
    printf("UCMapKit|surftex|ok|%s|%d\n", name, n);
    return 1;
}

// Surface edits address the source brush polygon. BSP indices change at every CSG rebuild.
// Work in world space, then transform only the mapping back into the brush (never its vertices).
static FPoly surfaceWorld(ABrush* b, int face) {
    FPoly p = b->Brush->Polys->Element(face);
    FModelCoords coords;
    FLOAT orientation = b->BuildCoords(&coords, NULL);
    p.Transform(coords, b->PrePivot, b->Location, orientation);
    return p;
}

static void storeSurface(ABrush* b, int face, FPoly p, int mapping, int texture, int shadows) {
    FModelCoords inv;
    FLOAT orientation = b->BuildCoords(NULL, &inv);
    FPoly local = p;
    local.Transform(inv, b->Location, b->PrePivot, orientation);
    const DWORD mask = PF_LowShadowDetail | PF_HighShadowDetail;
    for (int i = 0; i < b->Brush->Polys->Element.Num(); i++) {
        FPoly& dst = b->Brush->Polys->Element(i);
        if (i != face && dst.iLink != face) continue;
        if (mapping) { dst.Base = local.Base; dst.TextureU = local.TextureU; dst.TextureV = local.TextureV; dst.PanU = local.PanU; dst.PanV = local.PanV; }
        if (texture) dst.Texture = p.Texture;
        if (shadows) dst.PolyFlags = (dst.PolyFlags & ~mask) | (p.PolyFlags & mask);
    }
    UModel* m = GEditor->Level->Model;
    for (int i = 0; i < m->Surfs.Num(); i++) {
        FBspSurf& s = m->Surfs(i);
        if (s.Actor != b || s.iBrushPoly != face) continue;
        if (mapping) {
            // Vectors/points may be shared by unrelated faces: allocate, do not overwrite them.
            s.pBase = m->Points.AddItem(p.Base);
            s.vTextureU = m->Vectors.AddItem(p.TextureU);
            s.vTextureV = m->Vectors.AddItem(p.TextureV);
            s.PanU = p.PanU; s.PanV = p.PanV;
        }
        if (texture) s.Texture = p.Texture;
        if (shadows) s.PolyFlags = (s.PolyFlags & ~mask) | (p.PolyFlags & mask);
    }
}

static int surfaceError(const char* reason) {
    printf("UCMapKit|failed|surface|%s\n", reason); return 1;
}

static int fitSurface(FPoly& p, const char* mode) {
    FVector n = p.Normal.SafeNormal();
    FVector u = (p.TextureU - n * (p.TextureU | n)).SafeNormal();
    if (u.SizeSquared() < .5f) u = (p.Vertex[1] - p.Vertex[0]).SafeNormal();
    FVector v = (p.TextureV - n * (p.TextureV | n) - u * (p.TextureV | u)).SafeNormal();
    if (v.SizeSquared() < .5f) v = u ^ n;
    FLOAT u0 = 1e30f, u1 = -1e30f, v0 = 1e30f, v1 = -1e30f;
    FVector base = p.Vertex[0];
    for (int j = 0; j < p.NumVertices; j++) {
        FVector d = p.Vertex[j] - base;
        FLOAT x = d | u, y = d | v;
        u0 = Min(u0, x); u1 = Max(u1, x); v0 = Min(v0, y); v1 = Max(v1, y);
    }
    if (u1 - u0 < .001f || v1 - v0 < .001f || !p.Texture) return 0;
    FLOAT sc = p.Texture->Scale > 0 ? p.Texture->Scale : 1.f;
    FLOAT su = p.Texture->USize * sc / (u1 - u0), sv = p.Texture->VSize * sc / (v1 - v0);
    if (!strcmp(mode, "tile-u")) sv = su;
    if (!strcmp(mode, "tile-v")) su = sv;
    p.Base = base + u * u0 + v * v0;
    p.TextureU = u * su; p.TextureV = v * sv; p.PanU = p.PanV = 0;
    return 1;
}

// One continuous tile around a closed, vertical polygonal cylinder, with the texture's aspect ratio.
// Like geom.wrap_vertical: chain the side edges, accumulate their lengths, use one shared V origin.
static int wrapSurfaceCylinder(ABrush* b) {
    TArray<INT> faces; TArray<FVector> starts, ends, axes; TArray<FLOAT> widths;
    UTexture* texture = NULL; FLOAT perimeter = 0, top = -1e30f;
    for (int i = 0; i < b->Brush->Polys->Element.Num(); i++) {
        FPoly p = surfaceWorld(b, i);
        if (p.NumVertices < 3 || Abs(p.Normal.Z) > .001f) continue;
        if (!p.Texture || (texture && p.Texture != texture)) return surfaceError("Cylinder sides must use the same texture");
        texture = p.Texture;
        FVector u = (p.Normal ^ FVector(0, 0, 1)).SafeNormal();
        FLOAT lo = 1e30f, hi = -1e30f; FVector start, end;
        for (int j = 0; j < p.NumVertices; j++) {
            FLOAT d = p.Vertex[j] | u;
            if (d < lo) { lo = d; start = p.Vertex[j]; }
            if (d > hi) { hi = d; end = p.Vertex[j]; }
            top = Max(top, p.Vertex[j].Z);
        }
        start.Z = end.Z = 0;
        if (hi - lo < .001f) return surfaceError("Degenerate cylinder side");
        faces.AddItem(i); starts.AddItem(start); ends.AddItem(end); axes.AddItem(u); widths.AddItem(hi - lo);
        perimeter += hi - lo;
    }
    if (faces.Num() < 3) return surfaceError("Select a vertical cylinder with at least three side faces");
    TArray<INT> order; int current = 0;
    for (int k = 0; k < faces.Num(); k++) {
        for (int j = 0; j < order.Num(); j++) if (order(j) == current) return surfaceError("Cylinder sides do not form one closed outline");
        order.AddItem(current); int next = -1;
        for (int j = 0; j < faces.Num(); j++) if ((ends(current) - starts(j)).SizeSquared() < .01f) {
            if (next != -1) return surfaceError("Cylinder outline branches");
            next = j;
        }
        if (next < 0) return surfaceError("Cylinder sides do not meet");
        current = next;
    }
    if (current != 0) return surfaceError("Cylinder outline is not closed");
    FLOAT sc = texture->Scale > 0 ? texture->Scale : 1.f;
    FLOAT scale = texture->USize * sc / perimeter, cumulative = 0;
    for (int k = 0; k < order.Num(); k++) {
        int j = order(k); FPoly p = surfaceWorld(b, faces(j));
        p.Base = starts(j) - axes(j) * cumulative; p.Base.Z = top;
        p.TextureU = axes(j) * scale; p.TextureV = FVector(0, 0, -scale); p.PanU = p.PanV = 0;
        storeSurface(b, faces(j), p, 1, 0, 0); cumulative += widths(j);
    }
    printf("UCMapKit|surface|ok|cylinder|%d\n", faces.Num()); return 1;
}

// UC_SURFACE <brush> <source polygon or *> <floor|wall|tile|tile-u|tile-v|cylinder|pan|scale|rotate|flip-u|flip-v|texture|shadows> [args]
static int editSurface(const char* line) {
    char name[128], target[32], mode[32], arg[256] = ""; FLOAT x = 0, y = 0;
    if (sscanf(line, "UC_SURFACE %127s %31s %31s %255s", name, target, mode, arg) < 3) return 0;
    AActor* actor = findActor(name);
    if (!actor || !actor->IsStaticBrush() || !actor->Brush || !actor->Brush->Polys) return surfaceError("Source brush is missing; select its faces again");
    ABrush* b = (ABrush*)actor;
    int all = !strcmp(target, "*"), face = atoi(target), count = b->Brush->Polys->Element.Num();
    if (!all && (face < 0 || face >= count)) return surfaceError("Source polygon is missing; select its faces again");
    if (!strcmp(mode, "cylinder")) return wrapSurfaceCylinder(b);
    int shadow = !strcmp(mode, "shadows"), texture = !strcmp(mode, "texture"), pan = !strcmp(mode, "pan"), scale = !strcmp(mode, "scale");
    int fit = !strcmp(mode, "tile") || !strcmp(mode, "tile-u") || !strcmp(mode, "tile-v");
    int floor = !strcmp(mode, "floor"), wall = !strcmp(mode, "wall"), rotate = !strcmp(mode, "rotate");
    int flipu = !strcmp(mode, "flip-u"), flipv = !strcmp(mode, "flip-v");
    if (!(shadow || texture || pan || scale || fit || floor || wall || rotate || flipu || flipv)) return surfaceError("Unknown surface operation");
    if (pan || scale) {
        if (sscanf(line, "UC_SURFACE %*s %*s %*s %f %f", &x, &y) != 2 || !_finite(x) || !_finite(y)) return surfaceError("Invalid U/V values");
        if (scale && (x < .001f || y < .001f || x > 1000 || y > 1000)) return surfaceError("Texture scale must be 0.001 to 1000");
    }
    if (shadow && strcmp(arg, "low") && strcmp(arg, "normal") && strcmp(arg, "high")) return surfaceError("Invalid shadow detail");
    UTexture* tex = NULL;
    if (texture) {
        unsigned short w[256]; MultiByteToWideChar(CP_UTF8, 0, arg, -1, (LPWSTR)w, 256);
        tex = (UTexture*)UObject::StaticFindObject(UTexture::StaticClass(), ANY_PACKAGE, (const TCHAR*)w);
        if (!tex) return surfaceError("Texture is not loaded");
    }
    int changed = 0;
    for (int i = 0; i < count; i++) {
        if (!all && i != face) continue;
        FPoly p = surfaceWorld(b, i);
        if (p.NumVertices < 3) return surfaceError("Invalid source polygon");
        if (texture) p.Texture = tex;
        else if (shadow) p.PolyFlags = (p.PolyFlags & ~(PF_LowShadowDetail | PF_HighShadowDetail)) |
            (!strcmp(arg, "low") ? PF_LowShadowDetail : !strcmp(arg, "high") ? PF_HighShadowDetail : 0);
        else if (fit) { if (!fitSurface(p, mode)) return surfaceError("Cannot fit this face: degenerate UVs or no texture"); }
        else if (floor || wall) {
            FVector n = p.Normal.SafeNormal(), u;
            if (wall && Abs(n.Z) < .999f) u = (n ^ FVector(0, 0, 1)).SafeNormal();
            else u = (FVector(1, 0, 0) - n * n.X).SafeNormal();
            if (u.SizeSquared() < .5f) u = (FVector(0, 1, 0) - n * n.Y).SafeNormal();
            p.TextureU = u; p.TextureV = wall ? n ^ u : u ^ n;
            p.Base = n * (p.Vertex[0] | n); p.PanU = p.PanV = 0;
        } else if (pan) {
            if (Abs(p.PanU + x) > 32767 || Abs(p.PanV + y) > 32767) return surfaceError("Pan exceeds the engine's signed 16-bit range");
            p.PanU += (INT)x; p.PanV += (INT)y;
        } else if (scale) { p.TextureU /= x; p.TextureV /= y; }
        else if (rotate) { FVector u = p.TextureU; SWORD pu = p.PanU; p.TextureU = p.TextureV; p.TextureV = -u; p.PanU = p.PanV; p.PanV = -pu; }
        else if (flipu) { p.TextureU = -p.TextureU; p.PanU = -p.PanU; }
        else if (flipv) { p.TextureV = -p.TextureV; p.PanV = -p.PanV; }
        storeSurface(b, i, p, !shadow && !texture, texture, shadow); changed++;
    }
    printf("UCMapKit|surface|ok|%s|%d\n", mode, changed); return 1;
}

// UC_LIGHTSTATS: lightmap samples and storage, before/after LIGHT APPLY (no full pixel dump needed).
static int lightStats() {
    if (!GEditor->Level || !GEditor->Level->Model) return 0;
    UModel* m = GEditor->Level->Model;
    int samples = 0;
    for (int i = 0; i < m->LightMap.Num(); i++) samples += m->LightMap(i).UClamp * m->LightMap(i).VClamp;
    printf("UCMapKit|lightstats|%d|%d|%d\n", m->LightMap.Num(), samples, m->LightBits.Num()); return 1;
}

// UC_BRUSHES <file>: the static brushes in build order (the <brush> number of UC_BSPDUMP):
// B <ordinal> <name> <csg 1 add 2 subtract> <polyflags> <editor group> <x y z> <pitch yaw roll> <prepivot xyz>
static int listBrushes(const char* line) {
    char path[512];
    if (sscanf(line, "UC_BRUSHES %511s", path) != 1) return 0;
    if (!GEditor->Level) return 0;
    FILE* f = fopen(path, "wt");
    if (!f) return 0;
    int k = 0;
    for (int i = 0; i < GEditor->Level->Actors.Num(); i++) {
        AActor* a = GEditor->Level->Actors(i);
        if (!a || !a->IsStaticBrush() || a == GEditor->Level->Brush()) continue;
        ABrush* b = (ABrush*)a;
        char name[128], group[128];
        wtext(b->GetName(), name, sizeof(name));
        wtext(*b->Group, group, sizeof(group));
        for (char* c = group; *c; c++) if (*c == ' ') *c = '_';
        fprintf(f, "B %d %s %d %d %s %g %g %g %d %d %d %g %g %g\n", k++, name, (int)b->CsgOper, (int)b->PolyFlags,
                group[0] ? group : "None", b->Location.X, b->Location.Y, b->Location.Z,
                b->Rotation.Pitch, b->Rotation.Yaw, b->Rotation.Roll, b->PrePivot.X, b->PrePivot.Y, b->PrePivot.Z);
    }
    fclose(f);
    printf("UCMapKit|brushes|%d\n", k);
    return 1;
}

// UC_PATHS <file>: the AI's path network as PATHS DEFINE made it, for the "AI paths" view of the map editor.
// N <name> <class> <x y z>                           every navigation point
// R <start> <end> <distance> <reach flags> <radius> <height>   every reach spec the AI uses (pruned ones left out)
static int dumpPaths(const char* line) {
    char path[512];
    if (sscanf(line, "UC_PATHS %511s", path) != 1) return 0;
    if (!GEditor->Level) return 0;
    FILE* f = fopen(path, "wt");
    if (!f) return 0;
    int nodes = 0, specs = 0;
    for (int i = 0; i < GEditor->Level->Actors.Num(); i++) {
        AActor* a = GEditor->Level->Actors(i);
        if (!a || !a->IsA(ANavigationPoint::StaticClass())) continue;
        char name[128], cls[128];
        wtext(a->GetName(), name, sizeof(name));
        wtext(a->GetClass()->GetName(), cls, sizeof(cls));
        fprintf(f, "N %s %s %.1f %.1f %.1f\n", name, cls, a->Location.X, a->Location.Y, a->Location.Z);
        nodes++;
    }
    TArray<FReachSpec>& reach = GEditor->Level->ReachSpecs;
    for (int i = 0; i < reach.Num(); i++) {
        FReachSpec& r = reach(i);
        if (r.bPruned || !r.Start || !r.End) continue;
        char a[128], b[128];
        wtext(r.Start->GetName(), a, sizeof(a));
        wtext(r.End->GetName(), b, sizeof(b));
        fprintf(f, "R %s %s %d %d %d %d\n", a, b, r.distance, r.reachFlags, r.CollisionRadius, r.CollisionHeight);
        specs++;
    }
    fclose(f);
    printf("UCMapKit|paths|%d points|%d links\n", nodes, specs);
    return 1;
}

// UC_ANIMDUMP <mesh path> <file>: a model with every frame of its animations, for the map editor
// (animations of the characters, Animation Studio). A text header, then after the line "data" the
// arrays in binary (little endian):
//   faces   Faces x (uint16 wedge0, wedge1, wedge2, material)
//   wedges  Wedges x (uint16 vertex, uint8 u, uint8 v)            vertex counts after the special verts
//   special SpecialFaces x (uint16 v0, v1, v2, material)
//   verts   Verts x (int16 x, y, z): raw mesh units, frame after frame (FrameVerts each)
static UMesh* loadMesh(const char* path) {
    TCHAR w[256];
    MultiByteToWideChar(CP_UTF8, 0, path, -1, (LPWSTR)w, 256);
    return (UMesh*)UObject::StaticLoadObject(UMesh::StaticClass(), NULL, w, NULL, LOAD_NoWarn | LOAD_Quiet, NULL);
}
static int dumpAnims(const char* line) {
    char mpath[256], path[512];
    if (sscanf(line, "UC_ANIMDUMP %255s %511s", mpath, path) != 2) return 0;
    UMesh* mesh = loadMesh(mpath);
    if (!mesh) { printf("UCMapKit|anim|no mesh|%s\n", mpath); return 0; }
    ULodMesh* lod = mesh->IsA(ULodMesh::StaticClass()) ? (ULodMesh*)mesh : NULL;
    mesh->Verts.Load();
    FILE* f = fopen(path, "wb");
    if (!f) return 0;
    fprintf(f, "UCANIM 1\nmesh %s %d %d\n", mpath, lod ? 1 : 0, (int)sizeof(FMeshVert));
    fprintf(f, "counts %d %d %d %d %d %d %d %d %d %d %d\n", mesh->FrameVerts, mesh->AnimFrames,
        lod ? lod->SpecialVerts : 0, lod ? lod->ModelVerts : 0, lod ? lod->Faces.Num() : 0, lod ? lod->Wedges.Num() : 0,
        lod ? lod->Materials.Num() : 0, lod ? lod->SpecialFaces.Num() : 0, lod ? lod->RemapAnimVerts.Num() : 0,
        lod ? lod->OldFrameVerts : 0, mesh->Verts.Num());
    fprintf(f, "xform %g %g %g %g %g %g %d %d %d\n", mesh->Scale.X, mesh->Scale.Y, mesh->Scale.Z,
        mesh->Origin.X, mesh->Origin.Y, mesh->Origin.Z, mesh->RotOrigin.Pitch, mesh->RotOrigin.Yaw, mesh->RotOrigin.Roll);
    for (int i = 0; i < mesh->AnimSeqs.Num(); i++) {
        FMeshAnimSeq& s = mesh->AnimSeqs(i);
        char name[128], group[128];
        wtext(*s.Name, name, sizeof(name));
        wtext(*s.Group, group, sizeof(group));
        fprintf(f, "seq %s %s %d %d %g %d", name, group, s.StartFrame, s.NumFrames, s.Rate, s.Notifys.Num());
        for (int k = 0; k < s.Notifys.Num(); k++) {
            char fn[128];
            wtext(*s.Notifys(k).Function, fn, sizeof(fn));
            fprintf(f, " %g %s", s.Notifys(k).Time, fn);
        }
        fputc('\n', f);
    }
    for (int i = 0; i < mesh->Textures.Num(); i++) {
        char tex[256] = "None";
        if (mesh->Textures(i)) wtext(mesh->Textures(i)->GetPathName(), tex, sizeof(tex));
        fprintf(f, "tex %d %s\n", i, tex);
    }
    if (lod) for (int i = 0; i < lod->Materials.Num(); i++)
        fprintf(f, "mat %d %d %lu\n", i, lod->Materials(i).TextureIndex, (unsigned long)lod->Materials(i).PolyFlags);
    fprintf(f, "data\n");
    if (lod) {
        for (int i = 0; i < lod->Faces.Num(); i++) {
            FMeshFace& face = lod->Faces(i);
            _WORD w[4] = { face.iWedge[0], face.iWedge[1], face.iWedge[2], face.MaterialIndex };
            fwrite(w, 2, 4, f);
        }
        for (int i = 0; i < lod->Wedges.Num(); i++) {
            FMeshWedge& w = lod->Wedges(i);
            fwrite(&w.iVertex, 2, 1, f);
            fwrite(&w.TexUV.U, 1, 1, f);
            fwrite(&w.TexUV.V, 1, 1, f);
        }
        for (int i = 0; i < lod->SpecialFaces.Num(); i++) {
            FMeshFace& face = lod->SpecialFaces(i);
            _WORD w[4] = { face.iWedge[0], face.iWedge[1], face.iWedge[2], face.MaterialIndex };
            fwrite(w, 2, 4, f);
        }
    }
    for (int i = 0; i < mesh->Verts.Num(); i++) {
        FMeshVert& v = mesh->Verts(i);
        short xyz[3] = { (short)v.X, (short)v.Y, (short)v.Z };
        fwrite(xyz, 2, 3, f);
    }
    fclose(f);
    printf("UCMapKit|anim|%s|%d sequences|%d frames|%d verts\n", mpath, mesh->AnimSeqs.Num(), mesh->AnimFrames, mesh->FrameVerts);
    return 1;
}

// UC_ANIMNEW <source model> <package> <name> <file>: a copy of a model (every sequence and frame, its
// triangles, LOD, skins) with the new animations of <file> after its own frames, in a package made in
// memory (written by UC_ANIMSAVE). The Animation Studio of the map editor makes the file:
//   "seq <name> <group> <frames> <rate>" lines, then "data", then the frames: FrameVerts x int16 xyz each,
//   in raw model units like the model's own (the special verts first, as in Verts).
// Several models can go in the same package (one UC_ANIMNEW each).
static UPackage* AnimPackage = NULL;
// element by element (Core exports no TArray<_WORD>::operator=); only for plain types
template <class T> static void copyPlain(TArray<T>& to, const TArray<T>& from) {
    FArray& a = (FArray&)to;                      // through FArray (exported): the TArray<_WORD> members are not
    a.Empty(sizeof(T), from.Num());
    a.Add(from.Num(), sizeof(T));
    if (from.Num()) appMemcpy(a.GetData(), ((const FArray&)from).GetData(), from.Num() * sizeof(T));
}
static int newAnimMesh(const char* line) {
    char src[256], pkg[128], name[128], path[512];
    if (sscanf(line, "UC_ANIMNEW %255s %127s %127s %511s", src, pkg, name, path) != 4) return 0;
    UMesh* m0 = loadMesh(src);
    if (!m0 || !m0->IsA(ULodMesh::StaticClass())) { printf("UCMapKit|animnew|not a LOD model|%s\n", src); return 0; }
    ULodMesh* from = (ULodMesh*)m0;
    from->Verts.Load(); from->Tris.Load(); from->Connects.Load(); from->VertLinks.Load();
    FILE* f = fopen(path, "rb");
    if (!f) return 0;
    static char text[65536];
    size_t got = fread(text, 1, sizeof(text) - 1, f);
    text[got] = 0;
    char* data = strstr(text, "\ndata\n");
    if (!data) { fclose(f); printf("UCMapKit|animnew|no data\n"); return 0; }
    long dataAt = (long)(data - text) + 6;
    *data = 0;
    struct NewSeq { char name[64], group[64]; int frames; float rate; } seqs[256];
    int nseq = 0, total = 0;
    for (char* l = strtok(text, "\n"); l && nseq < 256; l = strtok(NULL, "\n")) {
        NewSeq& s = seqs[nseq];
        if (sscanf(l, "seq %63s %63s %d %f", s.name, s.group, &s.frames, &s.rate) == 4 && s.frames > 0) { total += s.frames; nseq++; }
    }
    int fv = from->FrameVerts;
    short* v = (short*)malloc((size_t)total * fv * 6);
    fseek(f, dataAt, SEEK_SET);
    size_t read = fread(v, 6, (size_t)total * fv, f);
    fclose(f);
    if ((int)read != total * fv) { free(v); printf("UCMapKit|animnew|frames missing|%d of %d\n", (int)read, total * fv); return 0; }
    TCHAR wpkg[128], wname[128];
    MultiByteToWideChar(CP_UTF8, 0, pkg, -1, (LPWSTR)wpkg, 128);
    MultiByteToWideChar(CP_UTF8, 0, name, -1, (LPWSTR)wname, 128);
    if (!AnimPackage) AnimPackage = UObject::CreatePackage(NULL, wpkg);
    ULodMesh* m = (ULodMesh*)UObject::StaticConstructObject(ULodMesh::StaticClass(), AnimPackage, FName(wname),
        RF_Public | RF_Standalone, NULL, GWarn);
    if (!m) { free(v); return 0; }
    // the model as it is
    m->BoundingBox = from->BoundingBox;
    m->BoundingSphere = from->BoundingSphere;
    (TArray<FMeshVert>&)m->Verts = (TArray<FMeshVert>&)from->Verts;
    (TArray<FMeshTri>&)m->Tris = (TArray<FMeshTri>&)from->Tris;
    m->AnimSeqs = from->AnimSeqs;
    (TArray<FMeshVertConnect>&)m->Connects = (TArray<FMeshVertConnect>&)from->Connects;
    m->BoundingBoxes = from->BoundingBoxes;
    m->BoundingSpheres = from->BoundingSpheres;
    (TArray<INT>&)m->VertLinks = (TArray<INT>&)from->VertLinks;
    m->Textures = from->Textures;
    m->TextureLOD = from->TextureLOD;
    m->FrameVerts = from->FrameVerts;
    m->AnimFrames = from->AnimFrames;
    m->AndFlags = from->AndFlags;
    m->OrFlags = from->OrFlags;
    m->Scale = from->Scale;
    m->Origin = from->Origin;
    m->RotOrigin = from->RotOrigin;
    m->CurPoly = from->CurPoly;
    m->CurVertex = from->CurVertex;
    copyPlain(m->CollapsePointThus, from->CollapsePointThus);
    copyPlain(m->FaceLevel, from->FaceLevel);
    m->Faces = from->Faces;
    copyPlain(m->CollapseWedgeThus, from->CollapseWedgeThus);
    m->Wedges = from->Wedges;
    m->Materials = from->Materials;
    m->SpecialFaces = from->SpecialFaces;
    m->ModelVerts = from->ModelVerts;
    m->SpecialVerts = from->SpecialVerts;
    m->MeshScaleMax = from->MeshScaleMax;
    m->LODStrength = from->LODStrength;
    m->LODMinVerts = from->LODMinVerts;
    m->LODMorph = from->LODMorph;
    m->LODZDisplace = from->LODZDisplace;
    m->LODHysteresis = from->LODHysteresis;
    copyPlain(m->RemapAnimVerts, from->RemapAnimVerts);
    m->OldFrameVerts = from->OldFrameVerts;
    // the new frames after its own, a sequence for each animation
    int first = m->AnimFrames, at = m->Verts.Num();
    m->Verts.Add(total * fv);
    for (int i = 0; i < total * fv; i++) {
        FMeshVert& mv = m->Verts(at + i);
        mv.D1 = mv.D2 = 0;
        mv.X = v[3 * i]; mv.Y = v[3 * i + 1]; mv.Z = v[3 * i + 2];
    }
    FVector* pts = (FVector*)malloc(sizeof(FVector) * fv);
    for (int k = 0; k < total; k++) {
        for (int i = 0; i < fv; i++) pts[i] = m->Verts(at + k * fv + i).Vector();
        m->BoundingBoxes.AddItem(FBox(pts, fv));
        m->BoundingSpheres.AddItem(FSphere(pts, fv));
    }
    free(pts);
    m->AnimFrames += total;
    int start = first;
    for (int s = 0; s < nseq; s++) {
        TCHAR wseq[64], wgroup[64];
        MultiByteToWideChar(CP_UTF8, 0, seqs[s].name, -1, (LPWSTR)wseq, 64);
        MultiByteToWideChar(CP_UTF8, 0, seqs[s].group, -1, (LPWSTR)wgroup, 64);
        FMeshAnimSeq* q = new(m->AnimSeqs) FMeshAnimSeq;
        q->Name = FName(wseq);
        q->Group = FName(wgroup);
        q->StartFrame = start;
        q->NumFrames = seqs[s].frames;
        q->Rate = seqs[s].rate;
        start += seqs[s].frames;
    }
    for (int i = 0; i < m->BoundingBoxes.Num(); i++) m->BoundingBox += m->BoundingBoxes(i);
    free(v);
    printf("UCMapKit|animnew|%s.%s|%d sequences|%d new frames|%d frames|box %d %d|first raw box %.0f %.0f %.0f %.0f %.0f %.0f\n",
        pkg, name, nseq, total, m->AnimFrames, m->BoundingBoxes.Num(), m->Verts.Num() / fv,
        from->BoundingBoxes.Num() ? from->BoundingBoxes(0).Min.X : 0.f, from->BoundingBoxes.Num() ? from->BoundingBoxes(0).Min.Y : 0.f,
        from->BoundingBoxes.Num() ? from->BoundingBoxes(0).Min.Z : 0.f, from->BoundingBoxes.Num() ? from->BoundingBoxes(0).Max.X : 0.f,
        from->BoundingBoxes.Num() ? from->BoundingBoxes(0).Max.Y : 0.f, from->BoundingBoxes.Num() ? from->BoundingBoxes(0).Max.Z : 0.f);
    return 1;
}

// UC_ANIMSAVE <file>: writes the package of UC_ANIMNEW (then a new one can be made); without any
// UC_ANIMNEW, an empty UCAnims package (the Studio has no animation left)
static int saveAnimPackage(const char* line) {
    char path[512];
    if (sscanf(line, "UC_ANIMSAVE %511s", path) != 1) return 0;
    if (!AnimPackage) AnimPackage = UObject::CreatePackage(NULL, TEXT("UCAnims"));
    TCHAR wpath[512];
    MultiByteToWideChar(CP_UTF8, 0, path, -1, (LPWSTR)wpath, 512);
    UBOOL ok = UObject::SavePackage(AnimPackage, NULL, RF_Standalone, wpath, GWarn);
    printf("UCMapKit|animsave|%s|%d\n", path, ok ? 1 : 0);
    AnimPackage = NULL;
    return ok;
}

// UC_MESHLIST <file>: every 3D model loaded (the packages loaded with OBJ LOAD first), for the map editor's
// Models: "M <package> <path> <class> <triangles> <frames> <sequences>" per line
static int safeTriCount(UMesh* mesh, ULodMesh* lod) {
    __try {
        if (lod) return lod->Faces.Num();
        mesh->Tris.Load();
        return mesh->Tris.Num();
    } __except (EXCEPTION_EXECUTE_HANDLER) { return -1; }
}

static int listMeshes(const char* line) {
    char path[512];
    if (sscanf(line, "UC_MESHLIST %511s", path) != 1) return 0;
    FILE* f = fopen(path, "wt");
    if (!f) return 0;
    int n = 0;
    for (TObjectIterator<UMesh> It; It; ++It) {
        UMesh* mesh = *It;
        ULodMesh* lod = mesh->IsA(ULodMesh::StaticClass()) ? (ULodMesh*)mesh : NULL;
        UObject* top = mesh;
        while (top->GetOuter()) top = top->GetOuter();
        char pkg[128], name[256], cls[64];
        wtext(top->GetName(), pkg, sizeof(pkg));
        wtext(mesh->GetPathName(), name, sizeof(name));
        wtext(mesh->GetClass()->GetName(), cls, sizeof(cls));
        fprintf(f, "M %s %s %s %d %d %d\n", pkg, name, cls, safeTriCount(mesh, lod), mesh->AnimFrames, mesh->AnimSeqs.Num());
        n++;
    }
    fclose(f);
    printf("UCMapKit|meshlist|%d\n", n);
    return 1;
}

// UC_MESHIMPORT <package> <name> <anivfile> <datafile> <old format 0|1> <lod 0|1>: a model of the map
// editor's Import, made from its two Unreal 3D files (_a.3d frames, _d.3d triangles) by the editor's own
// importer (UEditorEngine::meshImport, what #exec MESH IMPORT runs) into the package (created when
// needed). Old format: 4 bytes a vertex (11/11/10 bits, Unreal's); new: Deus Ex's 16-bit vertices.
// Then MESH ORIGIN / MESHMAP SCALE / MESHMAP SETTEXTURE work on it as on any mesh.
static int importMesh(const char* line) {
    char pkg[128], name[128], aniv[512], data[512];
    int old = 0, lodFlag = 1;
    if (sscanf(line, "UC_MESHIMPORT %127s %127s %511s %511s %d %d", pkg, name, aniv, data, &old, &lodFlag) < 4) return 0;
    TCHAR wpkg[128], wname[128], waniv[512], wdata[512];
    MultiByteToWideChar(CP_UTF8, 0, pkg, -1, (LPWSTR)wpkg, 128);
    MultiByteToWideChar(CP_UTF8, 0, name, -1, (LPWSTR)wname, 128);
    MultiByteToWideChar(CP_UTF8, 0, aniv, -1, (LPWSTR)waniv, 512);
    MultiByteToWideChar(CP_UTF8, 0, data, -1, (LPWSTR)wdata, 512);
    UPackage* p = UObject::CreatePackage(NULL, wpkg);
    ULODProcessInfo info;
    info.LevelOfDetail = lodFlag;
    info.NoUVData = 0;
    info.OldAnimFormat = old;
    info.SampleFrame = 0;
    info.MinVerts = 10;
    info.Style = 0;
    GEditor->meshImport(wname, p, waniv, wdata, 0, 0, 0, &info);
    UMesh* m = FindObject<UMesh>(p, wname);
    ULodMesh* lod = (m && m->IsA(ULodMesh::StaticClass())) ? (ULodMesh*)m : NULL;
    if (lod && lodFlag && lod->Faces.Num() == 0)
        GEditor->meshLODProcess(lod, &info);
    printf("UCMapKit|meshimport|%s|%d|%d verts|%d frames|%d faces\n", name, m ? 1 : 0, m ? m->FrameVerts : 0,
        m ? m->AnimFrames : 0, m ? safeTriCount(m, lod) : 0);
    return m != NULL;
}

// UC_SAVEPKG <package> <file>: a package made or changed in this session (the map editor's models) saved
static int savePackage(const char* line) {
    char pkg[128], path[512];
    if (sscanf(line, "UC_SAVEPKG %127s %511s", pkg, path) != 2) return 0;
    TCHAR wpkg[128], wpath[512];
    MultiByteToWideChar(CP_UTF8, 0, pkg, -1, (LPWSTR)wpkg, 128);
    MultiByteToWideChar(CP_UTF8, 0, path, -1, (LPWSTR)wpath, 512);
    UPackage* p = UObject::CreatePackage(NULL, wpkg);
    UBOOL ok = UObject::SavePackage(p, NULL, RF_Standalone, wpath, GWarn);
    printf("UCMapKit|savepkg|%s|%d\n", path, ok ? 1 : 0);
    return ok;
}

// UC_SOUNDS <file>: every sound loaded (the packages loaded with OBJ LOAD first): "<path> <bytes>" per line,
// for the map editor's sound picker (ambient sounds)
static int listSounds(const char* line) {
    char path[512];
    if (sscanf(line, "UC_SOUNDS %511s", path) != 1) return 0;
    FILE* f = fopen(path, "wt");
    if (!f) return 0;
    int n = 0;
    for (TObjectIterator<USound> It; It; ++It) {
        char name[256];
        wtext(It->GetPathName(), name, sizeof(name));
        fprintf(f, "%s %d\n", name, It->OriginalSize);
        n++;
    }
    fclose(f);
    printf("UCMapKit|sounds|%d\n", n);
    return 1;
}

// UC_NAVDROP <* | name name ...>: navigation points rested on the floor below them (Location = floor +
// CollisionHeight, 15 for path nodes), as UnrealEd places them. Deus Ex's PATHS DEFINE makes no reach
// spec from a point floating higher (measured: 15 above the floor links, 25 does not; the original
// maps have them at 11-44, median 15). Player starts and teleporters keep their height (JC spawns there).
static int dropNavPoints(const char* line) {
    if (!GEditor->Level) return 0;
    const char* list = line + 11;
    int all = !strncmp(list, "*", 1), moved = 0, checked = 0;
    for (int i = 0; i < GEditor->Level->Actors.Num(); i++) {
        AActor* a = GEditor->Level->Actors(i);
        if (!a || !a->IsA(ANavigationPoint::StaticClass()) || a->IsA(APlayerStart::StaticClass()) || a->IsA(ATeleporter::StaticClass()))
            continue;
        char name[128];
        wtext(a->GetName(), name, sizeof(name));
        if (!all) {                                  // whole words of the list only
            const char* p = strstr(list, name);
            size_t n = strlen(name);
            while (p && !((p == list || p[-1] == ' ') && (p[n] == 0 || p[n] == ' ' || p[n] == '\n' || p[n] == '\r'))) p = strstr(p + 1, name);
            if (!p) continue;
        }
        checked++;
        FCheckResult hit(1.f);
        FVector end = a->Location - FVector(0, 0, 512);
        if (GEditor->Level->SingleLineCheck(hit, NULL, end, a->Location, TRACE_Level, FVector(0, 0, 0), 0)) continue;
        FLOAT z = hit.Location.Z + a->CollisionHeight;
        if (Abs(a->Location.Z - z) < 2.f) continue;
        printf("UCMapKit|navdrop|%s|%.1f -> %.1f\n", name, a->Location.Z, z);
        a->Location.Z = z;
        moved++;
    }
    printf("UCMapKit|navdrop|%d checked|%d moved\n", checked, moved);
    return 1;
}

// UC_SIZES: collision cylinder of every non-brush actor (to rest props exactly on surfaces).
static int listSizes() {
    if (!GEditor->Level) return 0;
    for (int i=0; i<GEditor->Level->Actors.Num(); i++) {
        AActor* actor = GEditor->Level->Actors(i);
        if (!actor || actor->IsA(ABrush::StaticClass()) || actor->IsA(ALevelInfo::StaticClass())) continue;
        char cls[128];
        WideCharToMultiByte(CP_UTF8, 0, (const WCHAR*)actor->GetClass()->GetName(), -1, cls, sizeof(cls), NULL, NULL);
        printf("UCMapKit|size|%s|%.2f|%.2f\n", cls, actor->CollisionRadius, actor->CollisionHeight);
    }
    return 1;
}

#include "selected_bsp.h"
#include "region_extent_evidence.h"
#include "region_bsp.h"
#include "nonsolid_bsp.h"
#include "certificate_dump.h"
#include "isolated_box_update.h"
#include "retained_uv_update.h"

static int runCommand(const char* line, unsigned short* wide, FFeedbackContext& feedback) {
    if (!strncmp(line, "UC_CERT_DUMP ", 13) || !strcmp(line, "UC_CERT_PROFILE")) return certificateCommand(line);
    if (!strncmp(line, "UC_CERT_ZONE_POOL ", 18)) return certificateCommand(line);
    if (!strncmp(line, "UC_CERT_VERTEX_POOL ", 20)) return certificateCommand(line);
    if (!strncmp(line, "UC_CERT_BOX_UPDATE ", 19)) return isolatedBoxUpdate(line+19);
    if (!strncmp(line, "UC_CERT_RETAIN_UV ", 18)) return retainedUVUpdate(line+18);
    if (!strncmp(line, "UC_CERT_RETAIN_RINGS ", 21)) return retainedRingsUpdate(line+21);
    if (!strncmp(line, "UC_NONSOLID_UPDATE ", 19)) return nonSolidUpdate(line+19);
    if (!strncmp(line, "UC_NONSOLID_STATE ", 18)) return nonSolidState(line+18);
    if (!strncmp(line, "UC_EXTENT_EVIDENCE ", 19)) return regionExtentDiagnostic(line);
    if (!strncmp(line, "UC_EXTENT_HULLS ", 16)) return regionExtentHulls(line);
    if (!strncmp(line, "UC_REGION_", 10)) return regionCommand(line);
    if (!strncmp(line, "UC_SELECTED_", 12)) return selectedCommand(line);
    if (!strncmp(line, "UC_POINT ", 9)) return probePoint(line);
    if (!strcmp(line, "UC_SIZES")) return listSizes();
    if (!strncmp(line, "UC_TRACE ", 9)) return traceLine(line);
    if (!strncmp(line, "UC_BSPDUMP ", 11)) return dumpBsp(line);
    if (!strncmp(line, "UC_LIGHTDUMP ", 13)) return dumpLights(line);
    if (!strncmp(line, "UC_MESHES ", 10)) return dumpMeshes(line);
    if (!strncmp(line, "UC_BRUSHES ", 11)) return listBrushes(line);
    if (!strncmp(line, "UC_PATHS ", 9)) return dumpPaths(line);
    if (!strncmp(line, "UC_NAVDROP ", 11)) return dropNavPoints(line);
    if (!strncmp(line, "UC_ANIMDUMP ", 12)) return dumpAnims(line);
    if (!strncmp(line, "UC_SOUNDS ", 10)) return listSounds(line);
    if (!strncmp(line, "UC_MESHLIST ", 12)) return listMeshes(line);
    if (!strncmp(line, "UC_MESHIMPORT ", 14)) return importMesh(line);
    if (!strncmp(line, "UC_SAVEPKG ", 11)) return savePackage(line);
    if (!strncmp(line, "UC_ANIMNEW ", 11)) return newAnimMesh(line);
    if (!strncmp(line, "UC_ANIMSAVE ", 12)) return saveAnimPackage(line);
    if (!strncmp(line, "UC_TEXDUMP ", 11)) return dumpTexture(line);
    if (!strncmp(line, "UC_TEXFLAGS ", 12)) return dumpTexFlags(line);
    if (!strncmp(line, "UC_CLASSES ", 11)) return listClasses(line);
    if (!strncmp(line, "UC_DEFAULTS ", 12)) return dumpDefaults(line);
    if (!strncmp(line, "UC_CONDUMP ", 11)) return dumpConversations(line);
    if (!strncmp(line, "UC_TEXTDUMP ", 12)) return dumpGameContent(line, 0);
    if (!strncmp(line, "UC_TEXTHEX ", 11)) return setTextHex(line);
    if (!strncmp(line, "UC_SCRIPTDUMP ", 14)) return dumpGameContent(line, 1);
    if (!strncmp(line, "UC_CONSOUND ", 12)) return conversationSound(line);
    if (!strncmp(line, "UC_SET ", 7)) return setActor(line);
    if (!strncmp(line, "UC_DEL ", 7)) return deleteActor(line);
    if (!strncmp(line, "UC_PROP ", 8)) return setProp(line);
    if (!strncmp(line, "UC_SCALE ", 9)) return scaleActor(line);
    if (!strncmp(line, "UC_OBJPROP ", 11)) return setObjProp(line);
    if (!strncmp(line, "UC_SURFTEX ", 11)) return setSurfTexture(line);
    if (!strncmp(line, "UC_SURFACE ", 11)) return editSurface(line);
    if (!strcmp(line, "UC_LIGHTSTATS")) return lightStats();
    if (!strncmp(line, "UC_MOVER ", 9)) return editMover(line);
    if (!strcmp(line, "UC_WORLD finish")) return finishWorld();
    if (!strcmp(line, "UC_CAMERAS clear")) return clearCameras();
    if (!strcmp(line, "UC_ACTORS check")) return checkActors();
    if (!strcmp(line, "LIGHT APPLY") && !temporaryViewportReady) {
        puts("UCMapKit|failed|lighting|This WinDrvLite version does not match the supported temporary-viewport fix");
        return 0;
    }
    return GEditor->Exec((const TCHAR*)wide, feedback);
}

static int guardedCommand(const char* line, unsigned short* wide, FFeedbackContext& feedback) {
    __try {
        return runCommand(line, wide, feedback);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        printf("UCMapKit|fault|0x%08lx\n", GetExceptionCode()); fflush(stdout);
        return 0;
    }
}

// First-chance access violations on any thread: module + offset in the log (diagnostics).
static LONG CALLBACK reportFault(PEXCEPTION_POINTERS info) {
    if (info->ExceptionRecord->ExceptionCode != EXCEPTION_ACCESS_VIOLATION) return EXCEPTION_CONTINUE_SEARCH;
    void* address = info->ExceptionRecord->ExceptionAddress;
    HMODULE module = NULL;
    char name[MAX_PATH] = "?";
    if (GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                           (LPCSTR)address, &module) && module)
        GetModuleFileNameA(module, name, sizeof(name));
    const char* base = strrchr(name, '\\');
    printf("UCMapKit|av|%s+0x%lx|%s 0x%08lx\n", base ? base + 1 : name, (unsigned long)((char*)address - (char*)module),
           info->ExceptionRecord->ExceptionInformation[0] ? "write" : "read",
           (unsigned long)info->ExceptionRecord->ExceptionInformation[1]);
    fflush(stdout);
    return EXCEPTION_CONTINUE_SEARCH;
}

// "--make": the UnrealScript compiler, without the SDK's UCC.exe. What "ucc make" does: the engine
// started with DeusEx.ini (its EditPackages list), then Editor.MakeCommandlet, the compiler that is
// inside the game's own Editor.dll, compiles every package of the list whose .u is missing.
static int runMake(int argc, char** argv) {
    FMallocAnsi malloc;
    Utf8Log log;
    Utf8Error error;
    Utf8Feedback feedback;
    FFileManagerWindows files;
    // The engine reads <name>.ini, the name given to appInit (it ignores -ini=): "DeusEx" reads
    // DeusEx.ini, the file whose EditPackages the build scripts write. (Under its own name it would
    // read a UCMapKitHost.ini copied once from Default.ini, and never see a later change.)
    TCHAR name[256];
    int n = 0;
    const char* ini = argc > 2 ? argv[2] : "DeusEx.ini";
    for (const char* p = ini; *p && *p != '.' && n < 250; p++) name[n++] = (TCHAR)(unsigned char)*p;
    name[n] = 0;
    GIsEditor = 1;
    GIsServer = 1;
    GIsClient = 0;
    appInit(name, TEXT("-nosound"), &malloc, &log, &error, &feedback, &files, FConfigCacheIni::Factory, 1);
    GIsStarted = 1;
    int result = 6;
    __try {
        UClass* cls = UObject::StaticLoadClass(UCommandlet::StaticClass(), NULL, TEXT("Editor.MakeCommandlet"), NULL, LOAD_NoFail, NULL);
        UCommandlet* def = (UCommandlet*)cls->GetDefaultObject();
        GIsClient = def->IsClient;
        GIsEditor = def->IsEditor;
        GIsServer = def->IsServer;
        GLazyLoad = def->LazyLoad;
        UCommandlet* make = ConstructObject<UCommandlet>(cls);
        make->InitExecution();
        make->ParseParms(TEXT(""));
        result = make->Main(TEXT("")) ? 5 : 0;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        printf("UCMapKit|fault|0x%08lx\n", GetExceptionCode()); fflush(stdout);
        result = 7;
    }
    // the compiler's errors and warnings went through GWarn (the feedback context): the same
    // closing line as UCC, which the build scripts and the editor look for
    if (!result && feedback.Errors) result = 5;
    printf("%s - %d error(s), %d warnings\n", result ? "Failure" : "Success", feedback.Errors + (result && !feedback.Errors ? 1 : 0),
           feedback.Warnings);
    fflush(stdout);
    // after a critical error (a class whose parent does not exist...) the engine is in no state to
    // shut down cleanly: leave with the failure
    if (GIsCriticalError) { fflush(stderr); ExitProcess(result ? result : 5); }
    appPreExit();
    appExit();
    return result;
}

int main(int argc, char** argv) {
    AddVectoredExceptionHandler(1, reportFault);
    if (argc >= 2 && !strcmp(argv[1], "--make")) return runMake(argc, argv);
    puts("UCMapKit|initializing SDK"); fflush(stdout);
    if (argc != 2) return 2;
    // "-" = interactive: commands from stdin, one reply block per command ending in
    // "UCMapKit|ready"; a failed command is reported and the session goes on.
    int interactive = !strcmp(argv[1], "-");
    FILE* input = interactive ? stdin : fopen(argv[1], "rt");
    if (!input) return 3;
    FMallocAnsi malloc;
    Utf8Log log;
    Utf8Error error;
    Utf8Feedback feedback;
    FFileManagerWindows files;
    GIsEditor = 1;
    GIsServer = 1;
    GIsClient = 0;
    appInit(TEXT("UCMapKitHost"), TEXT("-ini=Revision.ini -nosound"), &malloc,
        &log, &error, &feedback, &files, FConfigCacheIni::Factory, 1);
    GIsStarted = 1;
    GEditor = ConstructObject<UEditorEngine>(UEditorEngine::StaticClass());
    GEditor->Init();
    temporaryViewportReady = patchTemporaryViewport();
    // void __thiscall UEditorEngine::Draw(UViewport*, int, unsigned char*, int*) -> ret 16
    static const unsigned char ret16[3] = { 0xC2, 0x10, 0x00 };
    patchExport("Editor.dll", "?Draw@UEditorEngine@@UAEXPAVUViewport@@HPAEPAH@Z", ret16, 3);
    puts("UCMapKit|ready"); fflush(stdout);
    char line[8192];
    while (fgets(line, sizeof(line), input)) {
        line[strcspn(line, "\r\n")] = 0;
        if (!line[0] || line[0] == '#') { if (interactive) { puts("UCMapKit|ready"); fflush(stdout); } continue; }
        if (interactive && !strcmp(line, "UC_QUIT")) break;
        unsigned short wide[8192];
        int i;
        for (i=0; line[i]; i++) wide[i] = (unsigned char)line[i];
        wide[i] = 0;
        printf("UCMapKit|command|%s\n", line); fflush(stdout);
        DWORD start = GetTickCount();
        int success = guardedCommand(line, wide, feedback);
        if (!success) {
            if (!interactive) {
                fprintf(stderr, "UCMapKit|failed|%s\n", line);
                return 4;
            }
            printf("UCMapKit|failed|%s\n", line);
        }
        if (GEditor->Level) printf("UCMapKit|actors|%d\n", GEditor->Level->Actors.Num());
        printf("UCMapKit|complete|%lu ms\n", GetTickCount() - start);
        if (interactive) puts("UCMapKit|ready");
        fflush(stdout);
    }
    if (!interactive) fclose(input);
    appPreExit();
    appExit();
    puts("UCMapKit|done");
    return 0;
}
