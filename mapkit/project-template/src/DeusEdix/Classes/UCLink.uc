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
//            script of Tools > Scripts says Port: UCScript.Output sets the link off); hacked (a hackable device:
//            a slot of its UnTriggerEvent), killed / knockedout (a character: told apart a tick after its event),
//            tagfires (the game's own Tag: the link's Tag is it), becomes (the condition Watch becomes true),
//            changes (the state or counter Watch changes), and the watched properties (bWatchProp: Watch holds
//            their tests, on Source or, with none, on the player: spotted, alarmoff, hurt, unlocked, atfloor...)
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
// A list of steps (the editor's lists: If / Otherwise / Wait until, editor/LOGIC.md "Logic runtime v2"): each Act's
// delay counts from the step before, and an Act can be a step of the list itself:
//   "delay|check|all or any|first|count|fail"  the conditions StepCond[first..]: they hold, the next step; they do
//                                             not, the step `fail` (an index, or "stop")
//   "delay|jump|||step|"                      on at that step ("stop": the end)
//   "delay|until|who|arrived or cond|most|k"  wait until who has arrived (sent with goto / run), or StepCond[k]
//                                             holds, at most `most` seconds (0: as long as it takes)
//   "delay|wait|||||"                         only its delay
var() bool   bSteps;
var() string StepCond[16];
var int   Runs;               // the steps run since it was set off: a list that goes round with no end is stopped
var float UntilStart;
// What a watched output looks at (P4, editor/LOGIC.md "Outputs and inputs"): When=becomes a condition, When=changes
// "flag|Name" or "count|Name", bWatchProp tests on properties: "Prop=Value", "Prop!=Value", "Prop<N", "Prop>N",
// "Prop<%N" (under N% of what it had at the first look), "Prop down" (less than at the last look: every time), joined
// by & (all), alternatives by ; each maybe "?Class:" first (only on that class)
var() string Watch;
var() bool   bWatchProp;
var string WatchBase;
var ScriptedPawn PendingPawn; // a character killed or knocked out: which of the two is known a tick later (PlayDying)
var bool  bPawnPending;

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
	RememberOrders();
}

// The characters an action sends back to their own orders: what the map gave them, kept before any rule changes it
// (one UCOrdersMemory each, saved with the game)
function RememberOrders()
{
	local int i;
	local ScriptedPawn sp;

	for (i = 0; i < ArrayCount(Act); i++)
		if (Field(Act[i], 1) == "ownorders")
		{
			sp = ScriptedPawn(ActorCalled(Field(Act[i], 2)));
			if (sp != None)
				class'UCOrdersMemory'.static.Keep(sp);
		}
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
		|| When == 'bodydone'                           // a character's body animation: its UCAnimSet tells UCL_<name>_Body
		|| When == 'output'                             // a script's output (UCScript.Output) sets the link off
		|| When == 'tagfires' || When == 'becomes' || When == 'changes' || bWatchProp)   // its own Tag, or watched
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
	if (When == 'hacked')                              // a hackable device untriggers its UnTriggerEvent list
	{
		if (HackableDevices(A) != None)
			HookUnTrigger(HackableDevices(A));
		else
			Report("hook", Source $ "|target");
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
// (Keypad.RunUntriggers), and any hackable device when it is hacked (HackableDevices.HackAction): this link takes a
// free slot of that list.
function HookUnTrigger(HackableDevices K)
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
		|| When == 'arrived' || When == 'hacked' || When == 'becomes' || When == 'changes' || bWatchProp)
		return;
	if (When == 'killed' || When == 'knockedout')
	{
		// its event comes before PlayDying says whether it was knocked out (Pawn.Died): told apart on the next tick
		PendingPawn = ScriptedPawn(ActorCalled(Source));
		if (PendingPawn == None)
			PendingPawn = ScriptedPawn(Other);
		bPawnPending = True;
		PendingBy = Who(Other, EventInstigator);
		Enable('Tick');
		return;
	}
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
	if (bPawnPending)
		PawnTold();
}

// a character's death event, a tick later: killed, or knocked out (bStunned; gone already: killed)
function PawnTold()
{
	local bool bOut;

	bPawnPending = False;
	bOut = PendingPawn != None && !PendingPawn.bDeleteMe && PendingPawn.bStunned;
	PendingPawn = None;
	if ((When == 'knockedout') == bOut)
		RunRule(PendingBy);
	else
		Report("skip", "how|" $ When);
}

function UnTrigger(Actor Other, Pawn EventInstigator)
{
	local Actor A;

	if (PassEvent != '')
		foreach AllActors(class'Actor', A, PassEvent)
			A.UnTrigger(Other, EventInstigator);
	if (When == 'closed' || When == 'leave' || (When == 'code' && bViaUnTrigger && Keypad(Other) != None)
		|| (When == 'hacked' && bViaUnTrigger))
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

	if (bWatchProp || When == 'becomes' || When == 'changes')
	{
		TickWatch();
		return;
	}
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

// The watched outputs of P4 (Watch): a condition that becomes true, a state or a counter that changes, a property that
// comes to pass its tests (on Source, or the player when the rule has none). Each runs when it becomes true; a "down"
// test every time the value goes down. The first look only takes how things are.
function TickWatch()
{
	local Actor A;
	local bool bNow;
	local string v;

	if (When == 'changes')
	{
		v = WatchValue();
		if (!bPolled)
		{
			bPolled = True;
			WatchBase = v;
			return;
		}
		if (v != WatchBase)
		{
			WatchBase = v;
			RunRule();
		}
		return;
	}
	if (When == 'becomes')
		bNow = Holds(Watch);
	else
	{
		if (Source == "")
			A = Plr();
		else
			A = ActorCalled(Source);
		bNow = A != None && TestsHold(A, Watch);
	}
	if (!bPolled)
	{
		bPolled = True;
		bWas = bNow;
		if (When != 'becomes' && Source != "" && A == None)
			Report("hook", Source $ "|missing");
		return;
	}
	if (bNow && (!bWas || InStr(Watch, " down") >= 0))
		RunRule(A);
	bWas = bNow;
}

// a state's or a counter's value now (Watch "flag|Name", "count|Name")
function string WatchValue()
{
	if (Field(Watch, 0) == "count")
		return string(GetI(StringToName(Field(Watch, 1))));
	if (GetF(StringToName(Field(Watch, 1))))
		return "1";
	return "0";
}

// tests "a&b;c&d": one alternative all of whose tests hold; "?Class:..." only on that class
function bool TestsHold(Actor A, string tests)
{
	local string alt, t;
	local int i, j;
	local bool bAll;

	while (tests != "")
	{
		i = InStr(tests, ";");
		if (i < 0)
		{
			alt = tests;
			tests = "";
		}
		else
		{
			alt = Left(tests, i);
			tests = Mid(tests, i + 1);
		}
		if (Left(alt, 1) == "?")
		{
			j = InStr(alt, ":");
			if (j < 0 || !A.IsA(StringToName(Mid(alt, 1, j - 1))))
				continue;
			alt = Mid(alt, j + 1);
		}
		bAll = alt != "";
		while (alt != "" && bAll)
		{
			j = InStr(alt, "&");
			if (j < 0)
			{
				t = alt;
				alt = "";
			}
			else
			{
				t = Left(alt, j);
				alt = Mid(alt, j + 1);
			}
			bAll = TestHolds(A, t);
		}
		if (bAll)
			return True;
	}
	return False;
}

function bool TestHolds(Actor A, string t)
{
	local int i;
	local string v;
	local bool bDown;

	i = InStr(t, " down");
	if (i >= 0)
	{
		v = A.GetPropertyText(Left(t, i));
		if (WatchBase == "")
		{
			WatchBase = v;
			return False;
		}
		bDown = float(v) < float(WatchBase);
		WatchBase = v;
		return bDown;
	}
	i = InStr(t, "<%");
	if (i >= 0)
	{
		v = A.GetPropertyText(Left(t, i));
		if (WatchBase == "")
			WatchBase = v;
		return float(v) < float(WatchBase) * float(Mid(t, i + 2)) / 100.0;
	}
	i = InStr(t, "!=");
	if (i >= 0)
		return !(A.GetPropertyText(Left(t, i)) ~= Mid(t, i + 2));
	i = InStr(t, "<");
	if (i >= 0)
		return float(A.GetPropertyText(Left(t, i))) < float(Mid(t, i + 1));
	i = InStr(t, ">");
	if (i >= 0)
		return float(A.GetPropertyText(Left(t, i))) > float(Mid(t, i + 1));
	i = InStr(t, "=");
	if (i >= 0)
		return A.GetPropertyText(Left(t, i)) ~= Mid(t, i + 1);
	return False;
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
	else if (verb == "sit")
	{
		if (!NpcSit(n, StringToName(a))) Report("fail", "sit|" $ target $ "|seat unavailable or unsupported character");
	}
	else if (verb == "standup")
	{
		if (!NpcStandUp(n)) Report("fail", "standup|" $ target $ "|cannot");
	}
	else if (verb == "wander")
		NpcOrders(n, 'Wandering');
	else if (verb == "follow")
		NpcOrders(n, 'Following');
	else if (verb == "body" || verb == "bodystop")
		Body(ScriptedPawn(T), verb == "bodystop", a, b, c);
	else if (verb == "fpmoment")                        // JC's weapon plays a first-person moment (UCViewMoment)
		FPMoment(a);
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
	else if (!DoMore(s, verb, T, a, b, c, P))           // the verbs of P4
		Report("fail", verb $ "|" $ target $ "|cannot");
}

// The verbs of P4 (editor/LOGIC.md): the player's resources, the view, lights, characters, the world. False: not one
// of them, or not on this target.
function bool DoMore(string s, string verb, Actor T, string a, string b, string c, DeusExPlayer P)
{
	local int n;
	local vector spot;

	n = int(a);
	spot = vect(1,0,0) * float(Field(s, 6)) + vect(0,1,0) * float(Field(s, 7)) + vect(0,0,1) * float(Field(s, 8));
	// the player's resources: skill points, credits, health (b "set": to that), an item given or taken
	if (verb == "skillpoints" && P != None)
	{
		if (n > 0)
			P.SkillPointsAdd(n);
		else
			P.SkillPointsAvail = Max(0, P.SkillPointsAvail + n);
	}
	else if (verb == "credits" && P != None)
	{
		P.Credits = Max(0, P.Credits + n);
		if (n > 0)
			P.ClientMessage(n @ "credits received");
		else if (n < 0)
			P.ClientMessage(-n @ "credits taken");
	}
	else if (verb == "health" && P != None)
		Health(P, n);
	else if (verb == "giveitem" && P != None)
		GiveItem(P, a, Clamp(int(b), 1, 20));
	else if (verb == "takeitem" && P != None)
		TakeItem(P, a, int(b));
	// the view: shake (a seconds, b strength), fade (a out / in, b seconds), flash (a colour, b strength)
	else if (verb == "shake" && P != None)
		P.ShakeView(FMax(0.1, float(a)), 512.0 + 1024.0 * FMax(0.1, float(b)), 8.0 + 16.0 * FMax(0.1, float(b)));
	else if (verb == "fade" && P != None)
		class'UCViewFade'.static.Start(P, a != "in", FMax(0, float(b)));
	else if (verb == "flash" && P != None)
		P.ClientFlash(0, ColourOf(a) * 1000.0 * FClamp(float(b), 0.1, 2.0));
	// lights: flicker (a seconds, 0: until turned on or off), colour (a hue, b saturation), brightness (a)
	else if ((verb == "flicker" || verb == "lightcolour" || verb == "lightbright") && Light(T) != None)
		class'UCLightFX'.static.Change(Light(T), verb, a, b);
	// characters: patrol from a point (a), back to their own orders, moved there at once
	else if (verb == "patrol" && ScriptedPawn(T) != None)
		return Patrol(ScriptedPawn(T), a);
	else if (verb == "ownorders" && ScriptedPawn(T) != None)
		return class'UCOrdersMemory'.static.GiveBack(ScriptedPawn(T));
	else if (verb == "teleport" || verb == "moveplayer")   // moveplayer: no object, the player
		return Teleport(T, P, vect(1,0,0) * float(a) + vect(0,1,0) * float(b) + vect(0,0,1) * float(c));
	else if (verb == "spawn")                          // a class, b how many, c the tag they get; where: 6-8
		return class'UCSpawner'.static.Queue(Self, a, Clamp(int(b), 1, 12), c, spot, Field(s, 9) == "attack", Rule);
	// the world: music, a damaging area, a save, the end, a crate's contents, the next floor, an animation in turn
	else if (verb == "music" && P != None)
		return Music(P, a, int(b));
	else if (verb == "hurtzone")                       // a damage a second, b radius, c seconds, 9 how; where: 6-8 or T
	{
		if (T != None)
			spot = T.Location;
		class'UCHurtZone'.static.Start(Self, spot, float(a), float(b), float(c), Field(s, 9));
	}
	else if (verb == "autosave" && P != None)
		return AutoSave(P, a);
	else if (verb == "endgame" && P != None)
	{
		if (a == "death")
			P.TakeDamage(10000, None, P.Location, vect(0,0,0), 'Exploded');
		else
			P.ShowCredits(True);
	}
	else if (verb == "fillcrate" && Decoration(T) != None)
		return FillCrate(Decoration(T), a, Clamp(int(b), 1, 3));
	else if (verb == "nextfloor")
		return NextFloor(T, a == "down");
	else if (verb == "animturn")
		AnimTurn(Field(s, 2), DeusExMover(T));
	else if (verb == "cancel")                          // another rule stops what it is doing
		return CancelRule(a);
	else
		return False;
	return True;
}

// the player healed (n > 0) or hurt (n < 0): n added to every part of the body (up to its most) or taken from it, so
// the health the game shows (DeusExPlayer.GenerateTotalHealth) goes up or down by n. HealPlayer would share n among
// the parts (+25 for 100), a shot hits the chest (dead from 80 with 40). No part goes below 1 (a chest or head at 0
// is death, also when the rest is well): the player dies, the game's way, only when the health would get to nothing
function Health(DeusExPlayer P, int n)
{
	if (n > 0)
	{
		P.HealthHead = Min(P.default.HealthHead, P.HealthHead + n);
		P.HealthTorso = Min(P.default.HealthTorso, P.HealthTorso + n);
		P.HealthArmLeft = Min(P.default.HealthArmLeft, P.HealthArmLeft + n);
		P.HealthArmRight = Min(P.default.HealthArmRight, P.HealthArmRight + n);
		P.HealthLegLeft = Min(P.default.HealthLegLeft, P.HealthLegLeft + n);
		P.HealthLegRight = Min(P.default.HealthLegRight, P.HealthLegRight + n);
		P.GenerateTotalHealth();
	}
	else if (n < 0)
	{
		P.ClientFlash(0.5, vect(500.0, 0.0, 0.0));
		if (P.Health + n <= 0)
		{
			P.TakeDamage(1000, None, P.Location, vect(0,0,0), 'Shot');
			return;
		}
		P.HealthHead = Max(1, P.HealthHead + n);
		P.HealthTorso = Max(1, P.HealthTorso + n);
		P.HealthArmLeft = Max(1, P.HealthArmLeft + n);
		P.HealthArmRight = Max(1, P.HealthArmRight + n);
		P.HealthLegLeft = Max(1, P.HealthLegLeft + n);
		P.HealthLegRight = Max(1, P.HealthLegRight + n);
		P.GenerateTotalHealth();
	}
}

// the item called cls given to the player, k of them, as if picked up (DeusExPlayer.HandleItemPickup); with no room
// it lies at his feet, as an item he cannot take does
function GiveItem(DeusExPlayer P, string cls, int k)
{
	local class<Inventory> C;
	local Inventory I;

	C = class<Inventory>(DynamicLoadObject(cls, class'Class', True));
	if (C == None)
	{
		Report("fail", "giveitem|" $ cls $ "|missing");
		return;
	}
	while (k > 0)
	{
		I = Spawn(C, None,, P.Location);
		if (I == None)
			break;
		P.FrobTarget = I;
		P.HandleItemPickup(I);
		k--;
	}
}

// k of the player's items of class cls taken away (0: all of them); one in his hand is put away first
function TakeItem(DeusExPlayer P, string cls, int k)
{
	local class<Inventory> C;
	local Inventory I;
	local Pickup U;
	local bool bAll;

	C = class<Inventory>(DynamicLoadObject(cls, class'Class', True));
	if (C == None)
		return;
	bAll = k <= 0;
	I = P.FindInventoryType(C);
	while (I != None && (bAll || k > 0))
	{
		U = Pickup(I);
		if (U != None && U.NumCopies > 1 && !bAll)
		{
			U.NumCopies--;
			k--;
			continue;
		}
		if (P.inHand == I)
			P.PutInHand(None);
		if (P.Weapon == I)
			P.Weapon = None;
		P.DeleteInventory(I);
		I.Destroy();
		k--;
		I = P.FindInventoryType(C);
	}
}

// a colour by its word, as a vector of 0..1 (a flash: white when it names none)
function vector ColourOf(string w)
{
	if (w ~= "red") return vect(1, 0.1, 0.1);
	if (w ~= "green") return vect(0.1, 1, 0.1);
	if (w ~= "blue") return vect(0.1, 0.3, 1);
	if (w ~= "yellow") return vect(1, 0.9, 0.2);
	if (w ~= "orange") return vect(1, 0.5, 0.1);
	return vect(1, 1, 1);
}

// patrol from the patrol point called p: its Tag is the route's (ScriptedPawn.PickStartPoint)
function bool Patrol(ScriptedPawn sp, string p)
{
	local PatrolPoint PP;

	PP = PatrolPoint(ActorCalled(p));
	if (PP == None || PP.Tag == '' || sp.Health <= 0)
		return False;
	class'UCSeatOrder'.static.Cancel(sp);
	sp.SetOrders('Patrolling', PP.Tag, True);         // a walk it was on is forgotten (TickGoes: other orders)
	return True;
}

// T (the player when none) put at a place at once
function bool Teleport(Actor T, DeusExPlayer P, vector spot)
{
	if (T == None)
		T = P;
	if (T == None)
		return False;
	if (!T.SetLocation(spot))                        // a walk it was on goes on from there
	{
		Report("fail", "teleport|" $ NameOf(T) $ "|blocked");
		return True;
	}
	T.Velocity = vect(0,0,0);
	if (Pawn(T) != None && Pawn(T).Physics != PHYS_Walking && Pawn(T).Physics != PHYS_Flying && Pawn(T).Physics != PHYS_Swimming)
		Pawn(T).SetPhysics(PHYS_Falling);
	return True;
}

// a song of the game (Package.Song), from its section; none: silence
function bool Music(DeusExPlayer P, string song, int section)
{
	local Music M;

	if (song == "")
	{
		P.ClientSetMusic(None, 0, 255, MTRAN_Fade);
		return True;
	}
	M = Music(DynamicLoadObject(song, class'Music', True));
	if (M == None)
	{
		Report("fail", "music|" $ song $ "|missing");
		return True;
	}
	P.ClientSetMusic(M, Clamp(section, 0, 255), 255, MTRAN_Fade);
	return True;
}

// the game saved in its autosave slot (Revision's: -3), not while he cannot save (dead, in a conversation...)
function bool AutoSave(DeusExPlayer P, string desc)
{
	local DeusExLevelInfo info;

	info = P.GetLevelInfo();
	if ((info != None && info.MissionNumber < 0) || P.IsInState('Dying') || P.IsInState('Paralyzed')
		|| P.IsInState('Interpolating') || P.dataLinkPlay != None || P.conPlay != None)
	{
		Report("fail", "autosave||cannot");
		return True;
	}
	if (desc == "")
		desc = "Autosave";
	P.SaveGame(-3, desc);
	return True;
}

// a crate's contents chosen now: n of the items "Package.Class:weight;..." picked by their weights
function bool FillCrate(Decoration D, string items, int n)
{
	local string list, one, cls;
	local float total, pick, w;
	local int i, k;
	local class<Inventory> C;

	for (k = 0; k < n; k++)
	{
		total = 0;
		list = items;
		while (list != "")
		{
			NextItem(list, one);
			total += WeightOf(one);
		}
		if (total <= 0)
			return False;
		pick = FRand() * total;
		list = items;
		cls = "";
		while (list != "" && cls == "")
		{
			NextItem(list, one);
			w = WeightOf(one);
			if (pick < w)
				cls = NameOfItem(one);
			pick -= w;
		}
		if (cls == "")
			cls = NameOfItem(one);
		C = class<Inventory>(DynamicLoadObject(cls, class'Class', True));
		if (k == 0)
			D.Contents = C;
		else if (k == 1)
			D.Content2 = C;
		else
			D.Content3 = C;
		Report("act", "fillcrate|" $ D.Name $ "|" $ cls);
	}
	return True;
}

function NextItem(out string list, out string one)
{
	local int i;

	i = InStr(list, ";");
	if (i < 0)
	{
		one = list;
		list = "";
	}
	else
	{
		one = Left(list, i);
		list = Mid(list, i + 1);
	}
}

function float WeightOf(string one)
{
	local int i;

	i = InStr(one, ":");
	if (i < 0)
		return 1;
	return FMax(0, float(Mid(one, i + 1)));
}

function string NameOfItem(string one)
{
	local int i;

	i = InStr(one, ":");
	if (i < 0)
		return one;
	return Left(one, i);
}

// an elevator to the floor after the one it is at (before: down), round to the first after the last
function bool NextFloor(Actor T, bool bDown)
{
	local int n, most, i;

	if (ElevatorMover(T) != None)
	{
		most = ElevatorMover(T).NumKeys;
		n = ElevatorMover(T).KeyNum;
	}
	else if (MultiMover(T) != None)
	{
		for (i = 0; i < 4; i++)
			if (MultiMover(T).SeqKeys(i, 0) >= 0)
				most = i + 1;
		n = MultiMover(T).CurrentSeq;
	}
	else
		return False;
	if (most <= 0)
		return False;
	if (bDown)
		n = (n + most - 1) % most;
	else
		n = (n + 1) % most;
	Floor(T, n);
	return True;
}

// an animated object forwards, or backwards when it last went forwards; a door with no animation opens or shuts
function AnimTurn(string target, DeusExMover M)
{
	local UCMotion Mo;
	local bool bAny;

	foreach AllActors(class'UCMotion', Mo)
		if (Mo.Target ~= target)
		{
			bAny = True;
			Mo.Play(Mo.Dir > 0);
		}
	if (!bAny && M != None)
	{
		if (M.KeyNum == 0 && !M.bOpening)
			DoorOpen(M);
		else
			DoorShut(M);
	}
}

// the rule with id r stops what it is doing (its delays, its waits); not this one while it runs (its own steps go on)
function bool CancelRule(string r)
{
	local UCLink L;
	local bool bAny;

	foreach AllActors(class'UCLink', L)
		if (L.Rule ~= r && L != Self && UCRuleAlso(L) == None)
		{
			bAny = True;
			L.StopRuns();
		}
	return bAny;
}

// what it is doing stops (CancelRule)
function StopRuns()
{
	if (IsInState('Running'))
	{
		Report("skip", "cancelled|");
		GotoState('');
	}
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
	class'UCSeatOrder'.static.Cancel(ScriptedPawn(ActorCalled(who)));

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

// A character's body animation ("Play a body animation", "Stop its body animation"): its UCAnimSet plays it (a new
// one when it has none of its own), and tells UCL_<character>_Body at its end. a: the animation, b: seconds (looped
// for that long), c: how (UCAnimSet.PlayBody).
function Body(ScriptedPawn SP, bool bStop, string anim, string secs, string opts)
{
	local UCAnimSet AS, Mine;

	if (SP == None)
		return;
	// A seated gesture does not cancel the chair order or release its seat.
	foreach AllActors(class'UCAnimSet', AS)
		if (AS.AppearanceMesh == None && (AS.Who == SP || string(AS.PawnName) ~= string(SP.Name)))
			Mine = AS;
	if (bStop)
	{
		if (Mine != None)
			Mine.StopBody();
		return;
	}
	if (Mine == None)
	{
		Mine = Spawn(class'UCAnimSet',,, SP.Location);
		if (Mine == None)
			return;
		Mine.Who = SP;
		Mine.Home = SP.Rotation;
		Mine.bReady = True;
	}
	if (Mine.Who == None)                  // its own, not started yet (a fraction of a second after the map starts)
	{
		Mine.Who = SP;
		Mine.Home = SP.Rotation;
		Mine.bReady = True;
	}
	Mine.PlayBody(StringToName(anim), float(secs), opts, "UCL_" $ SP.Name $ "_Body");
}

// JC's weapon plays the first-person moment called a (UCViewMoment, made in the editor's First-person moments)
function FPMoment(string moment)
{
	local UCViewMoment M;

	foreach AllActors(class'UCViewMoment', M)
		if (M.MomentName ~= moment)
		{
			M.Play();
			return;
		}
	Report("fail", "fpmoment|" $ moment $ "|missing");
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
	local UCLightFX FX;
	if (T == None) return;
	foreach AllActors(class'UCLightFX', FX)          // a flicker ends: its own type and period again first
		if (FX.L == T)
		{
			T.LightType = FX.OldType;
			T.LightPeriod = FX.OldPeriod;
			FX.Destroy();
		}
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

// ---------------------------------------------------------------- a list of steps (bSteps)
// a step of the list: a check goes on or jumps, a jump jumps, a wait has only its delay, any other step is an
// action -> the step to go on with
function int DoStep(int i)
{
	local string s, verb;

	s = Act[i];
	verb = Field(s, 1);
	if (verb == "check")
		return CheckStep(s, i);
	if (verb == "jump")
	{
		if (Field(s, 4) == "stop" || Field(s, 4) == "")
			return ArrayCount(Act);       // past the end: the list is over
		return int(Field(s, 4));
	}
	if (verb != "wait")
		DoAct(s);
	return i + 1;
}

// "delay|check|all or any|first|count|fail": the conditions hold -> the next step; else the step fail names (the
// end of the list for "stop"). The logic log says which way, and the first condition that did not hold.
function int CheckStep(string s, int i)
{
	local int k, n, j;
	local bool bAny, bOk, bHere;
	local string failed;

	bAny = Field(s, 2) == "any";
	k = int(Field(s, 3));
	n = int(Field(s, 4));
	bOk = !bAny || n <= 0;
	for (j = k; j < k + n && j < ArrayCount(StepCond); j++)
	{
		bHere = StepCond[j] == "" || Holds(StepCond[j]);
		if (bHere && bAny)
			bOk = True;
		if (!bHere && failed == "")
			failed = StepCond[j];
		if (!bHere && !bAny)
			bOk = False;
	}
	if (bOk)
	{
		Report("check", "pass|" $ i);
		return i + 1;
	}
	Report("check", "fail|" $ i $ "|" $ failed);
	if (Field(s, 5) == "" || Field(s, 5) == "stop")
		return ArrayCount(Act);
	return int(Field(s, 5));
}

// "delay|until|who|arrived or cond|most|k": what the step waits for is so, or its time is up (a skipped cutscene's
// hurry ends it too)
function bool UntilDone(string s)
{
	local float most;
	local bool bDone;

	most = float(Field(s, 4));
	if (bHurry)
		bDone = True;
	else if (Field(s, 3) == "arrived")
		bDone = Arrived(ScriptedPawn(ActorCalled(Field(s, 2))));
	else
		bDone = StepCond[int(Field(s, 5))] == "" || Holds(StepCond[int(Field(s, 5))]);
	if (bDone)
	{
		Report("until", "done|" $ Step $ "|" $ Field(s, 2));
		return True;
	}
	if (most > 0 && Level.TimeSeconds - UntilStart >= most)
	{
		Report("until", "timeout|" $ Step $ "|" $ Field(s, 2));
		return True;
	}
	return False;
}

state Running
{
Begin:
	Step = 0;
	Waited = 0;
	Runs = 0;
	bHurry = False;
Next:
	if (Step < 0 || Step >= ArrayCount(Act) || Act[Step] == "")
	{
		GotoState('');
		Stop;
	}
	Delay = float(Field(Act[Step], 0));
	if (bSteps)
	{
		Runs++;
		if (Runs > 256)
		{
			Report("fail", "steps||loop");
			GotoState('');
			Stop;
		}
		if (!bHurry && Delay > 0)
			Sleep(Delay);
		if (Field(Act[Step], 1) == "until")
		{
			UntilStart = Level.TimeSeconds;
			Goto('Until');
		}
		Step = DoStep(Step);
		Goto('Next');
	}
	if (!bHurry && Delay > Waited)
	{
		Sleep(Delay - Waited);
		Waited = Delay;
	}
	DoAct(Act[Step]);
	Step++;
	Goto('Next');
Until:
	if (!UntilDone(Act[Step]))
	{
		Sleep(0.25);
		Goto('Until');
	}
	Step++;
	Goto('Next');
}

defaultproperties
{
     bRouteOnly=False
     NearDist=256.000000
}
