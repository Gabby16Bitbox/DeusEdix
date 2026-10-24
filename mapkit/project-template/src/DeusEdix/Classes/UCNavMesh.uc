//=============================================================================
// UCNavMesh - the walkable area of the map for the game's scripts (Gabby, 17 Oct 2026). The map editor makes
// it with Recast (View > Walkable area) and bakes it at Rebuild, as polygons, when characters of the map are
// sent somewhere "on the walkable area" (Walk / Run to a place). Plain UnrealScript, no native code: it works
// the same in Revision and in the original Deus Ex.
//
// Route(from, to): A* over the polygons, then the funnel (the straight line that cuts the corners, as Detour
// does): Corner[0..NumCorners-1], the last one is "to". UCNavRoute walks a character through them with the
// game's own GoingTo / RunningTo, so it opens doors, turns and animates as the game does.
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

var transient bool bLoaded;
var transient float CentreX[2048], CentreY[2048], CentreZ[2048];      // the middle of each polygon
var transient float MinX[2048], MinY[2048], MaxX[2048], MaxY[2048], MinZ[2048], MaxZ[2048];     // and its box
// the search (A*): the cost of the way to a polygon and the estimate of the whole way through it, the polygon
// it was reached from, the search that saw it and the one that closed it; the open polygons in a heap by Estimate
var transient float WayCost[2048], Estimate[2048];
var transient int CameFrom[2048], SeenIn[2048], ClosedIn[2048], Heap[2048], HeapPos[2048];
var transient int HeapN, Search;
var transient int Way[2048];
var transient int NumWay;
// the portals between the polygons of the way (the ends of the edge each one crosses), and the route
var transient float PortalLeftX[2049], PortalLeftY[2049], PortalLeftZ[2049];
var transient float PortalRightX[2049], PortalRightY[2049], PortalRightZ[2049];
var transient vector Corner[64];
var transient int NumCorners;

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

// The middles and boxes of the polygons, once. A polygon without 3 to 6 sides is left out of the search.
function bool Load()
{
	local int p, k, n, b;

	if (bLoaded)
		return NumPolys > 0;
	bLoaded = True;
	if (NumPolys > 2048)
		NumPolys = 2048;
	for (p = 0; p < NumPolys; p++)
	{
		n = Sides[p];
		if (n < 3 || n > 6)
		{
			Sides[p] = 0;
			continue;
		}
		b = p * 6;
		CentreX[p] = 0;
		CentreY[p] = 0;
		CentreZ[p] = 0;
		for (k = 0; k < n; k++)
		{
			CentreX[p] += CornerX[b + k];
			CentreY[p] += CornerY[b + k];
			CentreZ[p] += CornerZ[b + k];
			if (k == 0 || CornerX[b + k] < MinX[p]) MinX[p] = CornerX[b + k];
			if (k == 0 || CornerX[b + k] > MaxX[p]) MaxX[p] = CornerX[b + k];
			if (k == 0 || CornerY[b + k] < MinY[p]) MinY[p] = CornerY[b + k];
			if (k == 0 || CornerY[b + k] > MaxY[p]) MaxY[p] = CornerY[b + k];
			if (k == 0 || CornerZ[b + k] < MinZ[p]) MinZ[p] = CornerZ[b + k];
			if (k == 0 || CornerZ[b + k] > MaxZ[p]) MaxZ[p] = CornerZ[b + k];
		}
		CentreX[p] /= n;
		CentreY[p] /= n;
		CentreZ[p] /= n;
	}
	Log("UCNavMesh:" @ NumPolys @ "polygons");
	return NumPolys > 0;
}

// x, y inside polygon i (seen from above; either winding)
function bool Inside(int i, float x, float y)
{
	local int k, k2, b, n, pos, neg;
	local float c;

	b = i * 6;
	n = Sides[i];
	for (k = 0; k < n; k++)
	{
		k2 = k + 1;
		if (k2 == n)
			k2 = 0;
		c = (CornerX[b + k2] - CornerX[b + k]) * (y - CornerY[b + k])
			- (CornerY[b + k2] - CornerY[b + k]) * (x - CornerX[b + k]);
		if (c > 0.5)
			pos++;
		else if (c < -0.5)
			neg++;
	}
	return pos == 0 || neg == 0;
}

// How far x, y is from polygon i, seen from above (0: inside it).
function float PolyDist(int i, float x, float y)
{
	local int k, k2, b, n;
	local float ex, ey, f, dx, dy, d, best;

	if (Inside(i, x, y))
		return 0;
	b = i * 6;
	n = Sides[i];
	best = 100000000;
	for (k = 0; k < n; k++)
	{
		k2 = k + 1;
		if (k2 == n)
			k2 = 0;
		ex = CornerX[b + k2] - CornerX[b + k];
		ey = CornerY[b + k2] - CornerY[b + k];
		f = ex * ex + ey * ey;
		if (f > 0)
			f = FClamp(((x - CornerX[b + k]) * ex + (y - CornerY[b + k]) * ey) / f, 0, 1);
		dx = CornerX[b + k] + ex * f - x;
		dy = CornerY[b + k] + ey * f - y;
		d = dx * dx + dy * dy;
		if (d < best)
			best = d;
	}
	return Sqrt(best);
}

// The polygon under p (a character's location, or a place: up to 140 units over its floor), or -1. Just off
// the mesh (it keeps 20 units from the walls: a place by a wall), the nearest polygon within 200 units.
function int FindPoly(vector p)
{
	local int i, best, near;
	local float d, bestD, nearD;

	best = -1;
	near = -1;
	bestD = 1000000;
	nearD = 200;
	for (i = 0; i < NumPolys; i++)
	{
		if (Sides[i] == 0 || p.Z < MinZ[i] - 40 || p.Z > MaxZ[i] + 140)
			continue;
		if (p.X < MinX[i] - nearD || p.X > MaxX[i] + nearD || p.Y < MinY[i] - nearD || p.Y > MaxY[i] + nearD)
			continue;
		d = PolyDist(i, p.X, p.Y);
		if (d == 0)
		{
			d = Abs(p.Z - (CentreZ[i] + 45));
			if (d < bestD)
			{
				bestD = d;
				best = i;
			}
		}
		else if (best < 0 && d < nearD)
		{
			nearD = d;
			near = i;
		}
	}
	if (best >= 0)
		return best;
	return near;
}

// ---------------------------------------------------------------- A* over the polygons
function HeapUp(int i)
{
	local int par, p;

	p = Heap[i];
	while (i > 0)
	{
		par = (i - 1) / 2;
		if (Estimate[Heap[par]] <= Estimate[p])
			break;
		Heap[i] = Heap[par];
		HeapPos[Heap[i]] = i;
		i = par;
	}
	Heap[i] = p;
	HeapPos[p] = i;
}

function HeapPush(int p)
{
	Heap[HeapN] = p;
	HeapPos[p] = HeapN;
	HeapN++;
	HeapUp(HeapN - 1);
}

function int HeapPop()
{
	local int top, p, i, c;

	top = Heap[0];
	HeapN--;
	if (HeapN > 0)
	{
		p = Heap[HeapN];
		i = 0;
		while (True)
		{
			c = i * 2 + 1;
			if (c >= HeapN)
				break;
			if (c + 1 < HeapN && Estimate[Heap[c + 1]] < Estimate[Heap[c]])
				c++;
			if (Estimate[Heap[c]] >= Estimate[p])
				break;
			Heap[i] = Heap[c];
			HeapPos[Heap[i]] = i;
			i = c;
		}
		Heap[i] = p;
		HeapPos[p] = i;
	}
	return top;
}

function float CentreDist(int a, int b)
{
	return Sqrt((CentreX[a] - CentreX[b]) * (CentreX[a] - CentreX[b]) + (CentreY[a] - CentreY[b]) * (CentreY[a] - CentreY[b])
		+ (CentreZ[a] - CentreZ[b]) * (CentreZ[a] - CentreZ[b]));
}

// The polygons from s to t (Way[0..NumWay-1]), or False when t cannot be reached from s.
function bool FindWay(int s, int t)
{
	local int p, q, k, b, n, steps;
	local float cost;

	Search++;
	HeapN = 0;
	WayCost[s] = 0;
	Estimate[s] = CentreDist(s, t);
	CameFrom[s] = -1;
	SeenIn[s] = Search;
	HeapPush(s);
	while (HeapN > 0 && steps < 4096)
	{
		steps++;
		p = HeapPop();
		if (p == t)
			break;
		ClosedIn[p] = Search;
		b = p * 6;
		n = Sides[p];
		for (k = 0; k < n; k++)
		{
			q = Across[b + k];
			if (q < 0 || q >= NumPolys || Sides[q] == 0 || ClosedIn[q] == Search)
				continue;
			cost = WayCost[p] + CentreDist(p, q);
			if (SeenIn[q] != Search)
			{
				SeenIn[q] = Search;
				WayCost[q] = cost;
				Estimate[q] = cost + CentreDist(q, t);
				CameFrom[q] = p;
				HeapPush(q);
			}
			else if (cost < WayCost[q])
			{
				WayCost[q] = cost;
				Estimate[q] = cost + CentreDist(q, t);
				CameFrom[q] = p;
				HeapUp(HeapPos[q]);
			}
		}
	}
	if (SeenIn[t] != Search)
		return False;
	NumWay = 0;
	for (p = t; p >= 0 && NumWay < 2048; p = CameFrom[p])
	{
		Way[NumWay] = p;
		NumWay++;
	}
	for (k = 0; k < NumWay / 2; k++)              // start first
	{
		p = Way[k];
		Way[k] = Way[NumWay - 1 - k];
		Way[NumWay - 1 - k] = p;
	}
	return True;
}

// ---------------------------------------------------------------- the funnel
// twice the signed area of a, b, c (seen from above)
function float Area2(float px, float py, float qx, float qy, float sx, float sy)
{
	return (sx - px) * (qy - py) - (qx - px) * (sy - py);
}

// portal i: the edge shared by Way[i - 1] and Way[i], its left and right ends as one walks through it
function bool Portal(int i)
{
	local int a, c, k, k2, b, n;
	local float dx, dy, mx, my;

	a = Way[i - 1];
	c = Way[i];
	b = a * 6;
	n = Sides[a];
	for (k = 0; k < n; k++)
		if (Across[b + k] == c)
			break;
	if (k == n)
		return False;
	k2 = k + 1;
	if (k2 == n)
		k2 = 0;
	dx = CentreX[c] - CentreX[a];
	dy = CentreY[c] - CentreY[a];
	mx = (CornerX[b + k] + CornerX[b + k2]) / 2;
	my = (CornerY[b + k] + CornerY[b + k2]) / 2;
	if (dx * (CornerY[b + k] - my) - dy * (CornerX[b + k] - mx) > 0)     // corner k on the left
	{
		PortalLeftX[i] = CornerX[b + k];
		PortalLeftY[i] = CornerY[b + k];
		PortalLeftZ[i] = CornerZ[b + k];
		PortalRightX[i] = CornerX[b + k2];
		PortalRightY[i] = CornerY[b + k2];
		PortalRightZ[i] = CornerZ[b + k2];
	}
	else
	{
		PortalLeftX[i] = CornerX[b + k2];
		PortalLeftY[i] = CornerY[b + k2];
		PortalLeftZ[i] = CornerZ[b + k2];
		PortalRightX[i] = CornerX[b + k];
		PortalRightY[i] = CornerY[b + k];
		PortalRightZ[i] = CornerZ[b + k];
	}
	return True;
}

// a corner of the route at an end of portal i (bLeft: its left end), 20 units into the portal (off the wall)
function AddCorner(int i, bool bLeft)
{
	local vector c, o;
	local float w;

	if (NumCorners >= 63)
		return;
	if (bLeft)
	{
		c.X = PortalLeftX[i]; c.Y = PortalLeftY[i]; c.Z = PortalLeftZ[i];
		o.X = PortalRightX[i]; o.Y = PortalRightY[i]; o.Z = PortalRightZ[i];
	}
	else
	{
		c.X = PortalRightX[i]; c.Y = PortalRightY[i]; c.Z = PortalRightZ[i];
		o.X = PortalLeftX[i]; o.Y = PortalLeftY[i]; o.Z = PortalLeftZ[i];
	}
	w = VSize((o - c) * vect(1,1,0));
	if (w > 1)
		c += (o - c) * (FMin(20, w / 2) / w);
	Corner[NumCorners] = c;
	NumCorners++;
}

// The corners of the way from a to b (b the last one; the others on the floor).
function MakeCorners(vector a, vector b)
{
	local int n, i, apex, left, right;
	local float apexX, apexY, leftX, leftY, rightX, rightY;

	n = NumWay + 1;                 // portal 0: the start, 1..NumWay-1: the edges, NumWay: the end
	PortalLeftX[0] = a.X;
	PortalLeftY[0] = a.Y;
	PortalLeftZ[0] = a.Z;
	PortalRightX[0] = a.X;
	PortalRightY[0] = a.Y;
	PortalRightZ[0] = a.Z;
	PortalLeftX[NumWay] = b.X;
	PortalLeftY[NumWay] = b.Y;
	PortalLeftZ[NumWay] = b.Z;
	PortalRightX[NumWay] = b.X;
	PortalRightY[NumWay] = b.Y;
	PortalRightZ[NumWay] = b.Z;
	for (i = 1; i < NumWay; i++)
		if (!Portal(i))
		{
			PortalLeftX[i] = CentreX[Way[i]];
			PortalLeftY[i] = CentreY[Way[i]];
			PortalLeftZ[i] = CentreZ[Way[i]];
			PortalRightX[i] = PortalLeftX[i];
			PortalRightY[i] = PortalLeftY[i];
			PortalRightZ[i] = PortalLeftZ[i];
		}
	NumCorners = 0;
	apexX = a.X; apexY = a.Y;
	leftX = PortalLeftX[0]; leftY = PortalLeftY[0];
	rightX = PortalRightX[0]; rightY = PortalRightY[0];
	apex = 0; left = 0; right = 0;
	for (i = 1; i < n && NumCorners < 63; i++)
	{
		// the right side of the funnel
		if (Area2(apexX, apexY, rightX, rightY, PortalRightX[i], PortalRightY[i]) <= 0)
		{
			if ((apexX == rightX && apexY == rightY) || Area2(apexX, apexY, leftX, leftY, PortalRightX[i], PortalRightY[i]) > 0)
			{
				rightX = PortalRightX[i]; rightY = PortalRightY[i];
				right = i;
			}
			else
			{
				AddCorner(left, True);              // the right side crossed the left: turn at the left
				apex = left;
				apexX = leftX; apexY = leftY;
				rightX = apexX; rightY = apexY;
				right = apex;
				i = apex;
				continue;
			}
		}
		// the left side
		if (Area2(apexX, apexY, leftX, leftY, PortalLeftX[i], PortalLeftY[i]) >= 0)
		{
			if ((apexX == leftX && apexY == leftY) || Area2(apexX, apexY, rightX, rightY, PortalLeftX[i], PortalLeftY[i]) < 0)
			{
				leftX = PortalLeftX[i]; leftY = PortalLeftY[i];
				left = i;
			}
			else
			{
				AddCorner(right, False);
				apex = right;
				apexX = rightX; apexY = rightY;
				leftX = apexX; leftY = apexY;
				left = apex;
				i = apex;
				continue;
			}
		}
	}
	if (NumCorners > 0 && VSize(Corner[NumCorners - 1] - b) < 2)
		NumCorners--;                       // the funnel's last turn was at the place itself
	Corner[NumCorners] = b;
	NumCorners++;
}

// corner i of the last route (other objects' code cannot index Corner itself: it is too big)
function vector CornerAt(int i)
{
	return Corner[i];
}

// The route from a to b on the walkable area: Corner[0..NumCorners-1] (b the last). False: no way on it.
function bool Route(vector a, vector b)
{
	local int s, t;

	NumCorners = 0;
	if (!Load())
		return False;
	s = FindPoly(a);
	t = FindPoly(b);
	if (s < 0 || t < 0)
		return False;
	if (s == t)
	{
		Corner[0] = b;
		NumCorners = 1;
		return True;
	}
	if (!FindWay(s, t))
		return False;
	MakeCorners(a, b);
	return NumCorners > 0;
}

defaultproperties
{
     bHidden=True
}
