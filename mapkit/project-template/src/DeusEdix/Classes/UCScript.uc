//=============================================================================
// UCScript - the base of the scripts written in the map editor (Tools > Scripts). A script is an
// invisible object placed in the map, a block the editor's rules use like a door or a keypad: a rule
// sets it off (Switch on / off), calls one of its inputs, or starts when it says one of its outputs.
// Write only the events you need:
//
//   Started()                         once, when the map is running and JC is in it
//   Triggered(Other, EventInstigator) a rule switches it on (or a trigger, another script)
//   Untriggered(Other, EventInstigator) a rule switches it off
//   Input(InputName, Args, Caller)    a rule calls one of its inputs (switch on InputName)
//   Repeat()                          every RepeatEvery seconds (set it in the Inspector; 0 = never)
//
// Its inputs and outputs are declared in defaultproperties, where the editor reads them:
//   Inputs(0)=(Id="Sabotage",Label="Sabotage it",Args="Seconds")
//   Outputs(0)=(Id="Sabotaged",Label="it is sabotaged")
// Output("Sabotaged") then starts the rules on it. Helpers: Player(), Say("..."), Arg(Args, "Seconds"),
// ArgFloat / ArgInt / ArgBool, Find('Tag'), FindNamed("Name"), TriggerTag('Tag'), GetFlag('Name'),
// SetFlag('Name', True), Give(class'Medkit'). log("...") writes a line to the editor's Console.
// Everything else of UnrealScript works as in any Deus Ex actor; a Tick of yours should call Super.Tick(DeltaTime)
// (the script starts there, and also at its first output, input, switch or repeat). tools\mapkit\editor\LOGIC.md: the whole.
//=============================================================================
class UCScript extends Actor
	abstract;

// an input or an output the script declares (defaultproperties): its id, the editor's sentence, its arguments
struct UCPort
{
	var string Id;
	var string Label;
	var string Args;              // an input's arguments, separated by commas: "Seconds,Mode"
};

var() float RepeatEvery;        // seconds between two Repeat() (0: Repeat is never called)
var bool bScriptStarted;
var UCPort Inputs[8];           // what the rules can make it do
var UCPort Outputs[8];          // what it tells the rules (Output)
var string WaitingOutputs[8];   // outputs said while the map was loading: their rules run when it has started
var int Waiting;

// ---------------------------------------------------------------- the events to write
function Started();
function Triggered(Actor Other, Pawn EventInstigator);
function Untriggered(Actor Other, Pawn EventInstigator);
function Repeat();

// A rule calls the input InputName, with its arguments ("Seconds=10;Mode=red": Arg, ArgFloat...). A script
// overrides it with a switch on InputName, and passes what it does not know on to Super.Input.
function Input(string InputName, string Args, Actor Caller)
{
	class'UCEditorStory'.static.LogicLine("noinput|" $ MapTitle() $ "|" $ Name $ "|" $ InputName);
}

// ---------------------------------------------------------------- outputs and arguments
// The rules waiting for this output (UCLink: When=output, Source=this script, Port=OutputName) run.
final function Output(string OutputName)
{
	local UCLink L;
	local int n;

	StartScript();
	if (!bScriptStarted)          // the map is still loading (PostBeginPlay...): a rule could not run its actions yet
	{
		if (Waiting < ArrayCount(WaitingOutputs))
		{
			WaitingOutputs[Waiting] = OutputName;
			Waiting++;
		}
		else
			class'UCEditorStory'.static.LogicLine("fail|" $ MapTitle() $ "||output|" $ Name $ "|full");
		return;
	}
	foreach AllActors(class'UCLink', L)
		if (L.When == 'output' && L.Source ~= string(Name) && L.Port ~= OutputName)
		{
			L.Trigger(Self, None);        // no instigator: the logic log says the script set it off
			n++;
		}
	class'UCEditorStory'.static.LogicLine("output|" $ MapTitle() $ "|" $ Name $ "|" $ OutputName $ "|" $ n);
}

// An argument of an input: Arg("Seconds=10;Mode=red", "Mode") is "red" ("" when it is not there).
final function string Arg(string Args, string Key)
{
	local string pair;
	local int i;

	while (Args != "")
	{
		i = InStr(Args, ";");
		if (i < 0)
		{
			pair = Args;
			Args = "";
		}
		else
		{
			pair = Left(Args, i);
			Args = Mid(Args, i + 1);
		}
		i = InStr(pair, "=");
		if (i > 0 && Left(pair, i) ~= Key)
			return Mid(pair, i + 1);
	}
	return "";
}

final function float ArgFloat(string Args, string Key, optional float Fallback)
{
	if (Arg(Args, Key) == "")
		return Fallback;
	return float(Arg(Args, Key));
}

final function int ArgInt(string Args, string Key, optional int Fallback)
{
	if (Arg(Args, Key) == "")
		return Fallback;
	return int(Arg(Args, Key));
}

final function bool ArgBool(string Args, string Key, optional bool Fallback)
{
	if (Arg(Args, Key) == "")
		return Fallback;
	return Arg(Args, Key) ~= "true" || Arg(Args, Key) == "1" || Arg(Args, Key) ~= "yes";
}

// the map's name as the game knows it, for the logic log
final function string MapTitle()
{
	local DeusExLevelInfo info;

	foreach AllActors(class'DeusExLevelInfo', info)
		return info.mapName;
	return "";
}

// ---------------------------------------------------------------- helpers
// JC (None for a moment while a map loads)
final function DeusExPlayer Player()
{
	return DeusExPlayer(GetPlayerPawn());
}

// a line in the game's message area (top left)
final function Say(coerce string Text)
{
	if (Player() != None)
		Player().ClientMessage(Text);
}

// the first actor with this Tag (None if there is none)
final function Actor Find(name ActorTag)
{
	local Actor A;

	if (ActorTag == '')
		return None;
	foreach AllActors(class'Actor', A, ActorTag)
		return A;
	return None;
}

// the actor with this name (its name in the editor's Hierarchy, e.g. "Light29")
final function Actor FindNamed(string ActorName)
{
	local Actor A;

	foreach AllActors(class'Actor', A)
		if (string(A.Name) ~= ActorName)
			return A;
	return None;
}

// sets off everything with this Tag: doors, triggers, lights, other scripts...
final function TriggerTag(name ActorTag)
{
	local Actor A;

	if (ActorTag == '')
		return;
	foreach AllActors(class'Actor', A, ActorTag)
		A.Trigger(Self, Player());
}

// the game's flags (the ones the Story and the conversations use)
final function bool GetFlag(name FlagName)
{
	return Player() != None && Player().FlagBase != None && Player().FlagBase.GetBool(FlagName);
}

final function SetFlag(name FlagName, bool bValue)
{
	if (Player() != None && Player().FlagBase != None)
		Player().FlagBase.SetBool(FlagName, bValue,, 99);
}

// a new item straight into JC's inventory (as if he picked it up)
final function Inventory Give(class<Inventory> ItemClass)
{
	local Inventory item;

	if (Player() == None || ItemClass == None)
		return None;
	item = Spawn(ItemClass,,, Player().Location);
	if (item != None)
		item.Frob(Player(), None);
	return item;
}

// ---------------------------------------------------------------- what calls the events
function PostBeginPlay()
{
	Super.PostBeginPlay();
	if (RepeatEvery > 0)
		SetTimer(RepeatEvery, True);
}

// Once JC is in the map: Started(), then what it said while the map was loading. From Tick, and from whatever
// reaches the script first (a Tick of the script's own may not call this one).
final function StartScript()
{
	local int i;

	if (bScriptStarted || Player() == None)
		return;
	bScriptStarted = True;
	Started();
	for (i = 0; i < Waiting; i++)
		Output(WaitingOutputs[i]);
	Waiting = 0;
}

event Tick(float DeltaTime)
{
	if (!bScriptStarted)
		StartScript();
}

function Trigger(Actor Other, Pawn EventInstigator)
{
	StartScript();
	Triggered(Other, EventInstigator);
}

function UnTrigger(Actor Other, Pawn EventInstigator)
{
	StartScript();
	Untriggered(Other, EventInstigator);
}

function Timer()
{
	StartScript();
	if (bScriptStarted)
		Repeat();
}

defaultproperties
{
	bHidden=True
	Texture=Texture'Engine.S_Trigger'
	DrawType=DT_Sprite
	CollisionRadius=16.000000
	CollisionHeight=16.000000
}
