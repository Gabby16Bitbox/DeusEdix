//=============================================================================
// UCViewFade - the player's view fades to black (out) or back from it (in) over some seconds (the rules' "Fade the
// view"): PlayerPawn.ConstantGlowScale, which the view's flash adds (-1: black). A new fade replaces the one going on;
// a fade out stays black until a fade in. Saved with the game, as the player's glow is.
//=============================================================================
class UCViewFade extends Info;

var PlayerPawn P;
var float From, Goal, Secs, T;

static function Start(PlayerPawn P, bool bOut, float secs)
{
	local UCViewFade F;

	foreach P.AllActors(class'UCViewFade', F)
		F.Destroy();
	F = P.Spawn(class'UCViewFade');
	if (F == None)
		return;
	F.P = P;
	F.From = P.ConstantGlowScale;
	if (bOut)
		F.Goal = -1;
	else
		F.Goal = 0;
	F.Secs = secs;
	F.T = 0;
	if (secs <= 0)
		F.Done();
}

event Tick(float dt)
{
	if (P == None)
	{
		Destroy();
		return;
	}
	T += dt;
	if (T >= Secs)
	{
		Done();
		return;
	}
	P.ConstantGlowScale = From + (Goal - From) * T / Secs;
}

function Done()
{
	if (P != None)
		P.ConstantGlowScale = Goal;
	Destroy();
}

defaultproperties
{
     bHidden=True
}
