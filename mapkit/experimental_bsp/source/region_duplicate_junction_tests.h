static int regionDuplicateJunctionSelfTest() {
    INT count=0;
    FVector a(124.707359f,1038.03613f,124.192436f);
    FVector b(98.0005951f,1037.70178f,123.686829f);
    FVector p(104.574318f,1037.78455f,123.811302f);
    if(!regionSameTriangle(a,b,p,a,p,b))return 0;count++;
    if(!regionSameTriangle(a,b,p,p,b,a))return 0;count++;
    if(regionSameTriangle(a,b,p,a,b,FVector(p.X,p.Y,p.Z+.0001f)))return 0;count++;
    if(regionSameTriangle(a,b,a,a,p,b))return 0;count++;
    TArray<FBspNode> nodes;TArray<FVector> corners;TArray<INT> starts,heads,next;
    FBspNode n;appMemzero(&n,sizeof(n));n.iSurf=0;n.NumVertices=3;n.Plane=FPlane(0,1,0,1039);
    nodes.AddItem(n);nodes.AddItem(n);starts.AddItem(0);starts.AddItem(3);
    corners.AddItem(a);corners.AddItem(b);corners.AddItem(FVector(148.594254f,1038.34631f,124.250038f));
    corners.AddItem(a);corners.AddItem(b);corners.AddItem(p);
    heads.AddItem(1);heads.AddItem(INDEX_NONE);next.AddItem(INDEX_NONE);next.AddItem(INDEX_NONE);
    if(!regionJunctionDuplicatesTriangle(nodes,corners,starts,heads,next,0,0,p))return 0;count++;
    // The predicate only removes an optional proposal; it cannot change a
    // different source surface or an almost-equal native collision plane.
    nodes(0).iSurf=1;
    if(regionJunctionDuplicatesTriangle(nodes,corners,starts,heads,next,0,0,p))return 0;count++;
    nodes(0).iSurf=0;nodes(1).Plane.W+=.0001f;
    if(regionJunctionDuplicatesTriangle(nodes,corners,starts,heads,next,0,0,p))return 0;count++;
    nodes(1).Plane=nodes(0).Plane;heads(0)=0;
    if(regionJunctionDuplicatesTriangle(nodes,corners,starts,heads,next,0,0,p))return 0;count++;
    heads(0)=1;
    if(regionJunctionDuplicatesTriangle(nodes,corners,starts,heads,next,0,1,p))return 0;count++;
    printf("UCMapKit|duplicate junction tests|%d passed\n",count);return 1;
}
