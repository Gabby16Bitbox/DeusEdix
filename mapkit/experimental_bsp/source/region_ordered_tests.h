static UModel* regionOrderedTestModel() {
    UModel* m=ConstructObject<UModel>(UModel::StaticClass());m->AddToRoot();
    m->Polys=ConstructObject<UPolys>(UPolys::StaticClass(),m);m->RootOutside=1;return m;
}
static FPoly regionOrderedTestPoly(FLOAT z,INT face) {
    FPoly p;p.Init();p.Base=FVector(0,0,z);p.Normal=FVector(0,0,1);
    p.TextureU=FVector(1,0,0);p.TextureV=FVector(0,1,0);p.iBrushPoly=face;p.iLink=INDEX_NONE;
    p.NumVertices=3;p.Vertex[0]=FVector(0,0,z);p.Vertex[1]=FVector(8,0,z);p.Vertex[2]=FVector(0,8,z);return p;
}
static int regionOrderedTests() {
    INT passed=0,total=0;
    for(INT test=0;test<26;test++) {
        UModel* old=regionOrderedTestModel();UModel* m=regionOrderedTestModel();
        FPoly a=regionOrderedTestPoly(-1,0),b=regionOrderedTestPoly(1,1),c=regionOrderedTestPoly(0,2);
        FPoly polys[3]={a,b,c};old->Nodes.AddZeroed(3);
        old->Vectors.AddItem(FVector(0,0,1));old->Vectors.AddItem(FVector(1,0,0));old->Vectors.AddItem(FVector(0,1,0));
        for(INT i=0;i<3;i++) {
            new(old->Surfs) FBspSurf;FBspSurf& surf=old->Surfs(i);
            surf.Actor=NULL;surf.Texture=NULL;surf.PolyFlags=0;surf.iBrushPoly=i;
            surf.pBase=old->Points.AddItem(polys[i].Base);surf.vNormal=0;surf.vTextureU=1;surf.vTextureV=2;
            surf.PanU=surf.PanV=0;surf.iLightMap=INDEX_NONE;
            FBspNode& node=old->Nodes(i);node.Plane=FPlane(polys[i].Base,polys[i].Normal);
            node.iSurf=i;node.NumVertices=3;node.iVertPool=old->Verts.Num();
            node.iFront=node.iBack=node.iPlane=INDEX_NONE;node.iLeaf[0]=node.iLeaf[1]=INDEX_NONE;
            node.iCollisionBound=node.iRenderBound=INDEX_NONE;
            for(INT j=0;j<3;j++){FVert v;v.pVertex=old->Points.AddItem(polys[i].Vertex[j]);v.iSide=INDEX_NONE;old->Verts.AddItem(v);}
        }
        old->Nodes(0).iFront=1;old->Nodes(1).iBack=2;
        m->Points=old->Points;m->Vectors=old->Vectors;m->Surfs=old->Surfs;
        c.iLink=old->Nodes(2).iSurf;b.iLink=old->Nodes(1).iSurf;
        m->Polys->Element.AddItem(c);m->Polys->Element.AddItem(b);
        INT root=1,expected=0;UModel* source=old;FPoly& p=m->Polys->Element(0);
        FLOAT nan;INT bits=0x7fc00000;appMemcpy(&nan,&bits,4);
        if(test==0||test==20||test==21||test==24||test==25)expected=1;
        if(test==1)source=NULL;
        else if(test==2)root=0;
        else if(test==3)root=99;
        else if(test==4)m->RootOutside=0;
        else if(test==5)old->Nodes(2).iBack=0;
        else if(test==6)old->Nodes(2).iFront=999;
        else if(test==7)old->Nodes(1).iSurf=999;
        else if(test==8)p.Base.X=nan;
        else if(test==9)p.Normal.X=nan;
        else if(test==10)p.Vertex[0].Y=nan;
        else if(test==11)p.Normal=FVector(0,0,0);
        else if(test==12)p.NumVertices=2;
        else if(test==13)p.NumVertices=FPoly::MAX_VERTICES+1;
        else if(test==14)p.iLink=999;
        else if(test==15)p.PolyFlags|=PF_NotSolid;
        else if(test==16)p.PolyFlags|=PF_Semisolid;
        else if(test==17)p.PolyFlags|=PF_Portal;
        else if(test==18)old->Nodes(1).NodeFlags|=NF_NotCsg;
        else if(test==19)m->Surfs(p.iLink).PolyFlags|=PF_NotSolid;
        else if(test==20) {
            // Same identity with changed plane must fall back, not restore it.
            FPoly& changed=m->Polys->Element(1);changed.Base.Z=2;
            for(INT k=0;k<3;k++)changed.Vertex[k].Z=2;
        } else if(test==21) {
            // Opposite solid coplanar keeps its own orientation.
            p.Base.Z=1;p.Normal.Z=-1;
            for(INT k=0;k<3;k++)p.Vertex[k].Z=1;
            FVector v=p.Vertex[1];p.Vertex[1]=p.Vertex[2];p.Vertex[2]=v;
        } else if(test==22) {
            old->Nodes(0).iFront=INDEX_NONE;old->Nodes(0).iPlane=1;
        } else if(test==23)old->Nodes(2).iFront=-2;
        else if(test==24) {
            // Full 16-corner FPoly is split BEFORE calling SplitWithPlane.
            p.NumVertices=FPoly::MAX_VERTICES;
            for(INT k=0;k<p.NumVertices;k++) {
                DOUBLE angle=2*PI*k/p.NumVertices;p.Vertex[k]=FVector(4*appCos(angle),4*appSin(angle),0);
            }
        } else if(test==25) {
            // Repeated source-face fragments do not change splitter identity.
            FPoly fragment=m->Polys->Element(1);fragment.Vertex[0].X=1;m->Polys->Element.AddItem(fragment);
        }
        INT actual=regionOrderedBuild(m,source,root),okay=(!!actual==expected);
        if(actual&&test==0)okay=m->Nodes(0).Plane.W==1&&m->Surfs(m->Nodes(0).iSurf).iBrushPoly==1;
        if(actual&&test==20)okay=m->Nodes(0).Plane.W==0;
        if(actual&&test==21) {
            okay=m->Nodes(0).Plane.Z==1&&m->Nodes(0).iPlane>=0&&
                  m->Nodes(m->Nodes(0).iPlane).Plane.Z==-1;
        }
        total++;if(okay)passed++;
        printf("UCMapKit|ordered test|%d|%s\n",test,okay?"pass":"FAIL");
        old->RemoveFromRoot();m->RemoveFromRoot();
    }
    printf("UCMapKit|ordered tests|%d|%d\n",passed,total);return passed==total;
}
