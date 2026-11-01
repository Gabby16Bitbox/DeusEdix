// Private native-oracle tests; excluded from release builds.
static int geometrySearchTests() {
    HMODULE editor=GetModuleHandleA("Editor.dll");if(!editor||!bspSupported(editor))return 0;
    GeoAdd nativeAdd=(GeoAdd)((BYTE*)editor+0x3f990);
    auto nativeRemap=(void (__cdecl *)(UModel*,FLOAT))((BYTE*)editor+0x45900);
    BspControlGuard guard;unsigned csr=_mm_getcsr();_mm_setcsr(csr&~0xe040);
    _controlfp(_PC_53|_RC_NEAR,_MCW_PC|_MCW_RC);
    int remaps=0,vectors=0;unsigned seed=1999;
    auto random=[&](){seed=seed*1664525+1013904223;return seed;};
    for(float t:{0.00001f,0.25f,2.f,512.f})for(int pass=0;pass<4;pass++) {
        UModel* m=ConstructObject<UModel>(UModel::StaticClass());m->AddToRoot();
        for(int i=0;i<1024;i++) {
            float edge[]={0,t,-t,nextafterf(t,0),nextafterf(t,FLT_MAX),nextafterf(-t,0),nextafterf(-t,-FLT_MAX)};
            float x=pass==0?float(i/8)*t*8:float(INT(random()%2000)-1000)*t;
            float y=pass==0?0:float(INT(random()%2000)-1000)*t;
            float z=pass<2?0:float(INT(random()%2000)-1000)*t;
            if(pass==0)x+=edge[i%7];
            if(pass==2&&i%3)x=m->Points(i-1).X+t*.75f,y=m->Points(i-1).Y,z=m->Points(i-1).Z;
            if(pass==3)x=(std::min)(131000.f,(float)fabs(x)),y=-x,z=1e-30f;
            if(fabs(x)>131072||fabs(y)>131072||fabs(z)>131072)x=y=z=0;
            m->Points.AddItem(FVector(x,y,z));FVert v;v.pVertex=i;v.iSide=INDEX_NONE;m->Verts.AddItem(v);
        }
        std::vector<INT> predicted;bool okay=geoNearMap(m,t,predicted);
        if(okay) {
            nativeRemap(m,t);
            for(int i=0;i<1024;i++)if(m->Verts(i).pVertex!=predicted[i]) {
                say("UCMapKit|near test failed|t %.9g|pass %d|point %d|native %d|indexed %d",t,pass,i,m->Verts(i).pVertex,predicted[i]);okay=false;break;
            }
        }
        m->RemoveFromRoot();if(!okay){_mm_setcsr(csr);return 0;}remaps+=1024;
    }
    for(float t:{0.00001f,0.00002f,0.015f,0.25f,1.f})for(int n=0;n<260;n++) {
        TArray<FVector> values;
        for(int i=0;i<n;i++)values.AddItem(FVector(float(INT(random()%64)-32)*t,float(INT(random()%32)-16)*t,float(INT(random()%32)-16)*t));
        for(int trial=0;trial<20;trial++) {
            FVector needle(0,0,0);
            if(n)needle=values(random()%n);
            if(trial%5==1)needle.X+=t;
            if(trial%5==2)needle.Y-=nextafterf(t,0);
            if(trial%5==3)needle.Z+=nextafterf(t,FLT_MAX);
            if(trial%5==4)needle=FVector(1e-30f,-1e-30f,0);
            int found=geoVectorFind(values,needle,t),expected=found==INDEX_NONE?values.Num():found;
            int before=values.Num(),actual=nativeAdd(&values,&needle,t,1);
            if(actual!=expected){say("UCMapKit|vector test failed|n %d|trial %d|native %d|SIMD %d",n,trial,actual,expected);_mm_setcsr(csr);return 0;}
            if(values.Num()>before)values.Remove(before);
            // Same-size in-place mutations must never reuse a stale index.
            if(n)values(random()%n)=needle;
            vectors++;
        }
    }
    _mm_setcsr(csr);
    BuildReserveHeap heap;heap.begin(true);
    void* memory=heap.resize(nullptr,65536);if(!memory)return 0;memset(memory,0x5a,65536);
    void* previous=memory;memory=heap.resize(memory,70000);
    if(memory!=previous||heap.spare()>BuildReserveHeap::Budget)return 0;
    for(int i=0;i<65536;i++)if(((BYTE*)memory)[i]!=0x5a)return 0;
    memory=heap.resize(memory,200000);if(!memory)return 0;
    for(int i=0;i<65536;i++)if(((BYTE*)memory)[i]!=0x5a)return 0;
    memory=heap.resize(memory,10);if(!memory||heap.spare()!=0)return 0;
    heap.end();if(heap.resize(memory,0)!=nullptr||heap.spare()!=0)return 0;
    std::vector<void*> allocations;
    heap.begin(true);
    for(int i=0;i<300;i++) {
        void* p=heap.resize(nullptr,512*1024);if(!p)return 0;
        memset(p,i,64);allocations.push_back(p);
        if(heap.spare()>BuildReserveHeap::Budget)return 0;
    }
    if(heap.spare()!=BuildReserveHeap::Budget)return 0;
    heap.end();
    for(int i=0;i<300;i++) {
        BYTE* p=(BYTE*)heap.resize(allocations[i],16);if(!p)return 0;
        for(int j=0;j<16;j++)if(p[j]!=(BYTE)i)return 0;
        heap.release(p);
    }
    if(heap.spare())return 0;
    say("UCMapKit|geometry tests passed|%d native point remaps|%d native vector queries|allocator growth, shrink, free, slot saturation and 32 MiB cap",remaps,vectors);return 1;
}
