//=============================================================================
// UCClimbBlock - a slab of a climbable area that can be turned off (UCClimbArea; its Tag is the area's name). An
// invisible mover on a piece of the area's wall: key 0 inside the wall (the area can be climbed), key 1 just out of the
// ladder skin (it cannot: the engine's ladder trace stops on movers and never reaches the skin). It never moves by
// itself: only its area moves it.
//=============================================================================
class UCClimbBlock extends Mover;

function Bump(Actor Other);

defaultproperties
{
	InitialState=None
	MoverEncroachType=ME_IgnoreWhenEncroach
	MoveTime=0.100000
	NumKeys=2
	bHidden=True
}
