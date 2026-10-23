static int regionUVNormalDiagnostic() {
    FVector original[2]={FVector(.0453690514f,-.569957495f,.820420742f),FVector(-.386751354f,.15166977f,-.909626186f)};
    FVector source[2]={FVector(.0453690477f,-.569957495f,.820420682f),FVector(-.386751324f,.151669756f,-.909626126f)};
    for(INT i=0;i<2;i++) {
        FVector normalized=original[i];normalized.Normalize();FVector safe=original[i].SafeNormal();
        printf("UCMapKit|uv normal diagnostic|%d|Normalize %d|SafeNormal %d|%.9g %.9g %.9g|%.9g %.9g %.9g\n",i,normalized==source[i],safe==source[i],normalized.X,normalized.Y,normalized.Z,safe.X,safe.Y,safe.Z);
    }
    return 1;
}
static int regionUVNormalTests() {
    int count=0;
    FVector old[2]={FVector(.0453690514f,-.569957495f,.820420742f),FVector(-.386751354f,.15166977f,-.909626186f)};
    FVector authored[2]={FVector(.0453690477f,-.569957495f,.820420682f),FVector(-.386751324f,.151669756f,-.909626126f)};
    regionUVWorld=NULL;regionUVSources.Empty();regionUVFaces.Empty();regionUVMappings.Empty();
    FRegionUVSource source;source.Actor=(ABrush*)1;source.Flags=0;source.Operation=CSG_Add;source.Start=0;source.Count=1;regionUVSources.AddItem(source);
    FPoly face;face.Init();face.NumVertices=3;face.Base=FVector(0,0,0);face.Normal=authored[0];
    face.TextureU=FVector(1,0,0);face.TextureV=FVector(0,1,0);
    face.Vertex[0]=FVector(0,0,0);face.Vertex[1]=FVector(1,0,0);face.Vertex[2]=FVector(0,1,0);regionUVFaces.AddItem(face);
    FBspSurf s;s.Actor=source.Actor;s.Texture=NULL;s.PolyFlags=0;s.iBrushPoly=0;s.PanU=s.PanV=0;
    FRegionUVMapping original;original.Actor=s.Actor;original.Texture=s.Texture;original.Flags=0;original.Face=0;original.PanU=original.PanV=0;
    original.Base=face.Base;original.U=face.TextureU;original.V=face.TextureV;original.Normal=old[0];original.Source=0;
    TArray<FRegionUVMapping> mappings;mappings.AddItem(original);TArray<INT> unchanged;unchanged.AddItem(1);int bad=0;
    for(INT i=0;i<2;i++) {
        mappings(0).Normal=old[i];regionUVFaces(0).Normal=authored[i];
        if(regionUVChoose(s,authored[i],mappings,unchanged,bad)!=0||bad)return 0;count++;
    }
    mappings(0)=original;regionUVFaces(0)=face;
    for(INT test=0;test<10;test++) {
        mappings(0)=original;regionUVFaces(0)=face;unchanged(0)=1;FVector current=authored[0];
        switch(test) {
            case 0:current.X+=.001f;break;
            case 1:current=-current;regionUVFaces(0).Normal=current;break;
            case 2:mappings(0).Normal=original.Normal*2.f;break;
            case 3:mappings(0).Normal=FVector(0,0,0);break;
            case 4:unchanged(0)=0;break;
            case 5:regionUVFaces(0).Normal.X+=.001f;break;
            case 6:regionUVSources(0).Actor=(ABrush*)2;break;
            case 7:regionUVSources(0).Count=0;break;
            case 8:{union{DWORD bits;FLOAT value;} nan;nan.bits=0x7fc00000;current.X=nan.value;break;}
            case 9:mappings.AddItem(original);mappings(1).Base.X=1;break;
        }
        if(regionUVChoose(s,current,mappings,unchanged,bad)!=INDEX_NONE)return 0;
        if(test==9&&!bad)return 0;
        count++;regionUVSources(0)=source;if(mappings.Num()>1)mappings.Remove(1);
    }
    regionUVWorld=NULL;regionUVSources.Empty();regionUVFaces.Empty();regionUVMappings.Empty();
    printf("UCMapKit|UV normal tests|%d passed\n",count);return 1;
}
