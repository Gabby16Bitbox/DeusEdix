// Made by DeusEdix from its Revision version for the original Deus Ex (dev\vanilla_runtime.py).
//=============================================================================
// UCBoot - DeusEdix: one in every map the editor builds. It starts what the editor wrote for the
// map: its story (UCEd_<map>, a subclass of UCEditorStory made by the editor), the emails and
// bulletins of its computers (UCTextBlock), the texts of its books and datacubes, and the watcher
// of the characters' fates (UCFateWatch). It is saved with the map: from a saved game it only makes
// the texts again (they live in memory).
//=============================================================================
class UCBoot extends Info;

var bool bStarted;            // story and fate watcher: once (both are saved with the map)
var transient bool bTexts;    // the texts: every time the map starts, from a saved game too

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
	EnsureSession();
	if (!bTexts)
	{
		bTexts = True;
		PrepareEditorTexts();
		MakeEditorTexts();
		EnsureVoiceDriver();
	}
	if (!bStarted)
	{
		bStarted = True;
		EnsureFateWatch();
		SpawnEditorStory();
	}
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
function EnsureVoiceDriver()
{
	local UCVoiceDriver d;

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
