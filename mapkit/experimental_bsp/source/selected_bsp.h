// Native feasibility probe. Only used by the isolated research host.
// bspRepartition(root) discards the other nodes in this Deus Ex SDK. Run it on
// a transient model, then graft the resulting branch into the real model.
static void selectedCompile(UModel* scratch, int root) {
    UModel* world=GEditor->Level->Model;
    __try {
        GEditor->Level->Model=scratch;
        GEditor->UEditorEngine::bspRepartition(scratch,root,0);
    } __finally { GEditor->Level->Model=world; }
}
static int selectedGraft(UModel* m, int root) {
    TArray<INT> oldNodes, stack;
    stack.AddItem(root);
    while(stack.Num()) {
        int i=stack(stack.Num()-1); stack.Remove(stack.Num()-1);
        if(i<0 || i>=m->Nodes.Num() || oldNodes.FindItemIndex(i)!=INDEX_NONE) return 0;
        oldNodes.AddItem(i);
        FBspNode& n=m->Nodes(i);
        if(n.iFront!=INDEX_NONE) stack.AddItem(n.iFront);
        if(n.iBack!=INDEX_NONE) stack.AddItem(n.iBack);
        if(n.iPlane!=INDEX_NONE) stack.AddItem(n.iPlane);
    }
    UModel* scratch=ConstructObject<UModel>(UModel::StaticClass());
    scratch->Polys=ConstructObject<UPolys>(UPolys::StaticClass(),scratch);
    scratch->RootOutside=m->RootOutside;
    scratch->Nodes=m->Nodes; scratch->Verts=m->Verts; scratch->Surfs=m->Surfs;
    scratch->Points=m->Points; scratch->Vectors=m->Vectors;
    int worldNodes=m->Nodes.Num(), worldLightmaps=m->LightMap.Num();
    // This SDK's repartitioner consults Level->Model internally as well.
    selectedCompile(scratch,root);
    printf("UCMapKit|selected|scratch|%d compiled|%d retained\n",scratch->Nodes.Num(),m->Nodes.Num());
    if(m->Nodes.Num()!=worldNodes || m->LightMap.Num()!=worldLightmaps) return 0;
    if(!scratch->Nodes.Num() || scratch->Surfs.Num()!=m->Surfs.Num()) return 0;
    // Retain the original surface records, including UVs and baked lighting.
    for(int j=0;j<scratch->Surfs.Num();j++) {
        FBspSurf& a=m->Surfs(j); FBspSurf& b=scratch->Surfs(j);
        if(a.Actor!=b.Actor || a.iBrushPoly!=b.iBrushPoly || a.Texture!=b.Texture || a.PolyFlags!=b.PolyFlags || a.PanU!=b.PanU || a.PanV!=b.PanV) return 0;
        if((m->Points(a.pBase)-scratch->Points(b.pBase)).SizeSquared()>.000001f ||
           (m->Vectors(a.vNormal)-scratch->Vectors(b.vNormal)).SizeSquared()>.000001f ||
           (m->Vectors(a.vTextureU)-scratch->Vectors(b.vTextureU)).SizeSquared()>.000001f ||
           (m->Vectors(a.vTextureV)-scratch->Vectors(b.vTextureV)).SizeSquared()>.000001f) return 0;
    }
    int count=scratch->Nodes.Num(); TArray<INT> mapped;
    for(int j=0;j<count;j++) mapped.AddItem(j<oldNodes.Num()?oldNodes(j):m->Nodes.AddZeroed());
    int pointBase=m->Points.Num();
    for(int j=0;j<scratch->Points.Num();j++) m->Points.AddItem(scratch->Points(j));
    for(int j=0;j<count;j++) {
        FBspNode n=scratch->Nodes(j);
        int start=m->Verts.Num();
        for(int k=0;k<n.NumVertices;k++) {
            FVert v=scratch->Verts(n.iVertPool+k); v.pVertex+=pointBase;
            m->Verts.AddItem(v);
        }
        n.iVertPool=start;
        if(n.iFront!=INDEX_NONE) n.iFront=mapped(n.iFront);
        if(n.iBack!=INDEX_NONE) n.iBack=mapped(n.iBack);
        if(n.iPlane!=INDEX_NONE) n.iPlane=mapped(n.iPlane);
        n.iCollisionBound=n.iRenderBound=INDEX_NONE;
        m->Nodes(mapped(j))=n;
    }
    // Detach any surplus old nodes; bspRefresh removes unreachable entries.
    for(int j=count;j<oldNodes.Num();j++) {
        FBspNode& n=m->Nodes(oldNodes(j)); n.NumVertices=0;
        n.iFront=n.iBack=n.iPlane=INDEX_NONE;
    }
    printf("UCMapKit|selected|grafted|%d old|%d new\n",oldNodes.Num(),count);
    return 1;
}

static int selectedFinish(UModel* m) {
    TArray<INT> lightIndexes;
    for(int i=0;i<m->Surfs.Num();i++) lightIndexes.AddItem(m->Surfs(i).iLightMap);
    TArray<AActor*> oldLights=m->Lights;
    int bakedPrefix=0;
    for(int i=0;i<m->LightMap.Num();i++) {
        int k=m->LightMap(i).iLightActors;
        if(k<0)continue;
        if(k>=oldLights.Num())return 0;
        while(k<oldLights.Num() && oldLights(k))k++;
        if(k>=oldLights.Num())return 0;
        bakedPrefix=Max(bakedPrefix,k+1);
    }
    if(oldLights.Num()>bakedPrefix)oldLights.Remove(bakedPrefix,oldLights.Num()-bakedPrefix);
    int lightCount=m->LightMap.Num(), bitCount=m->LightBits.Num();
    if(!finishWorld())return 0;
    if(m->Surfs.Num()!=lightIndexes.Num() || m->LightMap.Num()!=lightCount || m->LightBits.Num()!=bitCount) return 0;
    for(int i=0;i<m->Surfs.Num();i++) m->Surfs(i).iLightMap=lightIndexes(i);
    for(int i=0;i<m->Leaves.Num();i++) {
        if(m->Leaves(i).iPermeating>=0)m->Leaves(i).iPermeating+=oldLights.Num();
        if(m->Leaves(i).iVolumetric>=0)m->Leaves(i).iVolumetric+=oldLights.Num();
    }
    TArray<AActor*> leafLights=m->Lights; m->Lights=oldLights;
    for(int i=0;i<leafLights.Num();i++)m->Lights.AddItem(leafLights(i));
    return 1;
}

static int selectedRoots(UModel* m, const char* text, TArray<INT>& roots) {
    TArray<ABrush*> actors;
    char copy[4096]; if(strlen(text)>=sizeof(copy))return 0; strcpy(copy,text);
    for(char* name=strtok(copy," ");name;name=strtok(NULL," ")) {
        AActor* a=findActor(name);
        if(!a || !a->IsStaticBrush() || a==GEditor->Level->Brush())return 0;
        actors.AddUniqueItem((ABrush*)a);
    }
    if(!actors.Num() || !m->Nodes.Num())return 0;
    TArray<INT> parent, order, stack, pure, owned;
    parent.Add(m->Nodes.Num()); pure.AddZeroed(m->Nodes.Num()); owned.AddZeroed(m->Nodes.Num());
    for(int i=0;i<parent.Num();i++)parent(i)=-2;
    parent(0)=INDEX_NONE; stack.AddItem(0);
    while(stack.Num()) {
        int i=stack(stack.Num()-1); stack.Remove(stack.Num()-1); order.AddItem(i);
        FBspNode& n=m->Nodes(i);
        if(n.iSurf<0 || n.iSurf>=m->Surfs.Num())return 0;
        FBspSurf& s=m->Surfs(n.iSurf);
        owned(i)=actors.FindItemIndex(s.Actor)!=INDEX_NONE;
        if(owned(i) && (s.PolyFlags&PF_Portal))return 0;
        int children[3]={n.iFront,n.iBack,n.iPlane};
        for(int k=0;k<3;k++)if(children[k]!=INDEX_NONE) {
            int c=children[k]; if(c<0 || c>=parent.Num() || parent(c)!=-2)return 0;
            parent(c)=i; stack.AddItem(c);
        }
    }
    // Every selected actor must have compiled geometry. Never silently skip one.
    for(int a=0;a<actors.Num();a++) {
        int found=0;
        for(int k=0;k<order.Num();k++) if(m->Surfs(m->Nodes(order(k)).iSurf).Actor==actors(a)) {found=1;break;}
        if(!found)return 0;
    }
    for(int k=order.Num()-1;k>=0;k--) {
        int i=order(k); FBspNode& n=m->Nodes(i); pure(i)=owned(i);
        if(n.iFront!=INDEX_NONE && !pure(n.iFront))pure(i)=0;
        if(n.iBack!=INDEX_NONE && !pure(n.iBack))pure(i)=0;
        if(n.iPlane!=INDEX_NONE && !pure(n.iPlane))pure(i)=0;
        if(owned(i) && !pure(i)) {
            puts("UCMapKit|selected|refused|Selection shares a BSP branch with unselected geometry");return 0;
        }
    }
    if(pure(0)) {puts("UCMapKit|selected|refused|Selection includes the world root; use Full rebuild");return 0;}
    for(int k=0;k<order.Num();k++) {
        int i=order(k);
        if(pure(i) && (parent(i)==INDEX_NONE || !pure(parent(i))))roots.AddItem(i);
    }
    return roots.Num()>0;
}

static int selectedCommand(const char* line) {
    if (!GEditor->Level || !GEditor->Level->Model) return 0;
    UModel* m = GEditor->Level->Model;
    char path[512];
    if(!strncmp(line,"UC_SELECTED_TRACE ",18)) {
        FVector start,end,extent;
        if(sscanf(line+18,"%f %f %f %f %f %f %f %f %f",&start.X,&start.Y,&start.Z,&end.X,&end.Y,&end.Z,&extent.X,&extent.Y,&extent.Z)!=9)return 0;
        FCheckResult hit(1.f);
        int clear=GEditor->Level->SingleLineCheck(hit,NULL,end,start,TRACE_Level,extent,0);
        if(clear)puts("UCMapKit|selected trace|clear");
        else printf("UCMapKit|selected trace|%.9g %.9g %.9g %.9g %.9g %.9g %.9g\n",hit.Time,hit.Location.X,hit.Location.Y,hit.Location.Z,hit.Normal.X,hit.Normal.Y,hit.Normal.Z);
        return 1;
    }
    if (sscanf(line, "UC_SELECTED_DUMP %511s", path) == 1) {
        FILE* f = fopen(path, "wt"); if (!f) return 0;
        fprintf(f,"M %d %d %d %d %d %d\n",m->Nodes.Num(),m->Surfs.Num(),m->NumZones,m->Leaves.Num(),m->LightMap.Num(),m->LightBits.Num());
        for (int i=0;i<m->Nodes.Num();i++) {
            FBspNode& n=m->Nodes(i); char name[128]="None";
            if (n.iSurf>=0 && n.iSurf<m->Surfs.Num() && m->Surfs(n.iSurf).Actor)
                wtext(m->Surfs(n.iSurf).Actor->GetName(),name,sizeof(name));
            fprintf(f,"N %d %d %d %d %d %s %d %d %d %d %d %d\n",i,n.iFront,n.iBack,n.iPlane,n.iSurf,name,n.NumVertices,n.NodeFlags,n.iZone[0],n.iZone[1],n.iLeaf[0],n.iLeaf[1]);
            fprintf(f,"P %d %.9g %.9g %.9g %.9g %d %d",n.iSurf,n.Plane.X,n.Plane.Y,n.Plane.Z,n.Plane.W,n.NodeFlags,n.NumVertices);
            for(int k=0;k<n.NumVertices;k++) {
                FVector& v=m->Points(m->Verts(n.iVertPool+k).pVertex);
                fprintf(f," %.9g %.9g %.9g",v.X,v.Y,v.Z);
            }
            fprintf(f,"\n");
        }
        for(int i=0;i<m->Surfs.Num();i++) {
            FBspSurf& s=m->Surfs(i); char name[128]="None",tex[512]="None";
            if(s.Actor)wtext(s.Actor->GetName(),name,sizeof(name));
            if(s.Texture)wtext(s.Texture->GetPathName(),tex,sizeof(tex));
            fprintf(f,"S %d %s %s %lu %d %d %d %d",i,name,tex,(unsigned long)s.PolyFlags,s.iBrushPoly,s.iLightMap,s.PanU,s.PanV);
            FVector vectors[4]={m->Points(s.pBase),m->Vectors(s.vNormal),m->Vectors(s.vTextureU),m->Vectors(s.vTextureV)};
            for(int k=0;k<4;k++)fprintf(f," %.9g %.9g %.9g",vectors[k].X,vectors[k].Y,vectors[k].Z);
            fprintf(f,"\n");
        }
        for(int i=0;i<m->NumZones;i++) {
            char name[128]="None"; if(m->Zones[i].ZoneActor)wtext(m->Zones[i].ZoneActor->GetName(),name,sizeof(name));
            fprintf(f,"Z %d %s %I64u %I64u\n",i,name,m->Zones[i].Connectivity,m->Zones[i].Visibility);
        }
        fclose(f); return 1;
    }
    if (!strncmp(line,"UC_SELECTED_REPART ",19)) {
        TArray<INT> roots;
        if(!selectedRoots(m,line+19,roots))return 0;
        printf("UCMapKit|selected|before|%d nodes|%d branches\n",m->Nodes.Num(),roots.Num()); fflush(stdout);
        for(int i=0;i<roots.Num();i++)if(!selectedGraft(m,roots(i)))return 0;
        if(!selectedFinish(m))return 0;
        printf("UCMapKit|selected|after|%d nodes\n",m->Nodes.Num()); fflush(stdout);
        return 1;
    }
    return 0;
}
