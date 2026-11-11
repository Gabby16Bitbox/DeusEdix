//=============================================================================
// UCBCounter - "Counter": a whole number the rules add to (Add), take from (Take) and empty (Reset). It says Changed
// each time it changes, Reached when it gets to its goal, Lost when it goes back under it. The number is kept in a
// counter of the game's flags, so conditions and the Story's dialogues read it like any other counter, it goes on
// across maps and saves, and a rule that changes that counter itself ("Add 1 to the counter Kills") moves the block
// too: it looks at the counter every half second, as the rules do.
//   ReachedAt  the number it waits for, its goal (0: none, it only counts)
//   StateName  the counter it keeps (empty: one named as the block)
//   bAgain     once it gets to its goal it starts again from 0 (every 3 times...)
// The rules on Changed and Reached see the new number (the counter is set before it says them). At the start it
// takes the number the counter has (another map, a save) and says nothing.
//=============================================================================
class UCBCounter extends UCBlock;

var() int    ReachedAt;
var() string StateName;
var() bool   bAgain;
var int  Count;               // the number now, as the counter was at the last look
var bool bAtGoal;

final function string Root()
{
	if (FlagName(StateName) == "")
		return FlagName(string(Name));
	return FlagName(StateName);
}

final function Show()
{
	if (ReachedAt > 0)
		Value("count " $ Count $ "/" $ ReachedAt);
	else
		Value("count " $ Count);
}

// the number becomes n (kept in the counter at once), and the block says what that means
final function SetCount(int n)
{
	local bool bWas;

	if (n == Count)
		return;
	Count = n;
	SetInt(Root(), Count);
	Show();
	bWas = bAtGoal;
	bAtGoal = ReachedAt > 0 && Count >= ReachedAt;
	Output("Changed");
	if (bAtGoal && !bWas)
		Output("Reached");
	else if (bWas && !bAtGoal)
		Output("Lost");
	if (bAtGoal && !bWas && bAgain)
	{
		Count = 0;
		bAtGoal = False;
		SetInt(Root(), 0);
		Show();
	}
}

function Started()
{
	Count = GetInt(Root());
	bAtGoal = ReachedAt > 0 && Count >= ReachedAt;
	Show();
}

// a rule, a dialogue or another map's script changed the counter itself
function Repeat()
{
	if (GetInt(Root()) != Count)
		SetCount(GetInt(Root()));
}

function Input(string InputName, string Args, Actor Caller)
{
	if (InputName == "Add")
		SetCount(Count + 1);
	else if (InputName == "Take" && Count > 0)       // (not under 0)
		SetCount(Count - 1);
	else if (InputName == "Take")
		return;
	else if (InputName == "Reset")
		SetCount(0);
	else
		Super.Input(InputName, Args, Caller);
}

defaultproperties
{
	ReachedAt=3
	RepeatEvery=0.500000
	Inputs(0)=(Id="Add",Label="Add one")
	Inputs(1)=(Id="Take",Label="Take one away")
	Inputs(2)=(Id="Reset",Label="Set it back to 0")
	Outputs(0)=(Id="Reached",Label="it gets to its goal")
	Outputs(1)=(Id="Lost",Label="it goes back under its goal")
	Outputs(2)=(Id="Changed",Label="the number changes")
}
