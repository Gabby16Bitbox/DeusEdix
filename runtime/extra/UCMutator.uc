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
