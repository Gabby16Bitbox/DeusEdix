// Private pass-through diagnostic. No DLL file is changed and no trace value
// is rewritten. The five original instructions bytes are restored per call.
static INT regionExtentFailed=0,regionExtentCount=0;
static INT regionExtentPending=0;
static BYTE* regionExtentExitTarget=NULL;
static void __cdecl regionExtentExited(BYTE* state) {
    if(!regionExtentPending)return;regionExtentPending=0;
    printf("UCMapKit|extent exit|%.9g|%.9g|%.9g %.9g %.9g\n",*(FLOAT*)(state+0x78),*(FLOAT*)(state+0x7c),
           *(FLOAT*)(state+0x50),*(FLOAT*)(state+0x54),*(FLOAT*)(state+0x58));
}
static __declspec(naked) void regionExtentExitBridge() {
    __asm {
        pushfd
        pushad
        sub esp,108
        fnsave [esp]
        push esi
        call regionExtentExited
        add esp,4
        frstor [esp]
        add esp,108
        popad
        popfd
        pop edi
        pop esi
        pop ebp
        pop ebx
        add esp,1b4h
        jmp regionExtentExitTarget
    }
}
static void __cdecl regionExtentVisited(BYTE* state) {
    UModel* m=*(UModel**)(state+4);if(!m||m!=GEditor->Level->Model){regionExtentFailed=1;return;}
    INT* words=*(INT**)(state+0x580);
    if(!m->LeafHulls.Num()||words<&m->LeafHulls(0)||words>=&m->LeafHulls(0)+m->LeafHulls.Num()){regionExtentFailed=1;return;}
    INT start=words-&m->LeafHulls(0),count=0;
    while(start+count<m->LeafHulls.Num()&&words[count]>=0&&count<64)count++;
    if(count>=64||start+count+7>m->LeafHulls.Num()||words[count]!=INDEX_NONE){regionExtentFailed=1;return;}
    printf("UCMapKit|extent visited|%d|%d",start,count);
    for(INT i=0;i<count;i++) {
        INT index=words[i]&~0x40000000;if(index<0||index>=m->Nodes.Num()){regionExtentFailed=1;return;}
        FPlane p=m->Nodes(index).Plane;if(words[i]&0x40000000)p=FPlane(-p.X,-p.Y,-p.Z,-p.W);
        printf("|%08x %08x %08x %08x",*(DWORD*)&p.X,*(DWORD*)&p.Y,*(DWORD*)&p.Z,*(DWORD*)&p.W);
    }
    printf("|bounds");for(INT i=0;i<6;i++)printf(" %08x",words[count+1+i]);
    printf("\n");
    regionExtentPending=1;
    printf("UCMapKit|extent inputs|");
    for(INT i=0;i<3;i++)printf(" %.9g",*(FLOAT*)(state+0x3c+4*i));
    for(INT i=0;i<6;i++)printf(" %.9g",*(FLOAT*)(state+0x584+4*i));
    printf("\n");
}
static __declspec(naked) void regionExtentVisitedBridge() {
    __asm {
        mov [esi+580h],eax
        pushfd
        pushad
        sub esp,108
        fnsave [esp]
        push esi
        call regionExtentVisited
        add esp,4
        frstor [esp]
        add esp,108
        popad
        popfd
        ret
    }
}
static void __cdecl regionExtentAccepted(BYTE* state) {
    UModel* m=*(UModel**)(state+4);if(!m||m!=GEditor->Level->Model){regionExtentFailed=1;return;}
    INT* words=*(INT**)(state+0x580);
    if(!m->LeafHulls.Num()||words<&m->LeafHulls(0)||words>=&m->LeafHulls(0)+m->LeafHulls.Num()){regionExtentFailed=1;return;}
    INT start=words-&m->LeafHulls(0),count=0;
    while(start+count<m->LeafHulls.Num()&&words[count]>=0&&count<64)count++;
    if(count>=64||start+count+7>m->LeafHulls.Num()||words[count]!=INDEX_NONE){regionExtentFailed=1;return;}
    FLOAT* box=(FLOAT*)(words+count+1);FLOAT* normal=(FLOAT*)(state+0x50);
    printf("UCMapKit|extent accepted|%d|%.9g|%.9g|%.9g %.9g %.9g|%d",start,*(FLOAT*)(state+0x78),*(FLOAT*)(state+0x7c),normal[0],normal[1],normal[2],count);
    for(INT i=0;i<count;i++)printf(" %d",words[i]);
    printf("|");for(INT i=0;i<6;i++)printf(" %.9g",box[i]);
    printf("|owners");for(INT i=0;i<m->Nodes.Num();i++)if(m->Nodes(i).iCollisionBound==start)printf(" %d",i);
    printf("|raw %08x %08x",*(DWORD*)(state+0x78),*(DWORD*)(state+0x7c));
    printf("\n");regionExtentCount++;
}
static __declspec(naked) void regionExtentBridge() {
    __asm {
        pushfd
        pushad
        sub esp,108
        fnsave [esp]
        push esi
        call regionExtentAccepted
        add esp,4
        frstor [esp]
        add esp,108
        popad
        popfd
        mov eax,[esi]
        mov ecx,[esi+78h]
        ret
    }
}
static int regionExtentDiagnostic(const char* command) {
    FVector start,end,extent;char tail;
    unsigned short control=0;__asm fnstcw control
    printf("UCMapKit|extent fp-control|%04x\n",(unsigned int)control);
    if(sscanf(command,"UC_EXTENT_EVIDENCE %f %f %f %f %f %f %f %f %f %c",&start.X,&start.Y,&start.Z,&end.X,&end.Y,&end.Z,&extent.X,&extent.Y,&extent.Z,&tail)!=9)return 0;
    if(control!=0x027f||!_finite(start.X)||!_finite(start.Y)||!_finite(start.Z)||
       !_finite(end.X)||!_finite(end.Y)||!_finite(end.Z)||!_finite(extent.X)||!_finite(extent.Y)||!_finite(extent.Z))return 0;
    if(!GEditor->Level||!GEditor->Level->Model||extent.X<=0||extent.Y<=0||extent.Z<=0)return 0;
    HMODULE module=GetModuleHandleA("Engine.dll");if(!module)return 0;
    BYTE* image=(BYTE*)module;BYTE* site=image+0xf564a;
    const BYTE expected[5]={0x8b,0x06,0x8b,0x4e,0x78};
    if(memcmp(site,expected,5))return 0;
    BYTE* visitSite=image+0xf461e;const BYTE visitExpected[6]={0x89,0x86,0x80,0x05,0x00,0x00};
    if(memcmp(visitSite,visitExpected,6))return 0;
    BYTE* exitSite=image+0xf5682;const BYTE exitExpected[10]={0x5f,0x5e,0x5d,0x5b,0x81,0xc4,0xb4,0x01,0x00,0x00};
    if(memcmp(exitSite,exitExpected,10))return 0;
    FCheckResult baseline(1.f),actual(1.f);
    INT clear0=GEditor->Level->SingleLineCheck(baseline,NULL,end,start,TRACE_Level,extent,0),clear1=-1;
    BYTE replacement[5]={0xe8,0,0,0,0};*(LONG*)(replacement+1)=(LONG)((BYTE*)&regionExtentBridge-(site+5));
    BYTE visitReplacement[6]={0xe8,0,0,0,0,0x90};*(LONG*)(visitReplacement+1)=(LONG)((BYTE*)&regionExtentVisitedBridge-(visitSite+5));
    BYTE exitReplacement[10]={0xe9,0,0,0,0,0x90,0x90,0x90,0x90,0x90};*(LONG*)(exitReplacement+1)=(LONG)((BYTE*)&regionExtentExitBridge-(exitSite+5));
    regionExtentExitTarget=exitSite+10;
    DWORD oldProtection,visitOldProtection,exitOldProtection,ignored;
    if(!VirtualProtect(site,5,PAGE_EXECUTE_READWRITE,&oldProtection))return 0;
    if(!VirtualProtect(visitSite,6,PAGE_EXECUTE_READWRITE,&visitOldProtection)) {
        VirtualProtect(site,5,oldProtection,&ignored);return 0;
    }
    if(!VirtualProtect(exitSite,10,PAGE_EXECUTE_READWRITE,&exitOldProtection)) {
        VirtualProtect(visitSite,6,visitOldProtection,&ignored);VirtualProtect(site,5,oldProtection,&ignored);return 0;
    }
    regionExtentFailed=0;regionExtentCount=0;regionExtentPending=0;
    __try {
        memcpy(site,replacement,5);FlushInstructionCache(GetCurrentProcess(),site,5);
        memcpy(visitSite,visitReplacement,6);FlushInstructionCache(GetCurrentProcess(),visitSite,6);
        memcpy(exitSite,exitReplacement,10);FlushInstructionCache(GetCurrentProcess(),exitSite,10);
        clear1=GEditor->Level->SingleLineCheck(actual,NULL,end,start,TRACE_Level,extent,0);
    } __finally {
        memcpy(site,expected,5);FlushInstructionCache(GetCurrentProcess(),site,5);
        memcpy(visitSite,visitExpected,6);FlushInstructionCache(GetCurrentProcess(),visitSite,6);
        memcpy(exitSite,exitExpected,10);FlushInstructionCache(GetCurrentProcess(),exitSite,10);
        if(!VirtualProtect(exitSite,10,exitOldProtection,&ignored)||memcmp(exitSite,exitExpected,10))ExitProcess(93);
        if(!VirtualProtect(visitSite,6,visitOldProtection,&ignored)||memcmp(visitSite,visitExpected,6))ExitProcess(92);
        if(!VirtualProtect(site,5,oldProtection,&ignored)||memcmp(site,expected,5))ExitProcess(91);
    }
    INT same=clear0==clear1 && (clear0||(!appMemcmp(&baseline.Location,&actual.Location,sizeof(FVector))&&
        !appMemcmp(&baseline.Normal,&actual.Normal,sizeof(FVector))&&baseline.Time==actual.Time));
    unsigned short afterControl=0;__asm fnstcw afterControl
    printf("UCMapKit|extent fp-control|%04x\n",(unsigned int)afterControl);
    printf("UCMapKit|extent passthrough|%d|%d accepted|%d malformed|restored\n",same,regionExtentCount,regionExtentFailed);
    if(clear1)printf("UCMapKit|extent final|clear\n");
    else printf("UCMapKit|extent final|%.9g %.9g %.9g %.9g %.9g %.9g %.9g\n",actual.Time,actual.Location.X,actual.Location.Y,actual.Location.Z,actual.Normal.X,actual.Normal.Y,actual.Normal.Z);
    return same&&!regionExtentFailed;
}
static int regionExtentHulls(const char* command) {
    char name[128],tail;if(sscanf(command,"UC_EXTENT_HULLS %127s %c",name,&tail)!=1)return 0;
    INT all=!strcmp(name,"ALL");AActor* actor=all?NULL:findActor(name);UModel* m=GEditor->Level?GEditor->Level->Model:NULL;
    if((!all&&(!actor||!actor->IsStaticBrush()))||!m)return 0;
    TArray<INT> seen;INT count=0;
    for(INT node=0;node<m->Nodes.Num();node++) {
        INT start=m->Nodes(node).iCollisionBound;
        if(start==INDEX_NONE||seen.FindItemIndex(start)!=INDEX_NONE)continue;
        if(start<0||start>=m->LeafHulls.Num())return 0;
        seen.AddItem(start);INT n=0,selected=0;
        while(start+n<m->LeafHulls.Num()&&m->LeafHulls(start+n)>=0&&n<64) {
            INT i=m->LeafHulls(start+n)&~0x40000000;
            if(i<0||i>=m->Nodes.Num())return 0;
            INT surf=m->Nodes(i).iSurf;if(surf<0||surf>=m->Surfs.Num())return 0;
            if(m->Surfs(surf).Actor==actor)selected++;n++;
        }
        if(n>=64||start+n+7>m->LeafHulls.Num()||m->LeafHulls(start+n)!=INDEX_NONE)return 0;
        if(!selected&&!all)continue;count++;
        printf("UCMapKit|selected hull|%d|%d",start,n);
        for(INT k=0;k<n;k++) {
            INT word=m->LeafHulls(start+k);FBspNode& q=m->Nodes(word&~0x40000000);FBspSurf& surf=m->Surfs(q.iSurf);
            FPlane p=q.Plane;if(word&0x40000000)p=FPlane(-p.X,-p.Y,-p.Z,-p.W);
            printf("|%08x %08x %08x %08x %s %d %d",*(DWORD*)&p.X,*(DWORD*)&p.Y,*(DWORD*)&p.Z,*(DWORD*)&p.W,
                   surf.Actor?appToAnsi(surf.Actor->GetName()):"None",surf.iBrushPoly,surf.Actor==actor);
        }
        printf("|bounds");for(INT k=0;k<6;k++)printf(" %08x",m->LeafHulls(start+n+1+k));printf("\n");
    }
    printf("UCMapKit|selected hull complete|%s|%d\n",name,count);return count>0;
}
