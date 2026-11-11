//=============================================================================
// UCBSwitch - "Switch": each time a rule asks (its input Next) it picks one of its ways, Out1..Out6, and says it:
//   Mode     "In turn": 1, 2, ... the last, then 1 again (two ways: a flip-flop); "In order": 1 to the last once,
//            then it says Over; "At random": any of them, each as often as its weight
//   NumWays  how many ways (2 to 6)
//   Weights  "At random": how likely each way is, "2,1,1" (empty or missing: as likely as the others)
// Reset starts it from the first way again.
//=============================================================================
class UCBSwitch extends UCBlock;

var() int    NumWays;
var() string Mode;
var() string Weights;
var int NextWay;              // the way it picks next (0 = the first), in turn and in order

final function int Ways()
{
	return Clamp(NumWays, 2, 6);
}

// the weight of way k (0 = the first) in Weights: "2,1,1"
final function float WeightOf(int k)
{
	local string rest, part;
	local int i;

	rest = Weights;
	for (i = 0; i <= k; i++)
	{
		if (rest == "")
			return 1.0;
		if (InStr(rest, ",") >= 0)
		{
			part = Left(rest, InStr(rest, ","));
			rest = Mid(rest, InStr(rest, ",") + 1);
		}
		else
		{
			part = rest;
			rest = "";
		}
	}
	if (part == "")
		return 1.0;
	return FMax(0.0, float(part));
}

final function int RandomWay()
{
	local float total, pick;
	local int k;

	for (k = 0; k < Ways(); k++)
		total += WeightOf(k);
	if (total <= 0)
		return Rand(Ways());
	pick = FRand() * total;
	for (k = 0; k < Ways() - 1; k++)
	{
		pick -= WeightOf(k);
		if (pick < 0)
			return k;
	}
	return Ways() - 1;
}

function Started()
{
	Value("next " $ (NextWay + 1));
}

final function PickNext()
{
	local int way;

	if (Mode ~= "At random")
		way = RandomWay();
	else if (Mode ~= "In order" && NextWay >= Ways())
	{
		Value("over");
		Output("Over");
		return;
	}
	else
	{
		if (NextWay >= Ways())          // in turn, after NumWays was made smaller
			NextWay = 0;
		way = NextWay;
		NextWay++;
		if (!(Mode ~= "In order") && NextWay >= Ways())
			NextWay = 0;
	}
	Value("picked " $ (way + 1));
	Output("Out" $ (way + 1));
}

function Input(string InputName, string Args, Actor Caller)
{
	if (InputName == "Next")
		PickNext();
	else if (InputName == "Reset")
	{
		NextWay = 0;
		Value("next 1");
	}
	else
		Super.Input(InputName, Args, Caller);
}

defaultproperties
{
	NumWays=2
	Mode="In turn"
	Inputs(0)=(Id="Next",Label="Pick the next way")
	Inputs(1)=(Id="Reset",Label="Start from the first way")
	Outputs(0)=(Id="Out1",Label="picks way 1")
	Outputs(1)=(Id="Out2",Label="picks way 2")
	Outputs(2)=(Id="Out3",Label="picks way 3")
	Outputs(3)=(Id="Out4",Label="picks way 4")
	Outputs(4)=(Id="Out5",Label="picks way 5")
	Outputs(5)=(Id="Out6",Label="picks way 6")
	Outputs(6)=(Id="Over",Label="has no more ways (in order)")
}
