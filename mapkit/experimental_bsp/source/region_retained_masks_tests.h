// Native tests for whole-subtree zone-cache preservation, using owned models.
static UModel* regionMaskTestModel() {
    UModel* m=regionHullTestModel();
    FBspNode n=m->Nodes(2);m->Nodes.AddItem(n);m->Nodes.AddItem(n);
    m->Nodes(2).iFront=3;m->Nodes(2).iPlane=4;
    for(INT i=0;i<m->Nodes.Num();i++) {
        m->Nodes(i).ZoneMask=3;m->Nodes(i).iZone[0]=0;m->Nodes(i).iZone[1]=1;
        m->Nodes(i).iLeaf[0]=INDEX_NONE;
        m->Nodes(i).iLeaf[1]=m->Leaves.Num();
        m->Leaves.AddItem(FLeaf(1,INDEX_NONE,INDEX_NONE,2));
    }
    return m;
}
static int regionMaskNativeTests() {
    INT passed=0,total=0;
    for(INT test=0;test<10;test++) {
        regionHullsReset();UModel* m=regionMaskTestModel();INT okay=regionHullsBegin(m,1);
        if(okay&&test==5)okay=regionHullsBegin(m,3); // Deferred roots: ancestor 2 cannot restore.
        for(INT i=0;i<m->Nodes.Num();i++)m->Nodes(i).ZoneMask=2;
        if(test==1)m->Nodes(3).iZone[1]=2;
        if(test==2)m->Leaves(m->Nodes(3).iLeaf[1]).iZone=2;
        if(test==3) {
            // Leaf indices may compact; compare actual zone values, not IDs.
            for(INT i=0;i<m->Nodes.Num();i++)m->Nodes(i).iLeaf[1]=m->Leaves.Num()-1-i;
        }
        if(test==4)m->Nodes(3).iLeaf[1]=999;
        if(test==6)regionHullNodes(1).iBack=1; // Malformed skipped subtree, safe postorder rejects.
        if(test==7)regionHullNodes(1).iBack=999;
        if(test==8)m->Nodes(4).iZone[1]=2; // Coplanar descendants are part of the proof.
        if(test==9)m->Nodes(3).iLeaf[1]=INDEX_NONE;
        INT finish=okay?regionHullsFinish(m):0;
        if(test==4||test==6||test==7) {
            okay=okay&&!finish;
            for(INT i=0;i<m->Nodes.Num();i++)okay=okay&&m->Nodes(i).ZoneMask==2;
        } else {
            okay=okay&&finish&&m->Nodes(0).ZoneMask==2&&m->Nodes(1).ZoneMask==2;
            INT subComplete=test==0||test==3;
            okay=okay&&m->Nodes(2).ZoneMask==(subComplete?3:2);
            okay=okay&&m->Nodes(3).ZoneMask==((test==0||test==3||test==8)?3:2);
            okay=okay&&m->Nodes(4).ZoneMask==(test==8?2:3);
        }
        total++;if(okay)passed++;printf("UCMapKit|mask test|%d|%s\n",test,okay?"pass":"FAIL");
        regionHullsReset();m->RemoveFromRoot();
    }
    printf("UCMapKit|mask tests|%d|%d\n",passed,total);return passed==total;
}
