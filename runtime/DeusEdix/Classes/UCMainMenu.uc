//=============================================================================
// UCMainMenu - the project's own main menu (UCMenuLook, made in the map editor's File > Main menu...):
// over the whole screen, the project's picture and title and its buttons in a column, left, centred or
// right, in the game's button look or as text. UCMenuRoot opens it wherever the game opens its own.
// It is a menu of the game's kind (MenuUIMenuWindow) without the game's frame: the root window hides it
// under the screens it opens (load, save, settings, new game) and shows it again after them.
//=============================================================================
class UCMainMenu extends MenuUIMenuWindow;

var UCMenuButton btns[12];
var byte         btnAction[12];
var string       btnTarget[12];
var int          numBtns;
var Texture      logoTex;
var float        blockX, blockY, blockW, logoH, titleH, btnH, btnGap;
var bool         bAtMenu;          // on the menu's own map (the game's title screen): no game to go back to
var byte         pendingAction;
var bool         bAsking;          // our own question is on screen (the games' message box modes differ)
var string       pendingTarget;
var localized string ExitPrompt, LeavePrompt, PromptTitle;

// the fonts the editor offers (main_menu.py FONTS), by their number
static function Font FontOf(byte which)
{
	local Font f;
	local string names[7];

	names[0] = "DXFonts.MainMenuTrueType";
	names[1] = "DeusExUI.FontMenuTitle";
	names[2] = "DeusExUI.FontMenuHeaders";
	names[3] = "DeusExUI.FontMenuExtraLarge";
	names[4] = "DeusExUI.FontConversationLargeBold";
	names[5] = "DeusExUI.FontLocation";
	names[6] = "DeusExUI.FontMenuSmall";
	if (which < 7)
		f = Font(DynamicLoadObject(names[which], class'Font', True));
	if (f == None)
		f = Font'DeusExUI.FontMenuTitle';
	return f;
}

event InitWindow()
{
	Super.InitWindow();
	SetWindowAlignments(HALIGN_Full, VALIGN_Full);
	if (class'UCMenuLook'.default.bLogo)
		logoTex = Texture(DynamicLoadObject(string(class'UCMenuLook'.Outer.Name) $ ".UCMenuLogo", class'Texture', True));
}

// the game's frame (title bar, client area, button bar) is not made: the menu is the whole screen
function CreateControls()
{
}

// the project's buttons, those for here (UCMenuLook.Shows), in its order
function CreateMenuButtons()
{
	local int i;
	local byte shows;
	local DeusExLevelInfo info;

	bAtMenu = root.AtIntroMap();
	numBtns = 0;
	for (i = 0; i < class'UCMenuLook'.default.NumButtons && i < 12; i++)
	{
		shows = class'UCMenuLook'.default.Shows[i];
		if ((shows == 1 && !bAtMenu) || (shows == 2 && bAtMenu))
			continue;
		if (class'UCMenuLook'.default.Actions[i] == 5 && bAtMenu)
			continue;                                      // the main menu, from the main menu
		btns[numBtns] = UCMenuButton(NewChild(class'UCMenuButton'));
		btns[numBtns].Setup(class'UCMenuLook'.default.Labels[i], class'UCMenuLook'.default.ButtonLook == 1,
			FontOf(class'UCMenuLook'.default.ButtonFont), class'UCMenuLook'.default.Align);
		btnAction[numBtns] = class'UCMenuLook'.default.Actions[i];
		btnTarget[numBtns] = class'UCMenuLook'.default.Targets[i];
		numBtns++;
	}
	// what cannot be done now, greyed as the game's own menu does it (MenuMain.UpdateButtonStatus)
	info = player.GetLevelInfo();
	for (i = 0; i < numBtns; i++)
	{
		if (btnAction[i] == 2 && (bAtMenu || player.IsInState('Dying') || player.IsInState('Paralyzed')
			|| player.IsInState('Interpolating') || player.dataLinkPlay != None || (info != None && info.MissionNumber < 0)))
			btns[i].SetSensitivity(False);
		if (btnAction[i] == 4 && (bAtMenu || player.IsInState('Dying')))
			btns[i].SetSensitivity(False);
	}
}

event ParentRequestedPreferredSize(bool bWidthSpecified, out float preferredWidth,
                                   bool bHeightSpecified, out float preferredHeight)
{
	preferredWidth = GetRootWindow().width;
	preferredHeight = GetRootWindow().height;
}

function bool ChildRequestedReconfiguration(window child)
{
	return False;
}

// where everything goes: the block (picture, title, buttons) from PosX/PosY, aligned by Align
function ConfigurationChanged()
{
	local GC gc;
	local float tw, th, w, x, y;
	local int i;

	gc = GetGC();
	blockW = class'UCMenuLook'.default.ButtonWidth;
	logoH = 0;
	if (logoTex != None)
	{
		w = class'UCMenuLook'.default.LogoW * class'UCMenuLook'.default.LogoScale;
		logoH = class'UCMenuLook'.default.LogoH * class'UCMenuLook'.default.LogoScale + 12;
		blockW = FMax(blockW, w);
	}
	titleH = 0;
	if (class'UCMenuLook'.default.Title != "")
	{
		gc.SetFont(FontOf(class'UCMenuLook'.default.TitleFont));
		gc.GetTextExtent(0, tw, th, class'UCMenuLook'.default.Title);
		titleH = th + 14;
		blockW = FMax(blockW, tw);
	}
	btnGap = 9;
	btnH = 27;
	if (class'UCMenuLook'.default.ButtonLook == 1)
	{
		gc.SetFont(FontOf(class'UCMenuLook'.default.ButtonFont));
		gc.GetTextExtent(0, tw, th, "Mg");
		btnH = th + 8;
		btnGap = 4;
	}
	ReleaseGC(gc);

	blockY = class'UCMenuLook'.default.PosY * height;
	switch (class'UCMenuLook'.default.Align)
	{
		case 1:  blockX = (width - blockW) / 2; break;
		case 2:  blockX = width - class'UCMenuLook'.default.PosX * width - blockW; break;
		default: blockX = class'UCMenuLook'.default.PosX * width;
	}
	// the column fits the screen however many buttons: it starts higher when it would run off the bottom
	y = blockY + logoH + titleH;
	if (y + numBtns * (btnH + btnGap) > height - 40)
	{
		blockY = FMax(10, blockY - (y + numBtns * (btnH + btnGap) - (height - 40)));
		y = blockY + logoH + titleH;
	}
	w = class'UCMenuLook'.default.ButtonWidth;
	for (i = 0; i < numBtns; i++)
	{
		x = blockX;
		if (class'UCMenuLook'.default.Align == 1)
			x = blockX + (blockW - w) / 2;
		else if (class'UCMenuLook'.default.Align == 2)
			x = blockX + blockW - w;
		btns[i].ConfigureChild(x, y, w, btnH);
		y += btnH + btnGap;
	}
}

event DrawWindow(GC gc)
{
	local float x, w, h, bottom, tw, th;
	local EHAlign align;
	local int i;

	if (class'UCMenuLook'.default.bShade && numBtns > 0)
	{
		// a band of darkness from the top to the bottom of the screen behind the column, half as bright, its
		// sides fading (UCFade's column: 0 no change to 127 black, as UCCutWindow.Black; modulated white would brighten)
		x = blockX - 40;
		w = blockW + 80;
		gc.SetStyle(DSTY_Modulated);
		gc.DrawStretchedTexture(x + 16, 0, w - 32, height, 64, 0, 1, 8, Texture'UCFade');
		for (i = 0; i < 8; i++)
		{
			gc.DrawStretchedTexture(x + i * 2, 0, 2, height, (i + 1) * 8, 0, 1, 8, Texture'UCFade');
			gc.DrawStretchedTexture(x + w - (i + 1) * 2, 0, 2, height, (i + 1) * 8, 0, 1, 8, Texture'UCFade');
		}
	}
	align = HALIGN_Left;
	if (class'UCMenuLook'.default.Align == 1)
		align = HALIGN_Center;
	else if (class'UCMenuLook'.default.Align == 2)
		align = HALIGN_Right;
	if (logoTex != None)
	{
		w = class'UCMenuLook'.default.LogoW * class'UCMenuLook'.default.LogoScale;
		h = class'UCMenuLook'.default.LogoH * class'UCMenuLook'.default.LogoScale;
		x = blockX;
		if (align == HALIGN_Center)
			x = blockX + (blockW - w) / 2;
		else if (align == HALIGN_Right)
			x = blockX + blockW - w;
		gc.SetStyle(DSTY_Masked);
		gc.SetTileColorRGB(255, 255, 255);
		gc.DrawStretchedTexture(x, blockY, w, h, 0, 0, class'UCMenuLook'.default.LogoW,
			class'UCMenuLook'.default.LogoH, logoTex);
	}
	if (class'UCMenuLook'.default.Title != "")
	{
		gc.SetStyle(DSTY_Normal);
		gc.SetFont(FontOf(class'UCMenuLook'.default.TitleFont));
		gc.SetTextColor(class'UCMenuLook'.default.TitleColor);
		gc.SetAlignments(align, VALIGN_Top);
		gc.EnableWordWrap(False);
		gc.DrawText(blockX, blockY + logoH, blockW, titleH, class'UCMenuLook'.default.Title);
	}
	if (class'UCMenuLook'.default.Footer != "")
	{
		gc.SetFont(Font'DeusExUI.FontMenuSmall');
		gc.SetTextColorRGB(200, 200, 200);
		gc.SetAlignments(HALIGN_Right, VALIGN_Bottom);
		gc.GetTextExtent(0, tw, th, class'UCMenuLook'.default.Footer);
		gc.DrawText(0, height - th - 8, width - 10, th, class'UCMenuLook'.default.Footer);
	}
}

function bool ButtonActivated(Window buttonPressed)
{
	local int i;

	for (i = 0; i < numBtns; i++)
		if (buttonPressed == btns[i])
		{
			RunAction(btnAction[i], btnTarget[i]);
			return True;
		}
	return False;
}

function RunAction(byte action, string target)
{
	switch (action)
	{
		case 0:
			if (class'UCMenuLook'.default.bCharacterScreens || class'UCMenuLook'.default.StartMap == "")
				root.InvokeMenuScreen(Class'MenuSelectDifficulty');
			else
				Ask(action, target, !bAtMenu, LeavePrompt);
			break;
		case 1: root.InvokeMenuScreen(Class'MenuScreenLoadGame'); break;
		case 2: root.InvokeMenuScreen(Class'MenuScreenSaveGame'); break;
		case 3: root.InvokeMenu(Class'MenuSettings'); break;
		case 4: if (!bAtMenu) root.PopWindow(); break;
		case 5: Ask(action, class'UCMenuLook'.default.MenuMap, True, LeavePrompt); break;
		case 6: Ask(action, "", True, ExitPrompt); break;
		case 7: Ask(action, target, !bAtMenu, LeavePrompt); break;
	}
}

// a question first when it would end the game being played (or always, to exit), then Go
function Ask(byte action, string target, bool bAsk, string prompt)
{
	pendingAction = action;
	pendingTarget = target;
	if (!bAsk)
	{
		Go();
		return;
	}
	bAsking = True;
	root.MessageBox(PromptTitle, prompt, 0, False, Self);
}

// (in locals, the screens cleared last: clearing them destroys this window; the travel happens at the end of the frame)
function Go()
{
	local DeusExPlayer p;
	local DeusExRootWindow r;
	local string target;

	p = player;
	r = root;
	target = pendingTarget;
	switch (pendingAction)
	{
		case 0:
			class'UCNewGame'.static.ForgetLastGame(p);      // no states or counters of an earlier game
			p.StartNewGame(class'UCMenuLook'.default.StartMap);
			break;
		case 5:
			p.Level.Game.SendPlayer(p, target);
			r.ClearWindowStack();
			break;
		case 6: r.ExitGame(); break;
		case 7:
			if (target != "")
			{
				class'UCNewGame'.static.ForgetLastGame(p);
				p.StartNewGame(target);
			}
			break;
	}
}

event bool BoxOptionSelected(Window button, int buttonNumber)
{
	if (!bAsking)
		return Super.BoxOptionSelected(button, buttonNumber);
	bAsking = False;
	root.PopWindow();
	if (buttonNumber == 0)
		Go();
	return True;
}

// Esc goes back to the game, never off the title screen; Enter is the focused button's, not "close"
event bool VirtualKeyPressed(EInputKey key, bool bRepeat)
{
	if (key == IK_Escape)
	{
		if (!bAtMenu)
			CancelScreen();
		return True;
	}
	if (key == IK_Enter)
		return False;
	return Super(DeusExBaseWindow).VirtualKeyPressed(key, bRepeat);
}

event bool MouseButtonPressed(float pointX, float pointY, EInputKey button, int numClicks)
{
	return False;
}

defaultproperties
{
     ExitPrompt="Are you sure you|nwant to exit?"
     LeavePrompt="The game you are playing will be lost if you have not saved it. Go on?"
     PromptTitle="Please Confirm"
     bUsesHelpWindow=False
     bEscapeSavesSettings=False
     ScreenType=ST_Menu
}
