//=============================================================================
// UCBPhases - "Phases": the phases of a mission, one after the other ("Arrive, Alarm, Escape"). The phase now is
// kept in the game's flags, so it goes on across maps and saves and the Story's dialogues can read it:
//   <StateName>            a counter: the phase's number (1 the first)
//   <StateName>_<phase>    a state for each phase: Yes for the phase now, No for the others
// Rules move it on (GoTo_<phase>, Next, Previous, Reset) and run when it does (Changed, Enter_<phase>,
// Leave_<phase>): those ports are made from the list, so the class declares only the fixed ones.
//   Phases     the list, in order, separated by commas
//   StateName  the name of its flags ("Phase")
//=============================================================================
class UCBPhases extends UCBlock;

var() string Phases;
var() string StateName;
var int Now;                  // the phase now (1 the first; 0 before it has started)

final function string Root()
{
	if (FlagName(StateName) == "")
		return "Phase";
	return FlagName(StateName);
}

final function string PhaseAt(int k)
{
	return FlagName(Item(Phases, k - 1));
}

// the number of a phase by its name (as the editor writes it), 0 when the list has no such phase
final function int IndexOf(string P)
{
	local int k;

	P = FlagName(P);
	for (k = 1; k <= Items(Phases); k++)
		if (PhaseAt(k) ~= P)
			return k;
	return 0;
}

// the flags of phase k (no rule runs: what the map starts with, or a phase another map left)
final function Mirror(int k)
{
	local int i;

	Now = k;
	SetInt(Root(), k);
	for (i = 1; i <= Items(Phases); i++)
		SetState(Root() $ "_" $ PhaseAt(i), i == k);
	Value(PhaseAt(k));
}

final function SetPhase(int k)
{
	local int Was;

	if (k < 1 || k > Items(Phases) || k == Now)
		return;
	Was = Now;
	Mirror(k);
	if (Was > 0)
		Output("Leave_" $ PhaseAt(Was));
	Output("Enter_" $ PhaseAt(k));
	Output("Changed");
}

// the phase the flags say (another map, a save), else the first
function Started()
{
	local int k;

	k = GetInt(Root());
	if (k < 1 || k > Items(Phases))
		k = 1;
	if (Items(Phases) > 0)
		Mirror(k);
}

function Input(string InputName, string Args, Actor Caller)
{
	if (Left(InputName, 5) ~= "GoTo_")
	{
		if (IndexOf(Mid(InputName, 5)) == 0)
			Fail("phase", Mid(InputName, 5), "nophase");
		else
			SetPhase(IndexOf(Mid(InputName, 5)));
	}
	else if (InputName == "Next")
		SetPhase(Now + 1);
	else if (InputName == "Previous")
		SetPhase(Now - 1);
	else if (InputName == "Reset")
		SetPhase(1);
	else
		Super.Input(InputName, Args, Caller);
}

defaultproperties
{
	StateName="Phase"
	Inputs(0)=(Id="Next",Label="Go to the next phase")
	Inputs(1)=(Id="Previous",Label="Go back a phase")
	Inputs(2)=(Id="Reset",Label="Go back to the first phase")
	Outputs(0)=(Id="Changed",Label="the phase changes")
}
