//=============================================================================
// UCLogicHub - DeusEdix: the map's one place for the logic of the whole map (editor/LOGIC.md, P5). The editor's
// Rebuild writes it into a map that has something for it (UCLogicHub0), with what it was given in the Logic window:
//   Start(i)  the start values of states and counters, "name|b|1" a state (1 Yes, 0 No), "name|i|5" a counter. On
//             the map's first visit, as soon as the player is there (before the rules' first look, half a second
//             in), each one not set yet is set; one set already (by an earlier map) keeps its value. A Play
//             scenario's states come later (the runner's play step) and win over them.
//             It says so in the logic log:  start|map|name|value|set  or  start|map|name|value|kept
//   Watch(i)  the states and counters pinned in the window's list ("watched while playing"): every 0.25 s the hub
//             reads them and writes each change to the logic log, whoever made it (a rule, the Story, the map's own
//             scripts):  state|map|name|old|new   ("" not set, "true" / "false" a state, a number a counter)
//             The first line of each, once the player is in the map, has an empty old value: where it starts.
// A timer and one tick, no latent code (a saved game goes on from where it was; the start values are not set again
// on a later visit: bStarted is saved with the map).
//=============================================================================
class UCLogicHub extends Info;

var() string Start[32];           // the start values: "name|b|1", "name|i|5"
var() string Watch[32];           // the names of the flags to watch
var string Last[32];              // what each was at the last look
var byte Seen[32];                // 1: looked at once (its first line written); no bool arrays in UnrealScript
var bool bStarted;                // the start values applied (the map's first visit)
var string mapTitle;

function PostBeginPlay()
{
	local UCLogicHub other;

	Super.PostBeginPlay();
	foreach AllActors(class'UCLogicHub', other)
		if (other != self && !other.bDeleteMe)
		{
			Destroy();            // one per map
			return;
		}
	SetTimer(0.25, True);
}

// a saved game: the timer goes on by itself (it is saved with the actor)

function string MapName()
{
	local DeusExLevelInfo info;

	if (mapTitle == "")
		foreach AllActors(class'DeusExLevelInfo', info)
			mapTitle = info.mapName;
	return mapTitle;
}

// what flag n holds now, as the log writes it: a counter's number, a state's "true" / "false", "" when not set
// (a name that is both: the counter, as DeusExPlayer's own GetFlag-like code looks at the integer first)
function string ValueOf(FlagBase F, name n)
{
	if (F.CheckFlag(n, FLAG_Int))
		return string(F.GetInt(n));
	if (F.CheckFlag(n, FLAG_Bool))
	{
		if (F.GetBool(n))
			return "true";
		return "false";
	}
	return "";
}

// the first tick the player is there: the start values, once (then the tick sleeps)
event Tick(float DeltaTime)
{
	local DeusExPlayer P;

	if (bStarted)
	{
		Disable('Tick');
		return;
	}
	P = DeusExPlayer(GetPlayerPawn());
	if (P == None || P.FlagBase == None || P.rootWindow == None)
		return;
	bStarted = True;
	Disable('Tick');
	ApplyStarts(P);
}

// each start value "name|kind|value": set when the flag of that kind is not set yet, else kept
function ApplyStarts(DeusExPlayer P)
{
	local int i, j;
	local string s, nm, kind, v, how;
	local name n;

	for (i = 0; i < ArrayCount(Start); i++)
	{
		s = Start[i];
		j = InStr(s, "|");
		if (j <= 0)
			continue;
		nm = Left(s, j);
		s = Mid(s, j + 1);
		j = InStr(s, "|");
		if (j < 0)
			continue;
		kind = Left(s, j);
		v = Mid(s, j + 1);
		n = P.rootWindow.StringToName(nm);
		how = "kept";
		if (kind == "i")
		{
			if (!P.FlagBase.CheckFlag(n, FLAG_Int))
			{
				P.FlagBase.SetInt(n, int(v),, 99);
				how = "set";
			}
		}
		else if (!P.FlagBase.CheckFlag(n, FLAG_Bool))
		{
			P.FlagBase.SetBool(n, v == "1",, 99);
			how = "set";
		}
		class'UCEditorStory'.static.LogicLine("start|" $ MapName() $ "|" $ nm $ "|" $ ValueOf(P.FlagBase, n) $ "|" $ how);
	}
}

function Timer()
{
	local DeusExPlayer P;
	local int i;
	local string now;
	local name n;

	P = DeusExPlayer(GetPlayerPawn());
	if (P == None || P.FlagBase == None || P.rootWindow == None)
		return;
	for (i = 0; i < ArrayCount(Watch); i++)
	{
		if (Watch[i] == "")
			continue;
		n = P.rootWindow.StringToName(Watch[i]);
		now = ValueOf(P.FlagBase, n);
		if (Seen[i] == 1 && now == Last[i])
			continue;
		if (Seen[i] == 1)
			class'UCEditorStory'.static.LogicLine("state|" $ MapName() $ "|" $ Watch[i] $ "|" $ Last[i] $ "|" $ now);
		else
			class'UCEditorStory'.static.LogicLine("state|" $ MapName() $ "|" $ Watch[i] $ "||" $ now);
		Seen[i] = 1;
		Last[i] = now;
	}
}

defaultproperties
{
}
