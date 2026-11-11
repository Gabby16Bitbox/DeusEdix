//=============================================================================
// UCNewGame - the game's character screen of a new game (name, skills, look), started from the project's
// own main menu (UCMenuRoot): its Start begins the project's first map (UCMenuLook.StartMap) where the
// game's would play its intro and then begin UNATCO Island. Revision's screen (RevMenuScreenNewGame), the
// original game's MenuScreenNewGame in the project's version for it (dev\vanilla_runtime.py).
//=============================================================================
class UCNewGame extends RevMenuScreenNewGame;

function ProcessAction(String actionKey)
{
	if (actionKey == "START" && class'UCMenuLook'.default.StartMap != "")
	{
		if (TrimSpaceS(editName.GetText()) == "")
		{
			root.MessageBox(NameBlankTitle, NameBlankPrompt, 1, False, Self);
			return;
		}
		ForgetLastGame(player);
		SaveSettings();
		player.StartNewGame(class'UCMenuLook'.default.StartMap);
		return;
	}
	Super.ProcessAction(actionKey);
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
