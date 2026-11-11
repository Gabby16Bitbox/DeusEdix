//=============================================================================
// UCGameEars - DeusEdix (P9 "Game rules"): the noises of the game the player can hear, for the rules "a noise near
// the player" (UCRule When=noise). One per map, made by the first such rule (Ensure), saved with the map. It keeps
// itself where the player is and listens as the characters do (AISetEventCallback: still registered after a saved
// game is loaded, editor/LOGIC.md P9 slice 0), and tells each rule of the kinds below:
//   gunshot  the player's shot (WeaponFire: the game sends it for the player's shots only), a character's shot (a
//            Distress from a character with a weapon who is attacking: the game sends one with each shot of a
//            character, after its LoudNoise)
//   loud     a loud noise made by a thing (an explosion, something breaking or falling, a thing thrown). Left out: the
//            footsteps of the player and the characters (a LoudNoise from a pawn; a character's shot comes as its
//            Distress) and the debris of a hit (DeusExFragment: a dozen at each bullet on a wall)
//   alarm    an alarm starts (an alarm unit, a computer)
//   cry      a character in distress (hurt, afraid), not the player and not one shooting; the same one again after 3 s
// A rule on "loud" hears gunshots too. Who made it is the rule's "@by" / "@it". The game tells a listener only the
// loudest (the nearest) of each kind in a moment: a far shot in a moment a nearer one is heard is not told.
// Found in the game (29_P9_World, 10 Nov 2026): a character's own LoudNoise as it shoots is lost among the debris of
// its bullets, which are nearer; its Distress comes through.
//=============================================================================
class UCGameEars extends Info;

var Actor LastCry;             // the last cry told and when
var float LastCryAt;

static function Ensure(Actor from)
{
	local UCGameEars E;

	foreach from.AllActors(class'UCGameEars', E)
		return;
	from.Spawn(class'UCGameEars');
}

function PostBeginPlay()
{
	Super.PostBeginPlay();
	AISetEventCallback('WeaponFire', 'Heard');
	AISetEventCallback('LoudNoise', 'Heard');
	AISetEventCallback('Alarm', 'Heard');
	AISetEventCallback('Distress', 'Heard');
}

event Tick(float DeltaTime)
{
	local Pawn P;

	P = GetPlayerPawn();
	if (P != None)
		SetLocation(P.Location);         // a listener where the player is, wherever the player goes
}

function Heard(Name EventName, EAIEventState State, XAIParams Params)
{
	local Actor A;
	local Pawn P;

	if (State == EAISTATE_End)
		return;
	A = Params.BestActor;
	P = GetPlayerPawn();
	if (EventName == 'WeaponFire')
	{
		if (A == P)
			Tell("gunshot", A);
	}
	else if (EventName == 'Alarm')
	{
		if (State == EAISTATE_Begin)
			Tell("alarm", A);
	}
	else if (EventName == 'LoudNoise')
	{
		// not a footstep (a pawn's: the player's shots come as WeaponFire, a character's as Distress), not debris
		if (A != None && Pawn(A) == None && DeusExFragment(A) == None)
			Tell("loud", A);
	}
	else if (EventName == 'Distress' && ScriptedPawn(A) != None)
	{
		if (Shooting(ScriptedPawn(A)))
			Tell("gunshot", A);
		else
			Cry(A);
	}
}

// a character's Distress with a shot: it has a weapon (not a hand-to-hand one) and is attacking
function bool Shooting(ScriptedPawn sp)
{
	return sp.Weapon != None && DeusExWeapon(sp.Weapon) != None && !DeusExWeapon(sp.Weapon).bHandToHand
		&& sp.IsInState('Attacking');
}

function Cry(Actor A)
{
	if (A == LastCry && Level.TimeSeconds - LastCryAt < 3.0)
		return;
	LastCry = A;
	LastCryAt = Level.TimeSeconds;
	Tell("cry", A);
}

function Tell(string kind, Actor A)
{
	local UCRule R;
	local vector at;

	at = Location;
	if (A != None)
		at = A.Location;
	foreach AllActors(class'UCRule', R)
		if (R.When == 'noise')
			R.HearNoise(kind, A, at);
}

defaultproperties
{
}
