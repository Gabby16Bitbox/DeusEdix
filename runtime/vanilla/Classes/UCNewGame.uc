// Made by DeusEdix from its Revision version for the original Deus Ex (dev\vanilla_runtime.py).
//=============================================================================
// UCNewGame - the game's character screen of a new game (name, skills, look), started from the project's
// own main menu (UCMenuRoot): its Start begins the project's first map (UCMenuLook.StartMap) where the
// game's would play its intro and then begin UNATCO Island. Revision's screen (RevMenuScreenNewGame), the
// original game's MenuScreenNewGame in the project's version for it (dev\vanilla_runtime.py). An installed mod
// with no menu of its own opens it from the game's own menu, for its first map (UCModStart).
//=============================================================================
class UCNewGame extends MenuScreenNewGame;

function ProcessAction(String actionKey)
{
	if (actionKey == "START" && StartMapOf() != "")
	{
		if (TrimSpaceS(editName.GetText()) == "")
		{
			root.MessageBox(NameBlankTitle, NameBlankPrompt, 1, False, Self);
			return;
		}
		ForgetLastGame(player);
		SaveSettings();
		player.StartNewGame(StartMapOf());
		return;
	}
	Super.ProcessAction(actionKey);
}

// the map a new game begins on: an installed mod's with the game's own menu (UCModStart, set only by its launch),
// else the project's own menu's (UCMenuLook.StartMap); none: the game's own new game
static function string StartMapOf()
{
	if (class'UCModStart'.default.StartMap != "")
		return class'UCModStart'.default.StartMap;
	return class'UCMenuLook'.default.StartMap;
}

// A new game starts with no states or counters of the last one. The game's own new game clears them in its intro
// (MissionIntro: DeleteAllFlags), which the project's menu never plays; its StartNewGame alone clears only the yes/no
// states in the original game (DeusExRootWindow.ResetFlags deletes every flag as a bool): the counters of a game
// played before came along (chain test, 6 Nov 2026). Before the screen's own settings, which may set flags.
static function ForgetLastGame(DeusExPlayer p)
{
	if (p != None && p.FlagBase != None)
		p.FlagBase.DeleteAllFlags();
}

defaultproperties
{
}
