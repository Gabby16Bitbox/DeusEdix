//=============================================================================
// UCParticles - particles placed with the map editor (Objects > Effects): the game's ParticleGenerator (its
// particles, as the editor's Particles section sets them) that can also hurt, start off, be switched on and off
// and stay on for a while once switched on.
//   Switched on and off by an interaction ("Switch on" / "Switch off" call Trigger / UnTrigger) or by the game's
//   own triggers through its Tag. Off it throws no more particles (its frequency 0: those in the air live their
//   life out) and its sound (AmbientSound) is silent.
//   FxDamage      damage each hit (0: it hurts no one)
//   FxDamageType  the game's kind of damage: Burned, Shocked, PoisonGas, TearGas, Radiation, EMP, Exploded...
//   FxRadius      how far from its stream it hurts (units, round the stream)
//   FxReach       how far along its arrow (its rotation) the stream goes (0: a ball of FxRadius round it)
//   FxEvery       seconds between hits
//   bFxHurtAll    the characters too (else JC only)
//   bFxStartOn    on from the start of the map (else off until switched on)
//   FxOnTime      switched on, it goes off by itself after these seconds (0: until switched off)
//   bFxToggle     "Switch on" switches it off when it is on
//   FxArea        its particles start anywhere within this radius round it, across its arrow (a pool of gas on
//                 the floor, a cloud under a ceiling); 0: all from its point, as the game's generators
// Nothing hurts through a wall: a hit needs a clear line from the stream to the one it hurts (to its middle or to
// its eyes). The line starts a little out along the arrow: a generator set on a wall or a floor is not inside it.
//=============================================================================
class UCParticles extends ParticleGenerator;

var() int    FxDamage;
var() name   FxDamageType;
var() float  FxRadius;
var() float  FxReach;
var() float  FxEvery;
var() bool   bFxHurtAll;
var() bool   bFxStartOn;
var() float  FxOnTime;
var() bool   bFxToggle;
var() float  FxArea;

var float FxFrequency;          // its frequency, as set, for when it is on
var Sound FxSound;              // its sound, as set, for when it is on
var bool  bFxOn;
var bool  bFxReady;
var float FxLeft;               // seconds it stays on (FxOnTime)
var float FxHurtT;              // seconds to the next hit
var float FxThrowT;             // seconds since the last check of an area's throw (FxArea)

function PostBeginPlay()
{
	Super.PostBeginPlay();
	FxFrequency = frequency;
	FxSound = AmbientSound;
	bFxReady = True;
	FxSwitch(bFxStartOn);
}

function FxSwitch(bool bOn)
{
	bFxOn = bOn;
	if (bOn)
	{
		// over an area it throws its particles itself (FxThrow): the game's generator throws none
		if (FxArea > 0)
			frequency = 0;
		else
			frequency = FxFrequency;
		AmbientSound = FxSound;
		FxLeft = FxOnTime;
		FxHurtT = 0;
	}
	else
	{
		frequency = 0;
		AmbientSound = None;
	}
}

function Trigger(Actor Other, Pawn EventInstigator)
{
	if (bFxOn && bFxToggle)
		FxSwitch(False);
	else
		FxSwitch(True);
}

function UnTrigger(Actor Other, Pawn EventInstigator)
{
	FxSwitch(False);
}

// the one it hurts this hit: within FxRadius of the stream, with nothing solid between
function bool FxReaches(Pawn P, vector dir)
{
	local vector d, from, hitLoc, hitNormal;
	local float along;

	d = P.Location - Location;
	along = 0;
	if (FxReach > 0)
		along = FClamp(d Dot dir, 0, FxReach);
	from = Location + dir * along;
	if (VSize(P.Location - from) > FxRadius + P.CollisionRadius)
		return False;
	from = Location + dir * FMax(along, 8);
	if (Trace(hitLoc, hitNormal, P.Location, from, False) == None)
		return True;
	return Trace(hitLoc, hitNormal, P.Location + vect(0,0,1) * P.BaseEyeHeight, from, False) == None;
}

// an area's particles (FxArea): as the game's generator throws them (every checkTime, by its chance, numPerSpawn
// each time), each from a point of the disc round it across its arrow
function FxThrow(float deltaTime)
{
	local ParticleIterator It;
	local vector X, Y, Z;
	local float r, a;
	local int i;

	It = ParticleIterator(RenderInterface);
	if (It == None || bFrozen || bDying || !bSpewing)
		return;
	FxThrowT += deltaTime;
	if (FxThrowT <= checkTime)
		return;
	FxThrowT = 0;
	if (FRand() > FxFrequency)
		return;
	if (spawnSound != None)
		PlaySound(spawnSound, SLOT_Misc,,, 1024);
	GetAxes(Rotation, X, Y, Z);
	for (i = 0; i < numPerSpawn; i++)
	{
		r = FxArea * Sqrt(FRand());
		a = FRand() * 6.283185;
		pLoc = Location + (Y * Cos(a) + Z * Sin(a)) * r;
		It.AddParticle();
	}
	pLoc = Location;
}

function Tick(float deltaTime)
{
	local Pawn P;
	local vector dir;

	Super.Tick(deltaTime);
	if (!bFxReady || !bFxOn)
		return;
	// The game's generators freeze when they were not drawn for 2 s and JC is not within 320 units: one switched on
	// later, never drawn, would never start (as UCEffect keeps its own awake).
	if (proxy != None && GetPlayerPawn() != None && VSize(GetPlayerPawn().Location - Location) < 4000)
		proxy.LastRenderTime = Level.TimeSeconds;
	if (FxArea > 0)
		FxThrow(deltaTime);
	if (FxOnTime > 0)
	{
		FxLeft -= deltaTime;
		if (FxLeft <= 0)
		{
			FxSwitch(False);
			return;
		}
	}
	if (FxDamage <= 0)
		return;
	FxHurtT -= deltaTime;
	if (FxHurtT > 0)
		return;
	FxHurtT = FMax(0.1, FxEvery);
	dir = vector(Rotation);
	for (P = Level.PawnList; P != None; P = P.nextPawn)
		if (P.Health > 0 && (bFxHurtAll || PlayerPawn(P) != None) && FxReaches(P, dir))
			P.TakeDamage(FxDamage, None, P.Location, vect(0,0,0), FxDamageType);
}

defaultproperties
{
     FxDamageType=Burned
     FxRadius=48.000000
     FxEvery=0.500000
     bFxStartOn=True
}
