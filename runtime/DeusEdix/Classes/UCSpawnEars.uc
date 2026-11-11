//=============================================================================
// UCSpawnEars - DeusEdix (P9 "Game rules"): a character or a body that appears in the map, for the rules "a
// character or a body appears" (UCRule When=appears). Two per map, made by the first such rule (Ensure), saved with
// the map: one told of the characters (ScriptedPawn), one of the bodies (DeusExCarcass). The engine tells a SpawnNotify
// of each actor of its ActorClass as it is made (also after a saved game is loaded: editor/LOGIC.md P9 slice 0); it is
// not set up yet then (a body is told dead or knocked out a moment later), so the rules hear it at the next tick.
//=============================================================================
class UCSpawnEars extends SpawnNotify;

var Actor Waiting[16];         // made since the last tick
var int Num;

static function Ensure(Actor from)
{
	local UCSpawnEars E;
	local bool bPawns, bBodies;

	foreach from.AllActors(class'UCSpawnEars', E)
	{
		if (E.ActorClass == class'DeusExCarcass')
			bBodies = True;
		else
			bPawns = True;
	}
	if (!bPawns)
		from.Spawn(class'UCSpawnEars').ActorClass = class'ScriptedPawn';
	if (!bBodies)
		from.Spawn(class'UCSpawnEars').ActorClass = class'DeusExCarcass';
}

simulated event Actor SpawnNotification(Actor A)
{
	if (Num < ArrayCount(Waiting))
		Waiting[Num++] = A;
	Enable('Tick');
	return A;
}

event Tick(float DeltaTime)
{
	local UCRule R;
	local int i;

	for (i = 0; i < Num; i++)
	{
		if (Waiting[i] != None && !Waiting[i].bDeleteMe)
			foreach AllActors(class'UCRule', R)
				if (R.When == 'appears')
					R.HearSpawn(Waiting[i]);
		Waiting[i] = None;
	}
	Num = 0;
	Disable('Tick');
}

defaultproperties
{
     ActorClass=class'ScriptedPawn'
}
