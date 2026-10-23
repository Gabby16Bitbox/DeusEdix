// Optional exact-anchor repair during CLIP. UV Base and geometric plane are
// different quantities. No vertex is projected and no tolerance is introduced.
// Inputs without an exact existing anchor keep the legacy construction and
// are explicitly counted; every ordinary Full gate remains mandatory.
struct FRegionClipPlaneInput {
    FBspSurf Surface;
    FVector Base,U,V,Normal;
    FPlane Plane;
    INT Changed,UnchangedLegacy;
};
static int regionClipPlaneFinite(const FVector& v) {
    return _finite(v.X)&&_finite(v.Y)&&_finite(v.Z);
}
static FLOAT regionClipNativePlaneW(const FVector& base,const FVector& normal) {
    // The legacy DLL sums x87 PC53 products before the final float store;
    // the modern host inline FPlane can round individual products to float.
    // A temporary anchor must agree under BOTH paths.
    DOUBLE sum=(DOUBLE)base.X*normal.X+(DOUBLE)base.Y*normal.Y+(DOUBLE)base.Z*normal.Z;
    return (FLOAT)sum;
}
static int regionClipPlaneExact(const FVector& base,const FVector& normal,const FPlane& plane) {
    return FPlane(base,normal)==plane&&regionClipNativePlaneW(base,normal)==plane.W;
}
static int regionClipPlaneOwner(const FBspSurf& a,const FBspSurf& b) {
    return a.Actor==b.Actor&&a.Texture==b.Texture&&a.PolyFlags==b.PolyFlags&&
        a.iBrushPoly==b.iBrushPoly&&a.PanU==b.PanU&&a.PanV==b.PanV;
}
static int regionClipPlaneMapping(const FRegionClipPlaneInput& a,const FRegionClipPlaneInput& b) {
    return a.Base==b.Base&&a.U==b.U&&a.V==b.V&&a.Normal==b.Normal;
}
static int regionClipPlanePrepare(UModel* scratch,INT source,FPoly& p,
                                   TArray<FRegionClipPlaneInput>& inputs,INT& work) {
    if(--work<0)return 0;
    unsigned short control;__asm fnstcw control
    if((control&0x0f00)!=0x0200)return 0;
    if(!scratch||source<0||source>=scratch->Nodes.Num())return 0;
    const FBspNode& n=scratch->Nodes(source);
    if(n.iSurf<0||n.iSurf>=scratch->Surfs.Num()||!regionClipPlaneFinite(n.Plane)||
       !_finite(n.Plane.W)||!_finite(n.Plane.SizeSquared())||n.Plane.SizeSquared()<=0)return 0;
    const FBspSurf& surf=scratch->Surfs(n.iSurf);
    if(surf.pBase<0||surf.pBase>=scratch->Points.Num()||surf.vNormal<0||surf.vNormal>=scratch->Vectors.Num()||
       surf.vTextureU<0||surf.vTextureU>=scratch->Vectors.Num()||surf.vTextureV<0||surf.vTextureV>=scratch->Vectors.Num())return 0;
    FRegionClipPlaneInput saved;saved.Surface=surf;saved.Base=scratch->Points(surf.pBase);
    saved.U=scratch->Vectors(surf.vTextureU);saved.V=scratch->Vectors(surf.vTextureV);
    saved.Normal=scratch->Vectors(surf.vNormal);saved.Plane=n.Plane;saved.Changed=0;saved.UnchangedLegacy=0;
    if(!regionClipPlaneFinite(saved.Base)||!regionClipPlaneFinite(saved.U)||!regionClipPlaneFinite(saved.V)||
       !regionClipPlaneFinite(saved.Normal)||!regionClipPlaneFinite(p.Base)||!regionClipPlaneFinite(p.Normal))return 0;
    if(!regionClipPlaneExact(p.Base,p.Normal,n.Plane)) {
        // Require exactly the existing normal. Only the temporary geometric
        // anchor is changed; a historical normal discrepancy is not repaired.
        if(p.Normal!=(FVector)n.Plane) {
            saved.UnchangedLegacy=1;new(inputs) FRegionClipPlaneInput(saved);return 1;
        }
        if(n.iVertPool<0||n.iVertPool+n.NumVertices>scratch->Verts.Num())return 0;
        INT found=0;
        // A temporary intercept encodes the already authoritative native
        // plane. It never becomes a polygon vertex or final texture origin.
        // Reject an inexact float32 roundtrip; do not enlarge a tolerance.
        INT axis=0;if(Abs(p.Normal.Y)>Abs(p.Normal.X))axis=1;
        if(Abs(p.Normal.Z)>Abs(axis==0?p.Normal.X:p.Normal.Y))axis=2;
        FLOAT component=axis==0?p.Normal.X:(axis==1?p.Normal.Y:p.Normal.Z);
        for(INT trial=0;trial<17&&!found;trial++) {
            FVector intercept(0,0,0);
            if(trial) {
                if(axis!=0)intercept.X=17.f*trial;
                if(axis!=1)intercept.Y=31.f*trial;
                if(axis!=2)intercept.Z=47.f*trial;
            }
            FLOAT coordinate=(n.Plane.W-(intercept|p.Normal))/component;
            if(axis==0)intercept.X=coordinate;else if(axis==1)intercept.Y=coordinate;else intercept.Z=coordinate;
            if(!regionClipPlaneFinite(intercept)||!regionClipPlaneExact(intercept,p.Normal,n.Plane))continue;
            // Avoid the existing SDK point-pool weld. This is only a choice
            // of plane representation, not a geometry acceptance tolerance.
            INT closePoint=0;
            for(INT q=0;q<scratch->Points.Num();q++) {
                if(--work<0)return 0;
                FVector delta=intercept-scratch->Points(q);
                if(intercept!=scratch->Points(q)&&Abs(delta.X)<THRESH_SPLIT_POLY_PRECISELY&&
                   Abs(delta.Y)<THRESH_SPLIT_POLY_PRECISELY&&Abs(delta.Z)<THRESH_SPLIT_POLY_PRECISELY){closePoint=1;break;}
            }
            if(!closePoint){p.Base=intercept;found=1;}
        }
        for(INT j=0;j<n.NumVertices;j++) {
            if(--work<0)return 0;
            INT index=scratch->Verts(n.iVertPool+j).pVertex;
            if(index<0||index>=scratch->Points.Num())return 0;
            FVector point=scratch->Points(index);if(!regionClipPlaneFinite(point))return 0;
            if(!found&&regionClipPlaneExact(point,p.Normal,n.Plane)){p.Base=point;found=1;}
        }
        if(found)saved.Changed=1;
        else saved.UnchangedLegacy=1;
    }
    new(inputs) FRegionClipPlaneInput(saved);return 1;
}
static int regionClipPlaneRestore(UModel* model,const TArray<FRegionClipPlaneInput>& inputs) {
    if(!model)return 0;
    INT work=4000000,restored=0,changed=0,legacy=0;
    for(INT k=0;k<inputs.Num();k++){changed+=inputs(k).Changed;legacy+=inputs(k).UnchangedLegacy;}
    if(!changed)return 1;
    for(INT sid=0;sid<model->Surfs.Num();sid++) {
        FBspSurf& surf=model->Surfs(sid);INT match=INDEX_NONE,needed=0;
        for(INT k=0;k<inputs.Num();k++) {
            if(--work<0)return 0;
            if(!regionClipPlaneOwner(surf,inputs(k).Surface))continue;
            if(match!=INDEX_NONE&&!regionClipPlaneMapping(inputs(match),inputs(k))){printf("UCMapKit|clip plane refused|ambiguous UV surface %d\n",sid);return 0;}
            match=k;needed|=inputs(k).Changed;
        }
        if(!needed)continue;
        const FRegionClipPlaneInput& saved=inputs(match);
        if(surf.vNormal<0||surf.vNormal>=model->Vectors.Num()||model->Vectors(surf.vNormal)!=saved.Normal){printf("UCMapKit|clip plane refused|normal surface %d\n",sid);return 0;}
        for(INT n=0;n<model->Nodes.Num();n++)if(model->Nodes(n).iSurf==sid) {
            INT found=0;
            for(INT k=0;k<inputs.Num();k++) {
                if(--work<0)return 0;
                if(regionClipPlaneOwner(surf,inputs(k).Surface)&&model->Nodes(n).Plane==inputs(k).Plane){found=1;break;}
            }
            if(!found){printf("UCMapKit|clip plane refused|output plane node %d surface %d plane %.9g %.9g %.9g %.9g\n",n,sid,model->Nodes(n).Plane.X,model->Nodes(n).Plane.Y,model->Nodes(n).Plane.Z,model->Nodes(n).Plane.W);return 0;}
        }
        surf.pBase=model->Points.AddItem(saved.Base);
        surf.vTextureU=model->Vectors.AddItem(saved.U);surf.vTextureV=model->Vectors.AddItem(saved.V);
        restored++;
    }
    printf("UCMapKit|clip native planes|%d corrected inputs|%d UV mappings restored|%d unchanged legacy inputs\n",changed,restored,legacy);
    return 1;
}

