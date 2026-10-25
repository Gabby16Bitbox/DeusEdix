//=============================================================================
// UCLink - an interaction made in the map editor (Properties > Interactions): "when this
// happens to an object, do these things". No Tag or Event to write by hand: the link hooks
// itself to its object when the map starts (it takes the object's Event, keeping the event
// the object had: that one is triggered too), then runs its actions, each after its delay.
//
// The outputs each kind of object offers, and how each is heard, are the editor's tools\mapkit\editor\config\
// logic.json; tools\mapkit\editor\LOGIC.md explains the whole (conditions, scripts as blocks, the logic log).
//
//   When     opened (has opened), closed (starts closing), destroyed (a door), leave (JC walks out of a
//            trigger), animdone (the object's animation has finished), used (a button, any object JC uses), code,
//            wrongcode (a keypad), option (a computer's special option), enter (a trigger zone),
//            laser, alarm, dies (a character: killed or knocked out), any (whatever the object
//            triggers), picked (an item JC picks up), gone (an object destroyed), near (JC comes
//            within NearDist), start (the map starts: no object), npcused (a character has used the
//            object: UCNpcUse), finished / stopped (a timer, UCTimer, ran out / was stopped), arrived (a
//            character sent with goto/run is there). "used" on an object made usable (UCUsable): when JC
//            has finished using it (its UCUsable triggers the link, the link hooks nothing); output (a
//            script of Tools > Scripts says Port: UCScript.Output sets the link off)
//   Cond[i]  the conditions: all must hold when it fires, or it does nothing that time (UCEditorStory.Holds)
//   Act[i]   "delay|verb|target|a|b|c" (see DoAct)
//
// Every link of an object shares the Tag UCL_<object> (UCL_<object>_Fail for a keypad's wrong
// code, UCL_<object>_Opt<n> for a computer's option); the editor makes them (editor\links.py).
// What it does goes to the logic log (Report): the editor's Console shows it while Play runs.
//=============================================================================
class UCLink extends UCEditorStory;

var() string Source;          // the object (its name in the map); empty when When=start
var() name   When;
var() string Rule;            // the rule's id in the editor (the logic log names it)
var() string Port;            // When=output: which output of the script
var() string Cond[8];         // the conditions (UCEditorStory.Holds)
var() int    Option;          // When=option: which special option of the computer (0-3)
var() float  NearDist;        // When=near
var() bool   bOnce;           // only the first time
var() string Label;           // the sentence the editor shows
var() string Act[24];

var name  PassEvent;          // the object's own event before the link took it: triggered too
var bool  bDone, bPolled, bWas, bHurry;
var bool  bViaUnTrigger;      // When=code on a keypad that toggles door locks: heard by its UnTriggerEvent
var DeusExMover PendingDoor;  // a door that triggered opened/destroyed: which one it was is known a tick later
var Actor PendingBy;
var int   Step;
var float Waited, Delay;

// UCLightMemory keeps the original type of each light, shared by all interactions.

function PostBeginPlay()
{
	Super.PostBeginPlay();
	Disable('Tick');              // only while a door's event waits to be told apart (Trigger)
	Hook();
}

// one line of the logic log about this rule: kind|map|rule|rest (editor/LOGIC.md)
function Report(string kind, string rest)
{
	if (Rule != "")
		LogicLine(kind $ "|" $ MapName() $ "|" $ Rule $ "|" $ rest);
	else                          // a map built before rules had their id
		LogicLine(kind $ "|" $ MapName() $ "|" $ Name $ "|" $ rest);
}

function string NameOf(Actor A)
{
	if (A == None)
		return "";
	return string(A.Name);
}

function Actor ActorCalled(string s)
{
	local Actor A;

	if (s == "")
		return None;
	foreach AllActors(class'Actor', A)
		if (string(A.Name) ~= s && !A.bDeleteMe)
			return A;
	return None;
}

// The object's event becomes this link's Tag.
function Hook()
{
	local Actor A;
	local Keypad K;
	local Computers C;

	if (Source == "" || When == 'start' || When == 'picked' || When == 'gone' || When == 'near'
		|| When == 'cutstart' || When == 'cutdone'      // a cutscene (UCCutscene) triggers UCL_<name>_Start / _End
		|| When == 'npcused' || When == 'finished' || When == 'stopped' || When == 'arrived'
		|| When == 'output')                            // a script's output (UCScript.Output) sets the link off
		return;                                         // (UCNpcUse, UCTimer trigger their tags; arrived is watched)
	if (When == 'used' && UsableOf(Source) != None)    // JC has finished using it: its UCUsable triggers this
		return;
	if (When == 'animdone')                 // the end of the object's animation: its UCMotion's Event
	{
		HookMotion();
		return;
	}
	A = ActorCalled(Source);
	if (A == None)
	{
		Report("hook", Source $ "|missing");
		return;
	}
	if (AimsItsEvent(A))
	{
		Report("hook", Source $ "|target");
		return;
	}
	K = Keypad(A);
	if (When == 'code' && K != None && K.bToggleLock)  // its Event names the doors its code unlocks: keep it
	{
		HookUnTrigger(K);
		return;
	}
	if (When == 'wrongcode')
	{
		K = Keypad(A);
		if (K != None && K.FailEvent != Tag)
		{
			PassEvent = K.FailEvent;
			K.FailEvent = Tag;
		}
	}
	else if (When == 'option')
	{
		C = Computers(A);
		if (C != None && Option >= 0 && Option < ArrayCount(C.specialOptions) && C.specialOptions[Option].TriggerEvent != Tag)
		{
			PassEvent = C.specialOptions[Option].TriggerEvent;
			C.specialOptions[Option].TriggerEvent = Tag;
		}
	}
	else if (A.Event != Tag)
	{
		PassEvent = A.Event;
		A.Event = Tag;
	}
}

// Classes whose Event is the list of what they act on (config\logic.json "targettrigger", "switchtrigger"):
// taking it would break them. Revision's other MoreTriggers never send their Event when JC walks in, only
// untrigger it when he walks out ("moretrigger"): 'leave' is all a rule can hear from them. IsA by name: these
// classes may not exist in the game the map is for.
function bool AimsItsEvent(Actor A)
{
	if (AllianceTrigger(A) != None || OrdersTrigger(A) != None || InterpolateTrigger(A) != None || SequenceTrigger(A) != None
		|| A.IsA('UnTrigger') || A.IsA('RevStateTrigger'))
		return True;
	if (A.IsA('ElevatorTrigger') || A.IsA('PawnAppearTrigger') || A.IsA('ActorAppearTrigger') || A.IsA('AnimTrigger')
		|| A.IsA('AnimTweenBlendTrigger') || A.IsA('DamageTriggerDirect') || A.IsA('LOSHateTrigger')
		|| A.IsA('PhysicsTrigger') || A.IsA('SkinColourTrigger') || A.IsA('TriggerTrigger') || A.IsA('UnlitTrigger'))
		return True;
	return A.IsA('MoreTriggers') && When != 'leave';
}

// A keypad that toggles door locks fires no event, but untriggers its UnTriggerEvent list on the right code
// (Keypad.RunUntriggers): this link takes a free slot of that list.
function HookUnTrigger(Keypad K)
{
	local int i;

	for (i = 0; i < ArrayCount(K.UnTriggerEvent); i++)
		if (K.UnTriggerEvent[i] == Tag)
		{
			bViaUnTrigger = True;
			return;
		}
	for (i = 0; i < ArrayCount(K.UnTriggerEvent); i++)
		if (K.UnTriggerEvent[i] == '')
		{
			K.UnTriggerEvent[i] = Tag;
			bViaUnTrigger = True;
			return;
		}
	Report("hook", Source $ "|noslot");
}

function HookMotion()
{
	local UCMotion Mo;

	foreach AllActors(class'UCMotion', Mo)
		if (Mo.Target ~= Source && Mo.Event != Tag)
		{
			PassEvent = Mo.Event;
			Mo.Event = Tag;
		}
}

function Trigger(Actor Other, Pawn EventInstigator)
{
	local Actor A;
	local DeusExMover M;

	if (PassEvent != '')
		foreach AllActors(class'Actor', A, PassEvent)
			A.Trigger(Other, EventInstigator);
	M = DeusExMover(Other);
	if (When == 'closed' || When == 'leave' || When == 'start' || When == 'picked' || When == 'gone' || When == 'near'
		|| When == 'arrived')
		return;
	if ((When == 'opened' || When == 'destroyed') && M != None)
	{
		// a door blown up triggers its event before it is marked destroyed (DeusExMover.BlowItUp): tell them
		// apart on the next tick
		PendingDoor = M;
		PendingBy = Who(Other, EventInstigator);
		Enable('Tick');
		return;
	}
	if (When == 'destroyed')
		return;
	RunRule(Who(Other, EventInstigator));
}

// What set the rule off, for the logic log: the character using an object (UCNpcUse), the editor's own actor that
// did it (a timer, a cutscene, a script: they pass JC along), else who did it when the game says, else what triggered.
function Actor Who(Actor Other, Pawn EventInstigator)
{
	local Actor A;

	if (UCNpcUse(Other) != None)
	{
		A = ActorCalled(UCNpcUse(Other).Who);
		if (A != None)
			return A;
	}
	if ((UCEditorStory(Other) != None && UCUsable(Other) == None) || UCScript(Other) != None)
		return Other;                 // (a usable object is JC's own doing)
	if (EventInstigator != None)
		return EventInstigator;
	return Other;
}

event Tick(float DeltaTime)
{
	local DeusExMover M;

	M = PendingDoor;
	PendingDoor = None;
	Disable('Tick');
	if (M != None && (When == 'destroyed') == M.bDestroyed)
		RunRule(PendingBy);
}

function UnTrigger(Actor Other, Pawn EventInstigator)
{
	local Actor A;

	if (PassEvent != '')
		foreach AllActors(class'Actor', A, PassEvent)
			A.UnTrigger(Other, EventInstigator);
	if (When == 'closed' || When == 'leave' || (When == 'code' && bViaUnTrigger && Keypad(Other) != None))
		RunRule(Who(Other, EventInstigator));
}

// The rule runs, unless it ran already (once), still runs (its delays), or a condition does not hold: a rule refused
// by a condition is not used up. Each case goes to the logic log.
// (not Fire: DeusEx has a class Fire, and Fire(x) would read as a cast to it)
function RunRule(optional Actor By)
{
	local int i;

	if (bOnce && bDone)
	{
		Report("skip", "once|");
		return;
	}
	if (IsInState('Running'))
	{
		Report("skip", "running|");
		return;
	}
	for (i = 0; i < ArrayCount(Cond); i++)
		if (Cond[i] != "" && !Holds(Cond[i]))
		{
			Report("skip", "cond|" $ Cond[i]);
			return;
		}
	bDone = True;
	Report("fire", Source $ "|" $ When $ "|" $ NameOf(By) $ "|" $ Label);
	GotoState('Running');
}

// a cutscene was skipped: what it still had to do happens now (its "when it starts" actions)
function Hurry()
{
	if (!IsInState('Running'))
		return;
	bHurry = True;
	GotoState('Running', 'Next');
}

// the map starts
function StartStory()
{
	if (When == 'start')
		RunRule();
}

// what has no event of its own: watched every half second, it runs when it becomes true
function TickStory()
{
	local Actor A;
	local DeusExPlayer P;
	local bool bNow;

	if (When != 'picked' && When != 'gone' && When != 'near' && When != 'arrived')
		return;
	P = Plr();
	A = ActorCalled(Source);
	if (When == 'arrived')
		bNow = Arrived(ScriptedPawn(A));
	else if (When == 'near')
		bNow = A != None && P != None && VSize(P.Location - A.Location) <= NearDist;
	else if (When == 'picked')
		bNow = A == None || (Inventory(A) != None && Pawn(A.Owner) != None);
	else
		bNow = A == None;
	if (!bPolled)
	{
		bPolled = True;
		bWas = bNow;
		if (bNow && When != 'near' && When != 'arrived')
			Report("hook", Source $ "|missing");
		return;
	}
	if (bNow && !bWas)
		RunRule();
	bWas = bNow;
}

// ---------------------------------------------------------------- the actions (Field: UCEditorStory)
// Fixed recipients stay connected when they move. The checkbox adds current entrants,
// evaluated when this action executes (including its delay), without double execution.
function bool AreaKind(Actor A, string kind)
{
	if (A == None || A == Self || A.bDeleteMe || PlayerPawn(A) != None || string(A.Name) ~= Source)
		return False;
	if (kind == "light") return Light(A) != None;
	if (kind == "character") return ScriptedPawn(A) != None;
	if (kind == "object") return Decoration(A) != None || Inventory(A) != None || Mover(A) != None;
	return False;
}

// Snapshot recipients before running actions: changing an alliance must not change
// which actors the same action has already selected. Chunks avoid a hard group limit.
function QueueRecipient(Actor A, out UCLinkGroup First, out UCLinkGroup Tail, out int Slot)
{
	local UCLinkGroup G;
	if (A == None || (First != None && First.Contains(A.Name))) return;
	if (Tail == None || Slot >= 128)
	{
		G = Spawn(class'UCLinkGroup');
		if (G == None) return;
		if (First == None) First = G;
		if (Tail != None) Tail.NextGroup = G.Name;
		Tail = G;
		Slot = 0;
	}
	Tail.SetMember(Slot,A.Name);
	Slot++;
}

function RunRecipients(UCLinkGroup First, string s)
{
	local UCLinkGroup G, N;
	local int i;
	G = First;
	while (G != None)
	{
		for (i=0; G.GetMember(i) != ''; i++)
			DoAct("0|" $ Field(s,1) $ "|" $ string(G.GetMember(i)) $ "|" $ Field(s,3) $ "|" $ Field(s,4) $ "|" $ Field(s,5));
		N = G.Next();
		G.Destroy();
		G = N;
	}
}

function bool TagKind(Actor A, string verb)
{
	if (A == None || A == Self || A.bDeleteMe || PlayerPawn(A) != None || string(A.Name) ~= Source
		|| UCObjectTag(A) != None || UCLinkGroup(A) != None || UCLink(A) != None) return False;
	if (Left(verb,5) == "light") return Light(A) != None;
	if (verb == "open" || verb == "close" || verb == "toggle" || verb == "lock" || verb == "unlock" || verb == "blow") return DeusExMover(A) != None;
	if (verb == "attack" || verb == "hostile" || verb == "friend" || verb == "neutral" || verb == "stand" || verb == "wander"
		|| verb == "follow" || verb == "goto" || verb == "run" || verb == "leave" || verb == "appear") return ScriptedPawn(A) != None;
	return True;
}

function DoTag(string s)
{
	local Actor A;
	local UCLinkGroup First,Tail;
	local int Slot;
	if (Field(s,7) == "") return;
	foreach AllActors(class'Actor',A)
		if (TagKind(A,Field(s,1)) && class'UCObjectTag'.static.Matches(A,Field(s,7))) QueueRecipient(A,First,Tail,Slot);
	RunRecipients(First,s);
}

function DoArea(string s)
{
	local Actor A;
	local UCLinkGroup G, First,Tail;
	local vector center;
	local string kind, wanted;
	local int i,Slot;
	local float radius;

	kind = Field(s,7);
	radius = float(Field(s,8));
	center.X = float(Field(s,9));
	center.Y = float(Field(s,10));
	center.Z = float(Field(s,11));
	wanted = Field(s,13);
	G = UCLinkGroup(ActorCalled(Field(s,12)));
	while (G != None)
	{
		for (i=0; G.GetMember(i) != ''; i++)
		{
			A = ActorCalled(string(G.GetMember(i)));
			if (AreaKind(A,kind) && class'UCObjectTag'.static.Matches(A,wanted)) QueueRecipient(A,First,Tail,Slot);
		}
		G = G.Next();
	}
	if (Field(s,6) == "area+" && radius > 0)
		foreach AllActors(class'Actor',A)
			if (AreaKind(A,kind) && VSize(A.Location-center) <= radius && class'UCObjectTag'.static.Matches(A,wanted))
				QueueRecipient(A,First,Tail,Slot);
	RunRecipients(First,s);
}

function DoAct(string s)
{
	local string verb, target, a, b, c;
	local Actor T;
	local DeusExMover M;
	local DeusExPlayer P;
	local Sound snd;
	local name n;

	if (Field(s, 6) == "group" || Field(s, 6) == "area+")
	{
		Report("act", Field(s, 1) $ "|area " $ Field(s, 7));     // then one line for each object in it
		DoArea(s);
		return;
	}
	if (Field(s, 6) == "tag")
	{
		Report("act", Field(s, 1) $ "|tag " $ Field(s, 7));
		DoTag(s);
		return;
	}
	verb = Field(s, 1);
	target = Field(s, 2);
	a = Field(s, 3);
	b = Field(s, 4);
	c = Field(s, 5);
	P = Plr();
	T = ActorCalled(target);
	Report("act", verb $ "|" $ target $ "|" $ a);       // a: what it says or sets (a message, a counter...)
	if (target != "" && T == None)
	{
		Report("fail", verb $ "|" $ target $ "|missing");
		return;
	}
	if (T != None)
		n = T.Name;
	M = DeusExMover(T);
	// doors
	if (verb == "open" && M != None)
		DoorOpen(M);
	else if (verb == "close" && M != None)
		DoorShut(M);
	else if (verb == "toggle" && M != None)
	{
		if (M.KeyNum == 0 && !M.bOpening)
			DoorOpen(M);
		else
			DoorShut(M);
	}
	else if (verb == "lock")
		DoorDo(n, 2);
	else if (verb == "unlock")
		DoorDo(n, 3);
	else if (verb == "blow")
		DoorDo(n, 4);
	else if (verb == "key" && M != None && P != None && P.KeyRing != None && M.KeyIDNeeded != '')
	{
		P.KeyRing.GiveKey(M.KeyIDNeeded, a);
		P.ClientMessage("Nanokey received:" @ a);
	}
	// characters
	else if (verb == "attack")
		NpcHostile(n, True, a == "alone");
	else if (verb == "hostile")
		NpcHostile(n, False, a == "alone");
	else if (verb == "friend")
		NpcFriend(n);
	else if (verb == "neutral")
		NpcNeutral(n);
	else if (verb == "stand")
		NpcOrders(n, 'Standing');
	else if (verb == "wander")
		NpcOrders(n, 'Wandering');
	else if (verb == "follow")
		NpcOrders(n, 'Following');
	else if (verb == "goto" || verb == "run")
		NpcGo(n, vect(1,0,0) * float(a) + vect(0,1,0) * float(b) + vect(0,0,1) * float(c), verb == "run");
	else if (verb == "navgo" || verb == "navrun")      // on the walkable area (UCNavMesh)
		NpcWalk(n, vect(1,0,0) * float(a) + vect(0,1,0) * float(b) + vect(0,0,1) * float(c), verb == "navrun");
	else if (verb == "leave")
		Hide(n);
	else if (verb == "appear")
		Show(n);
	// lights, objects, devices
	else if (verb == "lighton" || verb == "lightoff" || verb == "lighttoggle")
		LightSet(T, Mid(verb, 5));
	else if (verb == "hide" && T != None)
	{
		T.bHidden = True;
		T.SetCollision(False, False, False);
	}
	else if (verb == "show" && T != None)
	{
		T.bHidden = T.default.bHidden;
		T.SetCollision(T.default.bCollideActors, T.default.bBlockActors, T.default.bBlockPlayers);
	}
	else if (verb == "on" && T != None)
		T.Trigger(Self, P);
	else if (verb == "off" && T != None)
		T.UnTrigger(Self, P);
	else if (verb == "explode")
	{
		if (T != None)
			Boom(T.Location, float(a), float(b));
		else
			Boom(Location, float(a), float(b));
	}
	// sounds, messages, the story
	else if (verb == "sound")
	{
		snd = Sound(DynamicLoadObject(a, class'Sound', True));
		if (snd == None)
			Report("fail", verb $ "|" $ a $ "|nosound");
		else if (float(c) <= 0 && P != None)
			P.PlaySound(snd, SLOT_None, FMax(0.1, float(b)),, 100000);
		else if (T != None)
			T.PlaySound(snd, SLOT_None, FMax(0.1, float(b)),, float(c));
		else
			PlaySound(snd, SLOT_None, FMax(0.1, float(b)),, float(c));
	}
	else if (verb == "anim" || verb == "animback" || verb == "animstop")
		Animate(target, verb, M);
	else if (verb == "cutplay" && UCCutscene(T) != None)
		UCCutscene(T).Play();
	else if (verb == "cutstop" && UCCutscene(T) != None)
		UCCutscene(T).Stop();
	else if (verb == "message")
		Message(a);
	else if (verb == "goal" && a == "")
		Report("fail", "goal||noname");
	else if (verb == "goal")
		Goal(StringToName(a), b, c == "done");
	else if (verb == "note")
		Note(a);
	else if (verb == "flag" && a == "")
		Report("fail", "flag||noname");
	else if (verb == "flag")
		SetF(StringToName(a), b != "0");
	else if (verb == "count")                           // a counter changes by b, or is set to b
		Count(StringToName(a), int(b), c == "set");
	else if (verb == "travel")
		TravelTo(a);
	// timers, characters using objects, effects
	else if (Left(verb, 5) == "timer" && UCTimer(T) != None)
		TimerDo(UCTimer(T), Mid(verb, 5), float(a));
	else if (verb == "npcuse")
		NpcUse(target, a, float(b), c != "stand");
	else if (verb == "effect" && T != None)
		Effect(T, a, float(b), c);
	// a script's input (Tools > Scripts): a virtual call, UCScript is in this package
	else if (verb == "input" && UCScript(T) != None)
		ScriptInput(UCScript(T), a, b);
	else if (verb == "input")
		Report("fail", verb $ "|" $ target $ "|noscript");
	else if (verb == "floor")                           // an elevator goes to floor a (its sequence, as SequenceTrigger)
		Floor(T, int(a));
	else
		Report("fail", verb $ "|" $ target $ "|cannot");
}

// (SetSeq checks nothing: past its last key an ElevatorMover goes to its base, a MultiMover says it arrived)
function Floor(Actor T, int n)
{
	if (ElevatorMover(T) != None && n >= 0 && n < ElevatorMover(T).NumKeys)
		ElevatorMover(T).SetSeq(n);
	else if (MultiMover(T) != None && n >= 0 && n < 4 && MultiMover(T).SeqKeys(n, 0) >= 0)
		MultiMover(T).SetSeq(n);
	else if (ElevatorMover(T) != None || MultiMover(T) != None)
		Report("fail", "floor|" $ NameOf(T) $ "|nofloor");
	else
		Report("fail", "floor|" $ NameOf(T) $ "|cannot");
}

function Count(name counter, int n, bool bSet)
{
	if (counter == '')
	{
		Report("fail", "count||noname");
		return;
	}
	if (bSet)
		SetI(counter, n);
	else
		SetI(counter, GetI(counter) + n);
}

function ScriptInput(UCScript S, string inputName, string args)
{
	LogicLine("input|" $ MapName() $ "|" $ S.Name $ "|" $ inputName $ "|" $ args);
	S.StartScript();              // a rule at the very start of the map: the script has its Started() first
	S.Input(inputName, args, Self);
}

// ---------------------------------------------------------------- the editor's building blocks
// The usable object of the map editor on this object (Properties > Usable), if it has one.
function UCUsable UsableOf(string objName)
{
	local UCUsable U;

	foreach AllActors(class'UCUsable', U)
		if (U.Target ~= objName)
			return U;
	return None;
}

// A character sent with goto/run (UCEditorStory.NpcGo: orders to the mark UCEdGo_<name>) is there.
function bool Arrived(ScriptedPawn sp)
{
	local UCMark mark;
	local UCNavRoute R;
	local name t;
	local bool bThere, bMark;
	local vector spot;

	if (sp == None || sp.Health <= 0)
		return False;
	foreach AllActors(class'UCNavRoute', R)          // still on the way: its mark is at a corner, not the place
		if (R.Who == sp && R.OnTheWay())
			return False;
	t = StringToName("UCEdGo_" $ sp.Name);
	if (t == '' || sp.OrderTag != t || (sp.Orders != 'GoingTo' && sp.Orders != 'RunningTo'))
		return False;
	foreach AllActors(class'UCMark', mark, t)
	{
		bMark = True;
		if (AtSpot(sp, mark.Location))
			bThere = True;
	}
	if (!bMark && SentToAny(sp.Name, spot))          // after a load the mark (transient) is not made again yet
		bThere = AtSpot(sp, spot);
	return bThere && !sp.IsInState('GoingTo') && !sp.IsInState('RunningTo');
}

// start (seconds: its own when 0), stop, pause, resume
function TimerDo(UCTimer T, string how, float secs)
{
	if (how == "start")
		T.StartIt(secs);
	else if (how == "stop")
		T.StopIt();
	else if (how == "pause")
		T.PauseIt();
	else if (how == "resume")
		T.ResumeIt();
}

// A character goes to an object and uses it (UCNpcUse); a new use of his replaces the one he was on.
function NpcUse(string who, string what, float secs, bool bCrouch)
{
	local UCNpcUse U;

	foreach AllActors(class'UCNpcUse', U)
		if (U.Who ~= who)
			U.Destroy();
	U = Spawn(class'UCNpcUse');
	if (U == None)
		return;
	U.Who = who;
	U.What = what;
	U.Secs = FMax(0, secs);
	U.bCrouch = bCrouch;
	U.Go();
}

// An effect on an object (UCEffect); "off" stops every effect on it, a new one replaces the same kind.
// On an effect point (UCEffectPoint) it sits on the point and goes along its arrow; opts may hold "exact".
function Effect(Actor T, string kind, float secs, string opts)
{
	local UCEffect E;

	foreach AllActors(class'UCEffect', E)
		if (E.Target ~= string(T.Name) && (kind ~= "off" || E.Kind ~= kind))
			E.Destroy();
	if (kind ~= "off" || kind == "")
		return;                                         // every effect on it stopped
	E = Spawn(class'UCEffect',,, T.Location);
	if (E == None)
		return;
	E.Target = string(T.Name);
	E.StartEffect(kind, secs, opts);
}

// The animation of an object (its UCMotion, made in the editor's Animation panel); a door without one
// opens and shuts.
function Animate(string target, string verb, DeusExMover M)
{
	local UCMotion Mo;
	local bool bAny;

	foreach AllActors(class'UCMotion', Mo)
		if (Mo.Target ~= target)
		{
			bAny = True;
			if (verb == "animstop")
				Mo.StopIt();
			else
				Mo.Play(verb == "animback");
		}
	if (!bAny && M != None)
	{
		if (verb == "anim")
			DoorOpen(M);
		else if (verb == "animback")
			DoorShut(M);
	}
}

// On, off or the other way: the kind of light (steady, flickering...) comes back when it is
// turned on again. The editor makes these lights non-static (their light can change).
function LightSet(Actor T, string mode)
{
	local UCLightMemory M, Found;
	if (T == None) return;
	foreach AllActors(class'UCLightMemory', M)
		if (M.Target == T) { Found = M; break; }
	if (mode == "toggle")
	{
		if (T.LightType == LT_None) mode = "on";
		else mode = "off";
	}
	if (mode == "off" && T.LightType != LT_None)
	{
		if (Found == None) Found = Spawn(class'UCLightMemory');
		if (Found != None) { Found.Target = T; Found.OriginalType = T.LightType; }
		T.LightType = LT_None;
	}
	else if (mode == "on" && T.LightType == LT_None)
	{
		if (Found != None && Found.OriginalType != LT_None) T.LightType = Found.OriginalType;
		else T.LightType = LT_Steady;
	}
}

function Boom(vector loc, float dmg, float radius)
{
	local ExplosionLarge E;
	local ExplosionLight L;

	if (radius <= 0)
		radius = 256;
	E = Spawn(class'ExplosionLarge',,, loc);
	L = Spawn(class'ExplosionLight',,, loc);
	if (L != None)
		L.size = 8;
	if (E != None)
		E.PlaySound(sound'LargeExplosion1', SLOT_None, 2.0,, radius * 16);
	if (dmg > 0)
		HurtRadius(dmg, radius, 'Exploded', dmg * 100, loc);
}

state Running
{
Begin:
	Step = 0;
	Waited = 0;
	bHurry = False;
Next:
	if (Step < ArrayCount(Act) && Act[Step] != "")
	{
		Delay = float(Field(Act[Step], 0));
		if (!bHurry && Delay > Waited)
		{
			Sleep(Delay - Waited);
			Waited = Delay;
		}
		DoAct(Act[Step]);
		Step++;
		Goto('Next');
	}
	GotoState('');
}

defaultproperties
{
     bRouteOnly=False
     NearDist=256.000000
}
