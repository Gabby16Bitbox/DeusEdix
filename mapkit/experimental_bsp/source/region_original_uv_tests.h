// Private harness unit tests call exactly the production predicate functions.
static int regionUVSelfTest() {
    int count=0;
    FPoly a;a.Init();a.NumVertices=3;a.Base=FVector(0,0,0);a.Normal=FVector(0,0,1);
    a.TextureU=FVector(1,0,0);a.TextureV=FVector(0,1,0);a.Vertex[0]=FVector(0,0,0);
    a.Vertex[1]=FVector(1,0,0);a.Vertex[2]=FVector(0,1,0);a.iLink=0;a.iBrushPoly=0;
    if(!regionUVSameSourceFace(a,a))return 0;count++;
    for(int field=0;field<12;field++) {
        FPoly b=a;
        switch(field) {
            case 0:b.Base.X=.01f;break;case 1:b.Normal.Z=-1;break;
            case 2:b.TextureU.X=2;break;case 3:b.TextureV.Y=2;break;
            case 4:b.Vertex[2].Y=2;break;case 5:b.PanU++;break;case 6:b.PanV++;break;
            case 7:b.Texture=(UTexture*)1;break;case 8:b.PolyFlags^=PF_Unlit;break;
            case 9:b.iLink++;break;case 10:b.iBrushPoly++;break;case 11:b.NumVertices=0;break;
        }
        if(regionUVSameSourceFace(a,b))return 0;count++;
    }
    union {DWORD bits;FLOAT value;} invalid;invalid.bits=0x7fc00000;
    FPoly bad=a;bad.Base.X=invalid.value;if(regionUVSameSourceFace(a,bad))return 0;count++;
    FBspSurf s;s.Actor=(ABrush*)1;s.Texture=(UTexture*)2;s.PolyFlags=0;s.iBrushPoly=3;s.PanU=4;s.PanV=5;
    FRegionUVMapping record;record.Actor=s.Actor;record.Texture=s.Texture;record.Flags=s.PolyFlags;
    record.Face=s.iBrushPoly;record.PanU=s.PanU;record.PanV=s.PanV;record.Source=0;
    record.Base=FVector(0,0,0);record.U=a.TextureU;record.V=a.TextureV;record.Normal=a.Normal;
    TArray<FRegionUVMapping> mappings;mappings.AddItem(record);TArray<INT> same;same.AddItem(1);int ambiguous=0;
    if(regionUVChoose(s,a.Normal,mappings,same,ambiguous)!=0||ambiguous)return 0;count++;
    same(0)=0;if(regionUVChoose(s,a.Normal,mappings,same,ambiguous)!=INDEX_NONE)return 0;count++;same(0)=1;
    if(regionUVChoose(s,-a.Normal,mappings,same,ambiguous)!=INDEX_NONE)return 0;count++;
    mappings.AddItem(record);mappings(1).Base.X=.001f;
    if(regionUVChoose(s,a.Normal,mappings,same,ambiguous)!=INDEX_NONE||!ambiguous)return 0;count++;
    mappings.Remove(1);
    for(int field=0;field<6;field++) {
        FRegionUVMapping changed=record;
        switch(field) {
            case 0:changed.Actor=(ABrush*)3;break;case 1:changed.Texture=(UTexture*)3;break;
            case 2:changed.Flags=1;break;case 3:changed.Face++;break;case 4:changed.PanU++;break;case 5:changed.PanV++;break;
        }
        mappings(0)=changed;if(regionUVChoose(s,a.Normal,mappings,same,ambiguous)!=INDEX_NONE)return 0;count++;
    }
    mappings(0)=record;mappings(0).Source=1;
    if(regionUVChoose(s,a.Normal,mappings,same,ambiguous)!=INDEX_NONE)return 0;count++;
    // Exercise the real operation refusal, not only its lookup predicate.
    if(!regionUVSnapshot()||!regionUVMappings.Num())return 0;
    UModel* world=GEditor->Level->Model;
    FRegionUVMapping original=regionUVMappings(0);int sid=INDEX_NONE;
    for(int i=0;i<world->Surfs.Num();i++)if(regionUVSameOwner(world->Surfs(i),original)){sid=i;break;}
    if(sid==INDEX_NONE)return 0;
    UModel* trial=ConstructObject<UModel>(UModel::StaticClass());trial->AddToRoot();
    trial->Points=world->Points;trial->Vectors=world->Vectors;
    new(trial->Surfs) FBspSurf(world->Surfs(sid));
    FVector sentinel=original.Base+FVector(1,2,3);
    trial->Surfs(0).pBase=trial->Points.AddItem(sentinel);
    FRegionUVMapping conflicting=original;conflicting.Base.X+=1;
    regionUVMappings.AddItem(conflicting);
    if(regionUVRestore(trial,world)!=0)return 0;count++;
    regionUVMappings.Remove(regionUVMappings.Num()-1);
    FRegionUVSource source=regionUVSources(original.Source);
    FVector saved=regionUVFaces(source.Start).Vertex[0];
    regionUVFaces(source.Start).Vertex[0].X+=1;
    if(!regionUVRestore(trial,world)||trial->Points(trial->Surfs(0).pBase)!=sentinel)return 0;count++;
    regionUVFaces(source.Start).Vertex[0]=saved;
    trial->RemoveFromRoot();regionUVWorld=NULL;
    regionUVSources.Empty();regionUVFaces.Empty();regionUVMappings.Empty();
    printf("UCMapKit|region UV tests|%d passed\n",count);return 1;
}
