// Exact-chair orders, using Deus Ex's Sitting state, seat slots and StandUp.
// No chair Tag is changed. This saved helper owns only this one request; newer
// orders cancel it. Conversations finish before the request starts.
class UCSeatOrder extends Info;

var ScriptedPawn Who;
var Seat Chair;
var name PreviousOrders, PreviousTag;
var bool bRise, bStarted;
var float BestDistance, StuckTime;
var UCAnimSet RiseAnimation;
var bool bOwnRiseAnimation;
var bool bPreviousFirstSeatOnly;

static function Cancel(ScriptedPawn P)
{
    local UCSeatOrder O;
    if (P == None) return;
    foreach P.AllActors(class'UCSeatOrder', O)
        if (O.Who == P) O.Destroy();
}

static function bool Send(ScriptedPawn P, Seat S, optional bool rise)
{
    local UCSeatOrder O;
    local int i;
    local bool free;

    if (P == None || P.bDeleteMe || P.Health <= 0 || !P.bInWorld) return False;
    if (rise)
        foreach P.AllActors(class'UCSeatOrder', O)
            if (O.Who == P && O.bRise) return True;
    if (!rise)
    {
        if (S == None || !P.bCanSit || !P.HasAnim('SitBegin') || !P.HasAnim('SitBreathe')) return False;
        if (!P.IsSeatValid(S) || S.Region.Zone.bWaterZone) return False;
        for (i = 0; i < S.numSitPoints; i++)
            if (S.sittingActor[i] == None || S.sittingActor[i] == P) free = True;
        if (!free) return False;
        // Repeated events must not replay the sit-down or release its reservation.
        foreach P.AllActors(class'UCSeatOrder', O)
            if (O.Who == P && O.Chair == S && !O.bRise) return True;
        if (P.bSitting && P.SeatActor == S && P.Orders == 'Sitting') return True;
    }
    Cancel(P);
    O = P.Spawn(class'UCSeatOrder');
    if (O == None) return False;
    O.Who = P;
    O.Chair = S;
    O.bRise = rise;
    O.PreviousOrders = P.Orders;
    O.PreviousTag = P.OrderTag;
    O.Tag = O.Name;
    O.SetTimer(0.2, True);
    return True;
}

function StopBody()
{
    local UCAnimSet A;
    foreach AllActors(class'UCAnimSet', A)
        if (A.Who == Who || A.PawnName == Who.Name) A.StopBody();
}

function bool Busy()
{
    return Who.IsInState('Conversation') || Who.IsInState('FirstPersonConversation')
        || Who.Enemy != None || !Who.bInterruptState;
}

function Fail(string why)
{
    Log("UCSeatOrder:" @ Who @ why);
    if (Who != None && Who.Health > 0 && bStarted && Who.OrderTag == Tag)
    {
        Who.StandUp();
        Who.SetOrders('Standing', '', True);
    }
    Destroy();
}

function BeginOrder()
{
    local int i, slot;
    local bool wasSeated;
    local UCAnimSet A;

    if (!bRise)
    {
        if (Chair == None || !Who.IsSeatValid(Chair) || Chair.Region.Zone.bWaterZone)
        { Fail("seat is unavailable"); return; }
        slot = -1;
        for (i = 0; i < Chair.numSitPoints; i++)
            if (Chair.sittingActor[i] == None || Chair.sittingActor[i] == Who)
            { slot = i; break; }
        if (slot < 0) { Fail("seat is occupied"); return; }
    }
    StopBody();
    wasSeated = Who.bSitting;
    // Exit the old state before reserving: Sitting.EndState can release a seat.
    Who.StandUp();
    Who.ClearNextState();
    Who.SetOrders('Standing', '', False);
    Who.GotoState('Standing');
    bStarted = True;
    if (bRise)
    {
        if (wasSeated && Who.HasAnim('SitStand'))
        {
            // Reuse their animation controller, so its custom idle does not fight SitStand.
            foreach AllActors(class'UCAnimSet', A)
                if (A.Who == Who && A.AppearanceMesh == None)
                { RiseAnimation = A; break; }
            if (RiseAnimation == None)
            {
                RiseAnimation = Spawn(class'UCAnimSet');
                bOwnRiseAnimation = True;
            }
            if (RiseAnimation != None)
            {
                RiseAnimation.Who = Who;
                RiseAnimation.Home = Who.Rotation;
                RiseAnimation.bReady = True;
                RiseAnimation.PlayBody('SitStand', 0, "once x1", "");
            }
        }
        if (RiseAnimation == None) Destroy();
        return;
    }
    Who.SetOrders('Sitting', Tag, False);
    Who.OrderActor = Chair;
    Who.SeatActor = Chair;
    Who.SeatSlot = slot;
    Who.SeatLocation = Chair.Location;
    Who.bSeatLocationValid = True;
    Who.SeatHack = Chair;
    Who.bSeatHackUsed = True;
    bPreviousFirstSeatOnly = Who.bUseFirstSeatOnly;
    Who.bUseFirstSeatOnly = True;
    Chair.sittingActor[slot] = Who;
    BestDistance = VSize(Who.Location - Chair.Location);
    Who.GotoState('Sitting');
}

function Timer()
{
    local float d;
    if (Who == None || Who.bDeleteMe || Who.Health <= 0 || !Who.bInWorld)
    { Destroy(); return; }
    if (!bStarted)
    {
        if (Who.Orders != PreviousOrders || Who.OrderTag != PreviousTag)
        { Destroy(); return; }
        if (!Busy()) BeginOrder();
        return;
    }
    if (bRise)
    {
        if (Who.Orders != 'Standing' || !Who.IsInState('Standing')
            || RiseAnimation == None || RiseAnimation.BodyAnim == '') Destroy();
        return;
    }
    if (Who.Orders != 'Sitting' || Who.OrderTag != Tag)
    { Destroy(); return; }
    if (Chair == None || !Who.IsSeatValid(Chair))
    { Fail("seat was removed, moved or picked up"); return; }
    // Do not force the AI out of combat, a conversation or a damage reaction.
    if (!Who.IsInState('Sitting'))
    {
        if (!Busy() && (Who.IsInState('Standing') || Who.IsInState('Wandering')))
            Fail("requested seat could not be reached");
        return;
    }
    if (Who.SeatActor != Chair)
    { Fail("requested seat could not be reached"); return; }
    if (Who.bSitting || Who.bSitInterpolation) { StuckTime = 0; return; }
    d = VSize(Who.Location - Chair.Location);
    if (d < BestDistance - 8) { BestDistance = d; StuckTime = 0; }
    else StuckTime += 0.2;
    if (StuckTime >= 20) Fail("no progress towards the seat; check AI paths and obstacles");
}

function Destroyed()
{
    local int i;
    if (Who != None && !Who.bDeleteMe && bStarted && !bRise)
        Who.bUseFirstSeatOnly = bPreviousFirstSeatOnly;
    if (RiseAnimation != None)
    {
        RiseAnimation.StopBody();
        if (bOwnRiseAnimation) RiseAnimation.Destroy();
    }
    // The actual seated occupant belongs to the game's StandUp, not this helper.
    if (Chair != None && Who != None && (Who.Health <= 0 || Who.bDeleteMe || !Who.bSitting || Who.SeatActor != Chair))
        for (i = 0; i < Chair.numSitPoints; i++)
            if (Chair.sittingActor[i] == Who) Chair.sittingActor[i] = None;
    Super.Destroyed();
}

defaultproperties
{
    bHidden=True
}
