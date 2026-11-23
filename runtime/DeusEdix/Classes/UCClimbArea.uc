//=============================================================================
// UCClimbArea - a climbable area of the map editor (+ Create > Ladder (climb)) that the rules turn on and off.
// Its walls are a ladder of the game: an invisible skin with the game's ladder texture, built into the map, which the
// engine finds with a trace round the player's feet. That trace stops on movers: the area's slabs (UCClimbBlock, their
// Tag its name) wait inside the wall while it is on and come out over the skin while it is off. So the climbing is
// the game's own. The editor builds it only for an area a rule uses or that starts off (editor/climb.py).
//   bOff  it starts off: its slabs come out when the map starts (not KeyNum 1: the editor takes a mover's place as
//         the one of its KeyNum, so a slab built at key 0 with KeyNum 1 would have no way out)
//=============================================================================
class UCClimbArea extends UCBlock;

var() bool bOff;
var bool bSet;          // a rule turned it on or off already

function Started()
{
	if (bSet)
		Value(Shown());
	else
		SetOff(bOff);
}

final function string Shown()
{
	if (bOff)
		return "off";
	return "on";
}

final function SetOff(bool bNow)
{
	local UCClimbBlock B;

	bOff = bNow;
	bSet = True;
	foreach AllActors(class'UCClimbBlock', B, Name)
	{
		if (bOff)
			B.InterpolateTo(1, B.MoveTime);
		else
			B.InterpolateTo(0, B.MoveTime);
	}
	Value(Shown());
}

function Input(string InputName, string Args, Actor Caller)
{
	if (InputName == "On")
		SetOff(false);
	else if (InputName == "Off")
		SetOff(true);
	else if (InputName == "Toggle")
		SetOff(!bOff);
	else
		Super.Input(InputName, Args, Caller);
}

defaultproperties
{
	Inputs(0)=(Id="On",Label="Turn it on")
	Inputs(1)=(Id="Off",Label="Turn it off")
	Inputs(2)=(Id="Toggle",Label="Turn it on or off")
}
