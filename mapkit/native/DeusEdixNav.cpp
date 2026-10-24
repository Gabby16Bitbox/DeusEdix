// DeusEdixNav.dll: the native code of the package DeusEdixNav (DeusEdixNav.u), loaded by the game with it.
// UCNavNative.Route: the route on a map's walkable area (a UCNavMesh) in C++ (NavRoute.h) instead of UnrealScript.
//
// Built against the Deus Ex SDK 1112f headers, like the map editor's engine bridge (host/README.md), and linked to
// Core.dll only: Revision's Core.dll exports the same names as the original game's, so one DLL serves both. The
// class extends Object, not Actor: Revision's Engine was rebuilt and its Actor may not have the SDK's layout.
#include "NavRoute.h"           // the standard headers first: the engine's guard() macro clashes with __declspec(guard)
#define DEUSEDIXNAV_API DLL_EXPORT
#include "Core.h"

IMPLEMENT_PACKAGE(DeusEdixNav);

class DEUSEDIXNAV_API UUCNavNative : public UObject {
public:
    DECLARE_CLASS(UUCNavNative, UObject, 0)
    DECLARE_FUNCTION(execRoute)
    UUCNavNative() {}
};

// IMPLEMENT_CLASS as UnObjBas.h writes it for other compilers: its _MSC_VER branch takes a member function's address
// without '&', which only Visual C++ 6 accepted
UClass UUCNavNative::PrivateStaticClass(EC_NativeConstructor, sizeof(UUCNavNative), UUCNavNative::StaticClassFlags,
    UUCNavNative::Super::StaticClass(), UUCNavNative::WithinClass::StaticClass(),
    FGuid(UUCNavNative::GUID1, UUCNavNative::GUID2, UUCNavNative::GUID3, UUCNavNative::GUID4), TEXT("UCNavNative"),
    GPackage, UUCNavNative::StaticConfigName(), RF_Public | RF_Standalone | RF_Transient | RF_Native,
    (void(*)(void*))UUCNavNative::InternalConstructor, (void(UObject::*)())&UUCNavNative::StaticConstructor);
extern "C" DLL_EXPORT UClass* autoclassUUCNavNative;
DLL_EXPORT UClass* autoclassUUCNavNative = UUCNavNative::StaticClass();

// Where a UCNavMesh class keeps the walkable area: the offset of each array in its objects. UCNavMesh is a class of
// each project's own package (DeusEdix, a project's, the mod's), so it is found by its properties, checked for
// their type and size; a class is looked up once.
struct MeshLayout {
    UClass* Class = NULL;
    FName Name = NAME_None;
    INT PropertiesSize = 0;
    INT NumPolys = -1, Sides = -1, CornerX = -1, CornerY = -1, CornerZ = -1, Across = -1, Corner = -1;
    bool ok() const {
        return NumPolys >= 0 && Sides >= 0 && CornerX >= 0 && CornerY >= 0 && CornerZ >= 0 && Across >= 0 && Corner >= 0;
    }
};

// the offset of a property of the class with that type and at least that many elements, or -1
static INT offsetOf(UClass* cls, const TCHAR* name, UClass* type, INT count) {
    UProperty* p = FindField<UProperty>(cls, name);
    if (!p || !p->IsA(type) || p->ArrayDim < count)
        return -1;
    return p->Offset;
}

static INT vectorsOffset(UClass* cls, const TCHAR* name, INT count) {
    UStructProperty* p = Cast<UStructProperty>(FindField<UProperty>(cls, name));
    if (!p || p->ArrayDim < count || !p->Struct || p->Struct->GetFName() != NAME_Vector)
        return -1;
    return p->Offset;
}

static const MeshLayout& layoutOf(UClass* cls) {
    static MeshLayout known;
    if (known.Class == cls && known.Name == cls->GetFName() && known.PropertiesSize == cls->GetPropertiesSize())
        return known;
    const INT corners = nav::MaxPolys * nav::MaxSides;
    MeshLayout l;
    l.Class = cls;
    l.Name = cls->GetFName();
    l.PropertiesSize = cls->GetPropertiesSize();
    l.NumPolys = offsetOf(cls, TEXT("NumPolys"), UIntProperty::StaticClass(), 1);
    l.Sides = offsetOf(cls, TEXT("Sides"), UByteProperty::StaticClass(), nav::MaxPolys);
    l.CornerX = offsetOf(cls, TEXT("CornerX"), UFloatProperty::StaticClass(), corners);
    l.CornerY = offsetOf(cls, TEXT("CornerY"), UFloatProperty::StaticClass(), corners);
    l.CornerZ = offsetOf(cls, TEXT("CornerZ"), UFloatProperty::StaticClass(), corners);
    l.Across = offsetOf(cls, TEXT("Across"), UIntProperty::StaticClass(), corners);
    l.Corner = vectorsOffset(cls, TEXT("Corner"), nav::MaxCorners);
    if (!l.ok())
        GLog->Logf(TEXT("UCNavNative: %s has no walkable area arrays"), cls->GetPathName());
    known = l;
    return known;
}

// The route from a to b on the walkable area of mesh, into its Corner array: the number of corners, 0 for no way.
static INT route(UObject* mesh, const FVector& a, const FVector& b) {
    if (!mesh)
        return 0;
    const MeshLayout& l = layoutOf(mesh->GetClass());
    if (!l.ok())
        return 0;
    BYTE* base = (BYTE*)mesh;
    nav::Polygons polys = {*(INT*)(base + l.NumPolys), base + l.Sides, (FLOAT*)(base + l.CornerX),
                           (FLOAT*)(base + l.CornerY), (FLOAT*)(base + l.CornerZ), (INT*)(base + l.Across)};
    nav::Vec out[nav::MaxCorners];
    INT n;
    try {
        nav::Router router(polys);
        n = router.Route(nav::Vec{a.X, a.Y, a.Z}, nav::Vec{b.X, b.Y, b.Z}, out);
    } catch (...) {                                     // no memory for the search: no route, the game goes on
        GLog->Logf(TEXT("UCNavNative: the search failed"));
        return 0;
    }
    FVector* corners = (FVector*)(base + l.Corner);
    for (INT i = 0; i < n; i++)
        corners[i] = FVector(out[i].X, out[i].Y, out[i].Z);
    return n;
}

void UUCNavNative::execRoute(FFrame& Stack, RESULT_DECL) {
    P_GET_OBJECT(UObject, Mesh);
    P_GET_VECTOR(From);
    P_GET_VECTOR(To);
    P_FINISH;
    *(INT*)Result = route(Mesh, From, To);
}
IMPLEMENT_FUNCTION(UUCNavNative, -1, execRoute);
