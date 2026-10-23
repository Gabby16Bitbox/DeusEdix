// Optional structural or homogeneous-semisolid splitter strategy. Native
// splitting/add-node generates all geometry. NotSolid/Portal and mixed roles
// are refused. Full, zones, coverage and collision gates still apply.
// ENodePlace is forward-declared by public Editor.h; values are the SDK's
// Editor/Src/EditorPrivate.h declaration, with named local constants.
static const ENodePlace REGION_ORDERED_BACK=(ENodePlace)0;
static const ENodePlace REGION_ORDERED_FRONT=(ENodePlace)1;
static const ENodePlace REGION_ORDERED_PLANE=(ENodePlace)2;
static const ENodePlace REGION_ORDERED_ROOT=(ENodePlace)3;
static int regionOrderedVector(const FVector& v) {return _finite(v.X)&&_finite(v.Y)&&_finite(v.Z);}
static int regionOrderedPoly(UModel* m,const FPoly& p) {
    if(!m||p.NumVertices<3||p.NumVertices>FPoly::MAX_VERTICES||p.iLink<0||p.iLink>=m->Surfs.Num()||
       !regionOrderedVector(p.Base)||!regionOrderedVector(p.Normal)||!_finite(p.Normal.SizeSquared())||p.Normal.SizeSquared()<=0)return 0;
    if((p.PolyFlags|m->Surfs(p.iLink).PolyFlags)&(PF_NotSolid|PF_Portal))return 0;
    for(INT j=0;j<p.NumVertices;j++)if(!regionOrderedVector(p.Vertex[j]))return 0;
    return _finite(FPlane(p.Base,p.Normal).W);
}
static int regionOrderedOriginal(UModel* original,INT root,INT outside) {
    if(!original||root<=0||root>=original->Nodes.Num()||(outside!=0&&outside!=1)||
       (original->RootOutside!=0&&original->RootOutside!=1))return 0;
    TArray<INT> seen;seen.AddZeroed(original->Nodes.Num());
    TArray<INT> ids,depths,sides,spaces;
    ids.AddItem(0);depths.AddItem(0);sides.AddItem(REGION_ORDERED_ROOT);spaces.AddItem(original->RootOutside);
    INT found=0;
    while(ids.Num()) {
        INT last=ids.Num()-1,i=ids(last),depth=depths(last),place=sides(last),space=spaces(last);
        ids.Remove(last);depths.Remove(last);sides.Remove(last);spaces.Remove(last);
        if(i<0||i>=original->Nodes.Num()||seen(i)||depth>512)return 0;
        seen(i)=1;const FBspNode& n=original->Nodes(i);
        if(n.iSurf<0||n.iSurf>=original->Surfs.Num()||!regionOrderedVector(n.Plane)||!_finite(n.Plane.W)||
           !_finite(n.Plane.SizeSquared())||n.Plane.SizeSquared()<=0||
           (n.NumVertices!=0&&n.NumVertices<3)||n.NumVertices>FBspNode::MAX_FINAL_VERTICES)return 0;
        if(place==REGION_ORDERED_PLANE&&(n.iFront!=INDEX_NONE||n.iBack!=INDEX_NONE))return 0;
        if(i==root) {
            if(place==REGION_ORDERED_PLANE||space!=outside||!n.IsCsg()||
               (original->Surfs(n.iSurf).PolyFlags&(PF_NotSolid|PF_Portal)))return 0;
            found++;
        }
        INT links[3]={n.iBack,n.iFront,n.iPlane};
        for(INT k=0;k<3;k++) {
            if(links[k]==INDEX_NONE)continue;
            if(links[k]<0||links[k]>=original->Nodes.Num())return 0;
            ids.AddItem(links[k]);depths.AddItem(depth+1);sides.AddItem(k);
            spaces.AddItem(k==REGION_ORDERED_PLANE?space:n.ChildOutside(k,space));
        }
    }
    return found==1;
}
static int regionOrderedBranch(UModel* m,TArray<FPoly>& input,INT parent,ENodePlace place,INT depth,INT& budget,INT& work,UModel* original,INT hint) {
    if(!input.Num())return 1;
    if(!m||!original||depth>128||input.Num()>65536||budget<=0)return 0;
    for(INT i=0;i<input.Num();i++) {
        if(!regionOrderedPoly(m,input(i)))return 0;
        // SplitWithPlane can add a corner: never call it with a full FPoly.
        // SplitInHalf is the SDK path for approaching MAX_VERTICES.
        if(input(i).NumVertices>=FPoly::VERTEX_THRESHOLD) {
            if(input.Num()>=65536)return 0;
            FPoly extra;input(i).SplitInHalf(&extra);
            if(!regionOrderedPoly(m,input(i))||!regionOrderedPoly(m,extra))return 0;
            input.AddItem(extra);
        }
    }
    INT chosen=0,matched=0;
    if(hint!=INDEX_NONE) {
        if(hint<0||hint>=original->Nodes.Num())return 0;
        const FBspNode& old=original->Nodes(hint);
        if(old.iSurf<0||old.iSurf>=original->Surfs.Num())return 0;
        const FBspSurf& oldSurf=original->Surfs(old.iSurf);
        if(old.IsCsg()&&!(oldSurf.PolyFlags&(PF_NotSolid|PF_Portal))) {
            for(INT i=0;i<input.Num();i++) {
                FPoly& p=input(i);FBspSurf& surf=m->Surfs(p.iLink);
                // Use the same FPoly Base/Normal plane as bspAddNode. Never
                // invent a plane from a vertex, nor overwrite geometry to match.
                FPlane plane(p.Base,p.Normal);
                if(surf.Actor==oldSurf.Actor&&surf.iBrushPoly==oldSurf.iBrushPoly&&
                   plane.X==old.Plane.X&&plane.Y==old.Plane.Y&&plane.Z==old.Plane.Z&&plane.W==old.Plane.W) {
                    chosen=i;matched=1;break;
                }
            }
        }
    }
    // Private diagnostic: choose the lowest-axis opposing interface first.
    // Keep the old hint for both clipped sides if this promotes another plane.
    if(input.Num()&&(input(0).PolyFlags&PF_Semisolid)) {
        INT bestAxis=4,best=-1;
        for(INT i=0;i<input.Num();i++)for(INT j=i+1;j<input.Num();j++) {
            if(--work<0)return 0;
            FPlane a(input(i).Base,input(i).Normal),b(input(j).Base,input(j).Normal);
            if(a.X==-b.X&&a.Y==-b.Y&&a.Z==-b.Z&&a.W==-b.W) {
                INT axis=a.X!=0?0:(a.Y!=0?1:2);
                if(axis<bestAxis) {
                    bestAxis=axis;
                    INT positive=a.X>0||(a.X==0&&(a.Y>0||(a.Y==0&&a.Z>0)));
                    best=positive?i:j;
                }
            }
        }
        if(best>=0&&best!=chosen){chosen=best;matched=0;}
    }
    FPoly splitter=input(chosen);
    INT head=GEditor->UEditorEngine::bspAddNode(m,parent,place,0,&splitter);
    if(head<0||head>=m->Nodes.Num()||!m->Nodes(head).IsCsg())return 0;
    budget--;INT tail=head;TArray<FPoly> front,back;
    for(INT i=0;i<input.Num();i++) {
        if(i==chosen)continue;
        if(--work<0||front.Num()+back.Num()>65536)return 0;
        FPoly a,b,p=input(i);INT split=p.SplitWithPlane(splitter.Base,splitter.Normal,&a,&b,0);
        if(split==SP_Coplanar) {
            if(budget<=0)return 0;
            // Opposite solid normals are legal coplanars; retain them. Only
            // the head supplies ChildOutside, as in the native representation.
            tail=GEditor->UEditorEngine::bspAddNode(m,tail,REGION_ORDERED_PLANE,0,&p);budget--;
            if(tail<0||tail>=m->Nodes.Num()||!m->Nodes(tail).IsCsg())return 0;
        } else if(split==SP_Front)front.AddItem(p);
        else if(split==SP_Back)back.AddItem(p);
        else if(split==SP_Split) {
            if(!regionOrderedPoly(m,a)||!regionOrderedPoly(m,b))return 0;
            if(a.NumVertices>=FPoly::VERTEX_THRESHOLD){FPoly extra;a.SplitInHalf(&extra);if(!regionOrderedPoly(m,extra))return 0;front.AddItem(extra);}
            if(b.NumVertices>=FPoly::VERTEX_THRESHOLD){FPoly extra;b.SplitInHalf(&extra);if(!regionOrderedPoly(m,extra))return 0;back.AddItem(extra);}
            if(!regionOrderedPoly(m,a)||!regionOrderedPoly(m,b))return 0;
            front.AddItem(a);back.AddItem(b);
        } else return 0;
    }
    INT frontHint=matched?original->Nodes(hint).iFront:hint,backHint=matched?original->Nodes(hint).iBack:hint;
    return regionOrderedBranch(m,front,head,REGION_ORDERED_FRONT,depth+1,budget,work,original,frontHint)&&
           regionOrderedBranch(m,back,head,REGION_ORDERED_BACK,depth+1,budget,work,original,backHint);
}
static int regionOrderedBuild(UModel* m,UModel* original,INT oldRoot) {
    if(!m||!m->Polys||!regionOrderedOriginal(original,oldRoot,m->RootOutside))return 0;
    TArray<FPoly> polys=m->Polys->Element;INT originalInputCount=polys.Num(),budget=65536,work=1000000;
    // Private experimental homogeneous detail mode. No surface/node flag changes.
    DWORD detail=original->Surfs(original->Nodes(oldRoot).iSurf).PolyFlags&PF_Semisolid;
    for(INT j=0;j<polys.Num();j++) {
        if((polys(j).PolyFlags&PF_Semisolid)!=detail||polys(j).iLink<0||polys(j).iLink>=m->Surfs.Num()||
           (m->Surfs(polys(j).iLink).PolyFlags&PF_Semisolid)!=detail)return 0;
    }
    if(!polys.Num()||polys.Num()>65536)return 0;
    for(INT i=0;i<polys.Num();i++)if(!regionOrderedPoly(m,polys(i)))return 0;
    m->Nodes.Empty();m->Verts.Empty();m->Bounds.Empty();m->LeafHulls.Empty();m->Leaves.Empty();
    if(!regionOrderedBranch(m,polys,INDEX_NONE,REGION_ORDERED_ROOT,0,budget,work,original,oldRoot))return 0;
    GEditor->UEditorEngine::bspRefresh(m,1);GEditor->UEditorEngine::bspBuildBounds(m);
    printf("UCMapKit|ordered builder|root %d|%d input|%d nodes\n",oldRoot,originalInputCount,m->Nodes.Num());return 1;
}

