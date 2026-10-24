// Made by DeusEdix from its Revision version for the original Deus Ex (dev\vanilla_runtime.py).
//=============================================================================
// UCShotRunner - automatic photos from the game (to check changes without having
// Gabby try them every time). tools\shots.ps1 uses it: it writes the section below,
// starts Revision on a map, waits for the game to close and collects the photos.
// In the normal game it does nothing: it starts only if the section below has bActive=True.
// The section is in RevisionUser.ini (config(User): Revision does not read configuration files
// with new names); tools\shots.ps1 adds it and then takes it away.
//
//  [DeusEdix.UCShotRunner]
//  bActive=True
//  Setup=UCDbgMyStart         (a UCDbg* command that sets the flags and jumps to the map; empty = none)
//  SetupFlags=Name=1,Other=0  (flags to change after the setup command: for the variants)
//  StartDelay=6               (seconds after the arrival, so that scenes and lights start)
//  Shots[0]=label;cam;x;y;z;lookX;lookY;lookZ               free camera
//  Shots[1]=label;view                                      what is on the screen (a conversation too)
//  Shots[2]=label;player;x;y;z;yaw;pitch                    moves JC and looks (first person)
//  Shots[3]=label;wait;seconds                              only waits
//  Shots[4]=label;console;command                           a console command (e.g. summon ...)
//  Shots[5]=label;torch;1                                   torch on (0 = off), for the "player" photos
//  Shots[6]=label;follow;Tag                                behind the character with that Tag
//  Shots[7]=label;where;Tag                                 only its position in the log, no photo
//  Shots[8]=label;flag;FlagName                             the flag's value in the log
//  Shots[9]=label;talk;Tag                                  JC talks to the character (as a click)
//  Shots[10]=label;next                                     a click for the next line of the conversation
//  Shots[11]=label;hud;1                                    HUD visible in the photos (0 = hidden, the default):
//                                                           needed for the first-person lines said in passing, which
//                                                           are read in the HUD
//  Shots[12]=label;waitmap;MAP_NAME;seconds                 waits to be in that map (at most that many seconds)
//  Shots[13]=label;waitflag;FlagName;seconds                waits for the flag to be true (at most that many seconds)
//  Shots[14]=label;near;NameOrTag;distance                  JC in front of the character, wherever it is (photo)
//  Shots[15]=label;choose;N                                 picks answer N (1 = the first) of the conversation
//  Shots[16]=label;play;x;y;z;yaw;pitch                     JC there, then the player takes over and the runner stops
//                                                           (the editor's "Play from here" button)
//  Shots[17]=label;fly;x;y;z;lookX;lookY;lookZ;seconds[;1]  the free camera glides there (for
//                                                           videos); with ;1 JC stays visible
//  Shots[18]=label;free                                     JC's eyes again, no photo
//  Shots[19]=label;text;NameOrTag;words~nmore               the text of a book/newspaper/datacube as the map
//                                                           editor writes it (~n = a new line, |n in the game)
//  Shots[20]=label;read;NameOrTag                           JC reads it and the text window stays open
//  Shots[21]=label;login;NameOrTag;N                        on a computer already in use (frob), logs in with account N
//                                                           (0 = logs out and closes the screen)
//  Shots[22]=label;screen;NameOrTag;EMAIL                   a button of the computer's screen (EMAIL, SPECIAL...)
// If the map changes halfway through the list (a jump, an exit) it goes on from the step it
// had got to (flag UC_ShotIndex): for trying sequences across several maps.
// At the end the game closes by itself (exit).
//=============================================================================
class UCShotRunner extends Actor
	config(User)
	transient;

var config bool bActive;
// Live mode (tools\mapkit\mcp_server.py live_*): the game stays open and takes one command at a
// time. The tool writes System\UCLive.txt with console lines "set UCShotRunner LiveCmd <step>" and
// "set UCShotRunner LiveSeq <n>"; the runner execs that file a few times a second, runs a new step
// (same grammar as Shots[], without the label) and acknowledges by saving LiveDone=<n> and
// LiveResult (map, position, view) to its section of RevisionUser.ini.
var config bool bLive;
var config int LiveSeq;
var config string LiveCmd;
var config int LiveDone;
var config string LiveResult;
var config string Setup;
var config string SetupFlags;
var config float StartDelay;
var config string Shots[160];

var int i;
var string fields[12];
var string Probe;          // the answer of the step anim (LiveResult)
var int numFields;
var UCCam cam;
var bool bTake;
var bool bAgain;     // the step must run again (the wait is not over)
var float waitT;     // how long the current wait has lasted
var bool bKeepHud;   // the photos are taken with the HUD visible (step "hud")
var bool bPlaying;   // "play": the player has the controls, the runner does nothing any more
// "fly": the free camera glides from one shot to another (smoothstep), moved in Tick
var bool bFlying;
var Actor readTarget;    // "read": the object JC keeps looking at (its text window stays open)
var float flyT, flyTime;
var vector flyFrom, flyFromLook, flyTo, flyToLook;

function DeusExPlayer Plr()
{
	return DeusExPlayer(GetPlayerPawn());
}

function Split(string s)
{
	local int p;

	numFields = 0;
	while (numFields < ArrayCount(fields))
	{
		p = InStr(s, ";");
		if (p < 0)
		{
			fields[numFields++] = s;
			return;
		}
		fields[numFields++] = Left(s, p);
		s = Mid(s, p + 1);
	}
}

function vector V(int k)
{
	local vector r;

	r.X = float(fields[k]);
	r.Y = float(fields[k + 1]);
	r.Z = float(fields[k + 2]);
	return r;
}

function FreeView()
{
	local DeusExPlayer P;

	P = Plr();
	if (P != None)
	{
		P.bHidden = False;
		P.ViewTarget = None;
		P.bBehindView = P.InConversation(); // JC stays visible in the dialogue camera
	}
}

function HideHud()
{
	local DeusExPlayer P;
	local DeusExRootWindow root;

	P = Plr();
	if (P == None)
		return;
	root = DeusExRootWindow(P.rootWindow);
	if (root == None || root.hud == None)
		return;
	if (bKeepHud)
		root.hud.Show();
	else
		root.hud.Hide();
}

// Sets up the shot Shots[k]; bTake = True if a photo is to be taken after it.
function float Prepare(int k)
{
	local DeusExPlayer P;
	local rotator r;
	local Actor A;
	local UCEdInfoLink il;

	bTake = False;
	bAgain = False;
	P = Plr();
	if (P == None || Shots[k] == "")
		return -1;
	Split(Shots[k]);
	Log("UCShot" @ k @ fields[0] @ fields[1]);
	switch (fields[1])
	{
		case "cam":
			P.bHidden = True;      // free camera: JC's body is not in the picture
			if (cam == None)
				cam = Spawn(class'UCCam',,, V(2));
			if (cam != None)
			{
				cam.SetShot(V(2), V(5));
				P.ViewTarget = cam;
				P.bBehindView = True;
				cam.ApplyView(P);
			}
			bTake = True;
			return 0.8;
		case "view":
			FreeView();
			bTake = True;
			return 0.3;
		case "fly":
			// fly;x;y;z;lookX;lookY;lookZ;seconds[;1]: from the free camera's shot (or straight there, the
			// first time) to this one, in that many seconds; no photo (the video is recorded outside);
			// with ;1 at the end JC stays visible (a scene with him in it)
			return FlyCam(P, V(2), V(5), float(fields[8]), numFields > 9 && fields[9] == "1");
		case "camat":
			// camat;NameOrTag;dx;dy;dz;seconds[;1]: like fly, to that offset from an actor (found by name or
			// Tag, wherever it is: a body that fell, a character that walked), looking at it
			A = Thing(fields[2]);
			if (A == None)
			{
				Log("UCShot camat: nothing called" @ fields[2]);
				return 0.1;
			}
			return FlyCam(P, A.Location + V(3), A.Location + vect(0,0,0.4) * A.CollisionHeight, float(fields[6]),
				numFields > 7 && fields[7] == "1");
		case "free":
			bFlying = False;
			readTarget = None;
			FreeView();
			return 0.1;
		case "player":
			FreeView();
			P.SetLocation(V(2));
			r.Yaw = int(fields[5]);
			r.Pitch = int(fields[6]);
			P.ViewRotation = r;
			P.SetRotation(r);
			bTake = True;
			return 0.8;
		case "wait":
			return float(fields[2]);
		case "waitmap":
			if (!(Caps(MapName()) == Caps(fields[2])) && waitT < float(fields[3]))
				bAgain = True;
			return Waiting(k);
		case "waitflag":
			if (!P.FlagBase.GetBool(P.rootWindow.StringToName(fields[2])) && waitT < float(fields[3]))
				bAgain = True;
			return Waiting(k);
		case "console":
			// the command may change the map: the step is already done, it must not run again on arrival
			P.FlagBase.SetInt('UC_ShotIndex', k + 1,, 99);
			P.ConsoleCommand(fields[2]);
			return 0.5;
		case "torch":
			Torch(P, fields[2] == "1");
			return 0.5;
		case "follow":
			if (!Follow(P, fields[2]))
				return 0.1;
			bTake = True;
			return 0.4;
		case "where":
			Follow(P, fields[2]);
			FreeView();
			return 0.05;
		case "hand":
			// what JC holds (to find out what makes him put his weapon away)
			Log("UCShot hand" @ P.inHand @ "coming" @ P.inHandPending @ "weapon" @ P.Weapon @ "state" @ P.GetStateName() @ "target" @ P.FrobTarget);
			return 0.05;
		case "flag":
			Log("UCShot flag" @ fields[2] @ P.FlagBase.GetBool(P.rootWindow.StringToName(fields[2])));
			return 0.05;
		case "talk":
			Talk(P, fields[2]);
			return 0.5;
		case "hud":
			bKeepHud = (fields[2] == "1");
			HideHud();
			return 0.1;
		case "next":
			// as a click in the conversation (lines without audio wait for the click)
			if (P.conPlay != None)
				P.conPlay.PlayNextEvent();
			return 0.6;
		case "frob":
			// uses an object (name or Tag) as JC would: buttons, doors
			FrobThing(P, fields[2]);
			return 0.5;
		case "infolink":
			// infolink;BindName;name shown;line: an InfoLink of the map editor (its portrait, its text)
			il = Spawn(class'UCEdInfoLink');
			if (il != None)
			{
				il.caller = fields[2];
				il.callerName = fields[3];
				il.AddLine(fields[4]);
				il.GotoState('Playing');
			}
			return 0.1;
		case "text":
			// text;NameOrTag;words: the text of a book, newspaper or datacube as the map editor writes it
			// (~n for a line break, written |n: the console and the live channel cut a line at |)
			SetDeviceText(fields[2], fields[3]);
			return 0.1;
		case "login":
			// login;NameOrTag;N: on a computer already in use (frob it first), log in with its account N
			// (1 = the first), as typing the login and password would: its emails or its options
			LoginComputer(fields[2], int(fields[3]));
			return 1.0;
		case "screen":
			// screen;NameOrTag;ACTION: on a computer in use, what a button of its screen does
			// (EMAIL, SPECIAL, LOGIN, EXIT: the actions of NetworkTerminal.CloseScreen)
			ComputerScreen(fields[2], fields[3]);
			return 1.0;
		case "read":
			// read;NameOrTag: JC reads a book, a newspaper or a datacube and its window stays open
			// (it closes as soon as JC's FrobTarget is something else: here it is set to the object)
			ReadThing(P, fields[2]);
			return 0.5;
		case "choose":
			// answer N (1 = the first) of a choice of the conversation, as the key N would;
			// it waits (15 seconds at most) for the answers to be on the screen
			if (!ChoicesShown(P) && waitT < 15)
			{
				// lines without a voice wait for a click: one a second until there is a choice
				if (P.conPlay != None && P.conPlay.conWinThird != None && P.conPlay.conWinThird.numChoices == 0
					&& int(waitT * 4) % 4 == 3)
					P.conPlay.PlayNextEvent();
				bAgain = True;
				return Waiting(k);
			}
			Waiting(k);
			if (ChoicesShown(P))
			{
				Log("UCShot choose" @ fields[2] @ "of" @ P.conPlay.conWinThird.numChoices);
				P.conPlay.conWinThird.ButtonActivated(P.conPlay.conWinThird.conChoices[int(fields[2]) - 1]);
			}
			else
				Log("UCShot choose: no choice on the screen");
			return 0.8;
		case "play":
			// "Play from here" of the map editor: JC where the editor's camera was (if there is room),
			// then the player gets the controls and the HUD back, and the runner switches itself off
			// for good (bActive=False saved: the next maps start normally)
			if (Setup == "")
				ApplySetupFlags();
			if (numFields >= 7 && !P.SetLocation(V(2)))
				Log("UCShot play: no room at" @ V(2) $ ", JC stays at the start");
			if (numFields >= 7)
			{
				r.Yaw = int(fields[5]);
				r.Pitch = int(fields[6]);
				P.ViewRotation = r;
				P.SetRotation(r);
			}
			FreeView();
			bPlaying = True;
			P.bShowMenu = False;
			bKeepHud = True;
			HideHud();
			bActive = False;
			bLive = False;
			SaveConfig();
			Log("UCShot play: the player has the controls at" @ P.Location);
			return 0;
		case "look":
			// look;NameOrTag: the look of an actor in the log (mesh, skins); look;corpses: of every dead body
			LookAt(fields[2]);
			return 0.05;
		case "kill":
			// kill;NameOrTag: a character dies as if JC shot them (to check its corpse)
			KillThing(P, fields[2]);
			return 1.0;
		case "ko":
			// ko;NameOrTag: a character knocked out (as by the baton), not killed: no gibs
			HurtThing(P, fields[2], -1, 'KnockedOut');
			return 1.0;
		case "hurt":
			// hurt;NameOrTag;damage[;type]: damage to any actor (a body lying there, a crate); type Shot by default
			if (numFields > 4 && fields[4] != "")
				HurtThing(P, fields[2], int(fields[3]), P.rootWindow.StringToName(fields[4]));
			else
				HurtThing(P, fields[2], int(fields[3]), 'Shot');
			return 1.0;
		case "spawn":
			// spawn;Package.Class;x;y;z[;yaw]: an actor of that class there (to try a class without a map)
			SpawnThing(fields[2], V(3), int(fields[6]));
			return 0.5;
		case "travel":
			// travel;URL: to another map as through a MapExit (JC keeps his inventory and what he carries)
			P.FlagBase.SetInt('UC_ShotIndex', k + 1,, 99);
			Log("UCShot travel" @ fields[2] @ "carrying" @ P.inHand);
			Level.Game.SendPlayer(P, fields[2]);
			return 0.5;
		case "anim":
			// anim;NameOrTag: a character's state, animation and place, at the end of LiveResult
			// (to check the animations chosen in the editor without photos)
			Probe = AnimOf(fields[2]);
			return 0.05;
		case "near":
			// JC in front of the character (name or Tag), wherever it went (a patrolling one walks)
			FreeView();
			// near;NameOrTag;distance;1: also with the view on it, down low (a body on the floor)
			NearThing(P, fields[2], float(fields[3]), numFields > 4 && fields[4] == "1");
			bTake = True;
			return 0.8;
	}
	return 0;
}

function string AnimOf(string who)
{
	local ScriptedPawn p;

	foreach AllActors(class'ScriptedPawn', p)
		if (string(p.Name) ~= who || string(p.Tag) ~= who)
			return p.GetStateName() $ "," $ p.AnimSequence $ "," $ int(p.Location.X) $ "," $ int(p.Location.Y) $ "," $ p.Mesh;
	return "none";
}

function string MapName()
{
	local DeusExLevelInfo info;

	foreach AllActors(class'DeusExLevelInfo', info)
		return info.mapName;
	return "";
}

// One round of waiting (waitmap / waitflag): a quarter of a second, then it checks again.
function float Waiting(int k)
{
	if (bAgain)
	{
		waitT += 0.25;
		return 0.25;
	}
	Log("UCShot wait" @ k @ fields[0] @ "over after" @ waitT @ "in" @ MapName());
	waitT = 0;
	return 0.05;
}

// The flags of SetupFlags ("Name=1,Other=0"): the setup command has already set its own
// and asked for the map change (which happens at the end of the tick); these correct them.
function ApplySetupFlags()
{
	local DeusExPlayer P;
	local string s, item, flagName;
	local int p1, p2;

	P = Plr();
	s = SetupFlags;
	while (P != None && s != "")
	{
		p1 = InStr(s, ",");
		if (p1 < 0)
		{
			item = s;
			s = "";
		}
		else
		{
			item = Left(s, p1);
			s = Mid(s, p1 + 1);
		}
		p2 = InStr(item, "=");
		if (p2 > 0)
		{
			flagName = Left(item, p2);
			P.FlagBase.SetBool(P.rootWindow.StringToName(flagName), Mid(item, p2 + 1) == "1",, 99);
			Log("UCShot flag set" @ flagName @ Mid(item, p2 + 1));
		}
	}
}

// The answers of a choice are on the screen and take a key (the window still, the input free).
function bool ChoicesShown(DeusExPlayer P)
{
	local ConWindowActive w;

	if (P.conPlay == None)
		return False;
	w = P.conPlay.conWinThird;
	return w != None && w.numChoices > 0 && w.moveMode == 2 && !w.bRestrictInput;   // 2 = MM_None
}

// near;NameOrTag;distance: JC at that distance from the character, in front of it if there is room
// (else at its side or behind it), turned towards it
function NearThing(DeusExPlayer P, string what, float dist, optional bool bLookAt)
{
	local Actor A;
	local rotator r;
	local vector spot;
	local int i;

	foreach AllActors(class'Actor', A)
		if (string(A.Name) ~= what || string(A.Tag) ~= what)
			break;
	if (A == None || !(string(A.Name) ~= what || string(A.Tag) ~= what))
	{
		Log("UCShot near" @ what @ "not found");
		return;
	}
	if (dist <= 0)
		dist = 120;
	for (i = 0; i < 4; i++)
	{
		r = A.Rotation;
		r.Pitch = 0;
		r.Roll = 0;
		r.Yaw += i * 16384;
		spot = A.Location + vector(r) * dist;
		spot.Z = A.Location.Z - A.CollisionHeight + P.CollisionHeight;
		if (FastTrace(spot, A.Location) && P.SetLocation(spot))
			break;
	}
	r = rotator(A.Location - P.Location);
	r.Pitch = 0;
	P.SetRotation(r);
	if (bLookAt)
		r = rotator(A.Location - (P.Location + vect(0,0,1) * P.BaseEyeHeight));
	P.ViewRotation = r;
	Log("UCShot near" @ A @ "at" @ A.Location @ "state" @ A.GetStateName() @ "JC at" @ P.Location @ "distance" @ VSize(A.Location - P.Location));
}

// look;NameOrTag: mesh and skins of an actor in the log (look;corpses: of every dead body)
function LookAt(string what)
{
	local Actor A;
	local ScriptedPawn SP;
	local int i;
	local string s;

	foreach AllActors(class'Actor', A)
		if (string(A.Name) ~= what || string(A.Tag) ~= what || (what ~= "corpses" && Carcass(A) != None))
		{
			s = "";
			for (i = 0; i < 8; i++)
				s = s @ i $ "=" $ A.MultiSkins[i];
			Log("UCShot look" @ A @ "mesh" @ A.Mesh @ "texture" @ A.Texture $ s);
			SP = ScriptedPawn(A);
			if (SP != None)
				Log("UCShot look" @ A @ "female" @ SP.bIsFemale @ "speed" @ SP.GroundSpeed @ "eyes" @ SP.BaseEyeHeight
					@ "alliance" @ SP.Alliance @ "name" @ SP.FamiliarName @ "bind" @ SP.BindName @ "weapon" @ SP.Weapon);
		}
}

// The free camera from its last shot (or straight there, the first time) to this one, in secs.
function float FlyCam(DeusExPlayer P, vector to, vector look, float secs, bool bShowJC)
{
	bFlying = False;
	P.bHidden = !bShowJC;
	if (cam == None)
		cam = Spawn(class'UCCam',,, to);
	if (cam == None)
		return 0.1;
	if (P.ViewTarget == cam)
	{
		flyFrom = cam.shotPosition;
		flyFromLook = cam.shotFocus;
	}
	else
	{
		flyFrom = to;
		flyFromLook = look;
	}
	flyTo = to;
	flyToLook = look;
	flyTime = secs;
	flyT = 0;
	cam.SetShot(flyFrom, flyFromLook);
	P.ViewTarget = cam;
	P.bBehindView = True;
	cam.ApplyView(P);
	bFlying = flyTime > 0;
	if (!bFlying)
		cam.SetShot(flyTo, flyToLook);
	return FMax(0.05, flyTime);
}

// the first actor with that name or Tag
function Actor Thing(string what)
{
	local Actor A;

	foreach AllActors(class'Actor', A)
		if (string(A.Name) ~= what || string(A.Tag) ~= what)
			return A;
	return None;
}

// ko / hurt: damage as if JC did it (amount -1: just enough to bring a character down, no gibs)
function HurtThing(DeusExPlayer P, string what, int amount, name kind)
{
	local Actor A;

	A = Thing(what);
	if (A == None)
	{
		Log("UCShot hurt: nothing called" @ what);
		return;
	}
	if (amount < 0)
		amount = Max(1, Pawn(A).Health + 20);
	Log("UCShot hurt" @ A @ amount @ kind);
	A.TakeDamage(amount, P, A.Location, vect(0,0,0), kind);
}

// spawn;Package.Class;x;y;z;yaw
function SpawnThing(string what, vector loc, int yaw)
{
	local class<Actor> C;
	local Actor A;
	local rotator r;

	C = class<Actor>(DynamicLoadObject(what, class'Class', True));
	r.Yaw = yaw;
	if (C != None)
		A = Spawn(C,,, loc, r);
	Log("UCShot spawn" @ what @ "at" @ loc @ "->" @ A @ "tag" @ A.Tag);
}

// kill;NameOrTag
function KillThing(DeusExPlayer P, string what)
{
	local ScriptedPawn A;

	foreach AllActors(class'ScriptedPawn', A)
		if (string(A.Name) ~= what || string(A.Tag) ~= what)
		{
			Log("UCShot kill" @ A);
			A.TakeDamage(10000, P, A.Location, vect(0,0,0), 'Shot');
			return;
		}
	Log("UCShot kill: nothing called" @ what);
}

// As if JC clicked on the character with that Tag (its conversation starts).
// frob;NameOrTag: as if JC used the object (the buttons of elevators, doors)
function FrobThing(DeusExPlayer P, string what)
{
	local Actor A;

	foreach AllActors(class'Actor', A)
		if (string(A.Name) ~= what || string(A.Tag) ~= what)
		{
			Log("UCShot frob" @ A @ "from" @ P.Location);
			A.Frob(P, None);
			return;
		}
	Log("UCShot frob: nothing called" @ what);
}

function LoginComputer(string what, int n)
{
	local Computers C;

	foreach AllActors(class'Computers', C)
		if (string(C.Name) ~= what || string(C.Tag) ~= what)
		{
			if (C.termwindow == None)
			{
				Log("UCShot login:" @ C @ "is not in use (frob it first)");
				return;
			}
			if (n <= 0)
			{
				// login;Name;0: log out, the computer screen closes
				C.termwindow.CloseScreen("EXIT");
				return;
			}
			n = n - 1;
			Log("UCShot login" @ C @ "as" @ C.userList[n].userName @ "package" @ C.TextPackage);
			C.termwindow.SetLoginInfo(C.userList[n].userName, n);
			C.termwindow.CloseScreen("LOGIN");
			return;
		}
	Log("UCShot login: nothing called" @ what);
}

function ComputerScreen(string what, string action)
{
	local Computers C;

	foreach AllActors(class'Computers', C)
		if ((string(C.Name) ~= what || string(C.Tag) ~= what) && C.termwindow != None)
		{
			Log("UCShot screen" @ C @ action);
			C.termwindow.CloseScreen(Caps(action));
			return;
		}
	Log("UCShot screen: no computer in use called" @ what);
}

function SetDeviceText(string what, string text)
{
	local InformationDevices A;
	local int p;

	while (True)
	{
		p = InStr(text, "~n");
		if (p < 0)
			break;
		text = Left(text, p) $ "|n" $ Mid(text, p + 2);
	}
	foreach AllActors(class'InformationDevices', A)
		if (string(A.Name) ~= what || string(A.Tag) ~= what)
		{
			A.textTag = '';
			A.TextPackage = "UCText_test_" $ A.Name;
			A.vaultString = text;
			Log("UCShot text" @ A @ text);
			return;
		}
	Log("UCShot text: nothing called" @ what);
}

function ReadThing(DeusExPlayer P, string what)
{
	local Actor A;

	foreach AllActors(class'Actor', A)
		if (string(A.Name) ~= what || string(A.Tag) ~= what)
		{
			Log("UCShot read" @ A);
			readTarget = A;
			P.FrobTarget = A;
			A.Frob(P, None);
			if (InformationDevices(A) != None)
			{
				Log("UCShot read: tag" @ InformationDevices(A).textTag @ "package" @ InformationDevices(A).TextPackage
					@ "window" @ InformationDevices(A).infoWindow);
				// its Tick closes the window when the reader looks elsewhere: without a reader it stays
				InformationDevices(A).aReader = None;
			}
			return;
		}
	Log("UCShot read: nothing called" @ what);
}

function Talk(DeusExPlayer P, string tagName)
{
	local Actor A;
	local Conversation c;
	local ConListItem item;

	// its Tag or its name in the map (UCEdit5): the editor shows names
	foreach AllActors(class'Actor', A)
		if (string(A.Tag) ~= tagName || string(A.Name) ~= tagName)
			break;
	if (A == None || !(string(A.Tag) ~= tagName || string(A.Name) ~= tagName))
	{
		Log("UCShot talk" @ tagName @ "not found");
		return;
	}
	// why a conversation does not start: who is talking already, whether JC and the NPC can
	// talk, which conversation the game would pick
	c = P.GetActiveConversation(A, IM_Frob);
	Log("UCShot talk: JC at" @ P.Location @ "distance" @ VSize(P.Location - A.Location));
	if (P.conPlay != None && P.conPlay.con != None)
		Log("UCShot talk: already playing" @ P.conPlay.con.conName);
	if (c != None)
	{
		Log("UCShot talk: radius start" @ c.bInvokeRadius @ "radius" @ c.radiusDistance);
		Log("UCShot talk: chosen" @ c.conName @ "JC can" @ P.CanStartConversation() @ "NPC can" @ (ScriptedPawn(A) == None || ScriptedPawn(A).CanConverse()) @ "state" @ A.GetStateName());
	}
	else
	{
		Log("UCShot talk: no valid conversation, state" @ A.GetStateName() @ "at" @ A.Location @ "JC at" @ P.Location);
		for (item = ConListItem(A.ConListItems); item != None; item = item.next)
			if (item.con != None)
				Log("UCShot talk:   listed" @ item.con.conName @ "requirements met" @ P.CheckFlagRefs(item.con.flagRefList));
	}
	Log("UCShot talk to" @ tagName @ P.StartConversation(A, IM_Frob));
}

// A camera behind the character with that Tag (to follow someone walking); it writes
// in the log where it is. False if there is none.
function bool Follow(DeusExPlayer P, string tagName)
{
	local Actor A, hitActor;
	local vector spot, look, hitLoc, hitNormal;

	// its Tag or its name in the map (UCEdit5): the editor shows names
	foreach AllActors(class'Actor', A)
		if (string(A.Tag) ~= tagName || string(A.Name) ~= tagName)
			break;
	if (A == None || !(string(A.Tag) ~= tagName || string(A.Name) ~= tagName))
	{
		Log("UCShot follow" @ tagName @ "not found");
		return False;
	}
	if (Mover(A) != None)
		Log("UCShot follow" @ tagName @ "at" @ A.Location @ "state" @ A.GetStateName() @ "key" @ Mover(A).KeyNum);
	else
		Log("UCShot follow" @ tagName @ "at" @ A.Location @ "state" @ A.GetStateName());
	look = A.Location + vect(0,0,20);
	spot = A.Location - vector(A.Rotation) * 170 + vect(0,0,75);
	hitActor = Trace(hitLoc, hitNormal, spot, look, False);
	if (hitActor != None)
		spot = hitLoc + hitNormal * 12;
	if (cam == None)
		cam = Spawn(class'UCCam',,, spot);
	if (cam == None)
		return False;
	cam.SetShot(spot, look);
	P.ViewTarget = cam;
	P.bBehindView = True;
	cam.ApplyView(P);
	return True;
}

// The torch (the light aug) on or off: it follows JC's view, so use it
// with the "player" photos (not with the free camera).
function Torch(DeusExPlayer P, bool bOn)
{
	local Augmentation aug;

	if (P.AugmentationSystem == None)
		return;
	aug = P.AugmentationSystem.FindAugmentation(class'AugLight');
	if (aug == None || !aug.bHasIt)
		aug = P.AugmentationSystem.GivePlayerAugmentation(class'AugLight');
	if (aug == None)
		return;
	if (bOn)
	{
		P.Energy = P.EnergyMax;
		aug.Activate();
	}
	else
		aug.Deactivate();
}

// auto: the mutator makes it while the map starts, and at the end of the start the engine
// puts every actor back in its initial state (a GotoState done before would be lost).
auto state Shooting
{
Begin:
	Sleep(1.0);
	if (Plr() == None)
		Goto('Begin');
	// the first time: the setup command sets the flags and reloads the map
	if (Setup != "" && !Plr().FlagBase.GetBool('UC_ShotSetupDone'))
	{
		Plr().FlagBase.SetBool('UC_ShotSetupDone', True,, 99);
		Log("UCShot setup" @ Setup);
		Spawn(class<Actor>(DynamicLoadObject("DeusEdix." $ Setup, class'Class')));
		ApplySetupFlags();
		Stop;
	}
	Sleep(StartDelay);
	HideHud();
	if (bLive)
	{
		LiveResult = "ready|" $ MapName() $ "|" $ Plr().Location;
		LiveDone = LiveSeq;
		SaveConfig();
		Goto('Live');
	}
	i = Plr().FlagBase.GetInt('UC_ShotIndex');   // after a map change: from where it had got to
Next:
	if (i < ArrayCount(Shots) && Shots[i] != "")
	{
		Sleep(FMax(0.05, Prepare(i)));
		if (bPlaying)
			Stop;
		if (bAgain)
			Goto('Next');
		if (bTake)
		{
			HideHud();
			Plr().ConsoleCommand("shot");
			Log("UCShot taken" @ i @ fields[0]);
			Sleep(0.6);
		}
		i++;
		Plr().FlagBase.SetInt('UC_ShotIndex', i,, 99);
		Goto('Next');
	}
	Log("UCShot done");
	Sleep(0.5);
	Plr().ConsoleCommand("exit");
	Stop;
Live:
	if (Plr() == None)
	{
		Sleep(0.25);
		Goto('Live');
	}
	Plr().ConsoleCommand("exec UCLive.txt");
	if (LiveSeq != LiveDone && LiveCmd != "")
	{
		Shots[0] = "live;" $ LiveCmd;
		waitT = 0;
LiveStep:
		Sleep(FMax(0.05, Prepare(0)));
		if (bAgain)
			Goto('LiveStep');
		if (bTake)
		{
			HideHud();
			Plr().ConsoleCommand("shot");
			Sleep(0.4);
		}
		if (Plr() != None)
			LiveResult = MapName() $ "|" $ Plr().Location $ "|" $ Plr().ViewRotation $ "|" $ bTake $ "|" $ Probe;
		Probe = "";
		LiveDone = LiveSeq;
		SaveConfig();
	}
	Sleep(0.25);
	Goto('Live');
}

// The game pauses itself when its window loses the focus (the engine's SETPAUSE):
// the photos must go on all the same, so the runner lifts the pause by itself.
event Tick(float deltaTime)
{
	local DeusExPlayer P;
	local float u;

	if (bPlaying)
		return;
	if (Level.Pauser != "")
		Level.Pauser = "";
	if (bFlying && cam != None)
	{
		flyT += deltaTime;
		u = FClamp(flyT / flyTime, 0, 1);
		u = u * u * (3 - 2 * u);
		cam.SetShot(flyFrom + (flyTo - flyFrom) * u, flyFromLook + (flyToLook - flyFromLook) * u);
		if (Plr() != None && Plr().ViewTarget == cam)
			cam.ApplyView(Plr());
		if (flyT >= flyTime)
			bFlying = False;
	}
	// The trial runs while other desktop work can deliver keyboard/mouse input.
	// PlayerInput clears movement axes in menu mode; native Move/Frob still work.
	// This actor exists only during opt-in photography in a temporary game save.
	P = Plr();
	if (P != None && readTarget != None && !readTarget.bDeleteMe)
		P.FrobTarget = readTarget;
	if (P != None)
	{
		if (!P.bShowMenu) Log("UCShot: manual movement disabled during automatic photography");
		P.bShowMenu = True;
		if (P.FlagBase != None && P.FlagBase.GetBool('UC_RooftopProofActive'))
		{
			P.Acceleration = vect(0,0,0);
			P.Velocity.X = 0;
			P.Velocity.Y = 0;
		}
	}
}

defaultproperties
{
     StartDelay=6.000000
     bHidden=True
     bAlwaysTick=True
}
