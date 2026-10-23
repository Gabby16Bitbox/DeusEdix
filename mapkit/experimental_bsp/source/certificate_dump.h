// Read-only authoritative evidence for independent local rebuild certification.
// %.9g round-trips every finite IEEE float32; the reader reconstructs float32
// before converting to an exact rational. Missing END means an invalid dump.
static int certVector(FILE* f,const FVector& v) {
    if(!_finite(v.X)||!_finite(v.Y)||!_finite(v.Z))return 0;
    fprintf(f," %.9g %.9g %.9g",v.X,v.Y,v.Z);return 1;
}
static int certificateZonePool(const char* path) {
    if(!GEditor->Level || !GEditor->Level->Model)return 0;
    UModel* m=GEditor->Level->Model;
    if(m->NumZones<0 || m->NumZones>FBspNode::MAX_ZONES)return 0;
    // Slots beyond NumZones are not serialized, but legacy node/leaf labels
    // can reference them. Snapshot the complete runtime array explicitly.
    for(int i=0;i<FBspNode::MAX_ZONES;i++) {
        AZoneInfo* a=m->Zones[i].ZoneActor;if(!a)continue;
        int found=0;
        for(int j=0;j<GEditor->Level->Actors.Num();j++)if(GEditor->Level->Actors(j)==a){found=1;break;}
        if(!found)return 0;
    }
    FILE* f=fopen(path,"wt");if(!f)return 0;
    fprintf(f,"ZONEPOOL 1\nM %d %d\n",m->NumZones,(int)FBspNode::MAX_ZONES);
    for(int i=0;i<FBspNode::MAX_ZONES;i++) {
        char actor[128]="None",cls[256]="None";AZoneInfo* a=m->Zones[i].ZoneActor;
        if(a){wtext(a->GetName(),actor,sizeof(actor));wtext(a->GetClass()->GetPathName(),cls,sizeof(cls));}
        fprintf(f,"Z %d %s %s %I64u %I64u\n",i,actor,cls,m->Zones[i].Connectivity,m->Zones[i].Visibility);
    }
    fprintf(f,"END %d\n",(int)FBspNode::MAX_ZONES);fclose(f);return 1;
}
static int certificateVertexPool(const char* path) {
    if(!GEditor->Level || !GEditor->Level->Model)return 0;
    UModel* m=GEditor->Level->Model;FILE* f=fopen(path,"wt");if(!f)return 0;
    fprintf(f,"VERTPOOL 1\nM %d %d %d %d\n",m->NumSharedSides,m->Verts.Num(),m->Nodes.Num(),m->Points.Num());
    for(int i=0;i<m->Verts.Num();i++)fprintf(f,"V %d %d %d\n",i,m->Verts(i).pVertex,m->Verts(i).iSide);
    for(int i=0;i<m->Nodes.Num();i++)fprintf(f,"N %d %d %d\n",i,m->Nodes(i).iVertPool,(int)m->Nodes(i).NumVertices);
    fprintf(f,"END %d %d\n",m->Verts.Num(),m->Nodes.Num());fclose(f);return 1;
}
static int certificateCommand(const char* line) {
    if(!strcmp(line,"UC_CERT_PROFILE")) {
        unsigned short control=0;
        __asm fnstcw control
        printf("UCMapKit|certificate profile|x87_control=0x%04x\n",(unsigned int)control);
        return 1;
    }
    char path[512];
    if(sscanf(line,"UC_CERT_ZONE_POOL %511s",path)==1)return certificateZonePool(path);
    if(sscanf(line,"UC_CERT_VERTEX_POOL %511s",path)==1)return certificateVertexPool(path);
    if(sscanf(line,"UC_CERT_DUMP %511s",path)!=1)return 0;
    if(!GEditor->Level || !GEditor->Level->Model)return 0;
    UModel* m=GEditor->Level->Model;FILE* f=fopen(path,"wt");if(!f)return 0;
    int valid=1,brushes=0;
    fprintf(f,"CERT 2 float32-roundtrip\nM %d %d %d %d %d %d %d %d\n",m->RootOutside,m->NumZones,m->Nodes.Num(),m->Surfs.Num(),m->Bounds.Num(),m->LeafHulls.Num(),m->Leaves.Num(),GEditor->Level->Actors.Num());
    for(int i=0;i<m->Nodes.Num() && valid;i++) {
        FBspNode& n=m->Nodes(i);
        if(n.iSurf<0 || n.iSurf>=m->Surfs.Num() || n.NumVertices>FBspNode::MAX_FINAL_VERTICES || (n.NumVertices && (n.iVertPool<0 || n.iVertPool+n.NumVertices>m->Verts.Num()))){valid=0;break;}
        fprintf(f,"N %d %d %d %d %d %d %d %d %d %d %d %d %d %I64u",i,n.iFront,n.iBack,n.iPlane,n.iSurf,n.NumVertices,n.NodeFlags,n.iCollisionBound,n.iRenderBound,n.iZone[0],n.iZone[1],n.iLeaf[0],n.iLeaf[1],n.ZoneMask);
        valid=certVector(f,n.Plane) && _finite(n.Plane.W);fprintf(f," %.9g",n.Plane.W);
        for(int k=0;k<n.NumVertices && valid;k++) {
            int index=m->Verts(n.iVertPool+k).pVertex;
            if(index<0 || index>=m->Points.Num()){valid=0;break;}
            valid=certVector(f,m->Points(index));
        }
        fprintf(f,"\n");
    }
    for(int i=0;i<m->Surfs.Num() && valid;i++) {
        FBspSurf& s=m->Surfs(i);char actor[128]="None",texture[512]="None";
        if(s.Actor)wtext(s.Actor->GetName(),actor,sizeof(actor));if(s.Texture)wtext(s.Texture->GetPathName(),texture,sizeof(texture));
        if(s.pBase<0||s.pBase>=m->Points.Num()||s.vNormal<0||s.vNormal>=m->Vectors.Num()||s.vTextureU<0||s.vTextureU>=m->Vectors.Num()||s.vTextureV<0||s.vTextureV>=m->Vectors.Num()){valid=0;break;}
        fprintf(f,"S %d %s %s %lu %d %d %d %d",i,actor,texture,(unsigned long)s.PolyFlags,s.iBrushPoly,s.iLightMap,s.PanU,s.PanV);
        valid=certVector(f,m->Points(s.pBase))&&certVector(f,m->Vectors(s.vNormal))&&certVector(f,m->Vectors(s.vTextureU))&&certVector(f,m->Vectors(s.vTextureV));fprintf(f,"\n");
    }
    for(int i=0;i<m->Bounds.Num() && valid;i++) {
        FBox& b=m->Bounds(i);fprintf(f,"D %d %d",i,(int)b.IsValid);
        valid=certVector(f,b.Min)&&certVector(f,b.Max);fprintf(f,"\n");
    }
    for(int i=0;i<m->LeafHulls.Num();i++)fprintf(f,"H %d %d\n",i,m->LeafHulls(i));
    for(int i=0;i<m->Leaves.Num();i++) {
        FLeaf& l=m->Leaves(i);fprintf(f,"L %d %d %d %d %I64u\n",i,l.iZone,l.iPermeating,l.iVolumetric,l.VisibleZones);
    }
    for(int i=0;i<m->NumZones;i++) {
        char actor[128]="None",cls[256]="None";AZoneInfo* a=m->Zones[i].ZoneActor;
        if(a){wtext(a->GetName(),actor,sizeof(actor));wtext(a->GetClass()->GetPathName(),cls,sizeof(cls));}
        fprintf(f,"Z %d %s %s %I64u %I64u\n",i,actor,cls,m->Zones[i].Connectivity,m->Zones[i].Visibility);
    }
    for(int i=0;i<GEditor->Level->Actors.Num() && valid;i++) {
        AActor* a=GEditor->Level->Actors(i);
        if(!a||!a->IsStaticBrush()||a==GEditor->Level->Brush()||!a->Brush||!a->Brush->Polys)continue;
        ABrush* b=(ABrush*)a;char actor[128];wtext(b->GetName(),actor,sizeof(actor));brushes++;
        fprintf(f,"B %d %s %d %lu %d\n",i,actor,(int)b->CsgOper,(unsigned long)b->PolyFlags,b->Brush->Polys->Element.Num());
        for(int j=0;j<b->Brush->Polys->Element.Num() && valid;j++) {
            FPoly p=surfaceWorld(b,j);char texture[512]="None";
            if(p.Texture)wtext(p.Texture->GetPathName(),texture,sizeof(texture));
            // FPoly.Base is a UV origin and can be off the geometry plane.
            // Vertices[0] anchors the source face; preserve Base separately.
            if(p.NumVertices<3){valid=0;break;}
            FPlane equation(p.Vertex[0],p.Normal);
            fprintf(f,"F %d %d %lu %s %d %d %d",j,p.iLink,(unsigned long)p.PolyFlags,texture,p.PanU,p.PanV,p.NumVertices);
            valid=certVector(f,p.Base)&&certVector(f,p.Normal)&&certVector(f,p.TextureU)&&certVector(f,p.TextureV)&&_finite(equation.W);
            fprintf(f," %.9g",equation.W);
            for(int k=0;k<p.NumVertices && valid;k++)valid=certVector(f,p.Vertex[k]);
            fprintf(f,"\n");
        }
    }
    if(valid)fprintf(f,"END %d\n",brushes);
    fclose(f);return valid;
}
