// Native/GPU conformance cases, invoked only by the private test build.
static unsigned bspRandom=0x1999;
static unsigned bspNext(){bspRandom=bspRandom*1664525+1013904223;return bspRandom;}
static int bspComputeTests() {
    if(!bspStockChoose)return 0;
    unsigned saved=_controlfp(0,0);_controlfp(_PC_53|_RC_NEAR,_MCW_PC|_MCW_RC);
    std::vector<FPoly> polys(512);std::vector<FPoly*> ptrs(512);std::vector<GpuBspPoly> input(512);
    std::vector<uint32_t> candidates(512);std::vector<GpuBspCount> output(512);
    INT uncertain=0,compared=0;
    for(int pass=0;pass<4;pass++) {
        for(int i=0;i<512;i++) {
            FPoly& p=polys[i];p.Init();p.NumVertices=3+(bspNext()%14);
            p.Base=FVector(0,0,0);
            p.Normal=pass==0?FVector(1,0,0):FVector(.5f,-.25f,.75f);
            DWORD flags[]={0,PF_Semisolid,PF_NotSolid,PF_Portal,PF_Portal|PF_NotSolid};p.PolyFlags=flags[i%5];
            for(int j=0;j<p.NumVertices;j++) {
                FLOAT a=(INT(bspNext()%200000)-100000)*.5f;
                FLOAT b=(INT(bspNext()%200000)-100000)*.5f;
                FLOAT c=(INT(bspNext()%200000)-100000)*.5f;
                if(pass==0) {FLOAT edge[]={0,.25f,-.25f,.249999985f,.25000003f,-.249999985f,-.25000003f};a=edge[(i+j)%7];b=c=0;}
                if(pass==2) {a=32768.0f+float(i%3)/256; b=-32768.0f; c=-(a*.5f-b*.25f)/.75f+(j%3-1)*.25f;}
                if(pass==3) {a=float(i%3)*1e-30f;b=-a;c=a;}
                p.Vertex[j]=FVector(a,b,c);
            }
            ptrs[i]=&p;candidates[i]=i;
            auto& dest=input[i];FPlane plane(p.Base,p.Normal);memcpy(dest.plane,&plane,16);dest.count=p.NumVertices;dest.flags=p.PolyFlags;
            for(int j=0;j<p.NumVertices;j++)memcpy(dest.vertices[j],&p.Vertex[j],12);
        }
        if(!gpu_bsp_counts(input.data(),512,candidates.data(),512,1,output.data()))return 0;
        _controlfp(_PC_53|_RC_NEAR,_MCW_PC|_MCW_RC);
        for(int i=0;i<512;i++) {
            GpuBspCount original; bspCpuCounts(ptrs.data(),512,i,original);
            if(output[i].uncertain){uncertain++;continue;}
            if(memcmp(&original,&output[i],sizeof(original))) {say("UCMapKit|GPU tests mismatch|pass %d row %d",pass,i);return 0;}
            compared++;
        }
        for(int balance=0;balance<=100;balance+=5) {
            FPoly* accelerated=bspGpuChoose(512,ptrs.data(),balance);
            if(!accelerated||accelerated!=bspStockChoose(512,ptrs.data(),2,balance)) {say("UCMapKit|GPU tests winner mismatch|pass %d balance %d",pass,balance);return 0;}
        }
    }
    _controlfp(saved,_MCW_PC|_MCW_RC);
    say("UCMapKit|GPU tests passed|%d exact rows|%d uncertain rows|84 winners",compared,uncertain);
    return compared&&uncertain;
}
