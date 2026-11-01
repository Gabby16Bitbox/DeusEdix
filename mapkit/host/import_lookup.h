// During MAP IMPORT, Core's ANY_PACKAGE lookup walks every loaded UObject and
// its class ancestry before checking its FName. Reject a different name first.
// Keep native iteration order, null handling, inheritance and exact-class tests.
// This is a scoped in-memory hook in the private compiler, never a disk patch.
static void* importLookupContinue=nullptr;
static void* importLookupSkip=nullptr;
__declspec(naked) static void importLookupFilter() {
    __asm {
        mov eax,dword ptr [esi+edx*4] // displaced native object-array load
        test eax,eax
        jz rejectObject
        push ecx
        mov ecx,dword ptr [ebp-14h]  // the resolved native FName index
        cmp dword ptr [eax+20h],ecx
        pop ecx
        jne rejectObject
        test eax,eax                // displaced native flags for its null branch
        jmp dword ptr [importLookupContinue]
    rejectObject:
        jmp dword ptr [importLookupSkip]
    }
}
static BYTE* importLookupSite() {
    HMODULE core=GetModuleHandleA("Core.dll"),editor=GetModuleHandleA("Editor.dll");
    if(!core||!editor||!bspSupported(editor))return nullptr;
    static HMODULE checked=nullptr;
    static bool supported=false;
    if(checked!=core) {
        supported=bspFileHash(core,"c640fd28fcfe84ac616a37eccd248d665e4008b9554bb87f6437385248c42417")||
                  bspFileHash(core,"8bf3039e14f849942ee70a95bdf26cf1f636245926e30106bbe58b7097eba7e4");
        checked=core;
    }
    if(!supported)return nullptr;
    BYTE* base=(BYTE*)core;
    const BYTE expected[]={0x8b,0x04,0x96,0x85,0xc0,0x74,0xec,0x8b,0x40,0x24,0x85,0xc0};
    if(memcmp(base+0x51f68,expected,sizeof(expected)))return nullptr;
    importLookupContinue=base+0x51f6d;
    importLookupSkip=base+0x51f5b;
    return base+0x51f68;
}
static int importLookupRun(const char* line,const TCHAR* wide,FOutputDevice& feedback,int (*oracle)()=nullptr) {
    BYTE* site=importLookupSite();
    if(!site)return oracle?0:lightBuildExec(line,wide,feedback);
    BYTE before[5];memcpy(before,site,5);
    BYTE jump[5]={0xe9,0,0,0,0};*(LONG*)(jump+1)=(LONG)((BYTE*)&importLookupFilter-(site+5));
    DWORD old,ignored;
    if(!VirtualProtect(site,5,PAGE_EXECUTE_READWRITE,&old))return oracle?0:lightBuildExec(line,wide,feedback);
    int result=0;
    __try {
        memcpy(site,jump,5);FlushInstructionCache(GetCurrentProcess(),site,5);
        result=oracle?oracle():lightBuildExec(line,wide,feedback);
    } __finally {
        memcpy(site,before,5);FlushInstructionCache(GetCurrentProcess(),site,5);
        if(!VirtualProtect(site,5,old,&ignored)||memcmp(site,before,5))ExitProcess(83);
    }
    say("UCMapKit|import lookup|native name prefilter|restored");
    return result;
}
#ifdef DEUSEDIX_BSP_TESTS
#include "import_lookup_tests.h"
#endif
static int importLookupExec(const char* line,const TCHAR* wide,FOutputDevice& feedback) {
#ifdef DEUSEDIX_BSP_TESTS
    if(!strcmp(line,"UC_IMPORT_LOOKUP_TEST"))return importLookupTests(feedback);
#endif
    const char* mode=getenv("DEUSEDIX_IMPORT_LOOKUP");
    if(_strnicmp(line,"MAP IMPORT",10)||(mode&&!strcmp(mode,"off")))return lightBuildExec(line,wide,feedback);
    return importLookupRun(line,wide,feedback);
}
