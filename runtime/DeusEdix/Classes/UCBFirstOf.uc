//=============================================================================
// UCBFirstOf - "First of": a race. Whichever of its inputs In1..In6 comes first, it says First<n> for it; the
// others after it are not heard until Reset. With a time limit, the clock starts at Start (or with the map) and,
// when it runs out before any of them, it says TimedOut instead.
//   NumWays        how many inputs it has (2 to 6)
//   TimeLimit      seconds (0: no limit)
//   bClockAtStart  the clock starts when the map starts (else at its input Start)
//=============================================================================
class UCBFirstOf extends UCBlock;

var() int   NumWays;
var() float TimeLimit;
var() bool  bClockAtStart;
var bool bOver;               // one came first, or the time ran out: until Reset
var bool bClock;              // the clock runs

final function int Ways()
{
	return Clamp(NumWays, 2, 6);
}

final function StartClock()
{
	if (bOver || TimeLimit <= 0)
		return;
	bClock = True;
	SetTimer(TimeLimit, False);
	Value("clock " $ int(TimeLimit + 0.5));
}

final function StopClock()
{
	bClock = False;
	SetTimer(0, False);
}

function Started()
{
	Value("waiting");
	if (bClockAtStart)
		StartClock();
}

// the clock ran out (UCScript.Timer calls Repeat)
function Repeat()
{
	if (!bClock || bOver)
		return;
	bClock = False;
	bOver = True;
	Value("timed out");
	Output("TimedOut");
}

final function Came(int k)
{
	if (bOver || k < 1 || k > Ways())
		return;
	bOver = True;
	StopClock();
	Value("first " $ k);
	Output("First" $ k);
}

function Input(string InputName, string Args, Actor Caller)
{
	if (Left(InputName, 2) == "In" && Len(InputName) == 3 && int(Mid(InputName, 2)) >= 1)
		Came(int(Mid(InputName, 2)));
	else if (InputName == "Start")
		StartClock();
	else if (InputName == "Reset")
	{
		StopClock();
		bOver = False;
		Value("waiting");
	}
	else
		Super.Input(InputName, Args, Caller);
}

defaultproperties
{
	NumWays=2
	Inputs(0)=(Id="In1",Label="1 comes")
	Inputs(1)=(Id="In2",Label="2 comes")
	Inputs(2)=(Id="In3",Label="3 comes")
	Inputs(3)=(Id="In4",Label="4 comes")
	Inputs(4)=(Id="In5",Label="5 comes")
	Inputs(5)=(Id="In6",Label="6 comes")
	Inputs(6)=(Id="Start",Label="Start the clock")
	Inputs(7)=(Id="Reset",Label="Start the race again")
	Outputs(0)=(Id="First1",Label="1 came first")
	Outputs(1)=(Id="First2",Label="2 came first")
	Outputs(2)=(Id="First3",Label="3 came first")
	Outputs(3)=(Id="First4",Label="4 came first")
	Outputs(4)=(Id="First5",Label="5 came first")
	Outputs(5)=(Id="First6",Label="6 came first")
	Outputs(6)=(Id="TimedOut",Label="the time ran out first")
}
