// Made by DeusEdix from its Revision version for the original Deus Ex (dev\vanilla_runtime.py).
//=============================================================================
// UCBoot - DeusEdix: one in every map the editor builds. It starts what the editor wrote for the
// map: its story (UCEd_<map>, a subclass of UCEditorStory made by the editor), the emails and
// bulletins of its computers (UCTextBlock), the texts of its books and datacubes, and the watcher
// of the characters' fates (UCFateWatch). It is saved with the map: from a saved game it only makes
// the texts again (they live in memory).
// It also tells how the map came alive this time (WokeAs, P9 "Game rules"): 'first' its first visit, 'back' the player
// came back to it (through a map exit: the game sets its PlayerTraveling flag before it travels, or the player was
// last in another map of the editor: the flag UCEdHere names the map the player was last in), 'loaded' a saved game
// was loaded. The rules "a saved game is loaded" and "the player comes back to the map" read it (UCRule.LookAtWorld).
//=============================================================================
class UCBoot extends Info;

var bool bStarted;            // story and fate watcher: once (both are saved with the map)
var transient bool bTexts;    // the texts: every time the map starts, from a saved game too
var transient name WokeAs;    // first, back, loaded ('' not told yet): not saved, so told again at every wake

function PostBeginPlay()
{
	local UCBoot other;

	Super.PostBeginPlay();
	foreach AllActors(class'UCBoot', other)
		if (other != self)
		{
			Destroy();
			return;
		}
	SetTimer(0.5, True);
}

function Timer()
{
	if (WokeAs == '')
		Wake();
	EnsureSession();
	if (!bTexts)
	{
		bTexts = True;
		PrepareEditorTexts();
		MakeEditorTexts();
		EnsureVoiceDriver();
		EnsureMenuStage();
	}
	if (!bStarted)
	{
		bStarted = True;
		EnsureFateWatch();
		SpawnEditorStory();
	}
}

// how the map came alive (WokeAs): before the first look of the rules, and before the game's mission script deletes
// PlayerTraveling (its first timer, a second after the map starts; this one's comes in half a second)
function Wake()
{
	local DeusExPlayer P;
	local name here, was;
	local bool bTravel;

	P = DeusExPlayer(GetPlayerPawn());
	if (P == None || P.FlagBase == None || P.rootWindow == None)
		return;
	here = P.rootWindow.StringToName(MapName());
	was = P.FlagBase.GetName('UCEdHere');
	bTravel = P.FlagBase.GetBool('PlayerTraveling');
	if (!bStarted)
		WokeAs = 'first';
	else if (bTravel || was != here)
		WokeAs = 'back';
	else
		WokeAs = 'loaded';
	P.FlagBase.SetName('UCEdHere', here, True, 0);
	Log("DeusEdix: the map woke:" @ WokeAs @ "(traveling" @ bTravel $ ", last in" @ was $ ")");
}

// the map behind the project's own main menu (UCMenuLook.MenuMap): its stage (UCMenuStage) holds JC still
// there, as the game's title screen, and opens the menu
function EnsureMenuStage()
{
	local UCMenuStage stage;
	local string here;

	if (!class'UCMenuLook'.default.bEnabled || class'UCMenuLook'.default.MenuMap == "")
		return;
	here = string(Level);
	if (InStr(here, ".") >= 0)
		here = Left(here, InStr(here, "."));
	if (!(here ~= class'UCMenuLook'.default.MenuMap))
		return;
	foreach AllActors(class'UCMenuStage', stage)
		return;
	Spawn(class'UCMenuStage');
}

// the editor's Play and live view start the map with ?Mutator=...UCMutator, which keeps its Console and
// test runner going; Revision clears the mutator when JC takes a map exit, so from the next map on the
// map's own boot does the same (20 Oct 2026). Both only act while the editor's session asks for them.
function EnsureSession()
{
	local UCShotRunner shots;

	class'UCConsoleLink'.static.Ensure(Self);
	if (class'UCShotRunner'.default.bActive)
	{
		foreach AllActors(class'UCShotRunner', shots)
			return;
		Spawn(class'UCShotRunner');
	}
}

function string MapName()
{
	local DeusExLevelInfo info;

	foreach AllActors(class'DeusExLevelInfo', info)
		return Caps(info.mapName);
	return "";
}

// the story written in the editor ("Story": dialogues and events), if this map has one
function SpawnEditorStory()
{
	local class<Actor> cls;
	local string m;

	m = MapName();
	if (m == "")
		return;
	cls = class<Actor>(DynamicLoadObject(string(Class.Outer.Name) $ ".UCEd_" $ m, class'Class', True));
	if (cls != None)
	{
		Spawn(cls);
		Log("DeusEdix: the editor's story" @ cls);
	}
}

// the voices of the conversations (given to the lines in the editor's Story: recorded, imported):
// played from the mouth of who speaks, so the lips follow. Not saved: made again at every start.
// The InfoLinks' own voice channel (UCInfoVoice) from the start too: it measures how fast the game's clock
// runs (the original Deus Ex's runs fast), so the map's first voiced line is already waited for long enough.
function EnsureVoiceDriver()
{
	local UCVoiceDriver d;

	class'UCInfoVoice'.static.Get(Self);
	foreach AllActors(class'UCVoiceDriver', d)
		return;
	Spawn(class'UCVoiceDriver');
}

function EnsureFateWatch()
{
	local UCFateWatch w;

	foreach AllActors(class'UCFateWatch', w)
		return;
	Spawn(class'UCFateWatch');
}

// Books, newspapers and datacubes written in the editor: the original game has no SpecialText (Revision's
// own text of an object); there the editor gives them their text through textTag and TextPackage, read by
// the game's own text parser (DataVault included). Nothing to prepare.
function PrepareEditorTexts()
{
}

// The emails and bulletins of the computers written in the editor (UCTextBlock): the texts the game
// looks for in the computer's TextPackage, made here in this package (in memory).
function MakeEditorTexts()
{
	local UCTextBlock b;
	foreach AllActors(class'UCTextBlock', b)
		class'UCTextBlock'.static.RegisterText(b);
}

defaultproperties
{
}
