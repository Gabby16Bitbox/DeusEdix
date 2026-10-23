//=============================================================================
// UCBehave - ready-made behaviours of one character of the map, chosen in the map editor's Inspector
// (Tactics: editor/behaviours.py writes one UCBehave per character, PawnName = the character's name):
//   throws grenades when the player is above it (on a roof, a ledge, a catwalk it cannot reach),
//   jumps over low obstacles in its way (crates, railings) with its own jump (JumpZ, the Inspector's Movement),
//   dodges sideways when the player aims at it and fires.
// It only adds to what the game's AI does: the character keeps its orders, its paths and its fights.
//=============================================================================
class UCBehave extends Info;

var() name PawnName;

var() bool bGrenades;
var() string GrenadeClass;         // a thrown grenade of the game (DeusEx.GasGrenade, DeusEx.LAM...)
var() float GrenadeAbove;          // the player's feet at least this much above its own
var() float GrenadeRange;
var() float GrenadeEvery;          // seconds between two grenades (about)

var() bool bJumpObstacles;
var() float JumpMax;               // the highest obstacle it jumps on or over

var() bool bDodge;
var() float DodgeChance;           // 0..1, each time the player fires at it
var() float DodgeSpeed;
var() float DodgeEvery;

var ScriptedPawn P;
var bool bFound;
var class<Projectile> GClass;
var float nextGrenade, nextJump, nextDodge;

function PostBeginPlay()
{
	Super.PostBeginPlay();
	if (GrenadeClass != "")
		GClass = class<Projectile>(DynamicLoadObject(GrenadeClass, class'Class', True));
	SetTimer(0.2, True);
}

function ScriptedPawn FindPawn()
{
	local ScriptedPawn sp;

	foreach AllActors(class'ScriptedPawn', sp)
		if (sp.Name == PawnName)
			return sp;
	return None;
}

function bool Hostile(DeusExPlayer pl)
{
	return P.Enemy == pl || P.IsInState('Attacking');
}

function Timer()
{
	local DeusExPlayer pl;

	if (P == None)
	{
		if (bFound)
		{
			Destroy();             // the character is gone (killed and removed, or taken away)
			return;
		}
		P = FindPawn();
		bFound = P != None;
		if (P == None)
			return;
		Log("UCBehave: " $ PawnName $ " grenades " $ bGrenades $ " (" $ GClass $ ") jumps " $ bJumpObstacles $ " dodges " $ bDodge
			$ ", JumpZ " $ P.JumpZ);
	}
	if (P.Health <= 0 || P.bDeleteMe || P.IsInState('Dying') || P.IsInState('Conversation') || P.IsInState('FirstPersonConversation'))
		return;
	pl = DeusExPlayer(GetPlayerPawn());
	if (pl == None || pl.Health <= 0)
		return;
	if (bJumpObstacles)
		TryJump();
	if (!Hostile(pl))
		return;
	if (bGrenades && GClass != None)
		TryGrenade(pl);
	if (bDodge)
		TryDodge(pl);
}

// the player above, near enough, in sight: a grenade thrown in an arc to the player's feet
function TryGrenade(DeusExPlayer pl)
{
	local vector start, target, dir, v, g;
	local Projectile gr;
	local float t, d;

	if (Level.TimeSeconds < nextGrenade)
		return;
	if ((pl.Location.Z - pl.CollisionHeight) - (P.Location.Z - P.CollisionHeight) < GrenadeAbove)
		return;
	dir = pl.Location - P.Location;
	dir.Z = 0;
	d = VSize(dir);
	if (d > GrenadeRange || !P.LineOfSightTo(pl))
		return;
	nextGrenade = Level.TimeSeconds + GrenadeEvery * (0.8 + 0.4 * FRand());
	start = P.Location + vect(0,0,0.7) * P.CollisionHeight + Normal(dir) * P.CollisionRadius * 1.2;
	gr = Spawn(GClass, P,, start, Rotator(pl.Location - start));
	if (gr == None)
		return;
	gr.Instigator = P;
	target = pl.Location - vect(0,0,0.8) * pl.CollisionHeight;
	g = P.Region.Zone.ZoneGravity;
	t = FClamp(d / 700.0, 0.7, 1.6);
	v = (target - start) / t - 0.5 * g * t;
	gr.SetPhysics(PHYS_Falling);
	gr.Velocity = v;
	if (P.HasAnim('Attack'))
		P.PlayAnim('Attack', 1.2, 0.1);
	Log("UCBehave: " $ PawnName $ " throws " $ GClass);
}

// walking into something higher than a step and lower than JumpMax, with room above it: a jump
function TryJump()
{
	local vector dir, feet, ahead, top, hitLoc, hitNorm;
	local Actor hit;
	local float h, vz;

	if (Level.TimeSeconds < nextJump || P.Physics != PHYS_Walking || VSize(P.Acceleration) < 1)
		return;
	dir = P.Acceleration;
	dir.Z = 0;
	dir = Normal(dir);
	feet = P.Location - vect(0,0,1) * P.CollisionHeight;
	ahead = P.Location + dir * (P.CollisionRadius + 24);
	ahead.Z = feet.Z + P.MaxStepHeight + 2;
	// something in the way at the knees
	if (FastTrace(ahead, feet + vect(0,0,1) * (P.MaxStepHeight + 2)))
		return;
	// how high it is: down from above it
	top = ahead;
	top.Z = feet.Z + JumpMax + 4;
	hit = Trace(hitLoc, hitNorm, ahead - vect(0,0,1) * (P.MaxStepHeight + 1), top, False);
	if (hit == None)
		return;                    // as high as JumpMax or more: a wall
	h = hitLoc.Z - feet.Z;
	if (h <= P.MaxStepHeight || h > JumpMax)
		return;
	// room for the body over it
	if (!FastTrace(top + dir * P.CollisionRadius, P.Location + vect(0,0,1) * (h + 4)))
		return;
	nextJump = Level.TimeSeconds + 1.0;
	vz = Sqrt(2 * Abs(P.Region.Zone.ZoneGravity.Z) * (h + 16));
	P.Velocity = dir * FMax(P.GroundSpeed * 0.6, 160) + vect(0,0,1) * FMax(vz, P.JumpZ);
	P.SetPhysics(PHYS_Falling);
	if (P.HasAnim('Jump'))
		P.PlayAnim('Jump', 1.0, 0.1);
}

// the player aiming at it and firing: a quick step to one side (the side with room)
function TryDodge(DeusExPlayer pl)
{
	local vector dir, side;

	if (Level.TimeSeconds < nextDodge || P.Physics != PHYS_Walking || pl.Weapon == None || !pl.Weapon.IsInState('NormalFire'))
		return;
	dir = Normal(P.Location - pl.Location);
	if (Vector(pl.ViewRotation) dot dir < 0.96 || !P.LineOfSightTo(pl))
		return;
	nextDodge = Level.TimeSeconds + 0.6;
	if (FRand() > DodgeChance)
		return;
	side = Normal(dir cross vect(0,0,1));
	if (FRand() < 0.5)
		side = -side;
	if (!FastTrace(P.Location + side * DodgeSpeed * 0.5, P.Location))
	{
		side = -side;
		if (!FastTrace(P.Location + side * DodgeSpeed * 0.5, P.Location))
			return;
	}
	nextDodge = Level.TimeSeconds + DodgeEvery;
	P.Velocity = side * DodgeSpeed + vect(0,0,1) * 160;
	P.SetPhysics(PHYS_Falling);
}

defaultproperties
{
     GrenadeClass="DeusEx.GasGrenade"
     GrenadeAbove=96.000000
     GrenadeRange=900.000000
     GrenadeEvery=6.000000
     JumpMax=56.000000
     DodgeChance=0.500000
     DodgeSpeed=420.000000
     DodgeEvery=2.500000
     bHidden=True
}
