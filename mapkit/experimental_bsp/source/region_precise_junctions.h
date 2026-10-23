#include "region_duplicate_junctions.h"
static int regionIsOriginalCorner(const TArray<FVector>& corners,int start,int count,const FVector& point) {
    for(int i=0;i<count;i++)if(corners(start+i)==point)return 1;
    return 0;
}

// A proposed vertex close to two edges of an acute corner must not be inserted
// twice. Assign only unambiguous proposals, using the same SDK bounds as before.
static int regionUniqueJunctionEdge(const TArray<FVector>& corners,int start,int count,
                                    const FVector& p,const FVector& normal,DOUBLE& time) {
    if(regionIsOriginalCorner(corners,start,count,p))return INDEX_NONE;
    INT found=INDEX_NONE;
    for(INT edge=0;edge<count;edge++) {
        FVector a=corners(start+edge),b=corners(start+(edge+1)%count);
        DOUBLE ex=(DOUBLE)b.X-a.X,ey=(DOUBLE)b.Y-a.Y,ez=(DOUBLE)b.Z-a.Z;
        DOUBLE length2=ex*ex+ey*ey+ez*ez;if(length2<=0.)return INDEX_NONE;
        DOUBLE px=(DOUBLE)p.X-a.X,py=(DOUBLE)p.Y-a.Y,pz=(DOUBLE)p.Z-a.Z;
        DOUBLE t=(px*ex+py*ey+pz*ez)/length2;
        if(t<=0. || t>=1.)continue;
        if((p-a).SizeSquared()<=THRESH_POINTS_ARE_SAME*THRESH_POINTS_ARE_SAME ||
           (p-b).SizeSquared()<=THRESH_POINTS_ARE_SAME*THRESH_POINTS_ARE_SAME)continue;
        DOUBLE dx=px-ex*t,dy=py-ey*t,dz=pz-ez*t;
        DOUBLE dn=dx*normal.X+dy*normal.Y+dz*normal.Z;
        DOUBLE tx=dx-normal.X*dn,ty=dy-normal.Y*dn,tz=dz-normal.Z*dn;
        if(Abs(dn)>THRESH_SPLIT_POLY_PRECISELY || tx*tx+ty*ty+tz*tz>THRESH_POINTS_ARE_SAME*THRESH_POINTS_ARE_SAME)continue;
        if(found!=INDEX_NONE)return INDEX_NONE;
        found=edge;time=t;
    }
    return found;
}

// Only for the private replacement model; never optimize retained world nodes.
static int regionOptimizePrecise(UModel* m,int intermediateFPoly=0) {
    // The stock optimizer also snaps existing corners and inserts near-edge
    // vertices using a loose tolerance. A rotated face can acquire a vertex
    // 0.24 units off its plane. Keep the compiler's original polygon boundary;
    // accept optimizer-proposed junctions only on that boundary within the
    // already declared precise split/point-coincidence bounds.
    TArray<FBspNode> original=m->Nodes;
    TArray<FVector> corners,normals,bases,textureU,textureV,sourceNormals;
    TArray<FBspSurf> surfaces;
    TArray<INT> starts,triangleHeads,triangleNext;
    triangleHeads.AddZeroed(m->Surfs.Num());triangleNext.AddZeroed(original.Num());
    for(INT h=0;h<triangleHeads.Num();h++)triangleHeads(h)=INDEX_NONE;
    for(INT h=0;h<triangleNext.Num();h++)triangleNext(h)=INDEX_NONE;
    for(int i=0;i<original.Num();i++) {
        FBspNode& n=original(i);starts.AddItem(corners.Num());
        for(int j=0;j<n.NumVertices;j++)corners.AddItem(m->Points(m->Verts(n.iVertPool+j).pVertex));
        if(n.iSurf<0 || n.iSurf>=m->Surfs.Num())return 0;
        if(n.NumVertices==3) {
            triangleNext(i)=triangleHeads(n.iSurf);triangleHeads(n.iSurf)=i;
        }
        FBspSurf surface=m->Surfs(n.iSurf);new(surfaces) FBspSurf(surface);
        bases.AddItem(m->Points(surface.pBase));
        textureU.AddItem(m->Vectors(surface.vTextureU));textureV.AddItem(m->Vectors(surface.vTextureV));
        FVector normal=m->Vectors(surface.vNormal);sourceNormals.AddItem(normal);
        if(!normal.Normalize())return 0;normals.AddItem(normal);
    }
    GEditor->UEditorEngine::bspOptGeom(m);
    selectedCommand("UC_SELECTED_DUMP ..\\Output\\clip-optimized.tree");
    if(m->Nodes.Num()!=original.Num())return 0;
    int restored=0,accepted=0,rejected=0;TArray<INT> visitedSurfaces;
    for(int i=0;i<m->Nodes.Num();i++) {
        FBspNode& n=m->Nodes(i);FBspNode& old=original(i);
        if(n.iFront!=old.iFront || n.iBack!=old.iBack || n.iPlane!=old.iPlane || n.NodeFlags!=old.NodeFlags ||
           n.Plane!=old.Plane)return 0;
        if(n.iSurf<0 || n.iSurf>=m->Surfs.Num())return 0;
        FBspSurf& surface=m->Surfs(n.iSurf);FBspSurf& originalSurface=surfaces(i);
        // bspOptGeom may compact surface/point indices, but it must not alter
        // ownership, material, UVs, flags or the canonical plane.
        if(surface.Actor!=originalSurface.Actor || surface.iBrushPoly!=originalSurface.iBrushPoly ||
           surface.Texture!=originalSurface.Texture || surface.PolyFlags!=originalSurface.PolyFlags ||
           surface.PanU!=originalSurface.PanU || surface.PanV!=originalSurface.PanV)return 0;
        if(m->Points(surface.pBase)!=bases(i) || m->Vectors(surface.vNormal)!=sourceNormals(i) ||
           m->Vectors(surface.vTextureU)!=textureU(i) || m->Vectors(surface.vTextureV)!=textureV(i)) {
            // Restore exact pre-opt mapping; native point welding can also
            // move a UV origin. A shared
            // surface with incompatible original mappings is still refused.
            if(visitedSurfaces.FindItemIndex(n.iSurf)!=INDEX_NONE)return 0;
            surface.pBase=m->Points.AddItem(bases(i));surface.vNormal=m->Vectors.AddItem(sourceNormals(i));
            surface.vTextureU=m->Vectors.AddItem(textureU(i));surface.vTextureV=m->Vectors.AddItem(textureV(i));
        }
        if(visitedSurfaces.FindItemIndex(n.iSurf)==INDEX_NONE)visitedSurfaces.AddItem(n.iSurf);
        if(!old.NumVertices)continue;
        TArray<FVector> proposed,result;
        for(int j=0;j<n.NumVertices;j++)proposed.AddItem(m->Points(m->Verts(n.iVertPool+j).pVertex));
        TArray<INT> edges;TArray<DOUBLE> parameters;
        for(int k=0;k<proposed.Num();k++) {
            DOUBLE t=0.;INT edge=regionUniqueJunctionEdge(corners,starts(i),old.NumVertices,proposed(k),normals(i),t);
            if(edge!=INDEX_NONE&&regionJunctionDuplicatesTriangle(original,corners,starts,
                    triangleHeads,triangleNext,i,edge,proposed(k)))edge=INDEX_NONE;
            edges.AddItem(edge);
            parameters.AddItem(t);
        }
        for(int j=0;j<old.NumVertices;j++) {
            FVector a=corners(starts(i)+j),b=corners(starts(i)+(j+1)%old.NumVertices);
            DOUBLE ex=(DOUBLE)b.X-a.X,ey=(DOUBLE)b.Y-a.Y,ez=(DOUBLE)b.Z-a.Z;
            DOUBLE length2=ex*ex+ey*ey+ez*ez;if(length2<=0.)return 0;
            result.AddItem(a);
            TArray<DOUBLE> times;TArray<FVector> junctions;
            for(int k=0;k<proposed.Num();k++) {
                FVector p=proposed(k);
                if(edges(k)!=j)continue;
                DOUBLE t=parameters(k);
                int pos=0;while(pos<times.Num() && times(pos)<t)pos++;
                times.Insert(pos);times(pos)=t;junctions.Insert(pos);junctions(pos)=p;
            }
            for(int k=0;k<junctions.Num();k++) {
                if((junctions(k)-result(result.Num()-1)).SizeSquared()<=THRESH_POINTS_ARE_SAME*THRESH_POINTS_ARE_SAME)continue;
                result.AddItem(junctions(k));accepted++;
            }
        }
        if(intermediateFPoly && result.Num()>FPoly::MAX_VERTICES) {
            // MAP REBUILD is followed by BSP REBUILD, whose BuildFPolys
            // requires the lower FPoly limit. Keep EVERY original corner;
            // discard only the optional new junction proposals for this ring.
            // Final local models keep the normal FBspNode limit instead.
            if(old.NumVertices>FPoly::MAX_VERTICES)return 0;
            accepted-=result.Num()-old.NumVertices;result.Empty();
            for(int j=0;j<old.NumVertices;j++)result.AddItem(corners(starts(i)+j));
        }
        if(result.Num()>FBspNode::MAX_FINAL_VERTICES)return 0;
        for(int j=0;j<proposed.Num();j++)if(result.FindItemIndex(proposed(j))==INDEX_NONE)rejected++;
        for(int j=0;j<old.NumVertices;j++)if(proposed.FindItemIndex(corners(starts(i)+j))==INDEX_NONE)restored++;
        n.iVertPool=m->Verts.Num();n.NumVertices=result.Num();
        for(int j=0;j<result.Num();j++) {
            FVert v;v.pVertex=m->Points.AddItem(result(j));v.iSide=INDEX_NONE;m->Verts.AddItem(v);
        }
    }
    printf("UCMapKit|precise junctions|%d accepted|%d rejected|%d original corners restored\n",accepted,rejected,restored);
    return 1;
}

