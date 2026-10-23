// Private, tightly checked alternative to CSG recompilation. Python proves
// both original and result against authoritative six-face box source geometry.
// Native code retains every partition link; source edits that no longer fit
// that routing are rejected by the independent exhaustive certificate.
static int isolatedBoxUpdate(const char* name) {
    UModel* m=GEditor->Level->Model;ABrush* actor=NULL;
    for(INT i=0;i<GEditor->Level->Actors.Num();i++) {
        AActor* a=GEditor->Level->Actors(i);char label[256];
        if(!a)continue;wtext(a->GetName(),label,sizeof(label));
        if(!strcmp(label,name)) {
            if(actor||!a->IsStaticBrush()||a==GEditor->Level->Brush())return 0;
            actor=(ABrush*)a;
        }
    }
    if(!m||!actor||actor->CsgOper!=CSG_Add||actor->PolyFlags||!actor->Brush||
       !actor->Brush->Polys||actor->Brush->Polys->Element.Num()!=6)return 0;
    TArray<INT> indices;INT faces[6]={0,0,0,0,0,0};
    for(INT i=0;i<m->Nodes.Num();i++) {
        FBspNode& n=m->Nodes(i);
        if(n.iSurf<0||n.iSurf>=m->Surfs.Num())return 0;
        FBspSurf& s=m->Surfs(n.iSurf);
        if(s.Actor!=actor)continue;
        if(n.NodeFlags||n.NumVertices!=4||s.PolyFlags||s.iBrushPoly<0||s.iBrushPoly>=6||faces[s.iBrushPoly]++)return 0;
        FPoly p=surfaceWorld(actor,s.iBrushPoly);
        if(p.NumVertices!=4||p.PolyFlags||p.Texture!=s.Texture)return 0;
        indices.AddItem(i);
    }
    if(indices.Num()!=6)return 0;
    TArray<FBspNode> before=m->Nodes;TArray<FLeaf> leaves=m->Leaves;
    FZoneProperties zones[64];appMemcpy(zones,m->Zones,sizeof(zones));
    INT zoneCount=m->NumZones,rootOutside=m->RootOutside;
    for(INT k=0;k<indices.Num();k++) {
        FBspNode& n=m->Nodes(indices(k));FBspSurf& s=m->Surfs(n.iSurf);
        FPoly p=surfaceWorld(actor,s.iBrushPoly);
        n.Plane=FPlane(p.Vertex[0],p.Normal);n.iVertPool=m->Verts.Num();
        for(INT v=0;v<4;v++) {
            if(!_finite(p.Vertex[v].X)||!_finite(p.Vertex[v].Y)||!_finite(p.Vertex[v].Z))return 0;
            FVert vertex;vertex.pVertex=m->Points.AddItem(p.Vertex[v]);vertex.iSide=INDEX_NONE;m->Verts.AddItem(vertex);
        }
        s.pBase=m->Points.AddItem(p.Base);s.vNormal=m->Vectors.AddItem(p.Normal);
        s.vTextureU=m->Vectors.AddItem(p.TextureU);s.vTextureV=m->Vectors.AddItem(p.TextureV);
        s.PanU=p.PanU;s.PanV=p.PanV;s.iLightMap=INDEX_NONE;
    }
    GEditor->bspBuildBounds(m);
    if(m->Nodes.Num()!=before.Num()||m->RootOutside!=rootOutside||m->Leaves.Num()!=leaves.Num()||m->NumZones!=zoneCount)return 0;
    for(INT i=0;i<before.Num();i++) {
        FBspNode& a=before(i);FBspNode& b=m->Nodes(i);
        if(a.iFront!=b.iFront||a.iBack!=b.iBack||a.iPlane!=b.iPlane||a.iSurf!=b.iSurf||a.NodeFlags!=b.NodeFlags||
           a.NumVertices!=b.NumVertices||a.iZone[0]!=b.iZone[0]||a.iZone[1]!=b.iZone[1]||a.iLeaf[0]!=b.iLeaf[0]||a.iLeaf[1]!=b.iLeaf[1])return 0;
        if(indices.FindItemIndex(i)==INDEX_NONE&&
           (appMemcmp(&a.Plane,&b.Plane,sizeof(FPlane))||a.iVertPool!=b.iVertPool))return 0;
    }
    if(appMemcmp(zones,m->Zones,sizeof(zones)))return 0;
    for(INT i=0;i<leaves.Num();i++) {
        FLeaf& a=leaves(i);FLeaf& b=m->Leaves(i);
        if(a.iZone!=b.iZone||a.iPermeating!=b.iPermeating||a.iVolumetric!=b.iVolumetric||a.VisibleZones!=b.VisibleZones)return 0;
    }
    for(INT i=0;i<GEditor->Level->Actors.Num();i++)if(GEditor->Level->Actors(i))
        GEditor->Level->SetActorZone(GEditor->Level->Actors(i),0,1);
    printf("UCMapKit|isolated box update|6 source faces|unchanged partition links\n");return 1;
}
