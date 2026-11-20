//=============================================================================
// UCGameFixes - fixes for the original Deus Ex, placed with the map editor (Objects > Level > Original game
// fixes): an invisible object; what it fixes holds in the map it is in.
//
// Disarmed weapons. A character whose arm is crippled drops the weapon in its hands (ScriptedPawn.DropWeapon),
// and the game's Weapon.DropFrom leaves a dropped weapon with no rounds (only grenades keep theirs: "you don't
// want to drop all of your ammo"), so JC picks up an empty gun, while the same gun taken from a body has 1 to 4
// rounds (DeusExCarcass). Every fifth of a second this object notes the weapon each living character holds; one
// of those found lying on the floor, its character still alive, was knocked out of its hands: it gets rounds
// by AmmoRule. Deus Ex: Revision gives them in the game itself: there it finds nothing to do.
//=============================================================================
class UCGameFixes extends Info;

var() bool   bDisarmedAmmo;     // a disarmed character's weapon has rounds when JC picks it up
var() string AmmoRule;          // how many: "Like from a body", "What they had left", "A full magazine", "This many"
var() int    Rounds;            // AmmoRule "This many"
var() string DisarmMessage;     // what JC reads when he sees someone disarmed ("" = nothing)

var ScriptedPawn Holders[128];  // the characters seen with a weapon at the last look
var Weapon       Held[128];     // the weapon each of them held
var int          HeldAmmo[128]; // and the rounds they had for it
var int          NumWatched;

function PostBeginPlay()
{
	Super.PostBeginPlay();
	SetTimer(0.2, True);
}

function Timer()
{
	local int i, n;
	local ScriptedPawn P;

	if (!bDisarmedAmmo)
		return;
	// what was in someone's hands at the last look and now lies on the floor, its character alive: disarmed
	for (i = 0; i < NumWatched; i++)
		if (Held[i] != None && !Held[i].bDeleteMe && Held[i].Owner == None && Held[i].IsInState('Pickup')
				&& Holders[i] != None && !Holders[i].bDeleteMe && Holders[i].Health > 0)
			Disarmed(Holders[i], Held[i], HeldAmmo[i]);
	n = 0;
	foreach AllActors(class'ScriptedPawn', P)
	{
		if (n >= ArrayCount(Held))
			break;
		if (P.Health > 0 && P.Weapon != None)
		{
			Holders[n] = P;
			Held[n] = P.Weapon;
			HeldAmmo[n] = 0;
			if (P.Weapon.AmmoType != None)
				HeldAmmo[n] = P.Weapon.AmmoType.AmmoAmount;
			n++;
		}
	}
	for (i = n; i < NumWatched; i++)
	{
		Holders[i] = None;
		Held[i] = None;
	}
	NumWatched = n;
}

// how many rounds a weapon knocked out of someone's hands gives (AmmoRule)
function int RoundsFor(Weapon W, int had)
{
	local DeusExWeapon dxw;

	dxw = DeusExWeapon(W);
	if (AmmoRule ~= "What they had left")
		return Max(1, had);
	if (AmmoRule ~= "A full magazine" && dxw != None && dxw.ReloadCount > 0)
		return dxw.ReloadCount;
	if (AmmoRule ~= "This many")
		return Max(1, Rounds);
	return Rand(4) + 1;             // as the original game's bodies give (DeusExCarcass)
}

function Disarmed(ScriptedPawn P, Weapon W, int had)
{
	local DeusExPlayer player;
	local int amount;

	if (W.PickupAmmoCount > 0)      // a grenade keeps its own; another of these objects did it already
		return;
	if (W.AmmoName == None || W.AmmoName == class'AmmoNone' || W.Default.PickupAmmoCount <= 0)
		return;                     // no rounds of its own: a knife, a baton
	amount = RoundsFor(W, had);
	W.PickupAmmoCount = amount;
	Log("UCGameFixes:" @ P.Name @ "disarmed," @ W.Class.Name @ "has" @ amount @ "rounds");
	if (DisarmMessage != "")
	{
		player = DeusExPlayer(GetPlayerPawn());
		if (player != None && player.LineOfSightTo(P))
			player.ClientMessage(DisarmMessage);
	}
}

defaultproperties
{
	bDisarmedAmmo=True
	AmmoRule="Like from a body"
	Rounds=6
}
