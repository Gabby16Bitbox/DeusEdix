//=============================================================================
// UCSoundFX - a sound effect placed in the map editor.
// - Zone (bOnTouch): it plays when JC walks into it (the cylinder CollisionRadius / CollisionHeight, as
//   a Trigger: TriggerType, bTriggerOnceOnly, ReTriggerDelay work as always), and it also
//   sets off its Event, as any Trigger does.
// - Triggered (Tag): it plays when something triggers it: the Event of a door (when it has finished
//   opening), of a button, of a keypad, of another trigger, an action of the story.
// FXSound is heard from where the object is, up to FXRadius units (bAtPlayer: inside JC's head,
// just as loud wherever he is: a voice, an alarm on the communicator).
// A playlist (the editor's Sound effect > More sounds, as Unity's Audio Random Container): FXSound and FXSounds are
// its sounds, one picked each time it plays (FXOrder 0 at random, never the same one twice in a row; 1 in sequence),
// its volume and pitch varied by up to RandomVolume and RandomPitch of them either way. With RepeatMax it plays again
// after a random wait between RepeatMin and RepeatMax seconds: a zone while JC stays in it, a triggered one until it
// is untriggered (an interaction's Switch off); touched or triggered again meanwhile, it keeps its wait. One sound and
// none of these: it plays as it always did.
// The editor's preview picks as this does (tools\mapkit\editor\static\sound-playlist.js).
//=============================================================================
class UCSoundFX extends Trigger;

var() sound FXSound;
var() float FXVolume;          // 1 = normal
var() float FXRadius;          // how far it is heard (units)
var() float FXPitch;           // 1 = as recorded
var() bool  bAtPlayer;         // heard "inside JC's head", not from here
var() bool  bOnTouch;          // plays when JC walks in (else only when triggered)
var bool bPlayed;
var() sound FXSounds[7];       // the other sounds of its list (FXSound is the first; None: an empty place)
var() byte  FXOrder;           // 0 at random (never the same one twice in a row), 1 in sequence
var() float RandomPitch;       // the pitch varies by up to this much of it either way (0.1: 10%)
var() float RandomVolume;      // the volume too
var() float RepeatMin;         // once played, again after a random wait between these (seconds; RepeatMax 0: once)
var() float RepeatMax;
var int    LastPick;           // the place in its list of the one played last (-1: none yet)
var bool   bRepeating;
var float  NextPlay;           // when it plays again (Level.TimeSeconds)
var Actor  Hearer;             // who it played for (bAtPlayer: JC)

function PostBeginPlay()
{
    Super.PostBeginPlay();
    Disable('Tick');              // only while it repeats
}

function PlayFX(Actor Who)
{
    if (CountSounds() == 0 || (bTriggerOnceOnly && bPlayed))
        return;
    if (bRepeating)
    {
        Hearer = Who;             // it plays again by itself when its wait is over (Tick): JC touching its zone again
        return;                   // (landing in it after a drop: two plays in 0.25 s, 28 Oct 2026) or another trigger
    }                             // does not play it at once too
    bPlayed = true;
    PlayOne(Who);
    if (RepeatMax <= 0 || bTriggerOnceOnly)
        return;
    if (!bRepeating)
        Log("UCSoundFX" @ Name @ "repeats every" @ FClamp(RepeatMin, 0, RepeatMax) @ "to" @ RepeatMax @ "s");
    bRepeating = True;
    Hearer = Who;
    NextPlay = Level.TimeSeconds + NextWait();
    Enable('Tick');
}

// one sound of its list at its volume and pitch (varied): heard from here, or in JC's head. Revision.log: "UCSoundFX
// <name> played <sound>" (with a list or variations, which one of how many and how, the numbers with the six decimals
// UnrealScript writes: "(2/5, volume 0.900000, pitch 1.100000)")
function PlayOne(Actor Who)
{
    local Pawn P;
    local sound S;
    local float Vol, Pit;
    local string Note;

    S = PickSound();
    Vol = Varied(FXVolume, RandomVolume);
    Pit = Varied(FXPitch, RandomPitch);
    if (CountSounds() > 1 || RandomVolume > 0 || RandomPitch > 0)
        Note = " (" $ (LastPick + 1) $ "/" $ CountSounds() $ ", volume" @ Vol $ ", pitch" @ Pit $ ")";
    if (bAtPlayer)
    {
        P = Pawn(Who);
        if (P == None || !P.IsA('PlayerPawn'))
            P = GetPlayerPawn();
        if (P != None)
        {
            P.PlaySound(S, SLOT_None, Vol,, 100000, Pit);
            Log("UCSoundFX" @ Name @ "played" @ S @ "for JC" $ Note);
            return;
        }
    }
    PlaySound(S, SLOT_None, Vol,, FXRadius, Pit);
    Log("UCSoundFX" @ Name @ "played" @ S $ Note);
}

// how many sounds its list has (FXSound and FXSounds, their empty places left out)
function int CountSounds()
{
    local int i, n;

    if (FXSound != None)
        n++;
    for (i = 0; i < ArrayCount(FXSounds); i++)
        if (FXSounds[i] != None)
            n++;
    return n;
}

// the sound at place k of its list (its empty places left out)
function sound SoundAt(int k)
{
    local int i;

    if (FXSound != None)
    {
        if (k == 0)
            return FXSound;
        k--;
    }
    for (i = 0; i < ArrayCount(FXSounds); i++)
        if (FXSounds[i] != None)
        {
            if (k == 0)
                return FXSounds[i];
            k--;
        }
    return None;
}

// the one it plays this time: in sequence the next, else one at random that is not the last one played
function sound PickSound()
{
    local int n, k;

    n = CountSounds();
    if (FXOrder == 1)
    {
        k = LastPick + 1;
        if (k >= n)
            k = 0;
    }
    else if (n == 1 || LastPick < 0 || LastPick >= n)
        k = Rand(n);
    else
    {
        k = Rand(n - 1);
        if (k >= LastPick)
            k++;
    }
    LastPick = k;
    return SoundAt(k);
}

// a volume or a pitch varied by up to Spread of it either way (no spread: as it is)
function float Varied(float X, float Spread)
{
    if (Spread <= 0)
        return X;
    return X * (1 + FMin(Spread, 1) * (2 * FRand() - 1));
}

// the wait before it plays again: between RepeatMin (at most RepeatMax) and RepeatMax seconds
function float NextWait()
{
    return RandRange(FClamp(RepeatMin, 0, RepeatMax), RepeatMax);
}

// it plays again when its wait is over: a zone while someone it is for is still in it
event Tick(float DeltaTime)
{
    if (!bRepeating || Level.TimeSeconds < NextPlay)
        return;
    if (bOnTouch && !StillTouched())
    {
        StopRepeating("nobody in its zone");
        return;
    }
    PlayOne(Hearer);
    NextPlay = Level.TimeSeconds + NextWait();
}

// someone it is for is still in its zone (as Trigger's Timer looks)
function bool StillTouched()
{
    local int i;

    for (i = 0; i < 4; i++)
        if (Touching[i] != None && IsRelevant(Touching[i]))
            return True;
    return False;
}

function StopRepeating(string Why)
{
    if (bRepeating)
        Log("UCSoundFX" @ Name @ "stops repeating:" @ Why);
    bRepeating = False;
    Disable('Tick');
}

function Touch(Actor Other)
{
    if (!bOnTouch)
        return;
    if (IsRelevant(Other) && (ReTriggerDelay <= 0 || Level.TimeSeconds - TriggerTime >= ReTriggerDelay))
        PlayFX(Other);
    Super.Touch(Other);          // its Event and its message, as every trigger
}

// a triggered sound (not on touch) says neither 'walks in' (Touch) nor 'walks out'
function UnTouch(Actor Other)
{
    if (bOnTouch)
        Super.UnTouch(Other);
}

function Trigger(Actor Other, Pawn EventInstigator)
{
    if (EventInstigator != None)
        PlayFX(EventInstigator);
    else
        PlayFX(Other);
}

// untriggered (a Trigger JC walks out of, an interaction's Switch off): one that repeats stops
function UnTrigger(Actor Other, Pawn EventInstigator)
{
    StopRepeating("untriggered");
}

defaultproperties
{
     FXVolume=1.000000
     FXRadius=1024.000000
     FXPitch=1.000000
     bOnTouch=True
     LastPick=-1
     CollisionRadius=64.000000
     CollisionHeight=64.000000
}
