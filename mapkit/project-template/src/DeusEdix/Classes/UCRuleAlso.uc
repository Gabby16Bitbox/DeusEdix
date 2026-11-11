//=============================================================================
// UCRuleAlso - another cause of a rule of the Logic runtime v2 ("Or when...", a rule's `also`): it hooks its object, or
// watches it, as a UCLink of that cause does, and sets its rule (the UCRule called Main) off; the rule checks its
// conditions and runs its steps. It has no actions of its own.
//=============================================================================
class UCRuleAlso extends UCLink;

var() string Main;

function RunRule(optional Actor By)
{
	local UCRule R;

	R = UCRule(ActorCalled(Main));
	if (R != None)
	{
		R.HeardValue = HeardValue;       // an output that came with a number: Value
		HeardValue = 0;
		R.Start(By, Source, When);
	}
	else
		Report("hook", Main $ "|missing");
}

function Hurry();
function StopRuns();
