//=============================================================================
// UCMutator - DeusEdix: in a map opened with "?Mutator=DeusEdix.UCMutator" (the map editor's "Play
// from here" and its live view) it starts the runner (UCShotRunner) when its section in
// RevisionUser.ini asks for it, and the map's UCBoot when the map has none (a map not built with
// DeusEdix). The runner is transient: back in a map already visited, the Tick makes it again.
//=============================================================================
class UCMutator extends Mutator;

var float checkTime;

function PostBeginPlay()
{
	Super.PostBeginPlay();
	Ensure();
}

function Ensure()
{
	local UCShotRunner shots;
	local UCBoot boot;

	foreach AllActors(class'UCBoot', boot)
		break;
	if (boot == None)
		Spawn(class'UCBoot');
	class'UCConsoleLink'.static.Ensure(Self);      // the map editor's Console (its Play only)
	if (class'UCShotRunner'.default.bActive)
	{
		foreach AllActors(class'UCShotRunner', shots)
			return;
		Spawn(class'UCShotRunner');
	}
}

// A key of the map's rules ("When the player presses a key"): Play binds it to "mutate UCKey <key>" in its copy of
// the player's settings (live._set_keys); the rules waiting for it (their Tag UCL_Key_<key>) run. Any other mutate
// goes on down the chain.
function Mutate(string MutateString, PlayerPawn Sender)
{
	local Actor A;
	local string k;

	if (Left(MutateString, 6) ~= "UCKey ")
	{
		k = Mid(MutateString, 6);
		foreach AllActors(class'Actor', A)
			if (string(A.Tag) ~= ("UCL_Key_" $ k))
				A.Trigger(Self, Sender);
		return;
	}
	if (NextMutator != None)
		NextMutator.Mutate(MutateString, Sender);
}

event Tick(float deltaTime)
{
	Super.Tick(deltaTime);
	checkTime += deltaTime;
	if (checkTime < 1.0)
		return;
	checkTime = 0;
	Ensure();
}

defaultproperties
{
}
