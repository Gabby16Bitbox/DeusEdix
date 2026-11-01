#include "gpu_bsp_compute.h"
// Optional acceleration of the pinned SDK 1112f BSP splitter. Only the
// splitter's scoring is offloaded. The native
// compiler still splits the polygons and constructs nodes/portals/collision.
// Hook is scoped to this single command and restored even on engine exceptions.
typedef FPoly* (__cdecl *BspChoose)(INT,FPoly**,INT,INT);
static BspChoose bspStockChoose=nullptr;
static unsigned long long bspCalls=0,bspPairs=0;
static double bspSeconds=0;
static int bspMax=0;
static int bspMode=0,bspMismatch=0,bspGpuCalls=0,bspFallbackRows=0,bspFailures=0;
static double bspGpuSeconds=0;
static int bspCalibrated=0,bspDisabled=0;
static int bspSkipBelow=0;
static char bspAdapter[256]="not needed";
static_assert(sizeof(FPoly)==272&&sizeof(GpuBspPoly)==288,"SDK/GPU layout mismatch");
struct BspControlGuard {
    unsigned saved;
    BspControlGuard():saved(_controlfp(0,0)){}
    ~BspControlGuard(){_controlfp(saved,_MCW_PC|_MCW_RC|_MCW_EM);}
};
static double bspClock() {LARGE_INTEGER n,f;QueryPerformanceCounter(&n);QueryPerformanceFrequency(&f);return double(n.QuadPart)/f.QuadPart;}
static void bspCpuCounts(FPoly** polys,INT n,INT candidate,GpuBspCount& result) {
    result={};FPlane plane(polys[candidate]->Base,polys[candidate]->Normal);
    for(INT j=0;j<n;j++)if(j!=candidate) {
        INT split=polys[j]->SplitWithPlaneFast(plane,nullptr,nullptr);
        if(split==SP_Front)result.front++;
        else if(split==SP_Back)result.back++;
        else if(split==SP_Split)result.split+=(polys[j]->PolyFlags&PF_Portal)?16:1;
    }
}
static bool bspFinite(FLOAT x) {return _finite(x)&&fabs(x)<=131072.0&&(x==0||fabs(x)>=FLT_MIN);}
static FPoly* bspGpuChoose(INT count,FPoly** polys,INT balance) {
    if(count<512||count>32768||balance<0||balance>100||bspMismatch||bspDisabled||(bspMode==4&&count<=bspSkipBelow))return nullptr;
    if((_controlfp(0,0)&(_MCW_PC|_MCW_RC))!=_PC_53)return nullptr;
    double start=bspClock(),estimate=0,calibrationSeconds=0;
    std::vector<GpuBspPoly> packed(count);std::vector<uint32_t> candidates;
    bool allDetail=true;
    for(INT i=0;i<count;i++)if(!(polys[i]->PolyFlags&(PF_Semisolid|PF_NotSolid)))allDetail=false;
    for(INT i=0;i<count;i++) {
        FPoly& p=*polys[i];auto& dst=packed[i];
        if(p.NumVertices<3||p.NumVertices>16)return nullptr;
        FPlane plane(p.Base,p.Normal);
        for(INT k=0;k<4;k++){float v=(&plane.X)[k];if(!bspFinite(v))return nullptr;dst.plane[k]=v;}
        dst.count=p.NumVertices;dst.flags=p.PolyFlags;
        for(INT j=0;j<p.NumVertices;j++)for(INT k=0;k<3;k++) {
            float v=(&p.Vertex[j].X)[k];if(!bspFinite(v))return nullptr;dst.vertices[j][k]=v;
        }
        if(!(p.PolyFlags&(PF_Semisolid|PF_NotSolid))||(p.PolyFlags&PF_Portal)||allDetail)candidates.push_back(i);
    }
    if(candidates.empty())return nullptr;
    std::vector<GpuBspCount> samples;
    if(!bspCalibrated) {
        size_t sample=std::min<size_t>(32,candidates.size());samples.resize(sample);double cpuStart=bspClock();
        for(size_t s=0;s<sample;s++)bspCpuCounts(polys,count,candidates[s*candidates.size()/sample],samples[s]);
        calibrationSeconds=bspClock()-cpuStart;estimate=calibrationSeconds*candidates.size()/sample;
        // Avoid paying D3D/driver startup for a branch the native compiler can
        // already score in well under a second. Reconsider larger branches.
        if(bspMode==4&&estimate<0.35) {bspSkipBelow=count;return nullptr;}
    }
    std::vector<GpuBspCount> counts(candidates.size());
    int okay;
    {BspControlGuard fpu;
        okay=gpu_bsp_counts(packed.data(),count,candidates.data(),(uint32_t)candidates.size(),1,counts.data());
        gpu_bsp_initialize(bspAdapter,sizeof(bspAdapter));
    }
    if(!okay){bspFailures++;bspDisabled=1;return nullptr;}
    // Check native counts on an evenly spread sample of this actual batch.
    // This also measures whether transfer/setup costs make acceleration useful
    // on this machine. All numerically uncertain rows still use native counts.
    if(!bspCalibrated) {
        for(size_t s=0;s<samples.size();s++) {
            size_t c=s*candidates.size()/samples.size();
            if(!counts[c].uncertain&&memcmp(&counts[c],&samples[s],sizeof(GpuBspCount))) {
                bspMismatch++;bspDisabled=1;return nullptr;
            }
        }
        bspCalibrated=1;
    }
    FPoly* best=nullptr;FLOAT bestScore=0;
    for(size_t c=0;c<candidates.size();c++) {
        INT i=candidates[c];auto& r=counts[c];
        if(r.uncertain){bspFallbackRows++;bspCpuCounts(polys,count,i,r);}
        // Preserve native first-winner ties and its float best-score storage.
        double split=double(100-balance)*r.split;
        double score=double(balance)*abs((INT)r.front-(INT)r.back)+split;
        if(polys[i]->PolyFlags&PF_Portal)score-=split;
        if(!best||score<double(bestScore)){best=polys[i];bestScore=(FLOAT)score;}
    }
    double gpuTime=bspClock()-start-calibrationSeconds;
    if(bspMode==4&&estimate>0&&gpuTime>=estimate*0.8) {
        bspDisabled=1;say("UCMapKit|GPU BSP fallback|GPU complete %.4f s >= CPU estimate %.4f s",gpuTime,estimate);return nullptr;
    }
    return best;
}
static FPoly* bspAccelerated(INT count,FPoly** polys,INT opt,INT balance) {
    if(bspMode>=2&&opt==2&&count>=512) {
        double t=bspClock();FPoly* accelerated=nullptr;
        try {accelerated=bspGpuChoose(count,polys,balance);}
        catch(...) {bspDisabled=1;bspFailures++;}
        bspGpuSeconds+=bspClock()-t;
        if(accelerated) {
            bspGpuCalls++;
            if(bspMode==2) {
                FPoly* expected=bspStockChoose(count,polys,opt,balance);
                if(expected!=accelerated) {bspMismatch++;say("UCMapKit|BSP MISMATCH|count %d|balance %d",count,balance);}
                return expected;
            }
            return accelerated;
        }
    }
    double t=bspClock();FPoly* chosen=bspStockChoose(count,polys,opt,balance);double seconds=bspClock()-t;
    bspCalls++;bspSeconds+=seconds;
    if(opt==2)bspPairs+=(unsigned long long)count*count;
    if(count>bspMax&&bspMode==1) {
        bspMax=count;
        say("UCMapKit|BSP profile|polys %d|opt %d|balance %d|seconds %.6f|control 0x%x",count,opt,balance,seconds,_controlfp(0,0));
        FILE* f=fopen("..\\Output\\splitter-input.bin","wb");
        if(f) {fwrite(&count,4,1,f);fwrite(&opt,4,1,f);fwrite(&balance,4,1,f);for(int i=0;i<count;i++)fwrite(polys[i],sizeof(FPoly),1,f);fclose(f);}
    }
    return chosen;
}
static FPoly* __cdecl bspObserve(INT count,FPoly** polys,INT opt,INT balance) {
    return bspAccelerated(count,polys,opt,balance);
}
static bool bspFileHash(HMODULE module,const char* expected) {
    wchar_t path[32768];DWORD length=GetModuleFileNameW(module,path,32768);
    if(!length||length>=32768)return false;
    HANDLE file=CreateFileW(path,GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,nullptr,OPEN_EXISTING,FILE_FLAG_SEQUENTIAL_SCAN,nullptr);
    if(file==INVALID_HANDLE_VALUE)return false;
    BCRYPT_ALG_HANDLE alg=nullptr;BCRYPT_HASH_HANDLE hash=nullptr;bool okay=false;
    if(BCryptOpenAlgorithmProvider(&alg,BCRYPT_SHA256_ALGORITHM,nullptr,0)>=0&&BCryptCreateHash(alg,&hash,nullptr,0,nullptr,0,0)>=0) {
        unsigned char block[16384],value[32];DWORD read=0;okay=true;
        while(true) {if(!ReadFile(file,block,sizeof(block),&read,nullptr)){okay=false;break;}if(!read)break;
            if(BCryptHashData(hash,block,read,0)<0){okay=false;break;}}
        if(okay&&BCryptFinishHash(hash,value,sizeof(value),0)>=0) {
            char hex[65];for(int i=0;i<32;i++)sprintf(hex+i*2,"%02x",value[i]);okay=!strcmp(hex,expected);
        } else okay=false;
    }
    if(hash)BCryptDestroyHash(hash);if(alg)BCryptCloseAlgorithmProvider(alg,0);CloseHandle(file);return okay;
}
static bool bspSupported(HMODULE module) {
    static int state=0;if(state)return state==1;
    state=-1;
    if(bspFileHash(module,"93e31b3e401880ab17ab4561c3fd4d2baa530fbe25ccb5154911ebad60fff035")&&
       (bspFileHash(GetModuleHandleA("Engine.dll"),"d66b689bbe95d7350b9f348da2273383c642e22e53dd56bd1bcf76ec322aa848")||
        bspFileHash(GetModuleHandleA("Engine.dll"),"0c3a8b18239ca98ae132506a1bd966cb5d91c6852e650e179cb15860832c20b4")))state=1;
    return state==1;
}
