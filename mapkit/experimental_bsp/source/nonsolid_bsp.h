// Canonical persisted collision/visibility state, excluding changed render
// bounds and UV origins. Float bit patterns survive decimal presentation.
static int nonSolidState(const char* path) {
    UModel* m=GEditor->Level->Model; FILE* f=fopen(path,"wt");if(!f)return 0;
    fprintf(f,"M %d %d %d %d %d %d\n",m->RootOutside,m->Nodes.Num(),m->Surfs.Num(),m->Leaves.Num(),m->NumZones,m->LeafHulls.Num());
    for(int i=0;i<m->Nodes.Num();i++) {
        FBspNode& n=m->Nodes(i);DWORD bits[4];appMemcpy(bits,&n.Plane,sizeof(bits));
        fprintf(f,"N %d %08lx %08lx %08lx %08lx %d %d %d %d %u %d %d %d %d %d %I64u %d\n",i,
            bits[0],bits[1],bits[2],bits[3],n.iFront,n.iBack,n.iPlane,n.iSurf,(unsigned)n.NodeFlags,
            n.iLeaf[0],n.iLeaf[1],n.iZone[0],n.iZone[1],n.iCollisionBound,n.ZoneMask,n.NumVertices>0);
    }
    for(int i=0;i<m->Surfs.Num();i++) {
        FBspSurf& s=m->Surfs(i);DWORD bits[3];appMemcpy(bits,&m->Vectors(s.vNormal),sizeof(bits));
        fprintf(f,"S %d %lu %08lx %08lx %08lx\n",i,(unsigned long)s.PolyFlags,bits[0],bits[1],bits[2]);
    }
    for(int i=0;i<m->Leaves.Num();i++) {
        FLeaf& l=m->Leaves(i);fprintf(f,"L %d %d %d %d %I64u\n",i,l.iZone,l.iPermeating,l.iVolumetric,l.VisibleZones);
    }
    for(int i=0;i<m->LeafHulls.Num();i++)fprintf(f,"H %d\n",m->LeafHulls(i));
    fclose(f);printf("UCMapKit|non-solid state|complete\n");return 1;
}

// Update non-solid polygons while retaining every BSP plane/link/leaf/zone.
// Python preflight proves pure subtree, unchanged planes, and solid clipping.
static int nonSolidUpdate(const char* path) {
    UModel* m=GEditor->Level->Model;
    FILE* f=fopen(path,"rt"); if(!f)return 0;
    int count;if(fscanf(f,"%d",&count)!=1||count<1||count>65536){fclose(f);return 0;}
    TArray<INT> changed,surfaces;
    TArray<FBspNode> before=m->Nodes;
    TArray<FLeaf> leaves=m->Leaves;
    TArray<INT> hulls=m->LeafHulls;
    FZoneProperties zones[64]; appMemcpy(zones,m->Zones,sizeof(zones));
    int numZones=m->NumZones;
    for(int k=0;k<count;k++) {
        int index,vertices;
        if(fscanf(f,"%d %d",&index,&vertices)!=2||index<0||index>=m->Nodes.Num()||vertices<3||vertices>16||changed.FindItemIndex(index)!=INDEX_NONE){fclose(f);return 0;}
        FBspNode& n=m->Nodes(index);FBspSurf& surface=m->Surfs(n.iSurf);
        if(!(n.NodeFlags&NF_NotCsg)||!(surface.PolyFlags&PF_NotSolid)||(surface.PolyFlags&PF_Portal)||!surface.Actor){fclose(f);return 0;}
        changed.AddItem(index);
        n.iVertPool=m->Verts.Num();n.NumVertices=vertices;
        for(int j=0;j<vertices;j++) {
            FVector v;
            if(fscanf(f,"%f %f %f",&v.X,&v.Y,&v.Z)!=3||!_finite(v.X)||!_finite(v.Y)||!_finite(v.Z)||Abs(n.Plane.PlaneDot(v))>.01f){fclose(f);return 0;}
            FVert vert;vert.pVertex=m->Points.AddItem(v);vert.iSide=INDEX_NONE;m->Verts.AddItem(vert);
        }
        if(surfaces.FindItemIndex(n.iSurf)==INDEX_NONE) {
            FPoly p=surfaceWorld(surface.Actor,surface.iBrushPoly);
            surface.pBase=m->Points.AddItem(p.Base);
            surface.vTextureU=m->Vectors.AddItem(p.TextureU);
            surface.vTextureV=m->Vectors.AddItem(p.TextureV);
            surface.iLightMap=INDEX_NONE;
            surfaces.AddItem(n.iSurf);
        }
    }
    fclose(f);
    GEditor->UEditorEngine::bspBuildBounds(m);
    // Only render extents changed. Every structural plane, child and solidity
    // bit is retained, so preserve the original collision hulls exactly.
    m->LeafHulls=hulls;
    for(int i=0;i<m->Nodes.Num()&&i<before.Num();i++)
        m->Nodes(i).iCollisionBound=before(i).iCollisionBound;
    if(m->Nodes.Num()!=before.Num()||m->Leaves.Num()!=leaves.Num()||m->NumZones!=numZones)return 0;
    for(int i=0;i<m->Nodes.Num();i++) {
        FBspNode& a=before(i);FBspNode& b=m->Nodes(i);
        if(appMemcmp(&a.Plane,&b.Plane,sizeof(FPlane))||a.iFront!=b.iFront||a.iBack!=b.iBack||a.iPlane!=b.iPlane||a.iSurf!=b.iSurf||a.NodeFlags!=b.NodeFlags||a.iZone[0]!=b.iZone[0]||a.iZone[1]!=b.iZone[1]||a.iLeaf[0]!=b.iLeaf[0]||a.iLeaf[1]!=b.iLeaf[1]||a.ZoneMask!=b.ZoneMask)return 0;
        if(changed.FindItemIndex(i)==INDEX_NONE&&(a.NumVertices!=b.NumVertices||a.iVertPool!=b.iVertPool))return 0;
    }
    for(int i=0;i<leaves.Num();i++) {
        FLeaf& a=leaves(i);FLeaf& b=m->Leaves(i);
        if(a.iZone!=b.iZone||a.iPermeating!=b.iPermeating||a.iVolumetric!=b.iVolumetric||a.VisibleZones!=b.VisibleZones)return 0;
    }
    if(appMemcmp(zones,m->Zones,sizeof(zones)))return 0;
    printf("UCMapKit|non-solid update|%d nodes|unchanged planes links leaves zones\n",count);
    return 1;
}
