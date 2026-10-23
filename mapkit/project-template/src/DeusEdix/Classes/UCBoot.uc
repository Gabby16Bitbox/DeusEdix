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

// Books, newspapers and datacubes written in the editor: Revision shows SpecialText when the object
// has no text of the game (textTag empty), but in the DataVault it would put an empty note (only the
// game's text parser fills it). The editor gives each one a TextPackage "UCText_<map>_<name>".
function PrepareEditorTexts()
{
	local InformationDevices d;

	foreach AllActors(class'InformationDevices', d)
		if (d.textTag == '' && d.SpecialText != "" && Left(d.TextPackage, 7) == "UCText_" && d.vaultString == "")
			d.vaultString = d.SpecialText;
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
