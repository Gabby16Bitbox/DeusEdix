//=============================================================================
// UCAnimSet - what a character does when it is not busy, chosen in the map editor.
// - With PawnName (the character's name in the map): the animation it plays standing still (Orders
//   Standing) instead of breathing, and (bOwnModel) its model with the animations made
//   in the Animation Studio: DeusEdixAnims.<the model it has now>, the game's sequences plus the new ones.
//   The model is the one the game gave it: with HDTP the soldiers switch to HDTPCharacters.*
//   (Facelift), and DeusEdixAnims has a copy of each; if the game changes it again, it is put back.
// - Without PawnName: the animations of the patrol points, for every character. PatrolPoint has a
//   PatrolAnim field the game never uses: whoever patrols and stops at that point (PauseTime)
//   plays it instead of breathing.
// The game's AI puts the breathing back only now and then (end of a loop, random gestures): the Tick
// brings it back to the chosen animation. In a conversation, a fight or a flight it touches nothing.
// - bStayPut (editor: Inspector > Behaviour > Stays put; Gabby, 18 Oct 2026): never turns, not even to talk.
//   While standing or talking the body keeps the way it faced at the start (no turning speed: the game's
//   turns only ask for a rotation) and its animation; the head alone follows JC (the game's head turn,
//   played on its own channel). Fighting, fleeing or sent somewhere, the AI turns it as always.
//=============================================================================
class UCAnimSet extends Info;

var() name PawnName;
var() name IdleAnim;
var() float IdleRate;
var() bool bOwnModel;
var Mesh Tried;                    // the last model whose copy was looked for

var ScriptedPawn Who;
var bool bReady;
var float Since;

var() bool bStayPut;               // never turns while standing or talking (see above)
var rotator Home;                  // the way it faced at the start
var rotator SavedRate;             // its turning speed, while held still
var bool bHeld;

// Appearance-only instance: apply after the game's initial Facelift/HDTP pass.
// PawnName is the exact object name, never a shared Tag. No AI or collision changes.
var() Mesh AppearanceMesh;
var() Texture AppearanceSkin;
var() Texture AppearanceSkins[8];

function PostBeginPlay()
{
    Super.PostBeginPlay();
    SetTimer(0.2, false);          // after every actor of the map has started
}

function Timer()
{
    local ScriptedPawn P;
    local Actor A;
    local int i;

    if (AppearanceMesh != None)
    {
        foreach AllActors(class'Actor', A)
            if (A.Name == PawnName)
            {
                A.Mesh = AppearanceMesh;
                A.Skin = AppearanceSkin;
                for (i = 0; i < 8; i++)
                    A.MultiSkins[i] = AppearanceSkins[i];
                break;
            }
        // Startup only. Later gameplay (cloaking, damage, custom animations) keeps control.
        Disable('Tick');
        return;
    }

    if (PawnName != '' && PawnName != 'None')
    {
        foreach AllActors(class'ScriptedPawn', P)
            if (P.Name == PawnName)
            {
                Who = P;
                Home = P.Rotation;
                break;
            }
    }
    bReady = true;
}

// the animation it should play now ('' = the game decides)
function name Wanted(ScriptedPawn P, out float Rate)
{
    local PatrolPoint Point;

    if (P == None || P.bDeleteMe || P.Health <= 0)
        return '';
    Rate = 1.0;
    if (VSize(P.Velocity * vect(1, 1, 0)) > 10)
        return '';
    if (P.IsInState('Patrolling'))
    {
        Point = PatrolPoint(P.destPoint);
        if (Point == None || VSize((P.Location - Point.Location) * vect(1, 1, 0)) > P.CollisionRadius + 24)
            return '';
        if (Point.PatrolAnim != '' && Point.PatrolAnim != 'None')
            return Point.PatrolAnim;
        if (P == Who && Point.PauseTime > 0)
        {
            Rate = IdleRate;
            return IdleAnim;
        }
        return '';
    }
    if (P == Who && (P.IsInState('Standing') || (bStayPut && Talking(P))))
    {
        Rate = IdleRate;
        return IdleAnim;
    }
    return '';
}

function bool Talking(ScriptedPawn P)
{
    return P.IsInState('Conversation') || P.IsInState('FirstPersonConversation');
}

// Stays put: no turning while standing or talking, back to the start's facing if something turned it
function Hold()
{
    local bool bStill;

    bStill = bStayPut && Who != None && !Who.bDeleteMe && Who.Health > 0
        && (Who.IsInState('Standing') || Talking(Who));
    if (bStill)
    {
        if (!bHeld)
        {
            SavedRate = Who.RotationRate;
            bHeld = True;
        }
        Who.RotationRate.Yaw = 0;
        Who.DesiredRotation.Yaw = Home.Yaw;
        if (Who.Rotation.Yaw != Home.Yaw)
            Who.SetRotation(Home);
    }
    else if (bHeld)
    {
        if (Who != None && !Who.bDeleteMe)
            Who.RotationRate = SavedRate;
        bHeld = False;
    }
}

// the model with the new animations, a copy of the one it has now
function OwnModel()
{
    local Mesh M;

    if (!bOwnModel || Who == None || Who.Mesh == None || Who.Mesh == Tried || Who.Mesh.Outer.Name == 'UCAnims')
        return;
    Tried = Who.Mesh;
    M = Mesh(DynamicLoadObject("DeusEdixAnims." $ Who.Mesh.Name, class'Mesh', true));
    if (M != None)
    {
        Who.Mesh = M;
        Tried = M;
    }
}

function Apply(ScriptedPawn P)
{
    local name A;
    local float R;

    A = Wanted(P, R);
    if (A == '' || A == 'None' || P.AnimSequence == A || !P.HasAnim(A))
        return;
    if (R <= 0)
        R = 1.0;
    P.LoopAnim(A, R, 0.25);
}

function Tick(float DeltaTime)
{
    local ScriptedPawn P;

    if (!bReady)
        return;
    if (Who != None)
    {
        OwnModel();
        Apply(Who);
        Hold();
    }
    else if (PawnName == '' || PawnName == 'None')
    {
        Since += DeltaTime;
        if (Since < 0.1)
            return;
        Since = 0;
        foreach AllActors(class'ScriptedPawn', P)
            Apply(P);
    }
}

defaultproperties
{
     IdleRate=1.000000
     bHidden=True
}
