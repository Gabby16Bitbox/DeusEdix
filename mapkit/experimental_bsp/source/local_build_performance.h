// Development opt-in only. Shared scorer/allocator snapshots are pinned by the
// Python implementation fingerprint and checked against host/ when compiling.
// This adapter wraps LOCAL commands, never a Full reference or a certificate.
#include "local_gpu_bsp_core.h"
#include "build_allocator.h"

static BuildReserveHeap* localBuildHeap=NULL;
static int localAccelerationPoisoned=0;

static int localAccelerationMode() {
    const char* mode=getenv("DEUSEDIX_LOCAL_BUILD_ACCELERATION");
    if(!mode||!strcmp(mode,"off"))return 0;
    if(!strcmp(mode,"verify"))return 2;
    if(!strcmp(mode,"gpu"))return 3;
    if(!strcmp(mode,"auto"))return 4;
    return 0;
}

static bool localGeometryCommand(const char* line) {
    // No UC_REGION_DIAG_*, MAP/BSP REBUILD, dump, certificate or probe command.
    // Keep the reference compiler and the read-only proofs outside the hooks.
    return !strncmp(line,"UC_REGION_BUILD ",16)||
        !strncmp(line,"UC_REGION_CLIP ",15)||
        !strncmp(line,"UC_REGION_CLIP_PLANES ",22)||
        !strncmp(line,"UC_REGION_CLIP_ORDERED ",23)||
        !strncmp(line,"UC_SELECTED_REPART ",19)||
        !strncmp(line,"UC_REGION_GRAFT ",16)||
        !strncmp(line,"UC_REGION_GRAFT_DEFER ",22)||
        !strcmp(line,"UC_REGION_FINISH");
}

static int runCommand(const char*, unsigned short*, FFeedbackContext&);

static int localGpuCommand(const char* line,unsigned short* wide,FFeedbackContext& feedback,int mode) {
    HMODULE module=GetModuleHandleA("Editor.dll");
    if(!module||!bspSupported(module)) {
        say("UCMapKit|local acceleration fallback|unsupported SDK");
        return runCommand(line,wide,feedback);
    }
    BYTE* image=(BYTE*)module;
    IMAGE_DOS_HEADER* dos=(IMAGE_DOS_HEADER*)image;
    IMAGE_NT_HEADERS* pe=(IMAGE_NT_HEADERS*)(image+dos->e_lfanew);
    BYTE* site=image+0x409f6;
    const BYTE expected[5]={0xe8,0x2d,0x15,0xfc,0xff};
    if(dos->e_magic!=IMAGE_DOS_SIGNATURE||pe->Signature!=IMAGE_NT_SIGNATURE||
       pe->FileHeader.TimeDateStamp!=984703280||pe->OptionalHeader.SizeOfImage!=0x18f000||
       memcmp(site,expected,5)) {
        say("UCMapKit|local acceleration fallback|native hook bytes changed");
        return runCommand(line,wide,feedback);
    }
    bspMode=mode;
    bspStockChoose=(BspChoose)(image+0x405d0);
    bspCalls=bspPairs=0;bspMax=0;bspSeconds=0;
    bspGpuSeconds=0;bspMismatch=bspGpuCalls=bspFallbackRows=bspFailures=0;
    BYTE replace[5]={0xe8,0,0,0,0};
    *(LONG*)(replace+1)=(LONG)((BYTE*)&bspObserve-(site+5));
    DWORD old,ignored;
    if(!VirtualProtect(site,5,PAGE_EXECUTE_READWRITE,&old))return runCommand(line,wide,feedback);
    int result=0;
    __try {
        memcpy(site,replace,5);FlushInstructionCache(GetCurrentProcess(),site,5);
        result=runCommand(line,wide,feedback);
    } __finally {
        memcpy(site,expected,5);FlushInstructionCache(GetCurrentProcess(),site,5);
        if(!VirtualProtect(site,5,old,&ignored)||memcmp(site,expected,5))ExitProcess(83);
    }
    say("UCMapKit|local GPU BSP|%s|mode %d|batches %d|seconds %.6f|CPU rows %d|mismatch %d|failures %d|restored",
        bspAdapter,mode,bspGpuCalls,bspGpuSeconds,bspFallbackRows,bspMismatch,bspFailures);
    // Verify returns native choices, but a mismatch still refuses publication.
    if(bspMismatch){localAccelerationPoisoned=1;return 0;}
    return result;
}

static int localBuildCommand(const char* line,unsigned short* wide,FFeedbackContext& feedback) {
    if(localAccelerationPoisoned)return 0;
    int mode=localAccelerationMode();
    if(!mode||!localGeometryCommand(line))return runCommand(line,wide,feedback);
    // Verify leaves allocations stock too, making it a native-result baseline.
    // Actual accelerated runs retain at most 32 MiB of spare allocation space.
    if(localBuildHeap)localBuildHeap->begin(mode!=2);
    int result=0;
    __try {result=localGpuCommand(line,wide,feedback,mode);}
    __finally {if(localBuildHeap)localBuildHeap->end();}
    if(localBuildHeap&&mode!=2)localBuildHeap->report();
    return result;
}
