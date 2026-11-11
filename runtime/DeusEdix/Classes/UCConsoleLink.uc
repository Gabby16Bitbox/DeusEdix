//=============================================================================
// UCConsoleLink - the map editor's Console while the game runs (Play). A few times a second it execs
// System\UCConsole.txt, where the editor writes "set UCConsoleLink Cmd <command>" and
// "set UCConsoleLink Seq <n>": a new command runs as if typed in the game's own console, and the
// answer is saved with Done=<n> into this class's section of the user ini, where the editor reads it.
// A window of the HUD, not an actor: windows go on ticking while the game is paused, and the game
// pauses itself when the editor has the focus (someone typing in the Console).
// UCMutator starts it (Ensure) only when that section says bActive=True: the editor's Play.
//=============================================================================
class UCConsoleLink extends Window
	config(User)
	transient;

var config bool bActive;
var config int Seq;
var config int Done;
var config string Cmd;
var config string Result;
var float pollT;
var bool bWasPaused;             // a rule's break paused the game (P7, UCLink.LivePause): "resumed" when it goes on
var string HeldAt;               // where: "<rule>|fire|" or "<rule>|act|<step>" (UCLink.LivePause sets the default)
var string Cheats;              // the commands the game runs only with its cheats on (the player classes' exec
                                // functions that test bCheatsEnabled, both games), as |name| (lower case)

// the link in the player's HUD, once (the root window outlives map changes, the check is cheap)
static function Ensure(Actor A)
{
	local DeusExPlayer P;
	local DeusExRootWindow root;
	local Window w;

	if (!default.bActive || A == None)
		return;
	P = DeusExPlayer(A.GetPlayerPawn());
	if (P == None)
		return;
	root = DeusExRootWindow(P.rootWindow);
	if (root == None)
		return;
	for (w = root.GetTopChild(); w != None; w = w.GetLowerSibling())
		if (UCConsoleLink(w) != None)
			return;
	root.NewChild(class'UCConsoleLink');
	Log("DeusEdix console: listening");
}

event InitWindow()
{
	Super.InitWindow();
	SetSensitivity(False);
	SetSelectability(False);
	SetSize(0, 0);
	bTickEnabled = True;
}

event Tick(float deltaTime)
{
	local PlayerPawn P;
	local string answer;

	P = GetPlayerPawn();
	if (P != None && P.Level.Pauser == "DeusEdix")
		bWasPaused = True;
	else if (P != None && bWasPaused)
	{
		bWasPaused = False;              // the editor's live control knows the game goes on (logic-live.js)
		default.HeldAt = "";
		class'UCEditorStory'.static.LogicLine("live|" $ MapOf(P) $ "||resumed|");
	}
	pollT += deltaTime;
	if (pollT < 0.25)
		return;
	pollT = 0;
	if (P == None)
		return;
	P.ConsoleCommand("exec UCConsole.txt");
	if (Seq == Done)
		return;
	Done = Seq;
	if (Cmd ~= "deusedix paused")      // asked every second while a rule may pause the game: not in the Console
	{
		Result = Live(DeusExPlayer(P), "paused");
		SaveConfig();
		return;
	}
	Log("DeusEdix console >" @ Cmd);
	if (Left(Caps(Cmd), 9) == "DEUSEDIX ")
	{
		Result = Left(Live(DeusExPlayer(P), Mid(Cmd, 9)), 1000);
		Log("DeusEdix console <" @ Result);
		SaveConfig();
		return;
	}
	if (!P.bCheatsEnabled && IsCheat(Cmd))
	{
		P.bCheatsEnabled = True;    // asked for by typing one: on for this game, and said
		P.ClientMessage("Cheats are on for this game (the Console)");
		Log("DeusEdix console < cheats on for this game");
	}
	answer = P.ConsoleCommand(Cmd);
	Result = Left(answer, 1000);
	if (answer != "")
		Log("DeusEdix console <" @ answer);
	SaveConfig();
}

// the first word of the command is one of Cheats
function bool IsCheat(string command)
{
	local int i;

	command = Caps(command);
	while (Left(command, 1) == " ")
		command = Mid(command, 1);
	i = InStr(command, " ");
	if (i >= 0)
		command = Left(command, i);
	return command != "" && InStr(Caps(Cheats), "|" $ command $ "|") >= 0;
}

// ---------------------------------------------------------------- live control of the logic (P7)
// "deusedix <what> ..." from the editor (the Logic window while Play runs), handled here, not by the game's console.
// A rule by its id in the editor (UCLink.Rule); objects, states and blocks by their names.
//   fire <rule>                   as if its cause happened now (its phase, once and conditions still count)
//   happen <object> <output>      every rule on that output of the object ("used", "opened"...), the same way
//   set <state> <value>           a state (yes or no) or a counter (a number)
//   input <block> <input> [args]  an input of a logic block or a script (a Phases block's GoTo_<phase>, Next...)
//   mute|trace|break <rule> [off] for this session only (UCLink.bLiveMute...: never in a saved game)
//   step <rule>                   the game goes on, and pauses after each action of the rule
//   continue                      no rule steps any more; the game goes on
//   clear                         every mute, trace, break and step off
//   paused                        whether the game is paused now (and by whom), and the level's time; paused by a
//                                 rule, where: "The game is paused (DeusEdix, 12.3) at L7|act|1"
// The answer is a sentence for the editor; the logic log gets "live|map|rule|what|detail".
function string Live(DeusExPlayer P, string line)
{
	local string what, a, b, c, m;
	local UCLink L;
	local UCScript S;
	local int n;
	local bool bOn;
	local name f;

	if (P == None || P.FlagBase == None || P.rootWindow == None)
		return "The player is not in a map yet";
	what = LowerText(Word(line, 0));
	a = Word(line, 1);
	b = Word(line, 2);
	c = Rest(line, 3);
	m = MapOf(P);
	bOn = !(b ~= "off");
	switch (what)
	{
	case "fire":
		foreach P.AllActors(class'UCLink', L)
			if (IsRule(L, a))
			{
				L.LiveFire(P);
				return "Set off " $ a;
			}
		return "This map has no rule " $ a;
	case "happen":
		class'UCEditorStory'.static.LogicLine("live|" $ m $ "||happen|" $ a $ " " $ b);
		foreach P.AllActors(class'UCLink', L)
			if (L.Source ~= a && string(L.When) ~= b)
			{
				n++;
				L.RunRule(P);
			}
		return a $ " " $ b $ ": " $ n $ " rules heard it";
	case "set":
		if (a == "" || b == "")
			return "Say which state and its value";
		f = P.rootWindow.StringToName(a);
		if (IsNumber(b))
			P.FlagBase.SetInt(f, int(b),, 99);
		else if (b ~= "yes" || b ~= "true")
			P.FlagBase.SetBool(f, True,, 99);
		else if (b ~= "no" || b ~= "false")
			P.FlagBase.SetBool(f, False,, 99);
		else
			return "A state is yes or no, a counter a number";
		class'UCEditorStory'.static.LogicLine("live|" $ m $ "||set|" $ a $ "=" $ b);
		return a $ " is now " $ b;
	case "input":
		foreach P.AllActors(class'UCScript', S)
			if (string(S.Name) ~= a)
			{
				class'UCEditorStory'.static.LogicLine("live|" $ m $ "||input|" $ a $ " " $ b);
				class'UCEditorStory'.static.LogicLine("input|" $ m $ "|" $ S.Name $ "|" $ b $ "|" $ c);
				S.StartScript();
				S.Input(b, c, P);
				return a $ ": " $ b;
			}
		return "This map has no block or script " $ a;
	case "mute":
	case "trace":
	case "break":
		foreach P.AllActors(class'UCLink', L)
			if (IsRule(L, a))
			{
				n++;
				if (what == "mute")
					L.bLiveMute = bOn;
				else if (what == "trace")
					L.bLiveTrace = bOn;
				else
					L.bLiveBreak = bOn;
				L.Report("live", what $ "|" $ OnOff(bOn));
			}
		if (n == 0)
			return "This map has no rule " $ a;
		return a $ ": " $ what $ " " $ OnOff(bOn);
	case "step":
		foreach P.AllActors(class'UCLink', L)
			if (IsRule(L, a))
			{
				n++;
				L.bLiveStep = True;
				L.Report("live", "step|");
			}
		if (n == 0)
			return "This map has no rule " $ a;
		GoOn(P);
		return a $ ": one action, then a pause";
	case "paused":
		if (P.Level.Pauser == "")
			return "The game runs (" $ P.Level.TimeSeconds $ ")";
		if (P.Level.Pauser == "DeusEdix" && default.HeldAt != "")
			return "The game is paused (" $ P.Level.Pauser $ ", " $ P.Level.TimeSeconds $ ") at " $ default.HeldAt;
		return "The game is paused (" $ P.Level.Pauser $ ", " $ P.Level.TimeSeconds $ ")";
	case "continue":
	case "clear":
		foreach P.AllActors(class'UCLink', L)
		{
			L.bLiveStep = False;
			if (what == "clear")
			{
				L.bLiveMute = False;
				L.bLiveTrace = False;
				L.bLiveBreak = False;
			}
		}
		class'UCEditorStory'.static.LogicLine("live|" $ m $ "||" $ what $ "|");
		GoOn(P);
		if (what == "clear")
			return "No rule is muted, traced or paused on any more";
		return "The game goes on";
	}
	return "Unknown: deusedix " $ what;
}

// the rule with that id (its other causes, UCRuleAlso, are not the rule: they set it off)
function bool IsRule(UCLink L, string id)
{
	if (id == "" || UCRuleAlso(L) != None)
		return False;
	if (L.Rule != "")
		return L.Rule ~= id;
	return string(L.Name) ~= id;
}

// the game goes on, when it is paused (a rule's break: UCLink.LivePause, or the player's Pause key)
function GoOn(DeusExPlayer P)
{
	default.HeldAt = "";
	if (P.Level.Pauser != "")
		P.Level.Pauser = "";
}

function string MapOf(Actor P)
{
	local DeusExLevelInfo info;

	foreach P.AllActors(class'DeusExLevelInfo', info)
		return info.mapName;
	return "";
}

function string OnOff(bool b)
{
	if (b)
		return "on";
	return "off";
}

// (the game has no Locs)
function string LowerText(string t)
{
	local string out;
	local int i, k;

	for (i = 0; i < Len(t); i++)
	{
		k = Asc(Mid(t, i, 1));
		if (k >= 65 && k <= 90)
			k += 32;
		out = out $ Chr(k);
	}
	return out;
}

function bool IsNumber(string t)
{
	return t != "" && string(int(t)) == t;
}

// the word k (0 the first) of s, the words split by spaces
function string Word(string s, int k)
{
	local int i;

	s = Rest(s, k);
	i = InStr(s, " ");
	if (i >= 0)
		return Left(s, i);
	return s;
}

// s from its word k on
function string Rest(string s, int k)
{
	local int i;

	while (Left(s, 1) == " ")
		s = Mid(s, 1);
	while (k > 0)
	{
		i = InStr(s, " ");
		if (i < 0)
			return "";
		s = Mid(s, i + 1);
		while (Left(s, 1) == " ")
			s = Mid(s, 1);
		k--;
	}
	return s;
}

defaultproperties
{
	Cheats="|abomb|allammo|allaugs|allcredits|allenergy|allhealth|allimages|allitems|allskillpoints|allskills|allweapons|amphibious|augadd|behindview|causeevent|cheatview|damageall|damagepart|debugcommand|editflags|fly|getai|getdebug|ghost|givenanokey|givenpc|gocatgo|god|iamwarren|invisible|invokeconwindow|ispeelmydreenk|killall|killpawns|legend|loadmap|moveactor|myvisionisaugmented|opensesame|playersonly|playmusicwindow|removenanokey|ripandtear|setdebug|setjumpz|setspeed|setstate|showacceleration|showarea|showbase|showbindname|showclass|showcylinder|showdata|showdist|showenemy|showenemyresponse|showeyes|showhealth|showinstigator|showlight|showlos|showmass|showmesh|showphysics|showpos|showquoteswindow|showrgbdialog|showstate|showvelocity|showvisibility|showzone|slomo|spawnmass|summon|tantabusall|tantalus|tantalusall|togglewinframes|togglewinstats|trig|type|untrig|viewmodeladd|viewmodelblendplay|viewmodelblendstop|viewmodeldestroy|viewmodelgiveweapon|viewmodelloop|viewmodelplay|walk|whatarottenwaytodie|whatashame|whereactor|whereisyevgeni|winframes|"
}
