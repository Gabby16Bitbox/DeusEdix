//=============================================================================
// UCRule - a rule of the editor that needs the Logic runtime v2 (editor/LOGIC.md "Logic runtime v2"): a UCLink that
// runs its steps with no latent code (a saved game holds only its arrays, so a save made in the middle of a run loads
// with any later version of this class), up to 8 runs at once. links.py makes one only for a rule that needs it;
// every other rule stays a UCLink, as it was.
//
//   bAny       its conditions: any of them holds (else all must)
//   ElseAt     the first step of its Otherwise: run when the conditions do not hold (-1: none, nothing runs)
//   Again      set off while a run goes on: '' ignore it (as UCLink), restart (the run stops, a new one starts),
//              each (a new run beside the others, up to 8)
//   MaxRuns    at most so many runs (0: no limit); Cooldown: so many seconds at least from one start to the next
//   TalkBusy   the player is in a conversation when a step is due: '' go on, wait (until it is over), giveup
//   ActId[i]   the editor's id of each step (the logic log names it)
// Its steps are UCLink's (bSteps: check, jump, until, wait, and the actions); "@by" as an action's object is what set
// the run off, "@it" the object it happened to. Its other causes are UCRuleAlso actors that set it off (Start).
// Its log lines name the rule as "<id>@<game time>" and, for a step, "#<step id>".
//=============================================================================
class UCRule extends UCLink;

var() bool   bAny;
var() int    ElseAt;
var() name   Again;
var() int    MaxRuns;
var() float  Cooldown;
var() name   TalkBusy;
var() string ActId[24];

var int    RStep[8];
var float  RDue[8];          // the game time the delay of its step is over (-1: not started)
var float  RUntil[8];        // when its Wait until began
var string RBy[8];
var int    RCame[8];         // Value for that run: the number its output came with (CameWith)
var string RIt[8];
var int    RCount[8];        // the steps it has run: a list that goes round with no end is stopped
var byte   RLive[8];       // (UnrealScript has no bool arrays: 1 yes)
var byte   RHurry[8];
var byte   RWaiting[8];
var int    Fired;
var float  LastFire;
var float  RateStart;
var int    RateCount;
var int    Cur;              // the run doing a step now (-1: none)
var float  LastTick;         // the level's time at its last Tick while it runs: a longer gap was a pause (Tick)

// P9 "Game rules": a cause heard on anyone of a set of characters (Every), each one its own "@it":
//   Every     "class:MJ12Troop" (that class and its subclasses), "faction:MJ12" (their Alliance), "names:Guard1,Guard2"
//   When      killed, knockedout, dies (looked at every frame: a body tells killed from knocked out too late), hurt
//             (EveryArg: below that % of their health, 0 any wound), sees (the player, as the game's own sight sees
//             him), turnshostile (to the player), findsbody (a body it can see within 1200, once per body: the
//             soldiers of the game never react to bodies by themselves); the others every half second
// The members are the living characters of the set, those that come later too (32 at most: more are said once).
// The first look takes how things are; a character that comes later starts from nothing.
var() string Every;
var() int    EveryArg;
var ScriptedPawn EMember[32];
var byte   EWas[32];         // what held at the last look (1 yes)
var int    EHealth[32];      // its health then
var int    EFull[32];        // its health when it joined
var string EFound;           // "member>body;" the bodies each member found
var bool   bEveryLooked;
var bool   bEveryFull;

// P9 "Game rules", the world: a cause with no object, heard by the rule itself
//   loaded    a saved game is loaded              (UCBoot.WokeAs, at each wake of the map)
//   back      the player comes back to the map    (the same)
//   goaldone  a goal is completed                 WorldArg: its name ("" any goal); the player's goals at each look
//   noise     a noise the player can hear         WorldArg: gunshot, loud (a shot too), alarm, cry; NearDist: within so
//                                                 many units of the player (0 anywhere it reaches). UCGameEars tells it
//   appears   a character or a body appears       WorldArg: character, body. UCSpawnEars tells it
// "@by" and "@it" are who made the noise, the one who appeared; a goal's name is "it" in the log.
var() string WorldArg;
var string GoalsDone;            // ";name;name;" the goals completed at the last look
var bool   bGoalsLooked;
var transient bool bWakeHeard;   // this wake of the map is heard (not saved: a load, a visit is a new one)

// ---------------------------------------------------------------- set off
function RunRule(optional Actor By)
{
	Start(By, Source, When);
}

// It runs, unless it ran already (once, at most MaxRuns), too soon (Cooldown), or still runs and is not to start again;
// its conditions do not hold: its Otherwise runs, or nothing. 20 starts in a second: it stops for that second.
// It and W are the cause that set it off (its own, or one of its UCRuleAlso), as the log says.
function Start(Actor By, string It, name W)
{
	local int r, live, came;
	local bool bOk;
	local string failed;

	came = HeardValue;                      // Value (an output that came with a number): this start's only
	HeardValue = 0;
	if (!LiveHeard(By))                     // live control (P7): traced, muted
		return;
	if (Level.TimeSeconds - RateStart > 1.0)
	{
		RateStart = Level.TimeSeconds;
		RateCount = 0;
	}
	RateCount++;
	if (RateCount > 20)
	{
		if (RateCount == 21)
			Report("fail", "rule||fast");
		return;
	}
	if (!InPhase())
	{
		Report("skip", "phase|" $ PhaseGate);
		return;
	}
	if (bOnce && bDone)
	{
		Report("skip", "once|");
		return;
	}
	if (MaxRuns > 0 && Fired >= MaxRuns)
	{
		Report("skip", "max|" $ MaxRuns);
		return;
	}
	if (Cooldown > 0 && Fired > 0 && Level.TimeSeconds - LastFire < Cooldown)
	{
		Report("skip", "cooldown|" $ Cooldown);
		return;
	}
	live = LiveRuns();
	if (live > 0 && Again != 'restart' && Again != 'each')
	{
		Report("skip", "running|");
		return;
	}
	if (live >= ArrayCount(RLive) && Again == 'each')
	{
		Report("skip", "full|");
		return;
	}
	CameWith = came;
	bOk = CondsHold(failed);
	if (!bOk && ElseAt < 0)
	{
		Report("skip", "cond|" $ failed);
		return;
	}
	if (Again == 'restart' && live > 0)
	{
		Report("skip", "restarted|");
		EndAll();
	}
	r = FreeRun();
	RStep[r] = 0;
	if (bOk)
	{
		bDone = True;
		Fired++;
		LastFire = Level.TimeSeconds;
		Report("fire", It $ "|" $ W $ "|" $ NameOf(By) $ "|" $ Label);
		LiveFired();
	}
	else
	{
		Report("skip", "cond|" $ failed);
		Report("else", It $ "|" $ W $ "|" $ NameOf(By));
		LiveFired();
		RStep[r] = ElseAt;
	}
	RLive[r] = 1;
	RDue[r] = -1;
	RCount[r] = 0;
	RHurry[r] = 0;
	RWaiting[r] = 0;
	RBy[r] = NameOf(By);
	RCame[r] = came;
	RIt[r] = It;
	if (live == 0)
		LastTick = Level.TimeSeconds;
	Enable('Tick');
}

// all of them hold, or (bAny) one does; none at all: it holds. failed: the first that does not.
function bool CondsHold(out string failed)
{
	local int i;
	local bool bSome, bHere;

	for (i = 0; i < ArrayCount(Cond); i++)
		if (Cond[i] != "")
		{
			bSome = True;
			bHere = Holds(Cond[i]);
			if (bHere && bAny)
				return True;
			if (!bHere && failed == "")
				failed = Cond[i];
			if (!bHere && !bAny)
				return False;
		}
	return !bAny || !bSome;
}

function int LiveRuns()
{
	local int r, n;

	for (r = 0; r < ArrayCount(RLive); r++)
		if (RLive[r] != 0)
			n++;
	return n;
}

function int FreeRun()
{
	local int r;

	for (r = 0; r < ArrayCount(RLive); r++)
		if (RLive[r] == 0)
			return r;
	return 0;
}

function EndAll()
{
	local int r;

	for (r = 0; r < ArrayCount(RLive); r++)
		RLive[r] = 0;
}

// another rule's "Stop a rule" (UCLink.CancelRule)
function StopRuns()
{
	if (LiveRuns() > 0)
		Report("skip", "cancelled|");
	EndAll();
}

// a cutscene was skipped: what its runs still had to do happens now
function Hurry()
{
	local int r;

	for (r = 0; r < ArrayCount(RLive); r++)
		if (RLive[r] != 0)
			RHurry[r] = 1;
	if (LiveRuns() > 0)
		Enable('Tick');
}

// ---------------------------------------------------------------- the runs, each tick
event Tick(float dt)
{
	local int r;
	local float gap;

	// The game was paused (its Pause key, the editor having the focus, a rule's break): the level's time went on with no
	// Tick here, so each run's due time moves on by as much, as a UCLink's Sleep waits through a pause (found with the
	// live control's breaks, 10 Nov 2026). (In the original game at a high frame rate a frame's dt is more than the
	// level's time that passed, so a frame alone never looks like a gap.)
	gap = Level.TimeSeconds - LastTick - dt;
	if (LastTick > 0 && gap > 0.1)
		for (r = 0; r < ArrayCount(RLive); r++)
			if (RLive[r] != 0)
			{
				if (RDue[r] >= 0)
					RDue[r] += gap;
				RUntil[r] += gap;
			}
	LastTick = Level.TimeSeconds;
	if (PendingDoor != None || bPawnPending)
		Super.Tick(dt);                     // a door or a character told apart (it may start a run)
	if (EveryEachFrame())
		LookAtFates();
	for (r = 0; r < ArrayCount(RLive); r++)
		if (RLive[r] != 0)
			Advance(r);
	Cur = -1;
	if (LiveRuns() > 0 || EveryEachFrame())
		Enable('Tick');
	else
		Disable('Tick');
}

// after a load the arrays are back; Tick may not be: the half-second look starts it again
function TickStory()
{
	if (Every != "")
		LookAtMembers();
	else if (IsWorld())
		LookAtWorld();
	else
		Super.TickStory();
	if (LiveRuns() > 0 || EveryEachFrame())
		Enable('Tick');
}

// ---------------------------------------------------------------- anyone of a set (P9)
// a rule on a set hooks itself to nothing: it looks
function Hook()
{
	if (Every == "" && !IsWorld())
		Super.Hook();
}

// ---------------------------------------------------------------- the world (P9 slice 3)
function bool IsWorld()
{
	return When == 'loaded' || When == 'back' || When == 'goaldone' || When == 'noise' || When == 'appears';
}

// each half second: the wake of the map once, the goals; the noises and the ones who appear come from the ears
// (made here when the map has none yet: one each, saved with the map)
function LookAtWorld()
{
	local UCBoot B;

	if (When == 'loaded' || When == 'back')
	{
		if (bWakeHeard)
			return;
		foreach AllActors(class'UCBoot', B)
			break;
		if (B == None || B.WokeAs == '')
			return;                     // not told yet: at the next look
		bWakeHeard = True;
		if (B.WokeAs == When)
			RunRule(Plr());
	}
	else if (When == 'goaldone')
		LookAtGoals();
	else if (When == 'noise')
		class'UCGameEars'.static.Ensure(Self);
	else if (When == 'appears')
		class'UCSpawnEars'.static.Ensure(Self);
}

// the goals completed now, ";name;...": each one not completed at the last look sets it off (the first look takes how
// things are). A goal of the name, or any.
function LookAtGoals()
{
	local DeusExPlayer P;
	local DeusExGoal g;
	local string now, rest, n;
	local int k, i;

	P = Plr();
	if (P == None)
		return;
	now = ";";
	for (g = P.FirstGoal; g != None && k < 500; g = g.next)
	{
		k++;
		if (g.bCompleted)
			now = now $ string(g.goalName) $ ";";
	}
	if (bGoalsLooked && now != GoalsDone)
	{
		rest = Mid(now, 1);
		while (rest != "")
		{
			i = InStr(rest, ";");
			n = Left(rest, i);
			rest = Mid(rest, i + 1);
			if (InStr(Caps(GoalsDone), ";" $ Caps(n) $ ";") < 0 && (WorldArg == "" || n ~= WorldArg))
				Start(P, n, When);
		}
	}
	GoalsDone = now;
	bGoalsLooked = True;
}

// a noise the ears heard (UCGameEars.Tell): of its kind ("loud" a shot too), near enough
function HearNoise(string kind, Actor maker, vector at)
{
	local DeusExPlayer P;

	if (When != 'noise')
		return;
	if (WorldArg == "loud")
	{
		if (kind != "loud" && kind != "gunshot")
			return;
	}
	else if (!(WorldArg ~= kind))
		return;
	P = Plr();
	if (NearDist > 0 && P != None && VSize(at - P.Location) > NearDist)
		return;
	Start(maker, NameOf(maker), When);
}

// a character or a body that appeared (UCSpawnEars.Tell)
function HearSpawn(Actor A)
{
	if (When != 'appears' || A == None || A.bDeleteMe)
		return;
	if (WorldArg == "body")
	{
		if (DeusExCarcass(A) == None)
			return;
	}
	else if (ScriptedPawn(A) == None)
		return;
	Start(A, NameOf(A), When);
}

function bool EveryEachFrame()
{
	return Every != "" && (When == 'killed' || When == 'knockedout' || When == 'dies');
}

// whether a character is of the set "class:X", "faction:X", "names:A,B"
function bool InSet(string set, ScriptedPawn sp)
{
	local int i;
	local string kind, v;

	i = InStr(set, ":");
	if (sp == None || i < 0)
		return False;
	kind = Left(set, i);
	v = Mid(set, i + 1);
	if (kind == "class")
		return sp.IsA(StringToName(v));
	if (kind == "faction")
		return string(sp.Alliance) ~= v;
	if (kind == "names")
		return InStr("," $ Caps(v) $ ",", "," $ Caps(string(sp.Name)) $ ",") >= 0;
	return False;
}

function bool Down(ScriptedPawn sp)
{
	return sp == None || sp.bDeleteMe || sp.Health <= 0 || sp.IsInState('Dying');
}

// its slot (a new member takes a free one; -1 when all 32 are taken: said once)
function int MemberSlot(ScriptedPawn sp)
{
	local int i, free;

	free = -1;
	for (i = 0; i < ArrayCount(EMember); i++)
	{
		if (EMember[i] == sp)
			return i;
		if (free < 0 && EMember[i] == None)
			free = i;
	}
	if (free < 0)
	{
		if (!bEveryFull)
			Report("fail", "every|" $ Every $ "|full");
		bEveryFull = True;
		return -1;
	}
	EMember[free] = sp;
	EHealth[free] = sp.Health;
	EFull[free] = Max(1, sp.Health);
	EWas[free] = 0;
	if (!bEveryLooked)                  // the first look takes how things are
		EWas[free] = byte(MemberHolds(sp, free));
	return free;
}

// what the rule's happening is on member i now (sees, turnshostile, hurt)
function bool MemberHolds(ScriptedPawn sp, int i)
{
	local DeusExPlayer P;

	P = Plr();
	if (P == None || Down(sp))
		return False;
	if (When == 'sees')
		return sp.AICanSee(P, sp.ComputeActorVisibility(P), True, True, True, True) > 0;
	if (When == 'turnshostile')
		return sp.GetAllianceType(P.Alliance) == ALLIANCE_Hostile;
	if (When == 'hurt' && EveryArg > 0)
		return sp.Health < EFull[i] * EveryArg / 100;
	if (When == 'hurt')
		return sp.Health < EHealth[i];
	return False;
}

// every half second: the set's members (newcomers too), what holds on each
function LookAtMembers()
{
	local ScriptedPawn sp;
	local int i;
	local bool bNow;

	if (Plr() == None)
		return;
	foreach AllActors(class'ScriptedPawn', sp)
		if (!Down(sp) && InSet(Every, sp))
		{
			i = MemberSlot(sp);
			if (i < 0 || EveryEachFrame())
				continue;
			if (When == 'findsbody')
			{
				FindBodies(sp);
				continue;
			}
			bNow = MemberHolds(sp, i);
			if (bNow && (EWas[i] == 0 || (When == 'hurt' && EveryArg == 0)))
			{
				if (When == 'hurt')
					Start(None, string(sp.Name), When);
				else
					Start(Plr(), string(sp.Name), When);
			}
			EWas[i] = byte(bNow);
			EHealth[i] = sp.Health;
		}
	for (i = 0; i < ArrayCount(EMember); i++)
		if (EMember[i] != None && !EveryEachFrame() && Down(EMember[i]))
			EMember[i] = None;
	bEveryLooked = True;
}

// a body member sp can see within 1200 that it has not found yet: "@by" is the body
function FindBodies(ScriptedPawn sp)
{
	local DeusExCarcass c;
	local string pair;

	foreach RadiusActors(class'DeusExCarcass', c, 1200, sp.Location)
	{
		if (c.bHidden || c.bDeleteMe)
			continue;
		pair = string(sp.Name) $ ">" $ string(c.Name) $ ";";
		if (InStr(EFound, pair) >= 0)
			continue;
		if (sp.AICanSee(c, sp.ComputeActorVisibility(c), True, True, True, True) <= 0)
			continue;
		if (Len(EFound) < 4000)
			EFound = EFound $ pair;
		if (bEveryLooked)
			Start(c, string(sp.Name), When);
	}
}

// every frame: a member going down, killed or knocked out (as UCFateWatch tells them apart)
function LookAtFates()
{
	local int i;
	local ScriptedPawn sp;
	local bool bOut;

	for (i = 0; i < ArrayCount(EMember); i++)
	{
		sp = EMember[i];
		if (sp == None)
			continue;
		if (sp.bDeleteMe)                   // gone with its health: it left the map
		{
			EMember[i] = None;
			continue;
		}
		if (sp.Health > 0 && !sp.IsInState('Dying'))
			continue;
		EMember[i] = None;
		bOut = sp.bStunned && !sp.bBurnedToDeath;
		if (When == 'dies' || (When == 'knockedout') == bOut)
			Start(None, string(sp.Name), When);
		else
			Report("skip", "how|" $ When $ "|" $ string(sp.Name));
	}
}

// an action on anyone of a set (fields 6, 7: "every", the set; 8 the set's name for the log): each living one that
// can do the verb, as a group's members (DoMembers)
function DoEvery(string s)
{
	local ScriptedPawn sp;
	local UCLinkGroup First, Tail;
	local int Slot;

	foreach AllActors(class'ScriptedPawn', sp)
		if (!Down(sp) && InSet(Field(s, 7), sp) && TagKind(sp, Field(s, 1)))
			QueueRecipient(sp, First, Tail, Slot);
	RunRecipients(First, s);
}

// the steps of run r that are due now: each after its delay, a Wait until looked at every quarter second
function Advance(int r)
{
	local string s, verb;
	local float now;

	now = Level.TimeSeconds;
	while (RLive[r] != 0)
	{
		Step = RStep[r];
		if (Step < 0 || Step >= ArrayCount(Act) || Act[Step] == "")
		{
			RLive[r] = 0;
			return;
		}
		if (RCount[r] > 256)
		{
			Cur = r;
			Report("fail", "steps||loop");
			RLive[r] = 0;
			return;
		}
		s = Act[Step];
		verb = Field(s, 1);
		if (RWaiting[r] == 0)
		{
			if (RDue[r] < 0)
				RDue[r] = now + float(Field(s, 0));
			if (RHurry[r] == 0 && now < RDue[r])
				return;
		}
		Cur = r;
		CameWith = RCame[r];
		if (verb == "until")
		{
			if (RWaiting[r] == 0)
			{
				RWaiting[r] = 1;
				RUntil[r] = now;
				RDue[r] = now;
			}
			if (RHurry[r] == 0 && now < RDue[r])
				return;
			UntilStart = RUntil[r];
			bHurry = RHurry[r] != 0;
			if (!UntilDone(s))
			{
				RDue[r] = now + 0.25;
				return;
			}
			RWaiting[r] = 0;
			NextStep(r, Step + 1);
			continue;
		}
		if (TalkBusy != '' && verb != "check" && verb != "jump" && verb != "wait" && Talking())
		{
			if (TalkBusy == 'giveup')
			{
				Report("skip", "talking|");
				RLive[r] = 0;
			}
			return;                         // wait: the same step when the conversation is over
		}
		NextStep(r, DoStep(Step));
	}
}

function NextStep(int r, int n)
{
	RStep[r] = n;
	RDue[r] = -1;
	RCount[r]++;
}

// "@by": what set the run off; "@it": the object it happened to
function DoAct(string s)
{
	local string t;

	if (Field(s, 6) == "every")
	{
		Report("act", Field(s, 1) $ "|every " $ Field(s, 8));     // then one line for each one that can do it
		DoEvery(s);
		return;
	}
	t = Field(s, 2);
	if (Cur >= 0 && t ~= "@by")
		s = WithField(s, 2, RBy[Cur]);
	else if (Cur >= 0 && t ~= "@it")
		s = WithField(s, 2, RIt[Cur]);
	Super.DoAct(s);
}

// s with its field k (0 first) made v
function string WithField(string s, int k, string v)
{
	local string head;
	local int i;

	while (k > 0)
	{
		i = InStr(s, "|");
		if (i < 0)
			return head $ s;
		head = head $ Left(s, i + 1);
		s = Mid(s, i + 1);
		k--;
	}
	i = InStr(s, "|");
	if (i < 0)
		return head $ v;
	return head $ v $ Mid(s, i);
}

// ---------------------------------------------------------------- the logic log: the rule, the game time, the step
function Report(string kind, string rest)
{
	local string r;

	r = Rule;
	if (r == "")
		r = string(Name);
	r = r $ "@" $ TimeText();
	if (Cur >= 0 && Step >= 0 && Step < ArrayCount(ActId) && ActId[Step] != "" && kind != "fire" && kind != "skip")
		r = r $ "#" $ ActId[Step];
	LogicLine(kind $ "|" $ MapName() $ "|" $ r $ "|" $ rest);
}

// the game time to the hundredth (34.27). Integers only: UnrealScript's % is a float operator, and the string of a float
// has six decimals ("27.000000"), which once left every time at .00 (found by the golden-log run, 10 Nov 2026)
function string TimeText()
{
	local int c, s;

	c = int(Level.TimeSeconds * 100);
	s = c / 100;
	c = c - s * 100;
	if (c < 10)
		return string(s) $ ".0" $ string(c);
	return string(s) $ "." $ string(c);
}

defaultproperties
{
     ElseAt=-1
     Cur=-1
}
