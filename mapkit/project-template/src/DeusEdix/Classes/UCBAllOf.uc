//=============================================================================
// UCBAllOf - "All of these": each object whose rule ticks it off (its input Add) counts once (a rule on no object:
// the rule); when they all have, it says Done. One can take its tick back (TakeBack: a lever turned off again), and
// Reset empties it.
//   Need     how many different ones must tick it off (0: all of those whose rules tick it off)
//   bAgain   once Done, it starts empty again (else it stays done until Reset)
// (no break inside an if of a switch: the compiler of the game fails on it, "Internal fixup error")
//=============================================================================
class UCBAllOf extends UCBlock;

var() int  Need;
var() bool bAgain;
var string Ticked[32];        // who ticked it off (UCBlock.WhoOf)
var int    NTicked;
var int    NeedNow;           // Need, or the rules counted when it started
var bool   bAllDone;

function Started()
{
	NeedNow = Need;
	if (NeedNow <= 0)
		NeedNow = Max(1, RulesCalling("Add"));
	Value(NTicked $ "/" $ NeedNow);
}

final function int TickOf(string Who)
{
	local int i;

	for (i = 0; i < NTicked; i++)
		if (Ticked[i] ~= Who)
			return i;
	return -1;
}

final function Clear()
{
	local int i;

	for (i = 0; i < NTicked; i++)
		Ticked[i] = "";
	NTicked = 0;
	bAllDone = False;
}

final function Add(string Who)
{
	if (bAllDone || TickOf(Who) >= 0 || NTicked >= ArrayCount(Ticked))
		return;
	Ticked[NTicked] = Who;
	NTicked++;
	Value(NTicked $ "/" $ NeedNow);
	if (NTicked >= NeedNow)
	{
		bAllDone = True;
		if (bAgain)
			Clear();
		Output("Done");
	}
}

final function TakeBack(string Who)
{
	local int i;

	i = TickOf(Who);
	if (i < 0)
		return;
	for (i = i; i < NTicked - 1; i++)
		Ticked[i] = Ticked[i + 1];
	NTicked--;
	Ticked[NTicked] = "";
	Value(NTicked $ "/" $ NeedNow);
	if (bAllDone)
	{
		bAllDone = False;
		Output("Undone");
	}
}

function Input(string InputName, string Args, Actor Caller)
{
	if (InputName == "Add")
		Add(WhoOf(Caller));
	else if (InputName == "TakeBack")
		TakeBack(WhoOf(Caller));
	else if (InputName == "Reset")
	{
		Clear();
		Value("0/" $ NeedNow);
	}
	else
		Super.Input(InputName, Args, Caller);
}

defaultproperties
{
	Inputs(0)=(Id="Add",Label="Tick it off")
	Inputs(1)=(Id="TakeBack",Label="Take the tick back")
	Inputs(2)=(Id="Reset",Label="Start it again")
	Outputs(0)=(Id="Done",Label="all of them have happened")
	Outputs(1)=(Id="Undone",Label="one is taken back")
}
