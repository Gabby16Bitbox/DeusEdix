// Isolated experiment: replay contributing source brushes, then splice only a
// clipped BSP cell. This never calls the world's csgRebuild or bspRepartition.
static UModel* regionScratch=NULL;
#include "region_original_uv.h"
#include "region_uv_normal_tests.h"
#include "region_original_uv_tests.h"
#include "region_retained_hulls.h"
#include "region_retained_hulls_tests.h"
#include "region_retained_masks_tests.h"

static int regionBuild(TArray<ABrush*>& brushes) {
    UModel* world=GEditor->Level->Model;
    if(regionScratch)regionScratch->RemoveFromRoot();
    regionScratch=ConstructObject<UModel>(UModel::StaticClass());
    regionScratch->AddToRoot();
    regionScratch->Polys=ConstructObject<UPolys>(UPolys::StaticClass(),regionScratch);
    regionScratch->RootOutside=world->RootOutside;
    // The native compiler welds nearly equal normals against the model pool.
    // Start with the world's canonical vectors so local and retained planes
    // classify exact-edge collision probes consistently.
    regionScratch->Vectors=world->Vectors;
    __try {
        GEditor->Level->Model=regionScratch;
        for(int pass=0;pass<2;pass++) {
            for(int i=0;i<brushes.Num();i++) {
                ABrush* b=brushes(i);
                int detail=(b->PolyFlags & (PF_Semisolid|PF_NotSolid)) && b->CsgOper==CSG_Add;
                if(detail!=pass)continue;
                GEditor->UEditorEngine::bspBrushCSG(b,regionScratch,b->PolyFlags,(ECsgOper)b->CsgOper,0);
            }
            if(!pass && regionScratch->Nodes.Num())
                GEditor->UEditorEngine::bspRepartition(regionScratch,0,0);
        }
        GEditor->UEditorEngine::bspRefresh(regionScratch,1);
    } __finally { GEditor->Level->Model=world; }
    printf("UCMapKit|region scratch|%d brushes|%d nodes\n",brushes.Num(),regionScratch->Nodes.Num());
    return regionScratch->Nodes.Num()>0;
}

static int regionSurface(UModel* m,int index) {
    UModel* q=regionScratch; FBspSurf b=q->Surfs(index);
    for(int i=0;i<m->Surfs.Num();i++) {
        FBspSurf& a=m->Surfs(i);
        if(a.Actor==b.Actor && a.iBrushPoly==b.iBrushPoly && a.Texture==b.Texture &&
           a.PolyFlags==b.PolyFlags && a.PanU==b.PanU && a.PanV==b.PanV &&
           (m->Points(a.pBase)-q->Points(b.pBase)).SizeSquared()<.000001f &&
           (m->Vectors(a.vNormal)-q->Vectors(b.vNormal)).SizeSquared()<.000001f &&
           (m->Vectors(a.vTextureU)-q->Vectors(b.vTextureU)).SizeSquared()<.000001f &&
           (m->Vectors(a.vTextureV)-q->Vectors(b.vTextureV)).SizeSquared()<.000001f) return i;
    }
    b.pBase=m->Points.AddItem(q->Points(b.pBase));
    b.vNormal=m->Vectors.AddItem(q->Vectors(b.vNormal));
    b.vTextureU=m->Vectors.AddItem(q->Vectors(b.vTextureU));
    b.vTextureV=m->Vectors.AddItem(q->Vectors(b.vTextureV));
    b.iLightMap=INDEX_NONE;
    int added=m->Surfs.Num();new(m->Surfs) FBspSurf(b);return added;
}

static int regionGraft(const char* path,int deferFinish=0) {
    if(!regionScratch)return 0;
    FILE* f=fopen(path,"rt");if(!f)return 0;
    int root,count,certifiedZone;
    if(fscanf(f,"%d %d %d",&root,&count,&certifiedZone)!=3 || count<=0 || count>65536){fclose(f);return 0;}
    UModel* m=GEditor->Level->Model;
    if(root<=0 || root>=m->Nodes.Num()){fclose(f);return 0;}
    BYTE permitted[64]={0};TArray<INT> leafZones,backZones,frontZones;TArray<QWORD> masks;
    if(certifiedZone==-2) {
        int zones;
        if(fscanf(f,"%d",&zones)!=1 || zones<1 || zones>=64){fclose(f);return 0;}
        for(int z=0;z<zones;z++) {
            int value;if(fscanf(f,"%d",&value)!=1 || value<=0 || value>=m->NumZones || permitted[value] ||
               m->Zones[value].Visibility!=~QWORD(0)){fclose(f);return 0;}
            permitted[value]=1;
        }
        int leaves;
        if(fscanf(f,"%d",&leaves)!=1 || leaves!=regionScratch->Leaves.Num()){fclose(f);return 0;}
        leafZones.Add(leaves);
        for(int i=0;i<leaves;i++) {
            int index,z;
            if(fscanf(f,"%d %d",&index,&z)!=2 || index!=i || z<=0 || z>=64 || !permitted[z]){fclose(f);return 0;}
            leafZones(i)=z;
        }
        int nodes;
        if(fscanf(f,"%d",&nodes)!=1 || nodes!=regionScratch->Nodes.Num()){fclose(f);return 0;}
        backZones.Add(nodes);frontZones.Add(nodes);masks.AddZeroed(nodes);
        for(int i=0;i<nodes;i++) {
            int index,back,front;
            if(fscanf(f,"%d %d %d",&index,&back,&front)!=3 || index!=i || back<0 || back>=64 || front<0 || front>=64 ||
               (back && !permitted[back]) || (front && !permitted[front])){fclose(f);return 0;}
            backZones(i)=back;frontZones(i)=front;
        }
        // bspBuild allocates descendants after their parent. Fail closed if a
        // future compiler violates that ordering; do not guess descendant masks.
        for(int i=nodes-1;i>=0;i--) {
            FBspNode& n=regionScratch->Nodes(i);
            // Zone zero is solid/unclassified, not a visible-zone contributor.
            QWORD mask=0;
            if(backZones(i))mask|=QWORD(1)<<backZones(i);
            if(frontZones(i))mask|=QWORD(1)<<frontZones(i);
            int children[3]={n.iFront,n.iBack,n.iPlane};
            for(int k=0;k<3;k++)if(children[k]>=0) {
                if(children[k]<=i || children[k]>=nodes){fclose(f);return 0;}
                mask|=masks(children[k]);
            }
            for(int side=0;side<2;side++)if(n.iLeaf[side]>=0) {
                if(n.iLeaf[side]>=leaves){fclose(f);return 0;}
                mask|=QWORD(1)<<leafZones(n.iLeaf[side]);
            }
            masks(i)=mask;
        }
    } else {
        if(certifiedZone<=0 || certifiedZone>=m->NumZones ||
           m->Zones[certifiedZone].Visibility!=~QWORD(0)){fclose(f);return 0;}
        permitted[certifiedZone]=1;
    }
    TArray<INT> old,stack,map,surfaceMap;
    stack.AddItem(root);
    while(stack.Num()) {
        int i=stack(stack.Num()-1);stack.Remove(stack.Num()-1);
        if(i<0 || i>=m->Nodes.Num() || old.FindItemIndex(i)!=INDEX_NONE){fclose(f);return 0;}
        old.AddItem(i);FBspNode& n=m->Nodes(i);
        if(n.iFront>=0)stack.AddItem(n.iFront);if(n.iBack>=0)stack.AddItem(n.iBack);if(n.iPlane>=0)stack.AddItem(n.iPlane);
    }
    // The Python exact-volume certificate must establish a unique original
    // zone anchor for EVERY replacement empty convex leaf. Recheck identities
    // here rather than accepting an arbitrary zone number from a recipe.
    for(int i=0;i<old.Num();i++) {
        FBspNode& n=m->Nodes(old(i));
        if(m->Surfs(n.iSurf).PolyFlags&PF_Portal){fclose(f);return 0;}
        for(int side=0;side<2;side++) {
            if(n.iZone[side]>=64 || (n.iZone[side] && !permitted[n.iZone[side]])){fclose(f);return 0;}
            if(n.iLeaf[side]>=0 && (n.iLeaf[side]>=m->Leaves.Num() || m->Leaves(n.iLeaf[side]).iZone<=0 ||
               m->Leaves(n.iLeaf[side]).iZone>=64 || !permitted[m->Leaves(n.iLeaf[side]).iZone])){fclose(f);return 0;}
        }
    }
    if(!regionHullsBegin(m,root)){fclose(f);return 0;}
    int leafBase=m->Leaves.Num(),lightBase=m->Lights.Num();
    for(int i=0;i<regionScratch->Lights.Num();i++)m->Lights.AddItem(regionScratch->Lights(i));
    for(int i=0;i<regionScratch->Leaves.Num();i++) {
        FLeaf l=regionScratch->Leaves(i);
        if(l.iZone<=0){fclose(f);return 0;}
        l.iZone=certifiedZone==-2?leafZones(i):certifiedZone;l.VisibleZones=m->Zones[l.iZone].Visibility;
        if(l.iPermeating>=0)l.iPermeating+=lightBase;
        if(l.iVolumetric>=0)l.iVolumetric+=lightBase;
        m->Leaves.AddItem(l);
    }
    for(int i=0;i<count;i++)map.AddItem(i<old.Num()?old(i):m->Nodes.AddZeroed());
    surfaceMap.Add(regionScratch->Surfs.Num());
    for(int i=0;i<surfaceMap.Num();i++)surfaceMap(i)=INDEX_NONE;
    for(int i=0;i<count;i++) {
        int source,front,back,plane,vertices;
        if(fscanf(f,"%d %d %d %d %d",&source,&front,&back,&plane,&vertices)!=5 ||
           source<0 || source>=regionScratch->Nodes.Num() || vertices<0 || (vertices>0 && vertices<3) || vertices>FBspNode::MAX_FINAL_VERTICES ||
           front<-1 || front>=count || back<-1 || back>=count || plane<-1 || plane>=count) {fclose(f);return 0;}
        FBspNode n=regionScratch->Nodes(source);
        if(n.iSurf<0 || n.iSurf>=surfaceMap.Num()){fclose(f);return 0;}
        if(surfaceMap(n.iSurf)==INDEX_NONE)surfaceMap(n.iSurf)=regionSurface(m,n.iSurf);
        n.iSurf=surfaceMap(n.iSurf);
        // Geometry edits can change shadow coverage on this surface. Never attach
        // its previous baked map to a differently shaped/revealed polygon.
        m->Surfs(n.iSurf).iLightMap=INDEX_NONE;
        n.iFront=front<0?-1:map(front);n.iBack=back<0?-1:map(back);n.iPlane=plane<0?-1:map(plane);
        n.iCollisionBound=n.iRenderBound=INDEX_NONE;
        for(int side=0;side<2;side++) {
            if(certifiedZone==-2)n.iZone[side]=side?frontZones(source):backZones(source);
            else if(n.iZone[side])n.iZone[side]=certifiedZone;
            if(n.iLeaf[side]>=0) {
                if(n.iLeaf[side]>=regionScratch->Leaves.Num()){fclose(f);return 0;}
                n.iLeaf[side]+=leafBase;
            }
        }
        n.ZoneMask=certifiedZone==-2?masks(source):((n.ZoneMask&1) | ((n.ZoneMask&~QWORD(1)) ? (QWORD(1)<<certifiedZone) : 0));
        n.iVertPool=m->Verts.Num();n.NumVertices=vertices;
        for(int j=0;j<vertices;j++) {
            FVector v;if(fscanf(f,"%f %f %f",&v.X,&v.Y,&v.Z)!=3 || !_finite(v.X)||!_finite(v.Y)||!_finite(v.Z)){fclose(f);return 0;}
            FVert fv;fv.pVertex=m->Points.AddItem(v);fv.iSide=INDEX_NONE;m->Verts.AddItem(fv);
        }
        m->Nodes(map(i))=n;
    }
    fclose(f);
    for(int i=count;i<old.Num();i++) {FBspNode& n=m->Nodes(old(i));n.NumVertices=0;n.iFront=n.iBack=n.iPlane=INDEX_NONE;}
    printf("UCMapKit|region graft|%d old|%d new\n",old.Num(),count);
    // TestVisibility already ran on the replacement model, where it cannot
    // re-portalize or alter the retained world. Compact only unused storage,
    // then rebuild native bounds/hulls for the now complete tree.
    if(!deferFinish) {
        GEditor->bspRefresh(m,1);
        GEditor->bspBuildBounds(m);
        if(!regionHullsFinish(m))return 0;
        for(int i=0;i<GEditor->Level->Actors.Num();i++)if(GEditor->Level->Actors(i))
            GEditor->Level->SetActorZone(GEditor->Level->Actors(i),0,1);
    }
    printf("UCMapKit|region zone transfer|%d|%d new leaves|%d existing leaves\n",certifiedZone,regionScratch->Leaves.Num(),leafBase);
    return 1;
}

static int regionDump(const char* path) {
    if(!regionScratch)return 0;UModel* world=GEditor->Level->Model;int result=0;char cmd[600];
    sprintf(cmd,"UC_SELECTED_DUMP %s",path);
    __try {GEditor->Level->Model=regionScratch;result=selectedCommand(cmd);}
    __finally {GEditor->Level->Model=world;}
    return result;
}

#include "region_precise_junctions.h"
#include "region_ordered_build.h"
#include "region_ordered_tests.h"
#include "region_ordered_detail_tests.h"
#include "region_clip_planes.h"
#include "region_clip_plane_tests.h"

static int regionClipCompile(UModel* clipped,INT oldRoot=INDEX_NONE,const TArray<FRegionClipPlaneInput>* planes=NULL) {
    UModel* world=GEditor->Level->Model;
    __try {
        GEditor->Level->Model=clipped;
        if(oldRoot!=INDEX_NONE){if(!regionOrderedBuild(clipped,world,oldRoot))return 0;}
        else GEditor->UEditorEngine::bspBuild(clipped,(EBspOptimization)2,15,0,0);
        selectedCommand("UC_SELECTED_DUMP ..\\Output\\clip-built.tree");
        // Match native BSP REBUILD's shared-edge/T-junction repair, restricted
        // to this replacement model. The retained world is never optimized.
        if(!regionOptimizePrecise(clipped))return 0;
        // Local-only leaf/light construction. The later exact-volume gate
        // supplies the old-world zone identity, never this temporary number.
        GEditor->TestVisibility(GEditor->Level,clipped,0,0);
        if(!regionUVRestore(clipped,world))return 0;
        if(planes&&!regionClipPlaneRestore(clipped,*planes))return 0;
    } __finally {GEditor->Level->Model=world;}
    return clipped->Nodes.Num()>0;
}

static int regionClip(const char* path,INT oldRoot=INDEX_NONE,int nativePlanes=0) {
    if(!regionScratch)return 0;FILE* f=fopen(path,"rt");if(!f)return 0;
    int outside,count;
    if(fscanf(f,"%d %d",&outside,&count)!=2 || count<1 || count>65536){fclose(f);return 0;}
    UModel* clipped=ConstructObject<UModel>(UModel::StaticClass());clipped->AddToRoot();
    clipped->Polys=ConstructObject<UPolys>(UPolys::StaticClass(),clipped);
    clipped->RootOutside=outside;clipped->Surfs=regionScratch->Surfs;
    clipped->Points=regionScratch->Points;clipped->Vectors=regionScratch->Vectors;
    TArray<FRegionClipPlaneInput> planeInputs;INT planeWork=4000000;
    for(int i=0;i<count;i++) {
        int source,vertices;
        if(fscanf(f,"%d %d",&source,&vertices)!=2 || source<0 || source>=regionScratch->Nodes.Num() || vertices<3 || vertices>FPoly::MAX_VERTICES){fclose(f);return 0;}
        FPoly p;GEditor->UEditorEngine::bspNodeToFPoly(regionScratch,source,&p);
        if(nativePlanes&&!regionClipPlanePrepare(regionScratch,source,p,planeInputs,planeWork)){fclose(f);printf("UCMapKit|clip plane refused|source %d\n",source);return 0;}
        if(nativePlanes&&planeInputs(planeInputs.Num()-1).Changed) {
            FBspSurf& geometric=clipped->Surfs(regionScratch->Nodes(source).iSurf);
            geometric.pBase=clipped->Points.AddItem(p.Base);
        }
        p.iLink=regionScratch->Nodes(source).iSurf;p.NumVertices=vertices;
        for(int j=0;j<vertices;j++)if(fscanf(f,"%f %f %f",&p.Vertex[j].X,&p.Vertex[j].Y,&p.Vertex[j].Z)!=3){fclose(f);return 0;}
        clipped->Polys->Element.AddItem(p);
    }
    fclose(f);
    if(!regionClipCompile(clipped,oldRoot,nativePlanes?&planeInputs:NULL))return 0;
    regionScratch->RemoveFromRoot();regionScratch=clipped;
    printf("UCMapKit|region clipped|%d polys|%d nodes\n",count,clipped->Nodes.Num());return 1;
}
#include "region_junction_tests.h"
#include "region_unique_junction_tests.h"
#include "region_full_hook.h"
static int regionCommand(const char* line) {
    if(!GEditor->Level || !GEditor->Level->Model)return 0;
    char path[512],name[128];
    if(!strcmp(line,"UC_REGION_UV_NORMAL_TESTS"))return regionUVNormalTests();
    if(!strcmp(line,"UC_REGION_ORDERED_TESTS"))return regionOrderedTests();
    if(!strcmp(line,"UC_REGION_ORDERED_DETAIL_TESTS"))return regionOrderedDetailTests();
    if(sscanf(line,"UC_REGION_CLIP_PLANES %511s",path)==1)return regionClip(path,INDEX_NONE,1);
    if(!strcmp(line,"UC_REGION_CLIP_PLANE_TESTS"))return regionClipPlaneTests();
    INT orderRoot;
    if(sscanf(line,"UC_REGION_CLIP_ORDERED %d %511s",&orderRoot,path)==2)return regionClip(path,orderRoot);
    if(!strcmp(line,"UC_REGION_MASK_TESTS"))return regionMaskNativeTests();
    if(!strcmp(line,"UC_REGION_UNIQUE_JUNCTION_TESTS"))return regionUniqueJunctionSelfTest();
    if(!strcmp(line,"UC_REGION_HULL_TESTS"))return regionHullNativeTests();
    if(!strcmp(line,"UC_REGION_DIAG_MAP_PRECISE"))return regionFullMapRebuild(1);
    if(!strcmp(line,"UC_REGION_DIAG_MAP_PASSTHROUGH"))return regionFullMapRebuild(0);
    if(!strcmp(line,"UC_REGION_DIAG_UV_RESTORE"))return regionUVRestore(GEditor->Level->Model,GEditor->Level->Model);
    if(!strcmp(line,"UC_REGION_DIAG_BSP_PRECISE") || !strcmp(line,"UC_REGION_DIAG_BSP_STOCK")) {
        // Exact BSP REBUILD OPTIMAL BALANCE=15 sequence in the installed
        // Editor.dll Exec (1027f3c3..1027f5c1), with only OptGeom substituted.
        // MAP REBUILD is dispatched separately through the real engine Exec.
        UModel* m=GEditor->Level->Model;
        GEditor->UEditorEngine::bspBuildFPolys(m,1,0);
        GEditor->UEditorEngine::bspMergeCoplanars(m,0,0);
        GEditor->UEditorEngine::bspBuild(m,(EBspOptimization)2,15,0,0);
        // ZONES and OPTGEOM are absent from the actual baseline command.
        m->Polys->Element.Empty();
        if(!finishWorld())return 0;
        if(!strcmp(line,"UC_REGION_DIAG_BSP_PRECISE") && !regionUVRestore(m,m))return 0;
        printf("UCMapKit|stock-sequence Full|%d nodes\n",m->Nodes.Num());
        return 1;
    }
    if(!strcmp(line,"UC_REGION_JUNCTION_TESTS"))return regionJunctionSelfTest();
    // Laboratory reference only. This replays ALL sources, including portals;
    // it is still a Full rebuild and is never a local publication command.
    if(!strcmp(line,"UC_REGION_DIAG_ALL")) {
        TArray<ABrush*> brushes;
        for(int i=0;i<GEditor->Level->Actors.Num();i++) {
            AActor* a=GEditor->Level->Actors(i);
            if(!a || !a->IsStaticBrush() || a==GEditor->Level->Brush())continue;
            ABrush* b=(ABrush*)a;
            if(!b->Brush || !b->Brush->Polys || (b->CsgOper!=CSG_Add && b->CsgOper!=CSG_Subtract))return 0;
            brushes.AddItem(b);
        }
        return brushes.Num() && regionBuild(brushes);
    }
    if(!strcmp(line,"UC_REGION_DIAG_ADOPT")) {
        if(!regionScratch || !regionScratch->Nodes.Num())return 0;
        GEditor->Level->Model=regionScratch;
        GEditor->bspBuildBounds(regionScratch);
        for(int i=0;i<GEditor->Level->Actors.Num();i++)if(GEditor->Level->Actors(i))
            GEditor->Level->SetActorZone(GEditor->Level->Actors(i),0,1);
        printf("UCMapKit|diagnostic full adopted|%d nodes\n",regionScratch->Nodes.Num());
        return 1;
    }
    if(!strcmp(line,"UC_REGION_UV_SNAPSHOT"))return regionUVSnapshot();
    if(!strcmp(line,"UC_REGION_UV_TESTS"))return regionUVSelfTest();
    if(sscanf(line,"UC_REGION_GRAFT_DEFER %511s",path)==1)return regionGraft(path,1);
    if(!strcmp(line,"UC_REGION_FINISH")) {
        UModel* m=GEditor->Level->Model;
        GEditor->bspRefresh(m,1);GEditor->bspBuildBounds(m);
        if(!regionHullsFinish(m))return 0;
        for(int i=0;i<GEditor->Level->Actors.Num();i++)if(GEditor->Level->Actors(i))
            GEditor->Level->SetActorZone(GEditor->Level->Actors(i),0,1);
        printf("UCMapKit|region multi finish|complete\n");return 1;
    }
    if(!strcmp(line,"UC_REGION_PREPARE_PRESERVE")) {
        return regionScratch && regionUVRestore(regionScratch,GEditor->Level->Model);
    }
    if(sscanf(line,"UC_REGION_CLIP %511s",path)==1)return regionClip(path);
    if(!strncmp(line,"UC_REGION_POINT ",16)) {
        FVector p,e;if(sscanf(line+16,"%f %f %f %f %f %f",&p.X,&p.Y,&p.Z,&e.X,&e.Y,&e.Z)!=6)return 0;
        FCheckResult h(1.f);UModel* m=GEditor->Level->Model;
        int clear=m->PointCheck(h,NULL,p,e,0);
        FPointRegion region=m->PointRegion(GEditor->Level->GetLevelInfo(),p);
        printf("UCMapKit|region point|%d %d\n",clear,region.iLeaf>=0);return 1;
    }
    if(sscanf(line,"UC_REGION_SOURCES %511s",path)==1) {
        FILE* f=fopen(path,"wt");if(!f)return 0;
        fprintf(f,"ROOT %d\n",GEditor->Level->Model->RootOutside);
        for(int i=0;i<GEditor->Level->Actors.Num();i++) {
            AActor* a=GEditor->Level->Actors(i);
            if(!a || !a->IsStaticBrush() || a==GEditor->Level->Brush() || !a->Brush || !a->Brush->Polys)continue;
            ABrush* b=(ABrush*)a;wtext(b->GetName(),name,sizeof(name));
            fprintf(f,"B %s %d %lu %.9g %.9g %.9g %d %d %d\n",name,(int)b->CsgOper,(unsigned long)b->PolyFlags,b->Location.X,b->Location.Y,b->Location.Z,b->Rotation.Pitch,b->Rotation.Yaw,b->Rotation.Roll);
            for(int j=0;j<b->Brush->Polys->Element.Num();j++) {
                FPoly p=surfaceWorld(b,j);fprintf(f,"F %d",p.NumVertices);
                for(int k=0;k<p.NumVertices;k++)fprintf(f," %.9g %.9g %.9g",p.Vertex[k].X,p.Vertex[k].Y,p.Vertex[k].Z);
                fprintf(f,"\n");
                fprintf(f,"N %d %.9g %.9g %.9g\n",j,p.Normal.X,p.Normal.Y,p.Normal.Z);
            }
        }
        fclose(f);return 1;
    }
    if(sscanf(line,"UC_REGION_BUILD %511s",path)==1) {
        FILE* f=fopen(path,"rt");if(!f)return 0;TArray<ABrush*> brushes;
        while(fscanf(f,"%127s",name)==1) {
            AActor* a=findActor(name);
            if(!a || !a->IsStaticBrush() || a==GEditor->Level->Brush()){fclose(f);return 0;}
            ABrush* b=(ABrush*)a;
            if(!b->Brush || !b->Brush->Polys || (b->PolyFlags & PF_Portal) || (b->CsgOper!=CSG_Add && b->CsgOper!=CSG_Subtract)){fclose(f);return 0;}
            brushes.AddItem(b);
        }
        fclose(f);return brushes.Num() && regionBuild(brushes);
    }
    if(sscanf(line,"UC_REGION_DUMP %511s",path)==1) {
        return regionDump(path);
    }
    if(sscanf(line,"UC_REGION_GRAFT %511s",path)==1)return regionGraft(path);
    float sx,sy,sz;
    if(sscanf(line,"UC_REGION_SCALE %127s %f %f %f",name,&sx,&sy,&sz)==4) {
        AActor* a=findActor(name);if(!a||!a->IsStaticBrush()||!a->Brush||!a->Brush->Polys ||
           !_finite(sx)||!_finite(sy)||!_finite(sz)||sx<.05f||sy<.05f||sz<.05f||sx>20||sy>20||sz>20)return 0;
        // Local-space scale, preserving UV density. Brush validation recomputes planes.
        for(int i=0;i<a->Brush->Polys->Element.Num();i++) {
            FPoly& p=a->Brush->Polys->Element(i);
            for(int k=0;k<p.NumVertices;k++){p.Vertex[k].X*=sx;p.Vertex[k].Y*=sy;p.Vertex[k].Z*=sz;}
            p.Base.X*=sx;p.Base.Y*=sy;p.Base.Z*=sz;p.Normal=FVector(0,0,0);if(p.CalcNormal())return 0;
        }
        a->Brush->BuildBound();return 1;
    }
    return 0;
}
