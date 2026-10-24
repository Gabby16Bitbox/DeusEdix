//=============================================================================
// UCNavNative - the routes on a map's walkable area, in C++ (DeusEdixNav.dll, native/NavRoute.h): A* over the
// polygons of a UCNavMesh, then the funnel. UCNavMesh.Route calls it. The package is DeusEdixNav, the same for every
// project and for the original game and Revision. Its DLL must be next to it in System: without it the engine stops
// as soon as it loads the package ("'DeusEdixNav' is not a DLL package").
//=============================================================================
class UCNavNative extends Object
	native
	abstract;

// The route from From to To on the walkable area of Mesh (a UCNavMesh: its arrays are read where they are), into
// Mesh.Corner[0..]: the number of corners (To the last), 0 when there is no way on the walkable area.
native static final function int Route(Object Mesh, vector From, vector To);
