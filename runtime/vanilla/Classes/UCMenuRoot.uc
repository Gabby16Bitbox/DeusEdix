// Made by DeusEdix from its Revision version for the original Deus Ex (dev\vanilla_runtime.py).
//=============================================================================
// UCMenuRoot - the game's root window with the project's own main menu (UCMenuLook): every main menu the
// game asks for (at its start, Esc during the game, back from a screen) is UCMainMenu, and the character
// screen of a new game is UCNewGame (it starts the project's first map, not the game's intro). Everything
// else is the game's own: this is Revision's root window (RevRootWindow, its HUD and screens kept), the
// original game's DeusExRootWindow in the project's version for it (dev\vanilla_runtime.py).
// Only a launch with the project's menu names it (the [Engine.Engine] Root= of that launch's ini copy,
// main_menu.py root_line): the player's own game never sees it.
//=============================================================================
class UCMenuRoot extends DeusExRootWindow;

function InvokeMenu(Class<DeusExBaseWindow> newMenu)
{
	if (class'UCMenuLook'.default.bEnabled && newMenu != None && ClassIsChildOf(newMenu, class'MenuMain'))
		newMenu = class'UCMainMenu';
	Super.InvokeMenu(newMenu);
}

function DeusExBaseWindow InvokeMenuScreen(Class<DeusExBaseWindow> newScreen, optional bool bNoPause)
{
	if (class'UCMenuLook'.default.bEnabled && newScreen != None && newScreen.Name == 'MenuScreenNewGame')
		newScreen = class'UCNewGame';
	return Super.InvokeMenuScreen(newScreen, bNoPause);
}


defaultproperties
{
}
