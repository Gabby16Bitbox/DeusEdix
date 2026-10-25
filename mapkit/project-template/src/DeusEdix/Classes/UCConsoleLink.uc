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

	pollT += deltaTime;
	if (pollT < 0.25)
		return;
	pollT = 0;
	P = GetPlayerPawn();
	if (P == None)
		return;
	P.ConsoleCommand("exec UCConsole.txt");
	if (Seq == Done)
		return;
	Done = Seq;
	Log("DeusEdix console >" @ Cmd);
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

defaultproperties
{
	Cheats="|abomb|allammo|allaugs|allcredits|allenergy|allhealth|allimages|allitems|allskillpoints|allskills|allweapons|amphibious|augadd|behindview|causeevent|cheatview|damageall|damagepart|debugcommand|editflags|fly|getai|getdebug|ghost|givenanokey|givenpc|gocatgo|god|iamwarren|invisible|invokeconwindow|ispeelmydreenk|killall|killpawns|legend|loadmap|moveactor|myvisionisaugmented|opensesame|playersonly|playmusicwindow|removenanokey|ripandtear|setdebug|setjumpz|setspeed|setstate|showacceleration|showarea|showbase|showbindname|showclass|showcylinder|showdata|showdist|showenemy|showenemyresponse|showeyes|showhealth|showinstigator|showlight|showlos|showmass|showmesh|showphysics|showpos|showquoteswindow|showrgbdialog|showstate|showvelocity|showvisibility|showzone|slomo|spawnmass|summon|tantabusall|tantalus|tantalusall|togglewinframes|togglewinstats|trig|type|untrig|viewmodeladd|viewmodelblendplay|viewmodelblendstop|viewmodeldestroy|viewmodelgiveweapon|viewmodelloop|viewmodelplay|walk|whatarottenwaytodie|whatashame|whereactor|whereisyevgeni|winframes|"
}
