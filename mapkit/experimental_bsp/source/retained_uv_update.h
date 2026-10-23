// Research-only source mapping update. It deliberately does not rebuild,
// refresh or reinterpret the world BSP. An independent source-intent proof
// must authorize retaining the geometry before this can be published.
static int retainedUVUpdate(const char* name) {
    if(!name || !*name || !GEditor->Level || !GEditor->Level->Model)return 0;
    ABrush* actor=NULL;
    for(INT i=0;i<GEditor->Level->Actors.Num();i++) {
        AActor* a=GEditor->Level->Actors(i);char label[256];
        if(!a)continue;wtext(a->GetName(),label,sizeof(label));
        if(strcmp(label,name))continue;
        if(actor || !a->IsStaticBrush() || a==GEditor->Level->Brush())return 0;
        actor=(ABrush*)a;
    }
    if(!actor || !actor->Brush || !actor->Brush->Polys)return 0;
    UModel* model=GEditor->Level->Model;TArray<INT> surfaces;TArray<FPoly> mappings;
    // Validate every selected surface before writing anything. Keep their
    // normals, render flags and all geometry-owned pool entries untouched.
    for(INT i=0;i<model->Surfs.Num();i++) {
        FBspSurf& s=model->Surfs(i);if(s.Actor!=actor)continue;
        if(s.iBrushPoly<0 || s.iBrushPoly>=actor->Brush->Polys->Element.Num())return 0;
        FPoly p=surfaceWorld(actor,s.iBrushPoly);
        if(!regionUVValid(p) || p.Texture!=s.Texture ||
           s.vNormal<0 || s.vNormal>=model->Vectors.Num() || p.Normal!=model->Vectors(s.vNormal))return 0;
        surfaces.AddItem(i);mappings.AddItem(p);
    }
    if(!surfaces.Num())return 0;
    for(INT k=0;k<surfaces.Num();k++) {
        FBspSurf& s=model->Surfs(surfaces(k));FPoly& p=mappings(k);
        s.pBase=model->Points.AddItem(p.Base);
        s.vTextureU=model->Vectors.AddItem(p.TextureU);s.vTextureV=model->Vectors.AddItem(p.TextureV);
        s.PanU=p.PanU;s.PanV=p.PanV;s.iLightMap=INDEX_NONE;
    }
    printf("UCMapKit|retained UV update|%d mappings|BSP unchanged\n",surfaces.Num());return 1;
}

struct FRetainedRingInput {
    INT Node,Count;
    FVector Points[FBspNode::MAX_FINAL_VERTICES];
};
static int retainedRingsUpdate(const char* path) {
    if(!GEditor->Level || !GEditor->Level->Model)return 0;
    UModel* m=GEditor->Level->Model;FILE* f=fopen(path,"rt");if(!f)return 0;
    char actor[128];int version=0,count=0,valid=1;TArray<FRetainedRingInput> rows;
    if(fscanf(f,"RETAINRINGS %d %127s %d",&version,actor,&count)!=3 || version!=1 || count<1 || count>m->Nodes.Num())valid=0;
    for(int k=0;k<count && valid;k++) {
        FRetainedRingInput row;
        if(fscanf(f,"%d %d",&row.Node,&row.Count)!=2 || row.Node<0 || row.Node>=m->Nodes.Num() ||
           row.Count<3 || row.Count>FBspNode::MAX_FINAL_VERTICES){valid=0;break;}
        FBspNode& n=m->Nodes(row.Node);char owner[128]="None";
        if(n.iSurf<0 || n.iSurf>=m->Surfs.Num() || row.Count!=n.NumVertices ||
           n.iVertPool<0 || n.iVertPool+row.Count>m->Verts.Num()){valid=0;break;}
        if(m->Surfs(n.iSurf).Actor)wtext(m->Surfs(n.iSurf).Actor->GetName(),owner,sizeof(owner));
        if(strcmp(owner,actor)){valid=0;break;}
        for(int j=0;j<rows.Num();j++)if(rows(j).Node==row.Node)valid=0;
        for(int j=0;j<row.Count && valid;j++) {
            FVector& p=row.Points[j];
            if(fscanf(f,"%f %f %f",&p.X,&p.Y,&p.Z)!=3 || !regionUVFinite(p) || n.Plane.PlaneDot(p)!=0)valid=0;
        }
        if(valid)rows.AddItem(row);
    }
    char extra[2];if(valid && fscanf(f,"%1s",extra)==1)valid=0;
    fclose(f);if(!valid || rows.Num()!=count)return 0;
    // Appended rings cannot alias any retained ring. Their changed edges do
    // not reuse cached shared-side intersections belonging to the old mesh.
    for(int k=0;k<rows.Num();k++) {
        FRetainedRingInput& row=rows(k);FBspNode& n=m->Nodes(row.Node);
        n.iVertPool=m->Verts.Num();
        for(int j=0;j<row.Count;j++) {
            FVert v;v.pVertex=m->Points.AddItem(row.Points[j]);v.iSide=INDEX_NONE;m->Verts.AddItem(v);
        }
    }
    printf("UCMapKit|retained rings update|%d rings|planes and collision unchanged\n",rows.Num());return 1;
}
