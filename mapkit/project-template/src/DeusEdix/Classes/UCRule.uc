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
	local int r, live;
	local bool bOk;
	local string failed;

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
	}
	else
	{
		Report("skip", "cond|" $ failed);
		Report("else", It $ "|" $ W $ "|" $ NameOf(By));
		RStep[r] = ElseAt;
	}
	RLive[r] = 1;
	RDue[r] = -1;
	RCount[r] = 0;
	RHurry[r] = 0;
	RWaiting[r] = 0;
	RBy[r] = NameOf(By);
	RIt[r] = It;
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

	if (PendingDoor != None || bPawnPending)
		Super.Tick(dt);                     // a door or a character told apart (it may start a run)
	for (r = 0; r < ArrayCount(RLive); r++)
		if (RLive[r] != 0)
			Advance(r);
	Cur = -1;
	if (LiveRuns() > 0)
		Enable('Tick');
	else
		Disable('Tick');
}

// after a load the arrays are back; Tick may not be: the half-second look starts it again
function TickStory()
{
	Super.TickStory();
	if (LiveRuns() > 0)
		Enable('Tick');
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

function string TimeText()
{
	local int c;

	c = int(Level.TimeSeconds * 100);
	return string(c / 100) $ "." $ Right("0" $ string(c % 100), 2);
}

defaultproperties
{
     ElseAt=-1
     Cur=-1
}
