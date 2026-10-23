#include "region_duplicate_junction_tests.h"
static int regionUniqueJunctionSelfTest() {
    if(!regionDuplicateJunctionSelfTest())return 0;
    if(!regionJunctionSelfTest())return 0;
    TArray<FVector> square;
    square.AddItem(FVector(0,0,0));square.AddItem(FVector(4,0,0));
    square.AddItem(FVector(4,4,0));square.AddItem(FVector(0,4,0));
    FVector normal(0,0,1);DOUBLE t=0.;INT count=0;
    if(regionUniqueJunctionEdge(square,0,4,FVector(2,0,0),normal,t)!=0||t!=.5)return 0;count++;
    if(regionUniqueJunctionEdge(square,0,4,FVector(2,.001f,0),normal,t)!=0)return 0;count++;
    if(regionUniqueJunctionEdge(square,0,4,FVector(2,.003f,0),normal,t)!=INDEX_NONE)return 0;count++;
    if(regionUniqueJunctionEdge(square,0,4,FVector(2,0,.009f),normal,t)!=0)return 0;count++;
    if(regionUniqueJunctionEdge(square,0,4,FVector(2,0,.011f),normal,t)!=INDEX_NONE)return 0;count++;
    if(regionUniqueJunctionEdge(square,0,4,FVector(0,0,0),normal,t)!=INDEX_NONE)return 0;count++;
    if(regionUniqueJunctionEdge(square,0,4,FVector(.001f,0,0),normal,t)!=INDEX_NONE)return 0;count++;
    if(regionUniqueJunctionEdge(square,0,4,FVector(2,2,0),normal,t)!=INDEX_NONE)return 0;count++;
    // Exact native-float counterexample from Canal Brush1682 face10. The new
    // point is close to two different edges of a very acute original corner.
    TArray<FVector> acute;
    acute.AddItem(FVector(198.159729f,964.580688f,115));
    acute.AddItem(FVector(87.8639526f,963,120));
    acute.AddItem(FVector(87.8737793f,963.028259f,119.000748f));
    acute.AddItem(FVector(176.108231f,964.292847f,115));
    FVector n(.0130478926f,-.999517977f,-.0281710438f);n.Normalize();
    FVector ambiguous(198.136322f,964.580444f,115);
    if(regionIsOriginalCorner(acute,0,4,ambiguous))return 0;
    if(regionUniqueJunctionEdge(acute,0,4,ambiguous,n,t)!=INDEX_NONE)return 0;count++;
    // The exact same proposal remains valid when only its one actual edge is
    // present in an ordinary non-acute polygon. Do not disable junctions globally.
    TArray<FVector> ordinary;
    ordinary.AddItem(FVector(176,0,115));ordinary.AddItem(FVector(200,0,115));
    ordinary.AddItem(FVector(200,0,125));ordinary.AddItem(FVector(176,0,125));
    if(regionUniqueJunctionEdge(ordinary,0,4,FVector(198.136322f,0,115),FVector(0,1,0),t)!=0)return 0;count++;
    printf("UCMapKit|unique junction tests|%d passed\n",count);return 1;
}
