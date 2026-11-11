//=============================================================================
// UCEdInfoLink - an InfoLink written in the map editor (Story panel). One-way, as the editor's
// rule wants: only the caller speaks, JC never answers by radio. Made by UCEditorStory.InfoLink
// (the generated story fills the lines right after spawning it). It waits for conversations
// and for another InfoLink of the editor to finish. As in the game, the whole text goes to the
// conversation history at the start (UCScene.InfoStart): an InfoLink cut by a level change
// counts as heard.
//=============================================================================
class UCEdInfoLink extends UCScene;

var string caller;          // portrait: InfoPortraits.<caller> (WaltonSimons, AlexJacobson...)
var string callerName;      // the name shown above the text
var string lines[32];
var int numLines;
var int n;
var float d;
var bool bPlaying;
var bool bQuickStart;   // Tutorial room guidance: the latest room replaces the previous one.
var name EndTag;         // the rules "When the InfoLink ... has been heard" (UCI_<id>, P5): triggered at its end


// Defaults belong to this project; overrides belong only to this call.
var bool bCustomStyle, bStyleBackground, bStyleText;
var byte StyleFont, StyleSize;
var Color StyleBackground, StyleText;

function PostBeginPlay()
{
    Super.PostBeginPlay();
    bCustomStyle=class'UCInfoLinkStyle'.default.bCustomStyle;
    StyleFont=class'UCInfoLinkStyle'.default.StyleFont;
    StyleSize=class'UCInfoLinkStyle'.default.StyleSize;
    bStyleBackground=class'UCInfoLinkStyle'.default.bStyleBackground;
    StyleBackground=class'UCInfoLinkStyle'.default.StyleBackground;
    bStyleText=class'UCInfoLinkStyle'.default.bStyleText;
    StyleText=class'UCInfoLinkStyle'.default.StyleText;
}

function InfoStart(string ownerBind)
{
    local DeusExPlayer P;
    local DeusExRootWindow root;
    local UCInfoLinkWindow win;
    P=Plr();
    if (P!=None) root=DeusExRootWindow(P.rootWindow);
    if (root!=None && root.hud!=None)
    {
        if (bCustomStyle)
        {
            root.hud.DestroyInfoLinkWindow();
            win=UCInfoLinkWindow(root.hud.NewChild(class'UCInfoLinkWindow'));
            root.hud.infolink=win;
            if (win!=None)
            {
                if (root.hud.msgLog!=None) root.hud.msgLog.Hide();
                win.ApplyAppearance(StyleFont,StyleSize,bStyleBackground,StyleBackground,bStyleText,StyleText);
            }
        }
        else if (UCInfoLinkWindow(root.hud.infolink)!=None)
            root.hud.DestroyInfoLinkWindow();
    }
    Super.InfoStart(ownerBind);
}

function CancelGuidance()
{
	StopInfoVoice();
	if (bPlaying)
		HideInfo(True);
	bPlaying = False;
	GotoState('');        // Cancel a latent Sleep and all remaining lines, including queued calls.
	Destroy();
}

function AddLine(string s)
{
	if (s == "" || numLines >= ArrayCount(lines))
		return;
	lines[numLines] = s;
	numLines++;
}

function string DisplayName(string bindName)
{
	if (bindName == caller && callerName != "")
		return callerName;
	return Super.DisplayName(bindName);
}

function float InfoLine(int i)
{
	if (i < numLines)
		return Say(caller, lines[i]);
	return -1;
}

// heard to its end (one cut short by a level change or replaced by newer guidance is not): the rules waiting for it
// run. (Not "Heard": that function would give the game's name heard, the rules' When, that spelling in the log.)
function TellHeard()
{
	local Actor A;
	local UCEditorStory S;

	if (EndTag == '')
		return;
	foreach AllActors(class'UCEditorStory', S)       // for the rules waiting for it (UCLink "Wait until")
		S.Seen(EndTag, Level.TimeSeconds);
	foreach AllActors(class'Actor', A, EndTag)
		A.Trigger(Self, Plr());
}

function bool OtherPlaying()
{
	local UCEdInfoLink other;

	foreach AllActors(class'UCEdInfoLink', other)
		if (other != Self && !other.bDeleteMe && other.bPlaying)
			return True;
	return False;
}

state Playing
{
Begin:
	// never over a conversation or another InfoLink
	if (Plr() == None || Talking() || OtherPlaying())
	{
		Sleep(0.5);
		Goto('Begin');
	}
	bPlaying = True;
	if (!bQuickStart)
		Sleep(0.5);
	Log("UCEd: InfoLink from" @ caller @ "(" $ numLines @ "lines)");
	InfoStart(caller);
	if (!bQuickStart)
		Sleep(1.5);
	n = 0;
Next:
	d = InfoLine(n);
	if (d >= 0)
	{
		Sleep(d);
		bInfoVoiceActive = False;
		n++;
		Goto('Next');
	}
	HideInfo();
	bPlaying = False;
	TellHeard();
	Destroy();
}

defaultproperties
{
	bHushTalks=True
}
