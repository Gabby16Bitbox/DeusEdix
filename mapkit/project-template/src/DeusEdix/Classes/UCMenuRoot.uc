//=============================================================================
// UCMenuRoot - the game's root window with the project's own main menu (UCMenuLook): every main menu the
// game asks for (at its start, Esc during the game, back from a screen) is UCMainMenu, and the character
// screen of a new game is UCNewGame (it starts the project's first map, not the game's intro). Everything
// else is the game's own: this is Revision's root window (RevRootWindow, its HUD and screens kept), the
// original game's DeusExRootWindow in the project's version for it (dev\vanilla_runtime.py).
// Only a launch with the project's menu names it (the [Engine.Engine] Root= of that launch's ini copy,
// main_menu.py root_line): the player's own game never sees it.
//=============================================================================
class UCMenuRoot extends RevRootWindow;

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

// Revision only: its own screens open its main menu by its class too (RevMenuMain); a new game's difficulty is
// the game's own screen, not Revision's (its game modes and challenges are its campaign's, and it crashed the
// game when opened from a project's menu: Extension's InitializeWindows assertion, 6 Nov 2026)
event MutateNewChild(Window NewParent, out class<Window> DesignatedClass)
{
	local name asked;

	if (DesignatedClass != None)
		asked = DesignatedClass.Name;
	Super.MutateNewChild(NewParent, DesignatedClass);
	if (!class'UCMenuLook'.default.bEnabled || DesignatedClass == None)
		return;
	if (DesignatedClass.Name == 'RevMenuMain')
		DesignatedClass = class'UCMainMenu';
	else if (asked == 'MenuSelectDifficulty')
		DesignatedClass = class'MenuSelectDifficulty';
}
// (end of Revision only)

defaultproperties
{
}
