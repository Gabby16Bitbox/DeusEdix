//=============================================================================
// UCNavMesh - the walkable area of the map for the game's scripts (Gabby, 17 Oct 2026). The map editor makes
// it with Recast (View > Walkable area) and bakes it at Rebuild, as polygons, when characters of the map are
// sent somewhere "on the walkable area" (Walk / Run to a place).
//
// Route(from, to): the route on the polygons, computed in C++ by DeusEdixNav.UCNavNative (DeusEdixNav.dll): A*,
// then the funnel (the straight line that cuts the corners, as Detour does) into Corner[0..NumCorners-1], the last
// one "to". UCNavRoute walks a character through them with the game's own GoingTo / RunningTo, so it opens doors,
// turns and animates as the game does.
//
// The polygons are numbers in the map (editor/navbake.py writes them): polygon p has Sides[p] corners (3 to 6),
// corner k at CornerX/Y/Z[p * 6 + k] (Unreal units, on the floor), and Across[p * 6 + k] is the polygon across
// its edge from corner k to k + 1, or -1. UnrealScript has no dynamic arrays, so they are sized for the largest
// walkable area: 2048 polygons. For scripts:
//     class'UCNavRoute'.static.Send(somePawn, aPlace, bRun)
//     M = class'UCNavMesh'.static.Of(self); if (M != None && M.Route(a, b)) ... M.CornerAt(i) ...
//=============================================================================
class UCNavMesh extends Info;

var() int NumPolys;
var() byte Sides[2048];
var() float CornerX[12288], CornerY[12288], CornerZ[12288];
var() int Across[12288];

var transient vector Corner[64];            // the last route (UCNavNative writes it)
var transient int NumCorners;
var transient bool bLogged;

// The map's walkable area, or None.
static function UCNavMesh Of(Actor anyone)
{
	local UCNavMesh M;

	if (anyone == None)
		return None;
	foreach anyone.AllActors(class'UCNavMesh', M)
		break;
	return M;
}

// corner i of the last route (other objects' code cannot index Corner itself: it is too big)
function vector CornerAt(int i)
{
	return Corner[i];
}

// The route from a to b on the walkable area: Corner[0..NumCorners-1] (b the last). False: no way on it.
function bool Route(vector a, vector b)
{
	if (!bLogged)
	{
		bLogged = True;
		Log("UCNavMesh:" @ NumPolys @ "polygons");
	}
	NumCorners = class'DeusEdixNav.UCNavNative'.static.Route(self, a, b);
	return NumCorners > 0;
}

defaultproperties
{
     bHidden=True
}
