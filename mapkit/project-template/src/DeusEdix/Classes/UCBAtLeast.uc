//=============================================================================
// UCBAtLeast - "At least N of these states": it looks at some states every half second, as the rules do, and says
// Reached when enough of them are Yes, Lost when they no longer are. It can keep a state of its own, Yes while
// enough hold, that conditions and the Story's dialogues read like any other (a derived state).
//   States     the states, separated by commas; "!Name" counts while that state is No
//   Need       how many must hold (0: all of them)
//   StateName  the state it keeps (empty: none)
// The first look only takes how things are (it says nothing), as a rule "when a condition becomes true".
//=============================================================================
class UCBAtLeast extends UCBlock;

var() string States;
var() int    Need;
var() string StateName;
var int  Holding;             // how many hold, at the last look
var bool bEnough;

final function int NeedNow()
{
	if (Need > 0)
		return Need;
	return Max(1, Items(States));
}

final function int HoldNow()
{
	local int k, n;
	local string S;

	for (k = 0; k < Items(States); k++)
	{
		S = Item(States, k);
		if (Left(S, 1) == "!")
		{
			if (!GetState(FlagName(Mid(S, 1))))
				n++;
		}
		else if (S != "" && GetState(FlagName(S)))
			n++;
	}
	return n;
}

final function Keep()
{
	if (FlagName(StateName) != "")
		SetState(FlagName(StateName), bEnough);
}

function Started()
{
	Holding = HoldNow();
	bEnough = Holding >= NeedNow();
	Keep();
	Value(Holding $ "/" $ NeedNow() $ " hold");
}

function Repeat()
{
	local int n;

	n = HoldNow();
	if (n == Holding)
		return;
	Holding = n;
	Value(Holding $ "/" $ NeedNow() $ " hold");
	if ((Holding >= NeedNow()) == bEnough)
		return;
	bEnough = !bEnough;
	Keep();
	if (bEnough)
		Output("Reached");
	else
		Output("Lost");
}

defaultproperties
{
	RepeatEvery=0.500000
	Outputs(0)=(Id="Reached",Label="enough of them hold")
	Outputs(1)=(Id="Lost",Label="no longer enough hold")
}
