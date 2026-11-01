// The lighting pass renders visibility through a hidden windowed viewport.
// Its pinned OpenGL driver unnecessarily enumerates every fullscreen mode.
// Leave the renderer and native light builder intact, skipping only that loop
// for windowed Init calls during LIGHT APPLY. No installed file is patched.
static void* lightEnumApi=nullptr;
static int lightEnumSkipped=0;
__declspec(naked) static void lightEnumStub() {
    __asm {
        cmp dword ptr [ebp+18h],0 // UOpenGLRenderDevice::Init's Fullscreen argument
        jne realEnumeration
        inc lightEnumSkipped
        xor eax,eax
        ret 12
    realEnumeration:
        jmp dword ptr [lightEnumApi]
    }
}
static bool lightUsesOpenGL() {
    FString render;
    return GConfig->GetString(TEXT("Engine.Engine"),TEXT("EditorRenderDevice"),render)&&
           !_wcsicmp((const wchar_t*)*render,L"OpenGLDrv.OpenGLRenderDevice");
}
static int lightViewportExec(const char* line,const TCHAR* wide,FOutputDevice& feedback) {
    const char* mode=getenv("DEUSEDIX_LIGHT_BUILD");
    if(strcmp(line,"LIGHT APPLY")||(mode&&(!strcmp(mode,"off")||!strcmp(mode,"rays"))))return buildNativeExec(line,wide,feedback);
    HMODULE editor=GetModuleHandleA("Editor.dll");
    if(!editor||!bspSupported(editor))return buildNativeExec(line,wide,feedback);
    if(!lightUsesOpenGL())return buildNativeExec(line,wide,feedback);
    if(!UObject::StaticLoadClass(UObject::StaticClass(),NULL,TEXT("OpenGLDrv.OpenGLRenderDevice"),NULL,LOAD_NoWarn,NULL))return buildNativeExec(line,wide,feedback);
    HMODULE driver=GetModuleHandleW(L"OpenGLDrv.dll");
    if(!driver)return buildNativeExec(line,wide,feedback);
    if(!bspFileHash(driver,"c47b639fd90250ebf8bc6a9d2c013720628751dae163416a1f44b1b1953fb93b")) {
        return buildNativeExec(line,wide,feedback);
    }
    BYTE* site=(BYTE*)driver+0xb846;
    BYTE expected[6]={0xff,0x15,0,0,0,0};*(DWORD*)(expected+2)=(DWORD)((BYTE*)driver+0x1f370);
    if(memcmp(site,expected,6))return buildNativeExec(line,wide,feedback);
    lightEnumApi=*(void**)((BYTE*)driver+0x1f370);lightEnumSkipped=0;
    BYTE call[6]={0xe8,0,0,0,0,0x90};*(LONG*)(call+1)=(LONG)((BYTE*)&lightEnumStub-(site+5));
    DWORD old,ignored;
    if(!VirtualProtect(site,6,PAGE_EXECUTE_READWRITE,&old))return buildNativeExec(line,wide,feedback);
    int result=0;
    __try {
        memcpy(site,call,6);FlushInstructionCache(GetCurrentProcess(),site,6);
        result=buildNativeExec(line,wide,feedback);
    } __finally {
        memcpy(site,expected,6);FlushInstructionCache(GetCurrentProcess(),site,6);
        if(!VirtualProtect(site,6,old,&ignored)||memcmp(site,expected,6))ExitProcess(83);
    }
    say("UCMapKit|lighting viewport|fullscreen enumerations skipped %d|restored",lightEnumSkipped);
    return result;
}

// FCOMIP writes the comparison flags directly instead of the old FCOMP /
// FNSTSW AX / TEST AH round-trip. Keep x87 arithmetic and the original double
// thresholds; even unordered comparisons keep their native branch direction.
struct LightComparePatch {
    DWORD offset,constant;BYTE stack,mask,branch,distance;
    BYTE before[17],after[17];
};
static LightComparePatch lightComparePatches[]={
    {0xf3703,0x1335b8,0x10,0x41,0x75,0x54},
    {0xf3714,0x1335b8,0x14,0x41,0x75,0x43},
    {0xf3768,0x12ac20,0x10,0x01,0x74,0x59},
    {0xf3779,0x12ac20,0x14,0x01,0x74,0x48},
    {0xf387f,0x129838,0x10,0x41,0x75,0x2a},
};
static bool lightPrepareComparisons(BYTE* base) {
    for(auto& p:lightComparePatches) {
        BYTE old[17]={0xd9,0x44,0x24,p.stack,0xdc,0x1d,0,0,0,0,0xdf,0xe0,0xf6,0xc4,p.mask,p.branch,p.distance};
        *(DWORD*)(old+6)=(DWORD)(base+p.constant);
        if(memcmp(base+p.offset,old,17))return false;
        memcpy(p.before,old,17);
        BYTE fast[17]={0xdd,0x05,0,0,0,0,0xd9,0x44,0x24,p.stack,0xdf,0xf1,0xdd,0xd8,0,0,0x90};
        *(DWORD*)(fast+2)=(DWORD)(base+p.constant);
        fast[14]=p.mask==0x41?0x76:0x73; // JBE for !(>); JAE for !(<), including native NaN behavior
        fast[15]=p.distance+1; // branch ends one byte before the native branch
        memcpy(p.after,fast,17);
    }
    return true;
}
static void lightWriteComparisons(BYTE* base,bool fast) {
    for(auto& p:lightComparePatches)memcpy(base+p.offset,fast?p.after:p.before,17);
    FlushInstructionCache(GetCurrentProcess(),base+0xf3703,0x18d);
}
static bool lightCpuHasCompareFlags() {
    unsigned features;
    __asm { mov eax,1
            cpuid
            mov features,edx }
    // CPUID.01H:EDX.FPU and CMOV also advertise the x87 FCOMI family.
    return (features&0x8001)==0x8001;
}
#ifdef DEUSEDIX_BSP_TESTS
#include "light_build_tests.h"
#endif
static int lightBuildExec(const char* line,const TCHAR* wide,FOutputDevice& feedback) {
#ifdef DEUSEDIX_BSP_TESTS
    if(!strcmp(line,"UC_LIGHT_BUILD_TEST"))return lightBuildTests();
#endif
    const char* mode=getenv("DEUSEDIX_LIGHT_BUILD");
    if(strcmp(line,"LIGHT APPLY")||(mode&&(!strcmp(mode,"off")||!strcmp(mode,"viewport"))))return lightViewportExec(line,wide,feedback);
    HMODULE editor=GetModuleHandleA("Editor.dll"),engine=GetModuleHandleA("Engine.dll");
    if(!editor||!engine||!bspSupported(editor)||!lightCpuHasCompareFlags())return lightViewportExec(line,wide,feedback);
    BYTE* base=(BYTE*)engine;
    if(!lightPrepareComparisons(base))return lightViewportExec(line,wide,feedback);
    DWORD old,ignored;
    if(!VirtualProtect(base+0xf3703,0x18d,PAGE_EXECUTE_READWRITE,&old))return lightViewportExec(line,wide,feedback);
    int result=0;
    __try {
        lightWriteComparisons(base,true);
        result=lightViewportExec(line,wide,feedback);
    } __finally {
        lightWriteComparisons(base,false);
        if(!VirtualProtect(base+0xf3703,0x18d,old,&ignored))ExitProcess(83);
        for(auto& p:lightComparePatches)if(memcmp(base+p.offset,p.before,17))ExitProcess(83);
    }
    say("UCMapKit|lighting comparisons|direct x87 flags|restored");
    return result;
}
