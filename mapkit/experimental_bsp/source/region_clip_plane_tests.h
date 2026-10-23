static UModel* regionClipPlaneFixture(FPoly& p) {
    UModel* m=ConstructObject<UModel>(UModel::StaticClass());
    new(m->Surfs) FBspSurf;FBspSurf& s=m->Surfs(0);
    s.Actor=NULL;s.Texture=NULL;s.PolyFlags=0;s.iBrushPoly=3;s.PanU=s.PanV=0;s.iLightMap=INDEX_NONE;
    p.Init();p.Normal=FVector(0,.447214007f,-.894427001f);p.Base=FVector(-.00219726562f,.00524902344f,-351.999969f);
    p.TextureU=FVector(1,0,0);p.TextureV=FVector(0,1,0);p.NumVertices=4;p.iLink=0;
    p.Vertex[0]=FVector(64,960,128);p.Vertex[1]=FVector(64,704,0);
    p.Vertex[2]=FVector(-64,704,-.00000381469727f);p.Vertex[3]=FVector(-64,960,128);
    s.pBase=m->Points.AddItem(p.Base);s.vNormal=m->Vectors.AddItem(p.Normal);
    s.vTextureU=m->Vectors.AddItem(p.TextureU);s.vTextureV=m->Vectors.AddItem(p.TextureV);
    m->Nodes.AddZeroed();FBspNode& n=m->Nodes(0);n.iSurf=0;n.iVertPool=0;n.NumVertices=4;
    n.iFront=n.iBack=n.iPlane=INDEX_NONE;n.Plane=FPlane(0,.447214007f,-.894427001f,314.838318f);
    for(INT k=0;k<4;k++){FVert v;v.pVertex=m->Points.AddItem(p.Vertex[k]);v.iSide=INDEX_NONE;m->Verts.AddItem(v);}
    return m;
}
static int regionClipPlaneTests() {
    INT passed=0;
    for(INT test=0;test<12;test++) {
        FPoly p;UModel* m=regionClipPlaneFixture(p);FVector original=p.Base;
        TArray<FRegionClipPlaneInput> inputs;INT work=4000000;
        if(test==0) {
            if(!regionClipPlanePrepare(m,0,p,inputs,work)||inputs.Num()!=1||!inputs(0).Changed||
               !regionClipPlaneExact(p.Base,p.Normal,m->Nodes(0).Plane)||m->Points(m->Surfs(0).pBase)!=original)return 0;
        } else if(test==1) {
            FVector normal(.7071068286895752f,.7071068286895752f,0),point(416,992,128);
            FPlane plane(normal.X,normal.Y,normal.Z,995.6063842773438f);
            if(regionClipPlaneExact(point,normal,plane)||regionClipNativePlaneW(point,normal)==plane.W)return 0;
        } else if(test==2) {
            p.Normal=-p.Normal;
            if(!regionClipPlanePrepare(m,0,p,inputs,work)||inputs(0).Changed||!inputs(0).UnchangedLegacy||p.Base!=original)return 0;
        } else if(test==3) {
            union{DWORD bits;FLOAT value;} bad;bad.bits=0x7fc00000;m->Nodes(0).Plane.W=bad.value;
            if(regionClipPlanePrepare(m,0,p,inputs,work))return 0;
        } else if(test==4) {
            if(regionClipPlanePrepare(m,1,p,inputs,work))return 0;
        } else if(test==5) {
            work=0;if(regionClipPlanePrepare(m,0,p,inputs,work))return 0;
        } else if(test==6) {
            if(!regionClipPlanePrepare(m,0,p,inputs,work))return 0;
            m->Surfs(0).pBase=m->Points.AddItem(p.Base);FPlane before=m->Nodes(0).Plane;
            if(!regionClipPlaneRestore(m,inputs)||m->Points(m->Surfs(0).pBase)!=original||m->Nodes(0).Plane!=before)return 0;
        } else if(test==7) {
            if(!regionClipPlanePrepare(m,0,p,inputs,work))return 0;
            m->Nodes(0).Plane.W+=1;
            if(regionClipPlaneRestore(m,inputs))return 0;
        } else if(test==8) {
            if(!regionClipPlanePrepare(m,0,p,inputs,work))return 0;
            FRegionClipPlaneInput other=inputs(0);other.Base.X+=1;new(inputs) FRegionClipPlaneInput(other);
            if(regionClipPlaneRestore(m,inputs))return 0;
        } else if(test==9) {
            if(!regionClipPlanePrepare(m,0,p,inputs,work))return 0;
            m->Surfs(0).vNormal=m->Vectors.AddItem(-p.Normal);
            if(regionClipPlaneRestore(m,inputs))return 0;
        } else if(test==10) {
            union{DWORD bits;FLOAT value;} bad;bad.bits=0x7f800000;p.Base.X=bad.value;
            if(regionClipPlanePrepare(m,0,p,inputs,work))return 0;
        } else if(test==11) {
            p.Base=FVector(0,0,-352);m->Points(m->Surfs(0).pBase)=p.Base;
            if(!regionClipPlanePrepare(m,0,p,inputs,work)||inputs(0).Changed||inputs(0).UnchangedLegacy)return 0;
        }
        passed++;printf("UCMapKit|clip plane test|%d|pass\n",test);
    }
    printf("UCMapKit|clip plane tests|%d|12\n",passed);return 1;
}
