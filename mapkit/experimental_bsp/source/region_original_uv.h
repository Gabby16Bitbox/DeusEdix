// Compatibility of unchanged source brushes with their Original compiled UVs.
// This never changes geometry or accepts a result: the ordinary Full gate stays.
struct FRegionUVSource {
    ABrush* Actor;DWORD Flags;INT Operation,Start,Count;
};
struct FRegionUVMapping {
    ABrush* Actor;UTexture* Texture;DWORD Flags;INT Face,PanU,PanV;
    FVector Base,U,V,Normal;INT Source;
};
static TArray<FRegionUVSource> regionUVSources;
static TArray<FPoly> regionUVFaces;
static TArray<FRegionUVMapping> regionUVMappings;
static UModel* regionUVWorld=NULL;

static int regionUVFinite(const FVector& v) {return _finite(v.X)&&_finite(v.Y)&&_finite(v.Z);}
static int regionUVValid(const FPoly& p) {
    if(p.NumVertices<3 || p.NumVertices>FPoly::MAX_VERTICES ||
       !regionUVFinite(p.Base)||!regionUVFinite(p.Normal)||!regionUVFinite(p.TextureU)||!regionUVFinite(p.TextureV))return 0;
    for(int k=0;k<p.NumVertices;k++)if(!regionUVFinite(p.Vertex[k]))return 0;
    return 1;
}
static int regionUVSameSourceFace(const FPoly& a,const FPoly& b) {
    if(!regionUVValid(a)||!regionUVValid(b)||a.NumVertices!=b.NumVertices||
       a.Base!=b.Base||a.Normal!=b.Normal||a.TextureU!=b.TextureU||a.TextureV!=b.TextureV||
       a.Texture!=b.Texture||a.PolyFlags!=b.PolyFlags||a.PanU!=b.PanU||a.PanV!=b.PanV||
       a.iLink!=b.iLink||a.iBrushPoly!=b.iBrushPoly)return 0;
    for(int k=0;k<a.NumVertices;k++)if(a.Vertex[k]!=b.Vertex[k])return 0;
    return 1;
}
static int regionUVSameOwner(const FBspSurf& a,const FRegionUVMapping& b) {
    return a.Actor==b.Actor&&a.iBrushPoly==b.Face&&a.Texture==b.Texture&&
        a.PolyFlags==b.Flags&&a.PanU==b.PanU&&a.PanV==b.PanV;
}
static int regionUVSameMapping(const FRegionUVMapping& a,const FRegionUVMapping& b) {
    // Exact metadata equality is a conservative subset of affine equality.
    return a.Base==b.Base&&a.U==b.U&&a.V==b.V&&a.Normal==b.Normal;
}
static int regionUVNormalizedSourceMatch(const FRegionUVMapping& original,const FVector& normal) {
    // A full rebuild may normalize a historical normal-pool representative.
    // Only the EXACT native normalization and EXACT immutable authored normal
    // authorize this UV-only repair. No normal, plane or vertex is rewritten.
    if(!regionUVFinite(original.Normal)||!regionUVFinite(normal)||normal.IsZero()||
       original.Source<0||original.Source>=regionUVSources.Num())return 0;
    FRegionUVSource& source=regionUVSources(original.Source);
    if(source.Actor!=original.Actor||original.Face<0||original.Face>=source.Count||
       source.Start<0||source.Start+original.Face>=regionUVFaces.Num())return 0;
    FPoly& authored=regionUVFaces(source.Start+original.Face);
    if(!regionUVValid(authored)||authored.Normal!=normal||original.Normal.SafeNormal()!=normal)return 0;
    // Sanity check against the SDK's existing normal-pool identity threshold:
    // reject grossly scaled/non-unit originals even if normalization agrees.
    FVector delta=original.Normal-normal;
    if(Abs(delta.X)>=THRESH_NORMALS_ARE_SAME||Abs(delta.Y)>=THRESH_NORMALS_ARE_SAME||
       Abs(delta.Z)>=THRESH_NORMALS_ARE_SAME)return 0;
    return 1;
}
static int regionUVChoose(const FBspSurf& s,const FVector& normal,
                         const TArray<FRegionUVMapping>& mappings,const TArray<INT>& unchanged,int& ambiguous) {
    int match=INDEX_NONE;ambiguous=0;
    for(int j=0;j<mappings.Num();j++) {
        const FRegionUVMapping& original=mappings(j);
        if(original.Source<0||original.Source>=unchanged.Num())return INDEX_NONE;
        if(!unchanged(original.Source)||!regionUVSameOwner(s,original))continue;
        if(match!=INDEX_NONE&&!regionUVSameMapping(mappings(match),original)){ambiguous=1;return INDEX_NONE;}
        match=j;
    }
    if(match!=INDEX_NONE&&normal!=mappings(match).Normal&&!regionUVNormalizedSourceMatch(mappings(match),normal))return INDEX_NONE;
    return match;
}
static int regionUVSnapshot() {
    regionUVWorld=NULL;regionUVSources.Empty();regionUVFaces.Empty();regionUVMappings.Empty();
    UModel* m=GEditor->Level->Model;TArray<INT> used;
    for(int n=0;n<m->Nodes.Num();n++)if(m->Nodes(n).NumVertices) {
        int sid=m->Nodes(n).iSurf;if(sid<0||sid>=m->Surfs.Num())return 0;
        if(used.FindItemIndex(sid)==INDEX_NONE)used.AddItem(sid);
    }
    for(int k=0;k<used.Num();k++) {
        FBspSurf& s=m->Surfs(used(k));ABrush* b=s.Actor;
        if(!b||!b->IsStaticBrush()||!b->Brush||!b->Brush->Polys||s.iBrushPoly<0||
           s.iBrushPoly>=b->Brush->Polys->Element.Num())continue;
        int source=INDEX_NONE;
        for(int q=0;q<regionUVSources.Num();q++)if(regionUVSources(q).Actor==b){source=q;break;}
        if(source==INDEX_NONE) {
            source=regionUVSources.Num();FRegionUVSource item;item.Actor=b;item.Flags=b->PolyFlags;item.Operation=b->CsgOper;
            item.Start=regionUVFaces.Num();item.Count=b->Brush->Polys->Element.Num();
            for(int f=0;f<b->Brush->Polys->Element.Num();f++) {
                FPoly p=surfaceWorld(b,f);if(!regionUVValid(p))return 0;regionUVFaces.AddItem(p);
            }
            regionUVSources.AddItem(item);
        }
        FRegionUVMapping value;value.Actor=s.Actor;value.Texture=s.Texture;value.Flags=s.PolyFlags;
        value.Face=s.iBrushPoly;value.PanU=s.PanU;value.PanV=s.PanV;value.Source=source;
        value.Base=m->Points(s.pBase);value.U=m->Vectors(s.vTextureU);value.V=m->Vectors(s.vTextureV);value.Normal=m->Vectors(s.vNormal);
        if(!regionUVFinite(value.Base)||!regionUVFinite(value.U)||!regionUVFinite(value.V)||!regionUVFinite(value.Normal))return 0;
        regionUVMappings.AddItem(value);
    }
    regionUVWorld=m;
    printf("UCMapKit|region UV snapshot|%d sources|%d used mappings\n",regionUVSources.Num(),regionUVMappings.Num());
    return 1;
}
static int regionUVRestore(UModel* m,UModel* world) {
    if(!regionUVWorld||regionUVWorld!=world)return 0;
    TArray<INT> unchanged;unchanged.AddZeroed(regionUVSources.Num());
    int changed=0,ambiguous=0,eligible=0,restored=0;
    for(int q=0;q<regionUVSources.Num();q++) {
        FRegionUVSource& old=regionUVSources(q);ABrush* b=old.Actor;
        if(!b||!b->Brush||!b->Brush->Polys||b->PolyFlags!=old.Flags||b->CsgOper!=old.Operation||
           b->Brush->Polys->Element.Num()!=old.Count){changed++;continue;}
        int same=1;
        for(int f=0;f<old.Count;f++)if(!regionUVSameSourceFace(regionUVFaces(old.Start+f),surfaceWorld(b,f))){same=0;break;}
        unchanged(q)=same;if(!same)changed++;
    }
    for(int i=0;i<m->Surfs.Num();i++) {
        FBspSurf& s=m->Surfs(i);int bad=0;
        int match=regionUVChoose(s,m->Vectors(s.vNormal),regionUVMappings,unchanged,bad);
        if(bad) {
            printf("UCMapKit|region UV refused|ambiguous Original mapping\n");
            return 0;
        }
        if(match==INDEX_NONE)continue;
        FRegionUVMapping& original=regionUVMappings(match);
        eligible++;
        if(m->Points(s.pBase)==original.Base&&m->Vectors(s.vTextureU)==original.U&&m->Vectors(s.vTextureV)==original.V)continue;
        s.pBase=m->Points.AddItem(original.Base);s.vTextureU=m->Vectors.AddItem(original.U);s.vTextureV=m->Vectors.AddItem(original.V);
        restored++;
    }
    printf("UCMapKit|region UV original|%d restored|%d eligible|%d ambiguous|%d changed sources\n",restored,eligible,ambiguous,changed);
    return 1;
}
