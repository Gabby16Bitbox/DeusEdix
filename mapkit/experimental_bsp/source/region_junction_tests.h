// Calls the actual candidate predicate, including non-local original corners.
static int regionJunctionSelfTest() {
    TArray<FVector> corners;
    corners.AddItem(FVector(99,99,99)); // A different polygon's corner.
    corners.AddItem(FVector(-108.581764f,1540,144.238449f));
    corners.AddItem(FVector(-108,1540,144.222031f));
    corners.AddItem(FVector(-97.8845215f,1540,142.026566f));
    corners.AddItem(FVector(-97.4170609f,1540,143.442429f));
    corners.AddItem(FVector(-100.132591f,1540,144));
    int count=0;
    for(int i=1;i<corners.Num();i++) {
        if(!regionIsOriginalCorner(corners,1,5,corners(i)))return 0;count++;
    }
    // A genuinely new edge junction, even within the ordinary coincidence
    // threshold of an old point, is not silently classified as an old corner.
    if(regionIsOriginalCorner(corners,1,5,corners(0)))return 0;count++;
    if(regionIsOriginalCorner(corners,1,5,FVector(-104,1540,143)))return 0;count++;
    if(regionIsOriginalCorner(corners,1,5,corners(2)+FVector(.0001f,0,0)))return 0;count++;
    // Identical coordinates in another component do not suppress a valid
    // proposal for this polygon; ownership is scoped by start/count.
    if(regionIsOriginalCorner(corners,0,1,corners(2)))return 0;count++;
    printf("UCMapKit|region junction tests|%d passed\n",count);return 1;
}
