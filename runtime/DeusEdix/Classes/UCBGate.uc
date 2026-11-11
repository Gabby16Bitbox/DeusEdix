//=============================================================================
// UCBGate - "Gate": what comes in (its input Pass) goes on (Out) only while it is open; while it is closed, it says
// Blocked instead. Rules open it, close it or turn it round.
//   bClosed  it starts closed
//=============================================================================
class UCBGate extends UCBlock;

var() bool bClosed;

function Started()
{
	Value(Shown());
}

final function string Shown()
{
	if (bClosed)
		return "closed";
	return "open";
}

function Input(string InputName, string Args, Actor Caller)
{
	if (InputName == "Pass" && bClosed)
		Output("Blocked");
	else if (InputName == "Pass")
		Output("Out");
	else if (InputName == "Open" || InputName == "Close" || InputName == "Toggle")
	{
		if (InputName == "Toggle")
			bClosed = !bClosed;
		else
			bClosed = InputName == "Close";
		Value(Shown());
	}
	else
		Super.Input(InputName, Args, Caller);
}

defaultproperties
{
	Inputs(0)=(Id="Pass",Label="Go through it")
	Inputs(1)=(Id="Open",Label="Open it")
	Inputs(2)=(Id="Close",Label="Close it")
	Inputs(3)=(Id="Toggle",Label="Open or close it")
	Outputs(0)=(Id="Out",Label="lets it through")
	Outputs(1)=(Id="Blocked",Label="stops it (closed)")
}
