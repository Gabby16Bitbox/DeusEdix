//=============================================================================
// UCMenuStage - the map behind the project's own main menu (UCMenuLook.MenuMap) made a title screen, as the
// game's DX.dx is: UCBoot makes it there. Only when the game was started as the project's own (its root window
// the project's UCMenuRoot: the editor's Play the menu, an exported mod); a Play of that map from the editor
// leaves it as it is. Then: the map's mission number below 0 (the game's sign of its title screens: no saving,
// no pause, nothing to go back to), JC still, unseen and without his HUD at the player start (the view behind
// the menu), the menu open; the view sways slowly when the editor asks.
//=============================================================================
class UCMenuStage extends Info
	transient;

var DeusExPlayer P;
var rotator baseView;
var float t, emptyFor;
var bool bOpened, bStaged;

function PostBeginPlay()
{
	Super.PostBeginPlay();
	SetTimer(0.25, True);
}

// JC found, and the map made the title screen the first time (False: not yet, or not started with the menu)
function bool Find()
{
	local DeusExLevelInfo info;

	if (P != None && !P.bDeleteMe)
		return bStaged;
	P = None;
	foreach AllActors(class'DeusExPlayer', P)
		break;
	if (P == None || P.rootWindow == None)
	{
		P = None;
		return False;
	}
	if (UCMenuRoot(P.rootWindow) == None)
	{
		// started some other way (a Play of this map from the editor): the map stays a map
		Destroy();
		return False;
	}
	foreach AllActors(class'DeusExLevelInfo', info)
		info.MissionNumber = -2;
	baseView = P.ViewRotation;
	P.GotoState('Paralyzed');
	P.bHidden = True;
	P.SetPhysics(PHYS_None);
	P.Velocity = vect(0, 0, 0);
	P.Acceleration = vect(0, 0, 0);
	bStaged = True;
	return True;
}

function Timer()
{
	local DeusExRootWindow root;

	if (!Find())
		return;
	root = DeusExRootWindow(P.rootWindow);
	if (root == None)
		return;
	root.ShowHud(False);
	if (root.GetTopWindow() != None)
	{
		emptyFor = 0;
		return;
	}
	// opened once at the start; again only when nothing has been on screen for a while (never while a
	// new game, a loaded game or a map change is on its way: those clear the screens and leave at once)
	emptyFor += 0.25;
	if (bOpened && (emptyFor < 1.5 || (P.FlagBase != None && P.FlagBase.GetBool('PlayerTraveling'))))
		return;
	bOpened = True;
	emptyFor = 0;
	P.ShowMainMenu();
}

event Tick(float deltaTime)
{
	local rotator r;

	Super.Tick(deltaTime);
	if (class'UCMenuLook'.default.CameraMove != 1 || !bStaged || P == None)
		return;
	t += deltaTime;
	r = baseView;
	r.Yaw += int(Sin(t * 0.13) * 900);
	r.Pitch += int(Sin(t * 0.07) * 250);
	P.ViewRotation = r;
	P.SetRotation(r);
}

defaultproperties
{
}
