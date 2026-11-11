//=============================================================================
// UCMenuButton - a button of the project's main menu (UCMainMenu): the game's main menu button (its bar,
// its light, its sounds) or only its text, in the colours of UCMenuLook, brighter under the mouse.
//=============================================================================
class UCMenuButton extends MenuUIMenuButtonWindow;

var bool bTextOnly;
var byte textAlign;            // 0 left, 1 centre, 2 right (UCMenuLook.Align)

function Setup(string label, bool bText, Font f, byte align)
{
	bTextOnly = bText;
	textAlign = align;
	if (f != None)
		fontButtonText = f;
	SetButtonText(label);
}

event DrawWindow(GC gc)
{
	if (!bTextOnly)
	{
		Super.DrawWindow(gc);
		return;
	}
	SetButtonMetrics();
	gc.SetFont(fontButtonText);
	switch (textColorIndex)
	{
		case 1:
		case 2:  gc.SetTextColor(class'UCMenuLook'.default.HoverColor); break;
		case 3:  gc.SetTextColor(class'UCMenuLook'.default.DisabledColor); break;
		default: gc.SetTextColor(class'UCMenuLook'.default.TextColor);
	}
	gc.EnableTranslucentText(False);
	gc.SetVerticalAlignment(VALIGN_Center);
	if (textAlign == 1)
		gc.SetHorizontalAlignment(HALIGN_Center);
	else if (textAlign == 2)
		gc.SetHorizontalAlignment(HALIGN_Right);
	else
		gc.SetHorizontalAlignment(HALIGN_Left);
	gc.DrawText(textOffset, textOffset, width, height, buttonText);
}

defaultproperties
{
}
