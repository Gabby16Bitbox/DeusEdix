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
// JSON for the dumps the editor reads: nlohmann/json 3.11.3 (MIT, third_party/nlohmann/LICENSE.MIT). Included
// before the engine's headers, whose macros (check, ...) would otherwise reach into its code.
#include "nlohmann/json.hpp"
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
// The game's text and conversation classes (XExtString, the ConSys objects): their C++ fields are read
// directly, with no call into UnrealScript.
#define EXTENSION_API DLL_IMPORT
#include "ExtString.h"
#include "ConSys.h"
#include "ConEventRandomLabel.h"
#pragma pack(pop)

// A JSON row keeps its keys in the order they are written.
typedef nlohmann::ordered_json Json;

// Text between the engine (UTF-16, TCHAR) and the rest (UTF-8: commands, files, the console). Most strings are
// short: they are converted into a buffer on the stack, and only a longer one is given room on the heap.
static int toUtf8(const TCHAR* text, char* out, int size) {
    return WideCharToMultiByte(CP_UTF8, 0, (LPCWSTR)text, -1, out, size, NULL, NULL);
}
static int toWide(const char* text, TCHAR* out, int size) {
    return MultiByteToWideChar(CP_UTF8, 0, text, -1, (LPWSTR)out, size);
}
template <class From, class To, int Convert(const From*, To*, int)>
class Text {
public:
    explicit Text(const From* text) : data(local) {
        if (Convert(text, local, ARRAY_COUNT(local))) return;
        int size = Convert(text, NULL, 0);
        data = size > 0 ? (To*)malloc(size * sizeof(To)) : NULL;
        if (!data || !Convert(text, data, size)) { free(data); data = local; local[0] = 0; }
    }
    ~Text() { if (data != local) free(data); }
    operator const To*() const { return data; }
private:
    To local[1024];
    To* data;
    Text(const Text&);                  // not copied (nor passed to printf's "...")
    Text& operator=(const Text&);
};
typedef Text<TCHAR, char, toUtf8> Utf8;
typedef Text<char, TCHAR, toWide> Wide;

// a name into a fixed buffer of the caller (cut when longer: names are short)
static void wtext(const TCHAR* s, char* out, int size) {
    if (!toUtf8(s, out, size) && size) out[size - 1] = 0;
}

static void printUtf8(const TCHAR* text, FILE* stream) {
    fputs(Utf8(text), stream);
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
            // bounded: a long message is cut, never written past the buffer (appSprintf has no size)
            TCHAR temp[2048];
            const int size = sizeof(temp) / sizeof(temp[0]);
            _snwprintf((wchar_t*)temp, size - 1, L"%s : %s, %s", *Context->GetContext(), *FName(event), text);
            temp[size - 1] = 0;
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

// Revision's WinDrvLite.dll (its window and input driver) stops LIGHT APPLY: the temporary viewport the lighting
// build opens fails the check(!IsTemporary) of UWindowsViewportLite::OpenWindow. The fix turns the conditional
// jump over that assertion into an unconditional one, so a temporary viewport opens like any other. It is made in
// this process's memory only, never in the game's file, and only when the bytes around it are the known build's:
//   +0x1647E  39 7D 0C            cmp  [ebp+0Ch], edi      the IsTemporary argument
//   +0x16481  74 18  ->  EB 18    je   -> jmp  +18h        over the assertion
//   +0x16483  68 E6 00 00 00      push 0E6h                the assertion's failure call begins
// With another build of the DLL nothing is changed and LIGHT APPLY is refused (runCommand).
static const DWORD WinDrvLiteCheck = 0x1647E;               // the cmp, from the DLL's base
static int temporaryViewportReady = 1;
static int patchTemporaryViewport() {
    BYTE* base = (BYTE*)GetModuleHandleA("WinDrvLite.dll");
    if (!base) return 1;                                     // the original game's WinDrv.dll: nothing to fix
    IMAGE_NT_HEADERS* nt = (IMAGE_NT_HEADERS*)(base + ((IMAGE_DOS_HEADER*)base)->e_lfanew);
    static const BYTE before[] = { 0x39, 0x7D, 0x0C }, after[] = { 0x18, 0x68, 0xE6, 0x00, 0x00, 0x00 };
    const BYTE je = 0x74, jmp = 0xEB;
    if (nt->OptionalHeader.SizeOfImage < WinDrvLiteCheck + sizeof(before) + 1 + sizeof(after)) return 0;
    BYTE* jump = base + WinDrvLiteCheck + sizeof(before);
    if (memcmp(jump - sizeof(before), before, sizeof(before)) || memcmp(jump + 1, after, sizeof(after))) return 0;
    if (*jump == jmp) return 1;                              // a copy of the DLL fixed on disk (UnrealEd's)
    if (*jump != je) return 0;
    DWORD old;
    if (!VirtualProtect(jump, 1, PAGE_EXECUTE_READWRITE, &old)) return 0;
    *jump = jmp;
    VirtualProtect(jump, 1, old, &old);
    FlushInstructionCache(GetCurrentProcess(), jump, 1);
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
        wtext(actor->GetClass()->GetName(), cls, sizeof(cls));
        wtext(actor->GetName(), name, sizeof(name));
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
        wtext(region.Zone->GetName(), zone, sizeof(zone));
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
            wtext(s.Texture->GetPathName(), tex, sizeof(tex));
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
// The pixel layouts UC_TEXDUMP reads, and the one it writes. A DXT1 block is 4x4 pixels drawn from two RGB565
// colours (5 bits red, 6 green, 5 blue) and two in between, 2 bits a pixel; when Color0 <= Color1 there is one
// colour in between and the fourth is transparent black.
struct Rgba { BYTE R, G, B, A; };                           // the dump file
struct Bgra { BYTE B, G, R, A; };                           // TEXF_RGBA8
struct Bgr { BYTE B, G, R; };                               // TEXF_RGB8
struct Dxt1Block { WORD Color0, Color1; DWORD Indices; };   // TEXF_DXT1
static_assert(sizeof(Bgr) == 3 && sizeof(Dxt1Block) == 8, "texture layouts");

static Rgba rgb565(WORD c) {
    Rgba out = { (BYTE)(((c >> 11) & 31) * 255 / 31), (BYTE)(((c >> 5) & 63) * 255 / 63), (BYTE)((c & 31) * 255 / 31), 255 };
    return out;
}

// a and b mixed wa:wb, as the format makes its colours in between
static Rgba blend(const Rgba& a, int wa, const Rgba& b, int wb) {
    int sum = wa + wb;
    Rgba out = { (BYTE)((wa * a.R + wb * b.R) / sum), (BYTE)((wa * a.G + wb * b.G) / sum),
                 (BYTE)((wa * a.B + wb * b.B) / sum), 255 };
    return out;
}

static void dxt1Block(const Dxt1Block& block, Rgba out[16]) {
    Rgba colours[4] = { rgb565(block.Color0), rgb565(block.Color1) };
    if (block.Color0 > block.Color1) {
        colours[2] = blend(colours[0], 2, colours[1], 1);
        colours[3] = blend(colours[0], 1, colours[1], 2);
    } else {
        colours[2] = blend(colours[0], 1, colours[1], 1);
        Rgba clear = { 0, 0, 0, 0 };
        colours[3] = clear;
    }
    for (int i = 0; i < 16; i++) out[i] = colours[(block.Indices >> (2 * i)) & 3];
}

// The mips of a loaded texture: UTexture::Mips, a TArray<FMipmap> (FMipmapBase's sizes, then the pixels in a
// TLazyArray<BYTE> that loads them from the package when first asked). The SDK's structs match the engine's layout
// because Editor.h is included with the engine's 4-byte packing (the #pragma pack at the top of this file).
// Loading reads the package file: guarded, a broken or missing file is "no data", not a crash.
static int loadMip(FMipmap* m) {
    __try { m->DataArray.Load(); }
    __except (EXCEPTION_EXECUTE_HANDLER) { return 0; }
    return m->DataArray.Num() > 0;
}

// UC_LOADPKG <file>: a package loaded from its path, however long. UnrealEd's OBJ LOAD FILE= parses the name into
// an 80-character buffer, so a package deep in a folder (another mod's, NewVision's textures) was cut and not found.
static int loadPackage(const char* line) {
    const char* path = line + 10;
    while (*path == ' ') path++;
    if (!*path) return 0;
    UObject* package = UObject::LoadPackage(NULL, Wide(path), LOAD_NoWarn);
    printf("UCMapKit|loadpkg|%s|%s\n", package ? "ok" : "failed", path);
    return package != NULL;
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
    UTexture* t = (UTexture*)UObject::StaticLoadObject(UTexture::StaticClass(), NULL, Wide(name), NULL, LOAD_NoWarn | LOAD_Quiet, NULL);
    if (!t) { printf("UCMapKit|texdump|missing|%s\n", name); return 1; }
    printf("UCMapKit|texdump|info|%s|%dx%d|scale %g|format %d\n", name, t->USize, t->VSize, t->Scale, (int)t->Format);
    // the largest mip up to maxSize pixels (the first one if all are larger); only that one is loaded
    int at = 0;
    while (at + 1 < t->Mips.Num() && (t->Mips(at).USize > maxSize || t->Mips(at).VSize > maxSize)) at++;
    FMipmap* mip = t->Mips.Num() ? &t->Mips(at) : NULL;
    if (!mip || mip->USize <= 0 || mip->VSize <= 0 || !loadMip(mip)) { printf("UCMapKit|texdump|nodata|%s\n", name); return 1; }
    int w = mip->USize, h = mip->VSize;
    Rgba* rgba = (Rgba*)calloc(w * h, sizeof(Rgba));
    const BYTE* d = &mip->DataArray(0);
    int n = mip->DataArray.Num(), ok = 1;
    if (t->Format == TEXF_P8 && t->Palette && n >= w * h) {
        int masked = (t->PolyFlags & PF_Masked) != 0;          // colour 0 of a masked texture is see-through
        for (int i = 0; i < w * h; i++) {
            FColor c = t->Palette->Colors(d[i]);
            Rgba pixel = { c.R, c.G, c.B, (BYTE)((masked && d[i] == 0) ? 0 : 255) };
            rgba[i] = pixel;
        }
    } else if (t->Format == TEXF_DXT1 && w >= 4 && h >= 4 && n >= (w / 4) * (h / 4) * (int)sizeof(Dxt1Block)) {
        const Dxt1Block* blocks = (const Dxt1Block*)d;
        Rgba block[16];
        for (int by = 0; by < h / 4; by++)
            for (int bx = 0; bx < w / 4; bx++) {
                dxt1Block(blocks[by * (w / 4) + bx], block);
                for (int i = 0; i < 16; i++) rgba[(by * 4 + (i >> 2)) * w + bx * 4 + (i & 3)] = block[i];
            }
    } else if (t->Format == TEXF_RGBA8 && n >= w * h * (int)sizeof(Bgra)) {
        const Bgra* p = (const Bgra*)d;
        for (int i = 0; i < w * h; i++) { Rgba pixel = { p[i].R, p[i].G, p[i].B, p[i].A }; rgba[i] = pixel; }
    } else if (t->Format == TEXF_RGB8 && n >= w * h * (int)sizeof(Bgr)) {
        const Bgr* p = (const Bgr*)d;
        for (int i = 0; i < w * h; i++) { Rgba pixel = { p[i].R, p[i].G, p[i].B, 255 }; rgba[i] = pixel; }
    } else ok = 0;
    if (ok) {
        FILE* f = fopen(path, "wb");
        if (f) {
            fprintf(f, "UCTEX %d %d\n", w, h);
            fwrite(rgba, sizeof(Rgba), w * h, f);
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

// A property named at run time (the Properties panel, a story's settings): the engine's own description of it,
// UProperty, gives its place in the object (Offset) and the size of one element - the address ImportText and
// ExportText use. Members known when compiling are read through the SDK's structs instead.
static BYTE* propertyData(UObject* obj, UProperty* p, INT index) {
    return (BYTE*)obj + p->Offset + index * p->ElementSize;
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

static std::string utf8(const TCHAR* text) {
    return std::string(Utf8(text));
}

// One JSON line of a dump. Text that is not valid UTF-8 is replaced, never refused.
static void writeRow(FILE* f, const Json& row) {
    std::string text = row.dump(-1, ' ', false, Json::error_handler_t::replace);
    text += '\n';
    fwrite(text.data(), 1, text.size(), f);
}

// A native class of the game found by name (its StaticClass() would make the host depend on that package's
// DLL), checked against the SDK header we read it with: a native class's size is its C++ size, so a
// different build of the game, with another layout, is refused instead of read at the wrong place.
static UClass* nativeClass(const TCHAR* path, INT size) {
    UClass* cls = FindObject<UClass>(ANY_PACKAGE, path);
    if (cls && (cls->GetFlags() & RF_Native) && cls->GetPropertiesSize() == size) return cls;
    printf("UCMapKit|failed|class %s %s\n", (const char*)Utf8(path), cls ? "is not the one of the SDK headers" : "is not loaded");
    return NULL;
}

// UC_SCRIPTDUMP / UC_TEXTDUMP <package> <file>: the script sources or the text assets of a loaded package
// (read only), one JSON line {path, parent, text} each.
static FILE* openContentDump(const char* line, UPackage** package) {
    char name[128], path[512];
    if (sscanf(line, "%*s %127s %511s", name, path) != 2) return NULL;
    *package = FindObject<UPackage>(NULL, Wide(name));
    return *package ? fopen(path, "wb") : NULL;
}

// parent: a copy, as GetPathName() hands every caller the same buffer
static void contentRow(FILE* f, UObject* obj, const FString& parent, const TCHAR* text) {
    Json row;
    row["path"] = utf8(obj->GetPathName());
    row["parent"] = utf8(*parent);
    row["text"] = utf8(text);
    writeRow(f, row);
}

static int dumpScripts(const char* line) {
    UPackage* package;
    FILE* f = openContentDump(line, &package);
    if (!f) return 0;
    int count = 0;
    for (TObjectIterator<UClass> it; it; ++it) {
        if (!it->ScriptText || !it->IsIn(package)) continue;
        UClass* super = it->GetSuperClass();
        contentRow(f, *it, FString(super ? super->GetPathName() : TEXT("")), *it->ScriptText->Text);
        ++count;
    }
    fclose(f); printf("UCMapKit|scripts|%d\n", count);
    return count > 0;
}

static int dumpTexts(const char* line) {
    UClass* extString = nativeClass(TEXT("Extension.ExtString"), sizeof(XExtString));
    UPackage* package;
    FILE* f = extString ? openContentDump(line, &package) : NULL;
    if (!f) return 0;
    int count = 0;
    for (TObjectIterator<UObject> it; it; ++it) {
        if (!it->IsA(extString) || !it->IsIn(package)) continue;
        contentRow(f, *it, FString(), ((XExtString*)*it)->GetText());
        ++count;
    }
    fclose(f); printf("UCMapKit|texts|%d\n", count);
    return count > 0;
}

// UC_CONDUMP <file>: every conversation object loaded, for the editor's local cache: all their reflected
// properties, zero and default values too, objects as full paths, so Python follows the native linked lists.
static int dumpConversations(const char* line) {
    char path[512];
    if (sscanf(line, "UC_CONDUMP %511s", path) != 1) return 0;
    UClass* base = FindObject<UClass>(ANY_PACKAGE, TEXT("ConSys.ConObject"));
    UClass* randomLabel = nativeClass(TEXT("ConSys.ConEventRandomLabel"), sizeof(DConEventRandomLabel));
    if (!base || !randomLabel) return 0;
    FILE* f = fopen(path, "wb");
    if (!f) return 0;
    // ExportText writes into the caller's buffer and is given no size: one large buffer for every value
    static TCHAR value[65536];
    int count = 0, errors = 0;
    for (TObjectIterator<UObject> it; it; ++it) {
        UObject* obj = *it;
        if (!obj->IsA(base)) continue;
        Json row;
        row["class"] = utf8(obj->GetClass()->GetName());
        row["path"] = utf8(obj->GetPathName());
        Json& properties = row["properties"] = Json::object();
        for (TFieldIterator<UProperty> p(obj->GetClass()); p; ++p) {
            for (INT i = 0; i < p->ArrayDim; ++i) {
                TCHAR key[256];
                if (p->ArrayDim > 1) appSprintf(key, TEXT("%s(%d)"), p->GetName(), i);
                else appStrcpy(key, p->GetName());
                Json& out = properties[utf8(key)];          // null unless exported
                // Some original camera transitions contain an out-of-range enum byte. Export the
                // stored number in that case; ExportText would index past the enum's names.
                UByteProperty* byte = Cast<UByteProperty>(*p);
                BYTE raw = byte ? *propertyData(obj, *p, i) : 0;
                if (byte && byte->Enum && raw >= byte->Enum->Names.Num()) out = std::to_string(raw);
                else if (safeExport(*p, i, (BYTE*)obj, value)) out = utf8(value);
                else ++errors;
            }
        }
        if (obj->IsA(randomLabel)) {
            // the random/cyclic jump targets: a TArray<FString> in C++, which the script property list
            // only shows as an opaque array header
            Json& labels = row["labels"] = Json::array();
            TArray<FString>& names = ((DConEventRandomLabel*)obj)->labels;
            for (INT i = 0; i < names.Num(); ++i) labels.push_back(utf8(*names(i)));
        }
        writeRow(f, row); ++count;
    }
    fclose(f);
    printf("UCMapKit|condump|%d|property errors %d\n", count, errors);
    return errors == 0 && count > 0;
}

// Resolve through ConSys itself, rather than infer sound names from a speech number.
static int conversationSound(const char* line) {
    char name[512], path[512]; INT id;
    if (sscanf(line, "UC_CONSOUND %511s %d %511s", name, &id, path) != 3 || id < 0) return 0;
    Wide wname(name);
    UClass* conversation = nativeClass(TEXT("ConSys.Conversation"), sizeof(DConversation));
    UObject* obj = FindObject<UObject>(ANY_PACKAGE, wname);
    if (!conversation || !obj || !obj->IsA(conversation)) return 0;
    USound* sound = ((DConversation*)obj)->GetSpeechAudio(id);
    Json row;
    row["conversation"] = name;
    row["id"] = id;
    row["sound"] = sound && sound->IsA(USound::StaticClass()) ? Json(utf8(sound->GetPathName())) : Json();
    FILE* f = fopen(path, "ab");
    if (!f) return 0;
    writeRow(f, row); fclose(f);
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
            UProperty* p = FindField<UProperty>(c, Wide(props[k]));
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

// UC_CLASSPROPS <file> <class>: every property of one class that UnrealEd's Properties window shows (CPF_Edit), for
// the map editor's All properties. Lines, in the class's order (its own first, then its parents'):
//   P <name> <index, -1 for a single value> <property type> <category> <class default>
//   E <name> <enum value names separated by |>
static int dumpClassProps(const char* line) {
    char path[512], cname[128];
    if (sscanf(line, "UC_CLASSPROPS %511s %127s", path, cname) != 2) return 0;
    UClass* c = FindObject<UClass>(ANY_PACKAGE, Wide(cname));
    if (!c || !c->IsChildOf(AActor::StaticClass())) { printf("UCMapKit|classprops|missing|%s\n", cname); return 1; }
    BYTE* d = (BYTE*)c->GetDefaultObject();
    FILE* f = fopen(path, "wt");
    if (!f || !d) { if (f) fclose(f); return 0; }
    static TCHAR buf[16384];
    int n = 0;
    for (TFieldIterator<UProperty> It(c); It; ++It) {
        UProperty* p = *It;
        if (!(p->PropertyFlags & CPF_Edit)) continue;
        char name[128], type[64], group[128];
        wtext(p->GetName(), name, sizeof(name));
        wtext(p->GetClass()->GetName(), type, sizeof(type));
        wtext(*p->Category, group, sizeof(group));
        for (char* q = group; *q; q++) if (*q == ' ' || *q == '\t') *q = '_';
        if (p->IsA(UByteProperty::StaticClass()) && ((UByteProperty*)p)->Enum) {
            UEnum* e = ((UByteProperty*)p)->Enum;
            fprintf(f, "E\t%s\t", name);
            for (int i = 0; i < e->Names.Num(); i++) {
                char en[128];
                wtext(*e->Names(i), en, sizeof(en));
                fprintf(f, "%s%s", i ? "|" : "", en);
            }
            fprintf(f, "\n");
        }
        int dim = p->ArrayDim > 32 ? 32 : p->ArrayDim;
        for (int i = 0; i < dim; i++) {
            if (!safeExport(p, i, d, buf)) continue;
            char value[4096];
            wtext(buf, value, sizeof(value));
            for (char* q = value; *q; q++) if (*q == '\t' || *q == '\n' || *q == '\r') *q = ' ';
            fprintf(f, "P\t%s\t%d\t%s\t%s\t%s\n", name, p->ArrayDim > 1 ? i : -1, type, group[0] ? group : "None", value);
        }
        n++;
    }
    fclose(f);
    printf("UCMapKit|classprops|%d\n", n);
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
    UProperty* p = FindField<UProperty>(a->GetClass(), Wide(prop));
    if (!p || index < 0 || index >= p->ArrayDim) { printf("UCMapKit|prop|noprop|%s|%s\n", name, prop); return 1; }
    // a value can be long (the text of a book or a datacube): Wide takes the heap for it
    if (!safeImport(p, Wide(value), propertyData(a, p, index))) {
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
    UObject* o = UObject::StaticFindObject(UObject::StaticClass(), ANY_PACKAGE, Wide(name));
    if (!o) { printf("UCMapKit|objprop|missing|%s\n", name); return 1; }
    UProperty* p = FindField<UProperty>(o->GetClass(), Wide(prop));
    if (!p) { printf("UCMapKit|objprop|noprop|%s|%s\n", name, prop); return 1; }
    if (!safeImport(p, Wide(line + used), propertyData(o, p, 0))) { printf("UCMapKit|objprop|failed|%s|%s\n", name, prop); return 1; }
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
    UTexture* tex = (UTexture*)UObject::StaticFindObject(UTexture::StaticClass(), ANY_PACKAGE, Wide(newt));
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

// mask: the PolyFlags taken from p (shadow detail, or the face flags of the editor's Surface panel)
static void storeSurface(ABrush* b, int face, FPoly p, int mapping, int texture, DWORD mask) {
    FModelCoords inv;
    FLOAT orientation = b->BuildCoords(NULL, &inv);
    FPoly local = p;
    local.Transform(inv, b->Location, b->PrePivot, orientation);
    for (int i = 0; i < b->Brush->Polys->Element.Num(); i++) {
        FPoly& dst = b->Brush->Polys->Element(i);
        if (i != face && dst.iLink != face) continue;
        if (mapping) { dst.Base = local.Base; dst.TextureU = local.TextureU; dst.TextureV = local.TextureV; dst.PanU = local.PanU; dst.PanV = local.PanV; }
        if (texture) dst.Texture = p.Texture;
        if (mask) dst.PolyFlags = (dst.PolyFlags & ~mask) | (p.PolyFlags & mask);
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
        if (mask) s.PolyFlags = (s.PolyFlags & ~mask) | (p.PolyFlags & mask);
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

// UC_SURFACE <brush> <source polygon or *> <floor|wall|tile|tile-u|tile-v|cylinder|pan|scale|rotate|flip-u|flip-v|texture|shadows|flags> [args]
// flags <set> <clear>: UnrealEd's surface properties (Unlit, Translucent, Masked, Modulated, Two Sided, Mirror, Invisible,
// Fake Backdrop, Special Lit, No Smoothing), only those bits
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
    int flipu = !strcmp(mode, "flip-u"), flipv = !strcmp(mode, "flip-v"), flags = !strcmp(mode, "flags");
    if (!(shadow || texture || pan || scale || fit || floor || wall || rotate || flipu || flipv || flags)) return surfaceError("Unknown surface operation");
    const DWORD allowed = PF_Invisible | PF_Masked | PF_Translucent | PF_Modulated | PF_FakeBackdrop | PF_TwoSided | PF_NoSmooth
        | PF_SpecialLit | PF_Unlit | PF_Mirrored;
    unsigned long set = 0, clear = 0;
    if (flags && (sscanf(line, "UC_SURFACE %*s %*s %*s %lu %lu", &set, &clear) != 2 || ((set | clear) & ~allowed) || (set & clear)))
        return surfaceError("Invalid surface flags");
    if (pan || scale) {
        if (sscanf(line, "UC_SURFACE %*s %*s %*s %f %f", &x, &y) != 2 || !_finite(x) || !_finite(y)) return surfaceError("Invalid U/V values");
        if (scale && (x < .001f || y < .001f || x > 1000 || y > 1000)) return surfaceError("Texture scale must be 0.001 to 1000");
    }
    if (shadow && strcmp(arg, "low") && strcmp(arg, "normal") && strcmp(arg, "high")) return surfaceError("Invalid shadow detail");
    UTexture* tex = NULL;
    if (texture) {
        tex = (UTexture*)UObject::StaticFindObject(UTexture::StaticClass(), ANY_PACKAGE, Wide(arg));
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
        else if (flags) p.PolyFlags = (p.PolyFlags | (DWORD)set) & ~(DWORD)clear;
        storeSurface(b, i, p, !shadow && !texture && !flags, texture,
            shadow ? (PF_LowShadowDetail | PF_HighShadowDetail) : flags ? (DWORD)(set | clear) : 0); changed++;
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
    return (UMesh*)UObject::StaticLoadObject(UMesh::StaticClass(), NULL, Wide(path), NULL, LOAD_NoWarn | LOAD_Quiet, NULL);
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
    // after the "data" line, the new frames' vertices as editor/anims.py writes them: x y z, 16-bit each
    struct FrameVert { short X, Y, Z; };
    int fv = from->FrameVerts;
    FrameVert* v = (FrameVert*)malloc(sizeof(FrameVert) * (size_t)total * fv);
    fseek(f, dataAt, SEEK_SET);
    size_t read = fread(v, sizeof(FrameVert), (size_t)total * fv, f);
    fclose(f);
    if ((int)read != total * fv) { free(v); printf("UCMapKit|animnew|frames missing|%d of %d\n", (int)read, total * fv); return 0; }
    Wide wpkg(pkg), wname(name);
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
        mv.X = v[i].X; mv.Y = v[i].Y; mv.Z = v[i].Z;
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
        Wide wseq(seqs[s].name), wgroup(seqs[s].group);
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
// UC_ANIMNEW, an empty package named after the file (the Studio has no animation left)
static int saveAnimPackage(const char* line) {
    char path[512];
    if (sscanf(line, "UC_ANIMSAVE %511s", path) != 1) return 0;
    if (!AnimPackage) {
        char name[128];
        const char* base = strrchr(path, '\\');
        strncpy(name, base ? base + 1 : path, 127);
        name[127] = 0;
        if (char* dot = strrchr(name, '.')) *dot = 0;
        AnimPackage = UObject::CreatePackage(NULL, Wide(name));
    }
    UBOOL ok = UObject::SavePackage(AnimPackage, NULL, RF_Standalone, Wide(path), GWarn);
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
    Wide wpkg(pkg), wname(name), waniv(aniv), wdata(data);
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
    Wide wpkg(pkg), wpath(path);
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

// UC_NAVDROP temp: every walking point of the map (path, patrol, hide, ambush points...) rested on the floor
// for PATHS DEFINE only; UC_NAVLIFT puts each back where it was. The original maps have their points 11-44
// units over the floor and were linked by Ion Storm's and Revision's editors, but this host's PATHS DEFINE
// links none floating over about 20 (Battery Park: 302 reach specs instead of 1409; 1095 with them on the
// floor; 17 Oct 2026). Left alone: player starts, teleporters, lifts and the markers PATHS DEFINE makes itself,
// points over water (swimming) and points higher than 64 over the floor (put there on purpose).
static char navTempName[4096][64];
static FLOAT navTempZ[4096];
static int navTempCount = 0;
static int classIs(AActor* a, const char* name) {
    for (UClass* c = a->GetClass(); c; c = c->GetSuperClass()) {
        char n[128];
        wtext(c->GetName(), n, sizeof(n));
        if (!_stricmp(n, name)) return 1;
    }
    return 0;
}
static int dropNavTemp() {
    if (!GEditor->Level || !GEditor->Level->Model) return 0;
    static const char* skip[] = { "PlayerStart", "Teleporter", "LiftCenter", "LiftExit", "InventorySpot", "WarpZoneMarker",
                                  "ButtonMarker", "TriggerMarker", NULL };
    navTempCount = 0;
    int checked = 0;
    for (int i = 0; i < GEditor->Level->Actors.Num() && navTempCount < 4096; i++) {
        AActor* a = GEditor->Level->Actors(i);
        if (!a || !a->IsA(ANavigationPoint::StaticClass())) continue;
        int other = 0;
        for (int k = 0; skip[k] && !other; k++) other = classIs(a, skip[k]);
        if (other) continue;
        checked++;
        char name[64];
        wtext(a->GetName(), name, sizeof(name));
        FPointRegion region = GEditor->Level->Model->PointRegion(GEditor->Level->GetLevelInfo(), a->Location);
        if (region.Zone && region.Zone->bWaterZone) { printf("UCMapKit|navdrop temp|%s|water\n", name); continue; }
        FCheckResult hit(1.f);
        FVector end = a->Location - FVector(0, 0, 512);
        if (GEditor->Level->SingleLineCheck(hit, NULL, end, a->Location, TRACE_Level, FVector(0, 0, 0), 0)) { printf("UCMapKit|navdrop temp|%s|no floor\n", name); continue; }
        FLOAT z = hit.Location.Z + a->CollisionHeight;
        if (Abs(a->Location.Z - z) < 2.f || z > a->Location.Z) continue;
        if (a->Location.Z - z > 64.f) { printf("UCMapKit|navdrop temp|%s|%.1f over the floor: kept\n", name, a->Location.Z - z); continue; }
        printf("UCMapKit|navdrop temp|%s|%.1f -> %.1f\n", name, a->Location.Z, z);
        strcpy(navTempName[navTempCount], name);
        navTempZ[navTempCount++] = a->Location.Z;
        a->Location.Z = z;
    }
    printf("UCMapKit|navdrop temp|%d checked|%d moved\n", checked, navTempCount);
    return 1;
}
static int liftNavTemp() {
    if (!GEditor->Level) return 0;
    int back = 0;
    for (int k = 0; k < navTempCount; k++) {
        AActor* a = findActor(navTempName[k]);
        if (!a || !a->IsA(ANavigationPoint::StaticClass())) continue;
        a->Location.Z = navTempZ[k];
        back++;
    }
    printf("UCMapKit|navlift|%d of %d back\n", back, navTempCount);
    navTempCount = 0;
    return 1;
}

// UC_KEEPPATHS save (right after MAP LOAD, before any edit) / UC_KEEPPATHS restore (after PATHS DEFINE): the
// map's own reach specs that this host's PATHS DEFINE does not make again are put back. Battery Park's subway
// stairs (PathNode405 -> PathNode446) were linked by the original editor and never by this one, even with the
// points on the floor (18 Oct 2026). A spec comes back only when both its points are still in the map, exactly
// where they were (not moved or deleted in the editor), the new PATHS DEFINE has not linked them itself, and the
// line between them at a man's height is clear of the level (nothing built across it since).
struct KeptSpec {
    char a[64], b[64];
    FVector la, lb;
    INT dist, rad, hgt, flags;
};
static KeptSpec* keptSpecs = NULL;
static int keptCount = 0;
static int keepPaths(const char* line) {
    if (!GEditor->Level) return 0;
    TArray<FReachSpec>& reach = GEditor->Level->ReachSpecs;
    if (!strcmp(line, "UC_KEEPPATHS save")) {
        free(keptSpecs);
        keptSpecs = (KeptSpec*)malloc(sizeof(KeptSpec) * (reach.Num() + 1));
        keptCount = 0;
        for (int i = 0; i < reach.Num() && keptSpecs; i++) {
            FReachSpec& r = reach(i);
            if (r.bPruned || !r.Start || !r.End || !r.Start->IsA(ANavigationPoint::StaticClass()) || !r.End->IsA(ANavigationPoint::StaticClass()))
                continue;
            KeptSpec& s = keptSpecs[keptCount++];
            wtext(r.Start->GetName(), s.a, sizeof(s.a));
            wtext(r.End->GetName(), s.b, sizeof(s.b));
            s.la = r.Start->Location;
            s.lb = r.End->Location;
            s.dist = r.distance;
            s.rad = r.CollisionRadius;
            s.hgt = r.CollisionHeight;
            s.flags = r.reachFlags;
        }
        printf("UCMapKit|keeppaths|%d saved\n", keptCount);
        return 1;
    }
    if (strcmp(line, "UC_KEEPPATHS restore")) return 0;
    int back = 0, there = 0, moved = 0, blocked = 0, full = 0;
    for (int k = 0; k < keptCount; k++) {
        KeptSpec& s = keptSpecs[k];
        AActor* a = findActor(s.a);
        AActor* b = findActor(s.b);
        if (!a || !b || !a->IsA(ANavigationPoint::StaticClass()) || !b->IsA(ANavigationPoint::StaticClass())
            || (a->Location - s.la).SizeSquared() > 1.f || (b->Location - s.lb).SizeSquared() > 1.f) {
            moved++;
            continue;
        }
        ANavigationPoint* na = (ANavigationPoint*)a;
        ANavigationPoint* nb = (ANavigationPoint*)b;
        int linked = 0;
        for (int j = 0; j < 16 && !linked; j++) {
            int p = na->Paths[j], q = na->PrunedPaths[j];
            if ((p >= 0 && p < reach.Num() && reach(p).End == b) || (q >= 0 && q < reach.Num() && reach(q).End == b))
                linked = 1;
        }
        if (linked) {
            there++;
            continue;
        }
        int clear = 0;
        for (FLOAT dz = 16.f; dz <= 48.f && !clear; dz += 16.f) {
            FCheckResult hit(1.f);
            if (GEditor->Level->SingleLineCheck(hit, NULL, b->Location + FVector(0, 0, dz), a->Location + FVector(0, 0, dz), TRACE_Level, FVector(0, 0, 0), 0))
                clear = 1;
        }
        if (!clear) {
            blocked++;
            continue;
        }
        int pa = -1, pb = -1;
        for (int j = 0; j < 16; j++) {
            if (pa < 0 && na->Paths[j] == -1) pa = j;
            if (pb < 0 && nb->upstreamPaths[j] == -1) pb = j;
        }
        if (pa < 0 || pb < 0) {
            full++;
            continue;
        }
        FReachSpec r;
        r.Init();
        r.Start = a;
        r.End = b;
        r.distance = s.dist;
        r.CollisionRadius = s.rad;
        r.CollisionHeight = s.hgt;
        r.reachFlags = s.flags;
        int idx = reach.AddItem(r);
        na->Paths[pa] = idx;
        nb->upstreamPaths[pb] = idx;
        back++;
        printf("UCMapKit|keeppaths|back|%s|%s\n", s.a, s.b);
    }
    printf("UCMapKit|keeppaths|%d of %d put back|%d made again|%d moved or gone|%d blocked|%d no room\n",
           back, keptCount, there, moved, blocked, full);
    return 1;
}

// UC_SIZES: collision cylinder of every non-brush actor (to rest props exactly on surfaces).
static int listSizes() {
    if (!GEditor->Level) return 0;
    for (int i=0; i<GEditor->Level->Actors.Num(); i++) {
        AActor* actor = GEditor->Level->Actors(i);
        if (!actor || actor->IsA(ABrush::StaticClass()) || actor->IsA(ALevelInfo::StaticClass())) continue;
        char cls[128];
        wtext(actor->GetClass()->GetName(), cls, sizeof(cls));
        printf("UCMapKit|size|%s|%.2f|%.2f\n", cls, actor->CollisionRadius, actor->CollisionHeight);
    }
    return 1;
}

// UC_UNLINK <model name prefix>: every polygon of the brushes whose model's name starts with the prefix
// gets a surface of its own (iLink = its index), as BRUSH IMPORT + BRUSH ADD left them. MAP IMPORTADD
// links the coplanar faces of one texture into one surface, which changes the map's surfaces and the
// numbers its faces have in the editor (scene.py brush_blocks imports the script's brushes in one go).
static int unlinkBrushes(const char* line) {
    char prefix[128];
    if (sscanf(line, "UC_UNLINK %127s", prefix) != 1 || !GEditor->Level) return 0;
    size_t n = strlen(prefix);
    int brushes = 0, polys = 0;
    for (int i = 0; i < GEditor->Level->Actors.Num(); i++) {
        AActor* a = GEditor->Level->Actors(i);
        if (!a || !a->IsA(ABrush::StaticClass()) || !a->Brush || !a->Brush->Polys) continue;
        char model[256];
        wtext(a->Brush->GetName(), model, sizeof(model));
        if (strncmp(model, prefix, n)) continue;
        for (int k = 0; k < a->Brush->Polys->Element.Num(); k++) a->Brush->Polys->Element(k).iLink = k;
        a->Brush->Linked = 1;
        brushes++;
        polys += a->Brush->Polys->Element.Num();
    }
    printf("UCMapKit|unlink|%d brushes|%d polygons\n", brushes, polys);
    return 1;
}

static int runCommand(const char* line, unsigned short* wide, FFeedbackContext& feedback) {
    if (!strncmp(line, "UC_POINT ", 9)) return probePoint(line);
    if (!strncmp(line, "UC_UNLINK ", 10)) return unlinkBrushes(line);
    if (!strcmp(line, "UC_SIZES")) return listSizes();
    if (!strncmp(line, "UC_TRACE ", 9)) return traceLine(line);
    if (!strncmp(line, "UC_BSPDUMP ", 11)) return dumpBsp(line);
    if (!strncmp(line, "UC_LIGHTDUMP ", 13)) return dumpLights(line);
    if (!strncmp(line, "UC_MESHES ", 10)) return dumpMeshes(line);
    if (!strncmp(line, "UC_BRUSHES ", 11)) return listBrushes(line);
    if (!strncmp(line, "UC_PATHS ", 9)) return dumpPaths(line);
    if (!strcmp(line, "UC_NAVDROP temp")) return dropNavTemp();
    if (!strcmp(line, "UC_NAVLIFT")) return liftNavTemp();
    if (!strncmp(line, "UC_KEEPPATHS ", 13)) return keepPaths(line);
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
    if (!strncmp(line, "UC_LOADPKG ", 11)) return loadPackage(line);
    if (!strncmp(line, "UC_CLASSPROPS ", 14)) return dumpClassProps(line);
    if (!strncmp(line, "UC_CONDUMP ", 11)) return dumpConversations(line);
    if (!strncmp(line, "UC_TEXTDUMP ", 12)) return dumpTexts(line);
    if (!strncmp(line, "UC_TEXTHEX ", 11)) return setTextHex(line);
    if (!strncmp(line, "UC_SCRIPTDUMP ", 14)) return dumpScripts(line);
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

// One command a line, of any length: the line and its wide copy grow when a command is longer than they are
// (released when the session ends). The wide copy is byte for byte, as the engine's commands are plain ASCII.
struct LineBuffer {
    char* text; unsigned short* w; size_t size;
    LineBuffer() : text((char*)malloc(8192)), w((unsigned short*)malloc(8192 * sizeof(unsigned short))), size(8192) {}
    ~LineBuffer() { free(text); free(w); }
    char* read(FILE* input) {
        size_t length = 0;
        for (;;) {
            if (!fgets(text + length, (int)(size - length), input)) return length ? text : NULL;
            length += strlen(text + length);
            if (length && text[length - 1] == '\n') return text;
            if (length + 1 < size) continue;                      // the last line of the file, no line break
            size *= 2;
            text = (char*)realloc(text, size);
            w = (unsigned short*)realloc(w, size * sizeof(unsigned short));
        }
    }
    unsigned short* wide() {
        size_t i = 0;
        for (; text[i]; i++) w[i] = (unsigned char)text[i];
        w[i] = 0;
        return w;
    }
};

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
    // Headless, the editor engine's Draw would paint its viewports through UnrealEd's front-end, which is not
    // there (it crashed on the toolbar buttons of LIGHT APPLY's viewport): Draw returns at once.
    // void __thiscall UEditorEngine::Draw(UViewport*, int, unsigned char*, int*): ret 16, its four arguments
    static const unsigned char ret16[3] = { 0xC2, 0x10, 0x00 };
    patchExport("Editor.dll", "?Draw@UEditorEngine@@UAEXPAVUViewport@@HPAEPAH@Z", ret16, 3);
    puts("UCMapKit|ready"); fflush(stdout);
    LineBuffer buffer;
    char* line;
    while ((line = buffer.read(input)) != NULL) {
        line[strcspn(line, "\r\n")] = 0;
        if (!line[0] || line[0] == '#') { if (interactive) { puts("UCMapKit|ready"); fflush(stdout); } continue; }
        if (interactive && !strcmp(line, "UC_QUIT")) break;
        unsigned short* wide = buffer.wide();
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
