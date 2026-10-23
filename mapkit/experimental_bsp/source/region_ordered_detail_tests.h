static int regionOrderedDetailTests() {
    INT passed=0,total=0;
    for(INT test=0;test<8;test++) {
        UModel* old=regionOrderedTestModel();UModel* m=regionOrderedTestModel();
        FPoly a=regionOrderedTestPoly(-1,0),b=regionOrderedTestPoly(1,1),c=regionOrderedTestPoly(0,2);
        FPoly polys[3]={a,b,c};old->Nodes.AddZeroed(3);
        old->Vectors.AddItem(FVector(0,0,1));old->Vectors.AddItem(FVector(1,0,0));old->Vectors.AddItem(FVector(0,1,0));
        for(INT i=0;i<3;i++) {
            new(old->Surfs) FBspSurf;FBspSurf& surf=old->Surfs(i);
            surf.Actor=NULL;surf.Texture=NULL;surf.PolyFlags=PF_Semisolid;surf.iBrushPoly=i;
            surf.pBase=old->Points.AddItem(polys[i].Base);surf.vNormal=0;surf.vTextureU=1;surf.vTextureV=2;
            surf.PanU=surf.PanV=0;surf.iLightMap=INDEX_NONE;
            FBspNode& node=old->Nodes(i);node.Plane=FPlane(polys[i].Base,polys[i].Normal);
            node.iSurf=i;node.NumVertices=3;node.iVertPool=old->Verts.Num();node.NodeFlags=0;
            node.iFront=node.iBack=node.iPlane=INDEX_NONE;node.iLeaf[0]=node.iLeaf[1]=INDEX_NONE;
            node.iCollisionBound=node.iRenderBound=INDEX_NONE;
            for(INT j=0;j<3;j++){FVert v;v.pVertex=old->Points.AddItem(polys[i].Vertex[j]);v.iSide=INDEX_NONE;old->Verts.AddItem(v);}
        }
        old->Nodes(0).iFront=1;old->Nodes(1).iBack=2;
        m->Points=old->Points;m->Vectors=old->Vectors;m->Surfs=old->Surfs;
        b.iLink=1;c.iLink=2;b.PolyFlags=c.PolyFlags=PF_Semisolid;
        m->Polys->Element.AddItem(c);m->Polys->Element.AddItem(b);
        INT expected=test==0||test==7,actual=0;
        if(test==1)m->Polys->Element(0).PolyFlags=0;
        else if(test==2)m->Surfs(2).PolyFlags=0;
        else if(test==3)m->Polys->Element(0).PolyFlags|=PF_NotSolid;
        else if(test==4)m->Polys->Element(0).PolyFlags|=PF_Portal;
        else if(test==5)old->Nodes(1).NodeFlags|=NF_NotCsg;
        if(test==6) {
            INT budget=65536,work=0;TArray<FPoly> input=m->Polys->Element;
            actual=regionOrderedBranch(m,input,INDEX_NONE,REGION_ORDERED_ROOT,0,budget,work,old,1);
        } else if(test==7) {
            // Existing hint remains the splitter when the interface is absent;
            // the real Island test exercises promotion and branch propagation.
            actual=regionOrderedBuild(m,old,1);
            if(actual)actual=m->Nodes(0).Plane.W==1&&m->Nodes(0).IsCsg();
        } else actual=regionOrderedBuild(m,old,1);
        INT okay=(!!actual==expected);total++;if(okay)passed++;
        printf("UCMapKit|ordered detail test|%d|%s\n",test,okay?"pass":"FAIL");
        old->RemoveFromRoot();m->RemoveFromRoot();
    }
    printf("UCMapKit|ordered detail tests|%d|%d\n",passed,total);return passed==total;
}
