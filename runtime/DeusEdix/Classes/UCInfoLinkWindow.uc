// A call-local window: fonts and colors never modify the game's HUD class defaults.
class UCInfoLinkWindow extends HUDInfoLinkDisplay;

var bool bFlatBackground;

function ApplyAppearance(byte family, byte textSize, bool bBackground, Color background, bool bText, Color ink)
{
    local int cw, ch, cols, rows;
    if (family==0)
    {
        fontText=Font'DeusExUI.FontFixedWidthSmall_DS'; cw=7; ch=12;
        if (textSize==1) { fontText=Font'DeusExUI.FontComputer8x20_A'; cw=8; ch=20; }
    }
    else if (family==1)
    {
        fontText=Font'DeusExUI.FontConversation'; cw=11; ch=18;
        if (textSize==1) { fontText=Font'DeusExUI.FontConversationLarge'; cw=16; ch=24; }
    }
    else
    {
        fontText=Font'DeusExUI.FontConversationBold'; cw=11; ch=18;
        if (textSize==1) { fontText=Font'DeusExUI.FontConversationLargeBold'; cw=16; ch=24; }
    }
    fontTextX=cw; fontTextY=ch;
    bFlatBackground=bBackground;
    if (bBackground) colBackground=background;
    if (bText)
    {
        colText=ink; colName=ink; colQueued=ink; colCursor=ink;
        winName.SetTextColor(ink);
        winQueued.SetTextColor(ink);
    }
    // The terminal scrolls within these six rows. The text, its clipping window,
    // the panel mask and its frame must all use the same dimensions.
    cols=292/cw; rows=6;
    winText.SetTextFont(fontText,cw,ch,colText);
    winText.SetTextSize(cols,rows);
    winText.SetSize(cols*cw,rows*ch);
    winText.SetTextWindowPosition(0,0);
    if (winText.textWindow!=None) winText.textWindow.SetSize(cols*cw,rows*ch);
    winText.EnableWordWrap(True);
    winText.SetCursorColor(colCursor);
    SetSize(431,36+ch*rows+18);
    AskParentForReconfigure();
}

// The original artwork occupies 114 pixels of each 128-pixel texture. DrawTexture
// with a larger height samples past it; it does not stretch the frame. Preserve
// the rounded top/bottom caps and extend only the straight middle of both layers.
function DrawPanelSlice(GC gc, Texture tex, float x, float w)
{
    gc.DrawTexture(x,0,w,16,0,0,tex);
    gc.DrawStretchedTexture(x,16,w,height-32,0,16,w,82,tex);
    gc.DrawTexture(x,height-16,w,16,0,98,tex);
}

function DrawBackground(GC gc)
{
    gc.SetStyle(backgroundDrawStyle);
    if (bFlatBackground) gc.SetStyle(DSTY_Masked);
    gc.SetTileColor(colBackground);
    DrawPanelSlice(gc,texBackgrounds[0],0,256);
    DrawPanelSlice(gc,texBackgrounds[1],256,175);
}

function DrawBorder(GC gc)
{
    if (!bDrawBorder) return;
    gc.SetStyle(borderDrawStyle);
    gc.SetTileColor(colBorder);
    DrawPanelSlice(gc,texBorders[0],0,256);
    DrawPanelSlice(gc,texBorders[1],256,175);
}
