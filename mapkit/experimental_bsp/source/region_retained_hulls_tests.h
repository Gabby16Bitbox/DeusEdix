// Synthetic native checks use private in-memory UModels, never map assets.
static UModel* regionHullTestModel() {
    UModel* m=ConstructObject<UModel>(UModel::StaticClass());m->AddToRoot();m->RootOutside=1;
    for(INT i=0;i<3;i++)m->Points.AddItem(FVector(i==1?1:0,i==2?1:0,0));
    new(m->Surfs) FBspSurf;FBspSurf& s=m->Surfs(0);s.Actor=NULL;s.Texture=NULL;s.iBrushPoly=0;s.PolyFlags=0;
    m->Nodes.AddZeroed(3);
    for(INT i=0;i<3;i++) {
        FBspNode& n=m->Nodes(i);n.Plane=FPlane(0,0,1,0);n.NumVertices=3;n.iSurf=0;
        n.iFront=n.iBack=n.iPlane=INDEX_NONE;n.iCollisionBound=INDEX_NONE;n.iVertPool=m->Verts.Num();
        n.iLeaf[0]=n.iLeaf[1]=INDEX_NONE;
        for(INT k=0;k<3;k++){FVert v;v.pVertex=k;v.iSide=INDEX_NONE;m->Verts.AddItem(v);}
    }
    m->Nodes(0).iFront=1;m->Nodes(0).iBack=2;
    for(INT k=0;k<2;k++) {
        m->Nodes(k?2:0).iCollisionBound=m->LeafHulls.Num();
        m->LeafHulls.AddItem(k);m->LeafHulls.AddItem(INDEX_NONE);
        FLOAT box[6]={-1,-2,-3,4,5,6};INT words[6];appMemcpy(words,box,sizeof(words));
        for(INT j=0;j<6;j++)m->LeafHulls.AddItem(words[j]);
    }
    return m;
}
static int regionHullNativeTests() {
    INT passed=0,total=0;
    for(INT test=0;test<17;test++) {
        regionHullsReset();UModel* m=regionHullTestModel();INT okay=1;
        if(test==10)m->Nodes(2).iBack=0; // cyclic original rejected before snapshot can be used
        INT begin=regionHullsBegin(m,1);
        if(test==10)okay=!begin;
        else if(!begin)okay=0;
        else {
            if(test==0||test==12) {
                // Changed selected plane cannot be reused by an outside hull.
                m->Nodes(1).Plane.W=2;
                m->LeafHulls(2)=0;m->LeafHulls(10)=0;
                if(test==12) {
                    // Compaction may renumber every external node. References
                    // must be remapped by the structural path, never raw IDs.
                    FBspNode swap=m->Nodes(1);m->Nodes(1)=m->Nodes(2);m->Nodes(2)=swap;
                    m->Nodes(0).iFront=2;m->Nodes(0).iBack=1;m->LeafHulls(8)=2;
                }
            } else if(test==1)m->Nodes(2).Plane.W=1;
            else if(test==2)m->Nodes(2).NumVertices=0;
            else if(test==3)m->Nodes(2).NodeFlags|=NF_NotCsg;
            else if(test==4)m->Surfs(0).PolyFlags=PF_NotSolid;
            else if(test==5)m->Points(0).X=0.0000001f;
            else if(test==6)m->Nodes(2).iBack=1;
            else if(test==7)regionHullWords(0)=999;
            else if(test==8)regionHullWords(2)=0x7fc00000;
            else if(test==9)m->RootOutside=0;
            else if(test==11)okay=!regionHullsBegin(m,1);
            else if(test==13){m->LeafHulls.Insert(1);m->LeafHulls(1)=1;m->Nodes(2).iCollisionBound++;}
            else if(test==14)m->LeafHulls(0)|=0x40000000;
            else if(test==15){regionHullNodes(1).iBack=1;okay=!regionHullsBegin(m,2);}
            else if(test==16){regionHullNodes(1).iBack=999;okay=!regionHullsBegin(m,2);}
            if(test!=11&&test!=15&&test!=16) {
                INT finish=regionHullsFinish(m);
                if(test==0||test==12) {
                    INT first=m->Nodes(0).iCollisionBound,dependent=m->Nodes(test==12?1:2).iCollisionBound;
                    FLOAT low;appMemcpy(&low,&m->LeafHulls(first+2),sizeof(low));
                    okay=finish&&low==-1&&m->LeafHulls(dependent+2)==0&&m->LeafHulls(first)==0;
                } else okay=!finish;
            }
        }
        total++;if(okay)passed++;printf("UCMapKit|hull test|%d|%s\n",test,okay?"pass":"FAIL");
        regionHullsReset();m->RemoveFromRoot();
    }
    printf("UCMapKit|hull tests|%d|%d\n",passed,total);return passed==total;
}
