//=============================================================================
// UCShotRunner - foto automatiche dal gioco (per controllare le modifiche senza far
// provare ogni volta a Gabby). Lo usa tools\shots.ps1, che scrive la sezione qui sotto,
// avvia Revision su una mappa, aspetta che il gioco si chiuda e raccoglie le foto.
// Nel gioco normale non fa nulla: parte solo se la sezione qui sotto ha bActive=True.
// La sezione sta in RevisionUser.ini (config(User): Revision non legge file di
// configurazione con nomi nuovi); tools\shots.ps1 la aggiunge e poi la toglie.
//
//  [DeusEdix.UCShotRunner]
//  bActive=True
//  Setup=UCDbgMyStart         (comando UCDbg* che mette i flag e salta alla mappa; vuoto = nessuno)
//  SetupFlags=Nome=1,Altro=0  (flag da cambiare dopo il comando di preparazione: per le varianti)
//  StartDelay=6               (secondi dopo l'arrivo, perche' scene e luci partano)
//  Shots[0]=etichetta;cam;x;y;z;guardaX;guardaY;guardaZ    telecamera libera
//  Shots[1]=etichetta;view                                  quello che si vede (anche una conversazione)
//  Shots[2]=etichetta;player;x;y;z;yaw;pitch                sposta JC e guarda (prima persona)
//  Shots[3]=etichetta;wait;secondi                          solo attesa
//  Shots[4]=etichetta;console;comando                       un comando da console (es. summon ...)
//  Shots[5]=etichetta;torch;1                               torcia accesa (0 = spenta), per le foto "player"
//  Shots[6]=etichetta;follow;Tag                            alle spalle del personaggio con quel Tag
//  Shots[7]=etichetta;where;Tag                             solo la sua posizione nel log, niente foto
//  Shots[8]=etichetta;flag;NomeFlag                         valore del flag nel log
//  Shots[9]=etichetta;talk;Tag                              JC parla col personaggio (come un clic)
//  Shots[10]=etichetta;next                                 clic per la battuta successiva della conversazione
//  Shots[11]=etichetta;hud;1                                interfaccia visibile nelle foto (0 = nascosta, il normale):
//                                                           serve per le battute "al volo" in prima persona, che
//                                                           si leggono nell'interfaccia
//  Shots[12]=etichetta;waitmap;NOME_MAPPA;secondi           aspetta di essere in quella mappa (al massimo tot secondi)
//  Shots[13]=etichetta;waitflag;NomeFlag;secondi            aspetta che il flag sia vero (al massimo tot secondi)
//  Shots[14]=etichetta;near;NomeOTag;distanza               JC davanti al personaggio, ovunque sia (foto)
//  Shots[15]=etichetta;choose;N                             sceglie la risposta N (1 = la prima) della conversazione
//  Shots[16]=etichetta;play;x;y;z;yaw;pitch                 JC li', poi i comandi al giocatore e il runner si spegne
//                                                           (il pulsante "Play from here" dell'editor)
//  Shots[17]=etichetta;fly;x;y;z;guardaX;guardaY;guardaZ;secondi[;1]   la telecamera libera scivola fin li' (per i
//                                                           video); con ;1 JC resta visibile
//  Shots[18]=etichetta;free                                 di nuovo gli occhi di JC, senza foto
//  Shots[19]=etichetta;text;NomeOTag;parole~naltre         il testo di un libro/giornale/datacube come lo scrive
//                                                           l'editor di mappe (~n = a capo, |n nel gioco)
//  Shots[20]=etichetta;read;NomeOTag                        JC lo legge e la finestra del testo resta aperta
//  Shots[21]=etichetta;login;NomeOTag;N                     su un computer gia' in uso (frob), entra con l'account N
//                                                           (0 = esce e chiude lo schermo)
//  Shots[22]=etichetta;screen;NomeOTag;EMAIL                un pulsante dello schermo del computer (EMAIL, SPECIAL...)
// Se la mappa cambia a meta' elenco (un salto, un'uscita) si riparte dal passo dove si era
// rimasti (flag UC_ShotIndex): serve per provare sequenze su piu' mappe.
// Alla fine il gioco si chiude da solo (exit).
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
var bool bAgain;     // il passo va ripetuto (attesa non finita)
var float waitT;     // da quanto dura l'attesa in corso
var bool bKeepHud;   // le foto si fanno con l'interfaccia visibile (azione "hud")
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
		P.bBehindView = P.InConversation(); // JC resta visibile nella camera del dialogo
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

// Prepara l'inquadratura i-esima; bTake = True se poi va scattata la foto.
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
			// il comando puo' far cambiare mappa: il passo e' gia' fatto, non va ripetuto all'arrivo
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
			// cosa ha in mano JC (per capire chi gli fa riporre l'arma)
			Log("UCShot mano" @ P.inHand @ "in arrivo" @ P.inHandPending @ "arma" @ P.Weapon @ "stato" @ P.GetStateName() @ "bersaglio" @ P.FrobTarget);
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
			// come un clic nella conversazione (le battute senza audio aspettano il clic)
			if (P.conPlay != None)
				P.conPlay.PlayNextEvent();
			return 0.6;
		case "frob":
			// usa un oggetto (nome o Tag) come JC: pulsanti, porte
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
			// la risposta N (1 = la prima) di una scelta della conversazione, come il tasto N;
			// aspetta (al massimo 15 secondi) che le risposte siano sullo schermo
			if (!ChoicesShown(P) && waitT < 15)
			{
				// le battute senza voce aspettano un clic: uno al secondo finche' non c'e' una scelta
				if (P.conPlay != None && P.conPlay.conWinThird != None && P.conPlay.conWinThird.numChoices == 0
					&& int(waitT * 4) % 4 == 3)
					P.conPlay.PlayNextEvent();
				bAgain = True;
				return Waiting(k);
			}
			Waiting(k);
			if (ChoicesShown(P))
			{
				Log("UCShot scegli" @ fields[2] @ "di" @ P.conPlay.conWinThird.numChoices);
				P.conPlay.conWinThird.KeyboardButtonActivated(int(fields[2]) - 1);
			}
			else
				Log("UCShot scegli: nessuna scelta sullo schermo");
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
			Level.Game.SendPlayer(P, fields[2] $ P.BuildOptionString());
			return 0.5;
		case "anim":
			// anim;NomeOTag: stato, animazione e posto di un personaggio, in fondo a LiveResult
			// (per controllare le animazioni scelte nell'editor senza foto)
			Probe = AnimOf(fields[2]);
			return 0.05;
		case "near":
			// JC davanti al personaggio (nome o Tag), ovunque sia andato (chi pattuglia cammina)
			FreeView();
			// near;NomeOTag;distanza;1: anche con lo sguardo verso di lui, in basso (un corpo a terra)
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

// Un giro di attesa (waitmap / waitflag): un quarto di secondo, poi si ricontrolla.
function float Waiting(int k)
{
	if (bAgain)
	{
		waitT += 0.25;
		return 0.25;
	}
	Log("UCShot attesa" @ k @ fields[0] @ "finita dopo" @ waitT @ "in" @ MapName());
	waitT = 0;
	return 0.05;
}

// I flag di SetupFlags ("Nome=1,Altro=0"): il comando di preparazione ha gia' messo i
// suoi e chiesto il cambio mappa (che avviene a fine tick); questi li correggono.
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
			Log("UCShot flag impostato" @ flagName @ Mid(item, p2 + 1));
		}
	}
}

// Le risposte di una scelta sono sullo schermo e accettano un tasto (finestra ferma, input libero).
function bool ChoicesShown(DeusExPlayer P)
{
	local ConWindowActive w;

	if (P.conPlay == None)
		return False;
	w = P.conPlay.conWinThird;
	return w != None && w.numChoices > 0 && w.moveMode == 2 && !w.bRestrictInput;   // 2 = MM_None
}

// near;NomeOTag;distanza: JC a quella distanza dal personaggio, davanti a lui se c'e' posto
// (altrimenti di lato o dietro), girato verso di lui
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
		Log("UCShot vicino" @ what @ "non trovato");
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
	Log("UCShot vicino" @ A @ "a" @ A.Location @ "stato" @ A.GetStateName() @ "JC a" @ P.Location @ "distanza" @ VSize(A.Location - P.Location));
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

// Come se JC cliccasse sul personaggio con quel Tag (parte la sua conversazione).
// frob;NomeOTag: come se JC usasse l'oggetto (pulsanti degli ascensori, porte)
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
			A.SpecialText = text;
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
					@ "window" @ InformationDevices(A).infoWindow @ "text" @ InformationDevices(A).SpecialText);
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
		Log("UCShot parla" @ tagName @ "non trovato");
		return;
	}
	// perche' una conversazione non parte: chi sta gia' parlando, se JC e il PNG possono
	// conversare, quale conversazione sceglierebbe il gioco
	c = P.GetActiveConversation(A, IM_Frob);
	Log("UCShot parla: JC a" @ P.Location @ "distanza" @ VSize(P.Location - A.Location));
	if (P.conPlay != None && P.conPlay.con != None)
		Log("UCShot parla: in corso" @ P.conPlay.con.conName);
	if (c != None)
	{
		Log("UCShot parla: avvio raggio" @ c.bInvokeRadius @ "raggio" @ c.radiusDistance);
		Log("UCShot parla: scelta" @ c.conName @ "JC puo'" @ P.CanStartConversation() @ "PNG puo'" @ (ScriptedPawn(A) == None || ScriptedPawn(A).CanConverse()) @ "stato" @ A.GetStateName());
	}
	else
	{
		Log("UCShot parla: nessuna conversazione valida, stato" @ A.GetStateName() @ "a" @ A.Location @ "JC a" @ P.Location);
		for (item = ConListItem(A.ConListItems); item != None; item = item.next)
			if (item.con != None)
				Log("UCShot parla:   in lista" @ item.con.conName @ "requisiti ok" @ P.CheckFlagRefs(item.con.flagRefList));
	}
	Log("UCShot parla con" @ tagName @ P.StartConversation(A, IM_Frob));
}

// Telecamera alle spalle del personaggio con quel Tag (per seguire chi cammina); scrive
// nel log dove si trova. Falso se non c'e'.
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
		Log("UCShot segui" @ tagName @ "non trovato");
		return False;
	}
	if (Mover(A) != None)
		Log("UCShot segui" @ tagName @ "a" @ A.Location @ "stato" @ A.GetStateName() @ "posizione" @ Mover(A).KeyNum);
	else
		Log("UCShot segui" @ tagName @ "a" @ A.Location @ "stato" @ A.GetStateName());
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

// Torcia (potenziamento luce) accesa o spenta: segue lo sguardo di JC, quindi va usata
// con le foto "player" (non con la telecamera libera).
function Torch(DeusExPlayer P, bool bOn)
{
	local Augmentation aug;

	if (P.AugmentationSystem == None)
		return;
	aug = P.AugmentationSystem.FindAugmentation(class'AugLight');
	if (aug == None || !aug.bHasIt)
		aug = P.AugmentationSystem.GivePlayerAugmentation(class'AugLight', True);
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

// auto: il mutator lo crea mentre la mappa si avvia, e alla fine dell'avvio il motore
// rimette ogni attore nel suo stato iniziale (un GotoState fatto prima andrebbe perso).
auto state Shooting
{
Begin:
	Sleep(1.0);
	if (Plr() == None)
		Goto('Begin');
	// prima volta: il comando di preparazione mette i flag e ricarica la mappa
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
	i = Plr().FlagBase.GetInt('UC_ShotIndex');   // dopo un cambio di mappa: da dove si era rimasti
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
			Log("UCShot preso" @ i @ fields[0]);
			Sleep(0.6);
		}
		i++;
		Plr().FlagBase.SetInt('UC_ShotIndex', i,, 99);
		Goto('Next');
	}
	Log("UCShot fine");
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

// Il gioco si mette in pausa quando la sua finestra perde il fuoco (SETPAUSE del motore):
// le foto devono andare avanti lo stesso, quindi la pausa si toglie da sola.
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
