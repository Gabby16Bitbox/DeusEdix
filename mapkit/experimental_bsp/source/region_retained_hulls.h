// Preserve collision hulls of structurally unchanged BSP branches. Native
// bspBuildBounds recomputes their AABB floats even without a geometry edit.
// This state is private to one local transaction; malformed input fails closed.
struct FRegionHullSurface {
    ABrush* Actor; UTexture* Texture; INT Poly; DWORD Flags;
};
static UModel* regionHullModel=NULL;
static TArray<FBspNode> regionHullNodes;
static TArray<FVert> regionHullVerts;
static TArray<FVector> regionHullPoints;
static TArray<FRegionHullSurface> regionHullSurfs;
static TArray<INT> regionHullWords,regionHullRoots,regionHullLeafZones;
static INT regionHullRootOutside=0;

static void regionHullsReset() {
    regionHullModel=NULL;regionHullNodes.Empty();regionHullVerts.Empty();
    regionHullPoints.Empty();regionHullSurfs.Empty();regionHullWords.Empty();regionHullRoots.Empty();regionHullLeafZones.Empty();
}
static int regionHullSameNode(UModel* m,INT oldIndex,INT newIndex) {
    if(oldIndex<0||oldIndex>=regionHullNodes.Num()||newIndex<0||newIndex>=m->Nodes.Num())return 0;
    FBspNode& a=regionHullNodes(oldIndex);FBspNode& b=m->Nodes(newIndex);
    if(appMemcmp(&a.Plane,&b.Plane,sizeof(FPlane))||a.NodeFlags!=b.NodeFlags||a.NumVertices!=b.NumVertices||
       a.iSurf<0||a.iSurf>=regionHullSurfs.Num()||b.iSurf<0||b.iSurf>=m->Surfs.Num())return 0;
    FRegionHullSurface& x=regionHullSurfs(a.iSurf);FBspSurf& y=m->Surfs(b.iSurf);
    if(x.Actor!=y.Actor||x.Texture!=y.Texture||x.Poly!=y.iBrushPoly||x.Flags!=y.PolyFlags)return 0;
    for(int k=0;k<a.NumVertices;k++) {
        if(a.iVertPool+k<0||a.iVertPool+k>=regionHullVerts.Num()||b.iVertPool+k<0||b.iVertPool+k>=m->Verts.Num())return 0;
        INT i=regionHullVerts(a.iVertPool+k).pVertex,j=m->Verts(b.iVertPool+k).pVertex;
        if(i<0||i>=regionHullPoints.Num()||j<0||j>=m->Points.Num()||
           appMemcmp(&regionHullPoints(i),&m->Points(j),sizeof(FVector)))return 0;
    }
    return 1;
}
static int regionHullsBeginImpl(UModel* m,INT root) {
    if(!m||root<=0||root>=m->Nodes.Num())return 0;
    if(!regionHullModel) {
        regionHullModel=m;regionHullNodes=m->Nodes;regionHullVerts=m->Verts;
        regionHullPoints=m->Points;regionHullWords=m->LeafHulls;regionHullRootOutside=m->RootOutside;
        for(INT i=0;i<m->Leaves.Num();i++)regionHullLeafZones.AddItem(m->Leaves(i).iZone);
        for(INT i=0;i<m->Surfs.Num();i++) {
            FRegionHullSurface s;FBspSurf& a=m->Surfs(i);
            s.Actor=a.Actor;s.Texture=a.Texture;s.Poly=a.iBrushPoly;s.Flags=a.PolyFlags;
            regionHullSurfs.AddItem(s);
        }
    }
    if(regionHullModel!=m||m->RootOutside!=regionHullRootOutside||!regionHullSameNode(m,root,root))return 0;
    // Original indices remain valid until the single final bspRefresh. Roots
    // must be disjoint; otherwise a second graft could claim a modified node.
    TArray<INT> stack,seen;seen.AddZeroed(regionHullNodes.Num());stack.AddItem(0);
    while(stack.Num()) {
        INT i=stack(stack.Num()-1);stack.Remove(stack.Num()-1);
        if(i<0||i>=regionHullNodes.Num()||seen(i))return 0;
        seen(i)=1;
        if(regionHullRoots.FindItemIndex(i)!=INDEX_NONE) {
            TArray<INT> sub,subSeen;subSeen.AddZeroed(regionHullNodes.Num());sub.AddItem(i);
            while(sub.Num()) {
                INT j=sub(sub.Num()-1);sub.Remove(sub.Num()-1);
                if(j<0||j>=regionHullNodes.Num()||subSeen(j))return 0;subSeen(j)=1;
                if(j==root)return 0;
                FBspNode& n=regionHullNodes(j);if(n.iFront>=0)sub.AddItem(n.iFront);if(n.iBack>=0)sub.AddItem(n.iBack);if(n.iPlane>=0)sub.AddItem(n.iPlane);
            }
        }
        FBspNode& n=regionHullNodes(i);if(n.iFront>=0)stack.AddItem(n.iFront);if(n.iBack>=0)stack.AddItem(n.iBack);if(n.iPlane>=0)stack.AddItem(n.iPlane);
    }
    if(root>=seen.Num()||!seen(root))return 0;
    TArray<INT> selectedSeen;selectedSeen.AddZeroed(regionHullNodes.Num());
    stack.AddItem(root);
    while(stack.Num()) {
        INT i=stack(stack.Num()-1);stack.Remove(stack.Num()-1);
        if(i<0||i>=regionHullNodes.Num()||selectedSeen(i))return 0;selectedSeen(i)=1;
        if(regionHullRoots.FindItemIndex(i)!=INDEX_NONE)return 0;
        FBspNode& n=regionHullNodes(i);if(n.iFront>=0)stack.AddItem(n.iFront);if(n.iBack>=0)stack.AddItem(n.iBack);if(n.iPlane>=0)stack.AddItem(n.iPlane);
    }
    regionHullRoots.AddItem(root);return 1;
}
static int regionHullsBegin(UModel* m,INT root) {
    INT okay=regionHullsBeginImpl(m,root);if(!okay)regionHullsReset();return okay;
}
// ZoneMask is a cache for the complete descendant partition. A matching node
// alone is insufficient: every child, including coplanars, must be unchanged.
// Plan the writes first; malformed graphs/leaves must not partially restore it.
static int regionHullMaskOwners(UModel* m,TArray<INT>& mapping,TArray<INT>& owners) {
    if(!m||mapping.Num()!=regionHullNodes.Num()||!mapping.Num())return 0;
    TArray<INT> stack,order,seen,complete;seen.AddZeroed(mapping.Num());complete.AddZeroed(mapping.Num());stack.AddItem(0);
    while(stack.Num()) {
        INT i=stack(stack.Num()-1);stack.Remove(stack.Num()-1);
        if(i<0||i>=mapping.Num()||seen(i))return 0;seen(i)=1;order.AddItem(i);
        FBspNode& n=regionHullNodes(i);INT children[3]={n.iFront,n.iBack,n.iPlane};
        for(INT k=0;k<3;k++) {
            if(children[k]<INDEX_NONE)return 0;
            if(children[k]>=0)stack.AddItem(children[k]);
        }
    }
    for(INT p=order.Num()-1;p>=0;p--) {
        INT i=order(p),j=mapping(i);if(j==INDEX_NONE)continue;
        if(j<0||j>=m->Nodes.Num())return 0;
        FBspNode& a=regionHullNodes(i);FBspNode& b=m->Nodes(j);INT same=1;
        INT children[3]={a.iFront,a.iBack,a.iPlane};
        for(INT k=0;k<3;k++)if(children[k]>=0&&!complete(children[k]))same=0;
        for(INT side=0;side<2;side++) {
            if(a.iZone[side]>=64||b.iZone[side]>=64)return 0;
            if(a.iZone[side]!=b.iZone[side])same=0;
            INT oldLeaf=a.iLeaf[side],newLeaf=b.iLeaf[side];
            if(oldLeaf<INDEX_NONE||newLeaf<INDEX_NONE||oldLeaf>=regionHullLeafZones.Num()||newLeaf>=m->Leaves.Num())return 0;
            if((oldLeaf==INDEX_NONE)!=(newLeaf==INDEX_NONE))same=0;
            if(oldLeaf>=0) {
                INT zone=regionHullLeafZones(oldLeaf);if(zone<0||zone>=64)return 0;
                if(newLeaf>=0&&zone!=m->Leaves(newLeaf).iZone)same=0;
            }
            if(newLeaf>=0&&(m->Leaves(newLeaf).iZone<0||m->Leaves(newLeaf).iZone>=64))return 0;
        }
        if(same){complete(i)=1;owners.AddItem(i);}
    }
    return 1;
}
static int regionHullsFinishImpl(UModel* m) {
    if(!m||m!=regionHullModel||m->RootOutside!=regionHullRootOutside||!regionHullRoots.Num())return 0;
    TArray<INT> mapping,used,oldStack,newStack;mapping.Add(regionHullNodes.Num());used.AddZeroed(m->Nodes.Num());
    for(INT i=0;i<mapping.Num();i++)mapping(i)=INDEX_NONE;
    oldStack.AddItem(0);newStack.AddItem(0);
    while(oldStack.Num()) {
        INT a=oldStack(oldStack.Num()-1),b=newStack(newStack.Num()-1);oldStack.Remove(oldStack.Num()-1);newStack.Remove(newStack.Num()-1);
        if(a<0||a>=mapping.Num()||b<0||b>=m->Nodes.Num()||mapping(a)!=INDEX_NONE||used(b))return 0;
        if(regionHullRoots.FindItemIndex(a)!=INDEX_NONE){used(b)=1;continue;}
        if(!regionHullSameNode(m,a,b))return 0;
        mapping(a)=b;used(b)=1;
        FBspNode& x=regionHullNodes(a);FBspNode& y=m->Nodes(b);
        INT left[3]={x.iFront,x.iBack,x.iPlane},right[3]={y.iFront,y.iBack,y.iPlane};
        for(INT k=0;k<3;k++) {
            if((left[k]<0)!=(right[k]<0))return 0;
            if(left[k]>=0){oldStack.AddItem(left[k]);newStack.AddItem(right[k]);}
        }
    }
    // Validate every copied word before committing any replacement hull.
    TArray<INT> owners,starts,words;INT skipped=0;
    for(INT i=0;i<mapping.Num();i++)if(mapping(i)>=0) {
        INT start=regionHullNodes(i).iCollisionBound;
        if(start<INDEX_NONE)return 0;
        if(start<0){if(m->Nodes(mapping(i)).iCollisionBound!=INDEX_NONE)return 0;continue;}
        if(start>=regionHullWords.Num())return 0;
        INT cursor=start,okay=1;
        while(cursor<regionHullWords.Num()&&regionHullWords(cursor)>=0) {
            INT encoded=regionHullWords(cursor),node=encoded&~0x40000000;
            if(node<0||node>=mapping.Num())return 0;
            if(mapping(node)<0)okay=0;
            cursor++;
        }
        if(cursor+7>regionHullWords.Num()||regionHullWords(cursor)!=INDEX_NONE)return 0;
        FLOAT box[6];appMemcpy(box,&regionHullWords(cursor+1),sizeof(box));
        for(INT k=0;k<6;k++)if(!_finite(box[k]))return 0;
        for(INT k=0;k<3;k++)if(box[k]>box[k+3])return 0;
        if(!okay){skipped++;continue;}
        // Independent postcompile proof: the generated hull must have the
        // identical ordered plane references after remapping, including flip
        // bits. We restore numerical AABB cache data, never an old partition.
        INT generated=m->Nodes(mapping(i)).iCollisionBound;
        if(generated<0||generated>=m->LeafHulls.Num())return 0;
        for(INT p=start;p<cursor;p++) {
            INT encoded=regionHullWords(p),expected=mapping(encoded&~0x40000000)|(encoded&0x40000000);
            if(generated>=m->LeafHulls.Num()||m->LeafHulls(generated)!=expected)return 0;
            generated++;
        }
        if(generated+7>m->LeafHulls.Num()||m->LeafHulls(generated)!=INDEX_NONE)return 0;
        FLOAT generatedBox[6];appMemcpy(generatedBox,&m->LeafHulls(generated+1),sizeof(generatedBox));
        for(INT k=0;k<6;k++)if(!_finite(generatedBox[k]))return 0;
        for(INT k=0;k<3;k++)if(generatedBox[k]>generatedBox[k+3])return 0;
        owners.AddItem(mapping(i));starts.AddItem(words.Num());
        for(INT p=start;p<cursor;p++) {
            INT encoded=regionHullWords(p);words.AddItem(mapping(encoded&~0x40000000)|(encoded&0x40000000));
        }
        for(INT p=cursor;p<cursor+7;p++)words.AddItem(regionHullWords(p));
    }
    // Compact the final records, retaining generated hulls only where no
    // original record is certified. This avoids accumulating duplicate arrays.
    TArray<INT> finalWords,finalOffsets,replacementFor;finalOffsets.Add(m->Nodes.Num());replacementFor.Add(m->Nodes.Num());
    for(INT i=0;i<replacementFor.Num();i++)replacementFor(i)=INDEX_NONE;
    for(INT i=0;i<owners.Num();i++)replacementFor(owners(i))=i;
    for(INT i=0;i<m->Nodes.Num();i++) {
        INT replacement=replacementFor(i),start=m->Nodes(i).iCollisionBound;
        if(start<INDEX_NONE)return 0;
        finalOffsets(i)=INDEX_NONE;
        if(replacement>=0) {
            INT begin=starts(replacement),end=replacement+1<starts.Num()?starts(replacement+1):words.Num();
            finalOffsets(i)=finalWords.Num();for(INT p=begin;p<end;p++)finalWords.AddItem(words(p));
        } else if(start>=0) {
            INT cursor=start;if(cursor>=m->LeafHulls.Num())return 0;
            while(cursor<m->LeafHulls.Num()&&m->LeafHulls(cursor)>=0) {
                INT node=m->LeafHulls(cursor)&~0x40000000;if(node<0||node>=m->Nodes.Num())return 0;cursor++;
            }
            if(cursor+7>m->LeafHulls.Num()||m->LeafHulls(cursor)!=INDEX_NONE)return 0;
            FLOAT box[6];appMemcpy(box,&m->LeafHulls(cursor+1),sizeof(box));
            for(INT k=0;k<6;k++)if(!_finite(box[k]))return 0;
            for(INT k=0;k<3;k++)if(box[k]>box[k+3])return 0;
            finalOffsets(i)=finalWords.Num();for(INT p=start;p<cursor+7;p++)finalWords.AddItem(m->LeafHulls(p));
        }
    }
    TArray<INT> maskOwners;if(!regionHullMaskOwners(m,mapping,maskOwners))return 0;
    m->LeafHulls=finalWords;for(INT i=0;i<m->Nodes.Num();i++)m->Nodes(i).iCollisionBound=finalOffsets(i);
    INT masksChanged=0;
    for(INT i=0;i<maskOwners.Num();i++) {
        INT old=maskOwners(i),now=mapping(old);
        if(m->Nodes(now).ZoneMask!=regionHullNodes(old).ZoneMask)masksChanged++;
        m->Nodes(now).ZoneMask=regionHullNodes(old).ZoneMask;
    }
    printf("UCMapKit|retained hulls|%d restored|%d dependent skipped|%d words|%d masks certified|%d masks restored\n",owners.Num(),skipped,finalWords.Num(),maskOwners.Num(),masksChanged);
    return 1;
}
static int regionHullsFinish(UModel* m) {
    INT okay=regionHullsFinishImpl(m);regionHullsReset();return okay;
}
