//=============================================================================
// UCViewMoment - a first-person moment made in the map editor (Interactions: "JC's weapon plays a moment"): the
// weapon JC holds plays pieces of its own animations (Select, Reload, Shoot...: any part, at any speed, forwards or
// backwards), moves in the view (PlayerViewOffset, as keys), with its sounds and a shake of the view, then goes back
// to how it was. An inspection of the gun, a gesture when a weapon is picked up, a weapon raised as a door opens.
//   MomentName      its name (UCLink finds it by it: verb "fpmoment")
//   WeaponClass     the class of the weapon it is made for ('': any weapon JC holds); JC holding another or none:
//                   nothing happens
//   Seq/SeqFrom/SeqTo/SeqTime: its clips in order: a sequence of the weapon's model, from and to a point of it (0 its
//                   first frame, 1 past its last), lasting SeqTime seconds; the last frame stays until the moment ends
//   OffT/OffV       keys of the weapon's place in the view: at OffT seconds, OffV added to its PlayerViewOffset (in
//                   the units of the class's own value), straight from one key to the next
//   SndT/Snd        sounds at their seconds
//   ShakeAt...      a shake of the view (ShakeTime seconds, ShakeRoll and ShakeVert as the game's explosions)
//   ViewMeshName    a copy of the weapon's model with new animations (imported from Blender into DeusEdixAnims),
//                   worn while the moment plays (DeusEdixAnims.<model>)
// JC firing, reloading, putting the weapon away or changing it ends the moment at once.
//=============================================================================
class UCViewMoment extends Info;

var() string MomentName;
var() string WeaponClass;
var() name   Seq[16];
var() float  SeqFrom[16];
var() float  SeqTo[16];
var() float  SeqTime[16];
var() int    NumSeq;
var() float  OffT[16];
var() vector OffV[16];
var() int    NumOff;
var() float  SndT[8];
var() Sound  Snd[8];
var() int    NumSnd;
var() float  ShakeAt;
var() float  ShakeTime;
var() float  ShakeRoll;
var() float  ShakeVert;
var() string ViewMeshName;

var DeusExPlayer Who;
var DeusExWeapon W;
var vector SavedOffset;
var Mesh   SavedMesh;
var float  T, Length, Scale;
var int    Cur, NextSnd;
var bool   bPlaying, bShook;

function Trigger(Actor Other, Pawn EventInstigator)
{
	Play();
}

function float EndOf()
{
	local int i;
	local float t, e;

	for (i = 0; i < NumSeq && i < 16; i++)
		t += FMax(0.01, SeqTime[i]);
	if (NumOff > 0)
		t = FMax(t, OffT[Min(NumOff, 16) - 1]);
	for (i = 0; i < NumSnd && i < 8; i++)
		t = FMax(t, SndT[i]);
	if (ShakeTime > 0)
	{
		e = ShakeAt + ShakeTime;
		t = FMax(t, e);
	}
	return t;
}

function Play()
{
	local Mesh M;

	if (bPlaying)
		Finish(False);
	Who = DeusExPlayer(GetPlayerPawn());
	if (Who == None)
		return;
	W = DeusExWeapon(Who.Weapon);
	if (W == None || (WeaponClass != "" && !(string(W.Class.Name) ~= WeaponClass)))
	{
		Log("UCViewMoment" @ MomentName @ "- JC does not hold its weapon" @ WeaponClass @ "(" $ W $ ")");
		W = None;
		return;
	}
	SavedOffset = W.PlayerViewOffset;
	Scale = 1.0;
	if (VSize(W.Default.PlayerViewOffset) > 0)          // the held weapon's offset is the class's, scaled
		Scale = VSize(SavedOffset) / VSize(W.Default.PlayerViewOffset);
	SavedMesh = None;
	if (ViewMeshName != "")
	{
		M = Mesh(DynamicLoadObject(ViewMeshName, class'Mesh', True));
		if (M != None)
		{
			SavedMesh = W.Mesh;
			W.Mesh = M;
		}
		else
			Log("UCViewMoment" @ MomentName @ "- no model" @ ViewMeshName @ "(is DeusEdixAnims installed?)");
	}
	T = 0;
	Cur = -1;
	NextSnd = 0;
	bShook = False;
	Length = EndOf();
	bPlaying = True;
	Log("UCViewMoment" @ MomentName @ "plays on" @ W @ "for" @ Length @ "s");
}

function Finish(bool bBack)
{
	bPlaying = False;
	if (W == None || W.bDeleteMe)
		return;
	W.PlayerViewOffset = SavedOffset;
	if (SavedMesh != None)
		W.Mesh = SavedMesh;
	W.AnimRate = 0;
	if (bBack && W.HasAnim('Idle1'))
		W.TweenAnim('Idle1', 0.2);
	W = None;
}

function vector OffsetAt(float t)
{
	local int i, n;
	local float u;

	n = Min(NumOff, 16);
	if (n <= 0)
		return vect(0, 0, 0);
	if (t <= OffT[0])
		return OffV[0] * (t / FMax(0.01, OffT[0]));      // from where it was to the first key
	for (i = 1; i < n; i++)
		if (t <= OffT[i])
		{
			u = (t - OffT[i - 1]) / FMax(0.01, OffT[i] - OffT[i - 1]);
			return OffV[i - 1] + (OffV[i] - OffV[i - 1]) * u;
		}
	return OffV[n - 1];
}

function Tick(float deltaTime)
{
	local int i;
	local float at, u;

	Super.Tick(deltaTime);
	if (!bPlaying)
		return;
	if (W == None || W.bDeleteMe || Who == None || Who.Weapon != W || W.IsInState('NormalFire') || W.IsInState('Reload')
		|| W.IsInState('DownWeapon'))
	{
		Finish(False);                        // JC fired, reloaded, put it away or took another
		return;
	}
	T += deltaTime;
	while (NextSnd < NumSnd && NextSnd < 8 && SndT[NextSnd] <= T)
	{
		if (Snd[NextSnd] != None)
			Who.PlaySound(Snd[NextSnd], SLOT_None);
		NextSnd++;
	}
	if (!bShook && ShakeTime > 0 && T >= ShakeAt)
	{
		bShook = True;
		Who.ShakeView(ShakeTime, ShakeRoll, ShakeVert);
	}
	W.PlayerViewOffset = SavedOffset + OffsetAt(T) * Scale;
	// the clip of this moment, and where in it
	at = 0;
	for (i = 0; i < NumSeq && i < 16; i++)
	{
		if (T < at + FMax(0.01, SeqTime[i]) || i == NumSeq - 1 || i == 15)
		{
			u = FClamp((T - at) / FMax(0.01, SeqTime[i]), 0, 1);
			if (i != Cur)
			{
				W.PlayAnim(Seq[i], 1.0, 0.0);
				Cur = i;
			}
			W.AnimFrame = SeqFrom[i] + (SeqTo[i] - SeqFrom[i]) * u;
			W.AnimRate = 0;
			break;
		}
		at += FMax(0.01, SeqTime[i]);
	}
	if (T >= Length)
		Finish(True);
}

defaultproperties
{
     bHidden=True
}
