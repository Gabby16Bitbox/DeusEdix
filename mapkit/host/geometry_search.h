// Exact broad-phase for the pinned native near-point remap. The native compiler
// still allocates the remap and consumes it (surfaces, vertices, degenerates).
// Only the quadratic search is bypassed; nearest is NOT interchangeable with
// the first earlier point inside the strict native distance threshold.
#pragma float_control(precise, on, push)
struct GeoCell {
    long long x,y,z;
    bool operator==(const GeoCell& b)const{return x==b.x&&y==b.y&&z==b.z;}
};
struct GeoCellHash {
    size_t operator()(const GeoCell& c)const {
        unsigned long long h=(unsigned long long)c.x*0x9e3779b185ebca87ULL;
        h^=(unsigned long long)c.y*0xc2b2ae3d27d4eb4fULL;
        h^=(unsigned long long)c.z*0x165667b19e3779f9ULL;
        return (size_t)(h^(h>>32));
    }
};
static GeoCell geoCell(const FVector& p,double width) {
    return {(long long)floor(double(p.X)/width),(long long)floor(double(p.Y)/width),(long long)floor(double(p.Z)/width)};
}
static bool geoPointFinite(const FVector& p) {
    return _finite(p.X)&&_finite(p.Y)&&_finite(p.Z)&&fabs(p.X)<=131072&&fabs(p.Y)<=131072&&fabs(p.Z)<=131072;
}
static double geoCellWidth(float threshold) {
    int exp;double f=frexp(double(threshold),&exp);return ldexp(1.0,exp-(f==0.5?1:0));
}
static int geoMode=0,geoPrepared=0,geoMerged=0,geoFailures=0,geoMismatches=0,geoCalls=0;
static unsigned long long geoChecks=0;
static double geoSeconds=0;
static DWORD geoLoopReturn=0,geoLoopSkip=0,geoCheckReturn=0;
static std::vector<INT> geoPrediction;
static INT* geoActual=nullptr;
static bool geoNearMap(UModel* model,float tolerance,std::vector<INT>& map) {
    if((_controlfp(0,0)&(_MCW_PC|_MCW_RC))!=_PC_53||(_mm_getcsr()&0xe040)||!_finite(tolerance)||tolerance<0.000001f||tolerance>1024.f)return false;
    int n=model->Points.Num();if(n<256||n>2000000)return false;
    for(int i=0;i<n;i++)if(!geoPointFinite(model->Points(i)))return false;
    double width=geoCellWidth(tolerance),limit=double(tolerance)*double(tolerance);
    std::unordered_map<GeoCell,std::vector<INT>,GeoCellHash> grid;grid.reserve(n);
    map.resize(n);geoMerged=0;
    for(int i=0;i<n;i++) {
        const FVector& p=model->Points(i);GeoCell cell=geoCell(p,width);int best=i;
        for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++) {
            auto bucket=grid.find({cell.x+x,cell.y+y,cell.z+z});if(bucket==grid.end())continue;
            for(INT j:bucket->second) {
                if(j>=best)break;
                const FVector& q=model->Points(j);
                // Native x87 runs at 53-bit precision. Preserve its operation
                // order, strict comparison, and earliest-index tie behavior.
                double dx=double(q.X)-double(p.X),dy=double(q.Y)-double(p.Y),dz=double(q.Z)-double(p.Z);
                double zz=dz*dz,yy=dy*dy,xx=dx*dx;
                double zy=zz+yy,distance=zy+xx;geoChecks++;
                if(distance<limit){best=j;break;}
            }
        }
        map[i]=best;if(best!=i)geoMerged++;
        // Include merged points too: native mapping does not collapse chains.
        grid[cell].push_back(i);
    }
    return true;
}
static void __cdecl geoPrepare(UModel* model,INT* remap,float tolerance) {
    double start=bspClock();geoPrepared=0;geoActual=nullptr;geoPrediction.clear();
    try {
        if(geoNearMap(model,tolerance,geoPrediction)) {
            geoCalls++;
            if(geoMode==2)geoActual=remap;
            else {memcpy(remap,geoPrediction.data(),geoPrediction.size()*sizeof(INT));geoPrepared=1;}
        }
    } catch(...) {geoFailures++;geoPrediction.clear();}
    geoSeconds+=bspClock()-start;
}
static void __cdecl geoCheck() {
    if(geoActual)for(size_t i=0;i<geoPrediction.size();i++)if(geoActual[i]!=geoPrediction[i]) {
        geoMismatches++;say("UCMapKit|geometry search mismatch|index %u|native %d|indexed %d",(unsigned)i,geoActual[i],geoPrediction[i]);break;
    }
    geoActual=nullptr;
}
__declspec(naked) static void geoLoopStub() {
    __asm {
        mov dword ptr [ebp-18h],esi
        mov dword ptr [ebp-14h],esi
        pushad
        push dword ptr [ebp+0ch]
        push eax
        push ebx
        call geoPrepare
        add esp,12
        popad
        cmp geoPrepared,0
        je nativeLoop
        mov ecx,geoMerged
        mov dword ptr [ebp-18h],ecx
        mov ecx,dword ptr [ebx+8ch]
        jmp dword ptr [geoLoopSkip]
    nativeLoop:
        jmp dword ptr [geoLoopReturn]
    }
}
__declspec(naked) static void geoCheckStub() {
    __asm {
        pushad
        call geoCheck
        popad
        mov ecx,dword ptr [ebp-14h]
        mov ebx,dword ptr [ebx+8ch]
        jmp dword ptr [geoCheckReturn]
    }
}
typedef INT (__cdecl *GeoAdd)(TArray<FVector>*,const FVector*,FLOAT,INT);
static GeoAdd geoStockAdd=nullptr;
static unsigned long long geoVectorCalls=0;
static int geoVectorMismatches=0;
static bool geoVectorMatch(const FVector& a,const FVector& b,float t) {
    double dx=double(a.X)-double(b.X),dy=double(a.Y)-double(b.Y),dz=double(a.Z)-double(b.Z);
    return dx>-double(t)&&dx<double(t)&&dy>-double(t)&&dy<double(t)&&dz>-double(t)&&dz<double(t);
}
static INT geoVectorFind(const TArray<FVector>& array,const FVector& p,float tolerance) {
    int n=array.Num(),i=0;
    __m128 px=_mm_set1_ps(p.X),limit=_mm_set1_ps(tolerance),sign=_mm_set1_ps(-0.0f);
    // An inclusive single-precision broad-phase cannot reject an exact match:
    // rounding is monotone, and the threshold itself is a float. Every passing
    // lane is checked with the native strict double-precision comparisons.
    for(;i+3<n;i+=4) {
        __m128 a=_mm_set_ps(array(i+3).X,array(i+2).X,array(i+1).X,array(i).X);
        __m128 x=_mm_cmple_ps(_mm_andnot_ps(sign,_mm_sub_ps(px,a)),limit);
        int mask=_mm_movemask_ps(x);
        for(int bit=0;bit<4;bit++)if((mask&(1<<bit))&&geoVectorMatch(p,array(i+bit),tolerance))return i+bit;
    }
    for(;i<n;i++)if(geoVectorMatch(p,array(i),tolerance))return i;
    return INDEX_NONE;
}
static INT __cdecl geoAddVector(TArray<FVector>* array,const FVector* p,FLOAT tolerance,INT search) {
    if(!search||array->Num()<32||!_finite(tolerance)||tolerance<=0||!geoPointFinite(*p)||
       (_controlfp(0,0)&(_MCW_PC|_MCW_RC))!=_PC_53||(_mm_getcsr()&0xe040))return geoStockAdd(array,p,tolerance,search);
    geoVectorCalls++;INT found=geoVectorFind(*array,*p,tolerance);
    if(geoMode==2) {
        INT expected=found==INDEX_NONE?array->Num():found;
        INT native=geoStockAdd(array,p,tolerance,search);
        if(expected!=native){geoVectorMismatches++;say("UCMapKit|vector search mismatch|native %d|SIMD %d",native,expected);}
        return native;
    }
    return found==INDEX_NONE?geoStockAdd(array,p,tolerance,0):found;
}
#ifdef DEUSEDIX_BSP_TESTS
#include "geometry_search_tests.h"
#endif
static int geometrySearchExec(const char* line,const TCHAR* wide,FOutputDevice& feedback,bool world=false) {
#ifdef DEUSEDIX_BSP_TESTS
    if(!strcmp(line,"UC_GEOMETRY_SEARCH_TEST"))return geometrySearchTests();
#endif
    const char* env=getenv("DEUSEDIX_GEOMETRY_SEARCH");geoMode=env&&!strcmp(env,"verify")?2:env&&!strcmp(env,"off")?0:1;
    if(!geoMode||(!world&&strcmp(line,"MAP REBUILD")&&strcmp(line,"BSP REBUILD OPTIMAL BALANCE=15")))return world?finishWorldStock():gpuBspExec(line,wide,feedback);
    HMODULE module=GetModuleHandleA("Editor.dll");if(!module||!bspSupported(module))return world?finishWorldStock():gpuBspExec(line,wide,feedback);
    BYTE* site=(BYTE*)module+0x45954;BYTE* end=(BYTE*)module+0x45a90;
    const BYTE expected[6]={0x89,0x75,0xe8,0x89,0x75,0xec},after[9]={0x8b,0x4d,0xec,0x8b,0x9b,0x8c,0,0,0};
    BYTE* vectorSite=(BYTE*)module+0x16bd;const BYTE vectorExpected[5]={0xe9,0xce,0xe2,0x03,0};
    if(memcmp(site,expected,6)||memcmp(end,after,9)||memcmp(vectorSite,vectorExpected,5))return world?finishWorldStock():gpuBspExec(line,wide,feedback);
    geoLoopReturn=(DWORD)(site+6);geoLoopSkip=(DWORD)((BYTE*)module+0x459cf);geoCheckReturn=(DWORD)(end+9);
    DWORD old,oldVector,ignored;if(!VirtualProtect(site,0x150,PAGE_EXECUTE_READWRITE,&old))return world?finishWorldStock():gpuBspExec(line,wide,feedback);
    if(!VirtualProtect(vectorSite,5,PAGE_EXECUTE_READWRITE,&oldVector)){if(!VirtualProtect(site,0x150,old,&ignored))ExitProcess(83);return world?finishWorldStock():gpuBspExec(line,wide,feedback);}
    geoStockAdd=(GeoAdd)((BYTE*)module+0x3f990);geoVectorCalls=0;geoVectorMismatches=0;
    BYTE vectorJump[5]={0xe9,0,0,0,0};*(LONG*)(vectorJump+1)=(LONG)((BYTE*)&geoAddVector-(vectorSite+5));
    geoCalls=geoFailures=geoMismatches=0;geoChecks=0;geoSeconds=0;
    BYTE jump[6]={0xe9,0,0,0,0,0x90};*(LONG*)(jump+1)=(LONG)((BYTE*)&geoLoopStub-(site+5));
    BYTE check[9]={0xe9,0,0,0,0,0x90,0x90,0x90,0x90};*(LONG*)(check+1)=(LONG)((BYTE*)&geoCheckStub-(end+5));int result=0;
    __try {
        memcpy(site,jump,6);if(geoMode==2)memcpy(end,check,9);FlushInstructionCache(GetCurrentProcess(),site,0x150);
        memcpy(vectorSite,vectorJump,5);FlushInstructionCache(GetCurrentProcess(),vectorSite,5);
        result=world?finishWorldStock():gpuBspExec(line,wide,feedback);
    } __finally {
        memcpy(vectorSite,vectorExpected,5);FlushInstructionCache(GetCurrentProcess(),vectorSite,5);
        if(!VirtualProtect(vectorSite,5,oldVector,&ignored)||memcmp(vectorSite,vectorExpected,5))ExitProcess(83);
        memcpy(site,expected,6);memcpy(end,after,9);FlushInstructionCache(GetCurrentProcess(),site,0x150);
        if(!VirtualProtect(site,0x150,old,&ignored)||memcmp(site,expected,6)||memcmp(end,after,9))ExitProcess(83);
    }
    say("UCMapKit|geometry search|batches %d|checks %llu|seconds %.6f|mismatch %d|failures %d|restored",geoCalls,geoChecks,geoSeconds,geoMismatches,geoFailures);
    say("UCMapKit|vector search|calls %llu|mismatch %d|restored",geoVectorCalls,geoVectorMismatches);
    return result;
}
static int buildNativeExec(const char* line,const TCHAR* wide,FOutputDevice& feedback,bool world=false) {
    bool compile=world||!strcmp(line,"MAP REBUILD")||!strcmp(line,"BSP REBUILD OPTIMAL BALANCE=15");
    if(!compile)return geometrySearchExec(line,wide,feedback,world);
    const char* mode=getenv("DEUSEDIX_BUILD_ALLOCATOR");bool enabled=!mode||strcmp(mode,"off");
    Malloc.build.begin(enabled);int result=0;
    __try {result=geometrySearchExec(line,wide,feedback,world);}
    __finally {Malloc.build.end();}
    if(enabled)Malloc.build.report();return result;
}
static int finishWorld() {return buildNativeExec("UC_WORLD finish",nullptr,Feedback,true);}
#pragma float_control(pop)
