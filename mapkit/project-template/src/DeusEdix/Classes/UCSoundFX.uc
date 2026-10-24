//=============================================================================
// UCSoundFX - a sound effect placed in the map editor.
// - Zone (bOnTouch): it plays when JC walks into it (the cylinder CollisionRadius / CollisionHeight, as
//   a Trigger: TriggerType, bTriggerOnceOnly, ReTriggerDelay work as always), and it also
//   sets off its Event, as any Trigger does.
// - Triggered (Tag): it plays when something triggers it: the Event of a door (when it has finished
//   opening), of a button, of a keypad, of another trigger, an action of the story.
// FXSound is heard from where the object is, up to FXRadius units (bAtPlayer: inside JC's head,
// just as loud wherever he is: a voice, an alarm on the communicator).
//=============================================================================
class UCSoundFX extends Trigger;

var() sound FXSound;
var() float FXVolume;          // 1 = normal
var() float FXRadius;          // how far it is heard (units)
var() float FXPitch;           // 1 = as recorded
var() bool  bAtPlayer;         // heard "inside JC's head", not from here
var() bool  bOnTouch;          // plays when JC walks in (else only when triggered)
var bool bPlayed;

function PlayFX(Actor Who)
{
    local Pawn P;

    if (FXSound == None || (bTriggerOnceOnly && bPlayed))
        return;
    bPlayed = true;
    if (bAtPlayer)
    {
        P = Pawn(Who);
        if (P == None || !P.IsA('PlayerPawn'))
            P = GetPlayerPawn();
        if (P != None)
        {
            P.PlaySound(FXSound, SLOT_None, FXVolume,, 100000, FXPitch);
            Log("UCSoundFX" @ Name @ "played" @ FXSound @ "for JC");
            return;
        }
    }
    PlaySound(FXSound, SLOT_None, FXVolume,, FXRadius, FXPitch);
    Log("UCSoundFX" @ Name @ "played" @ FXSound);
}

function Touch(Actor Other)
{
    if (!bOnTouch)
        return;
    if (IsRelevant(Other) && (ReTriggerDelay <= 0 || Level.TimeSeconds - TriggerTime >= ReTriggerDelay))
        PlayFX(Other);
    Super.Touch(Other);          // its Event and its message, as every trigger
}

function Trigger(Actor Other, Pawn EventInstigator)
{
    if (EventInstigator != None)
        PlayFX(EventInstigator);
    else
        PlayFX(Other);
}

defaultproperties
{
     FXVolume=1.000000
     FXRadius=1024.000000
     FXPitch=1.000000
     bOnTouch=True
     CollisionRadius=64.000000
     CollisionHeight=64.000000
}
