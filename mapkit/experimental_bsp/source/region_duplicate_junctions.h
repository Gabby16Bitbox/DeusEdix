// Optional T-junctions must not reproduce an existing compiled triangle.
// Match native coordinates and the same original surface/plane exactly.
// No corner, triangle, plane, UV, or validation tolerance is changed.
static int regionSameTriangle(const FVector& a,const FVector& b,const FVector& p,
                              const FVector& x,const FVector& y,const FVector& z) {
    if(a==b||a==p||b==p)return 0;
    return (a==x||a==y||a==z)&&(b==x||b==y||b==z)&&(p==x||p==y||p==z);
}
static int regionJunctionDuplicatesTriangle(const TArray<FBspNode>& nodes,
        const TArray<FVector>& corners,const TArray<INT>& starts,
        const TArray<INT>& triangleHeads,const TArray<INT>& triangleNext,
        INT owner,INT edge,const FVector& point) {
    const FBspNode& n=nodes(owner);
    FVector a=corners(starts(owner)+edge),b=corners(starts(owner)+(edge+1)%n.NumVertices);
    for(INT i=triangleHeads(n.iSurf);i!=INDEX_NONE;i=triangleNext(i)) {
        if(i==owner||nodes(i).Plane!=n.Plane)continue;
        INT first=starts(i);
        if(regionSameTriangle(a,b,point,corners(first),corners(first+1),corners(first+2)))return 1;
    }
    return 0;
}
