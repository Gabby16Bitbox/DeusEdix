//=============================================================================
// UCScene - the base of every scene (scripted event) of the UNATCO route.
//
// A scene is an Actor with a "Playing" state written as a sequence
// (Sleep, Say, FireTag...). RULE: no pointer to the Player/flags/windows
// may stay in member variables: every helper gets them, uses them and lets them go
// (otherwise a map change crashes the engine).
//=============================================================================
class UCScene extends Actor
	abstract
	transient;

var bool bHistoryOnly;   // Say() writes only to the history (see InfoStart)
var bool bHushTalks;     // no talking with people while its InfoLinks play (UCTalkHush, from InfoStart)
var int infoVoiceId;     // Own channel only: cancelling a tutorial must not stop another speaker.
var bool bInfoVoiceActive;
var name openedDoors[16];  // doors already opened by the scene's NPCs (OpenDoorsNear)
var int numOpened;

function DeusExPlayer Plr()
{
	return DeusExPlayer(GetPlayerPawn());
}

// Closed doors in front of an NPC of the scene open (once, and they stay open):
// locked ones too, which an NPC cannot open and in front of which it used to get stuck.
// The doors of Paul's apartment in the map are not marked as doors (bIsDoor):
// to the NPCs' AI they were walls, and Gunther stayed in front of the door (tried with the automatic
// photos). Here every mover "to be opened" counts: not the windows (glass, not frobbable)
// nor the secret passages (not frobbable). It is also marked as a door, so the game's
// AI handles it by itself if it shuts again. Opening early (a wide radius) also helps
// when they go through one after another: each one frobbed the door (open/close), it swung
// into them, and they kept pushing and backing off in front of the 'Ton's main door.
function OpenDoorsNear(ScriptedPawn sp, float radius)
{
	local DeusExMover m;
	local int i;
	local bool bDone;

	if (sp == None || !sp.bInWorld)
		return;
	foreach sp.RadiusActors(class'DeusExMover', m, radius)
	{
		if (!m.bFrobbable || m.bDestroyed || m.NumKeys < 2 || m.FragmentClass == class'GlassFragment')
			continue;
		m.bIsDoor = True;
		if (m.KeyNum != 0 || m.bInterpolating || numOpened >= ArrayCount(openedDoors))
			continue;
		bDone = False;
		for (i = 0; i < numOpened; i++)
			if (openedDoors[i] == m.Name)
				bDone = True;
		if (bDone)
			continue;
		openedDoors[numOpened] = m.Name;
		numOpened++;
		m.bLocked = False;
		// as the NPCs do it (ScriptedPawn.FrobDoor): an NPC opens any door with Frob
		m.Frob(sp, None);
	}
}

// True if JC is looking at the actor: in his field of view (about 60 degrees from the centre) and
// with no walls in between. Rule of the scenes: an NPC moves or vanishes ONLY when
// JC cannot see it (it first stops at a visible spot that makes sense).
function bool SeenByJC(Actor A)
{
	local DeusExPlayer P;
	local vector d;

	P = Plr();
	if (P == None || A == None)
		return False;
	d = A.Location - (P.Location + vect(0,0,1) * P.BaseEyeHeight);
	if (VSize(d) > 4000)
		return False;
	if ((Normal(d) dot vector(P.ViewRotation)) < 0.5)
		return False;
	return P.LineOfSightTo(A);
}

// Anna Navarre died on the 747 (mission 3). AnnaNavarre_Dead alone is not enough:
// M03PlayerKilledAnna is set by Alex's InfoLink (DL_AlexShocked) when Anna dies
// there, and it is the flag the original game uses for the suspicion of Manderley and
// Gunther. A death somewhere else does not turn on the "Anna died on the 747" variants.
function bool Anna747()
{
	return GetF('AnnaNavarre_Dead') && GetF('M03PlayerKilledAnna');
}

// True while the player is in a conversation (wait for it to end).
function bool Talking()
{
	local DeusExPlayer P;

	P = Plr();
	return (P != None && P.conPlay != None);
}

function SetF(Name flagName, bool value)
{
	local DeusExPlayer P;

	P = Plr();
	if (P != None && P.FlagBase != None)
		P.FlagBase.SetBool(flagName, value,, 99);
}

function bool GetF(Name flagName)
{
	local DeusExPlayer P;

	P = Plr();
	if (P != None && P.FlagBase != None)
		return P.FlagBase.GetBool(flagName);
	return False;
}

function string DisplayName(string bindName)
{
	switch (bindName)
	{
		case "AlexJacobson":   return "Alex Jacobson";
		case "AnnaNavarre":    return "Anna Navarre";
		case "GuntherHermann": return "Gunther Hermann";
		case "JCDenton":       return "JC Denton";
		case "JosephManderley":return "Joseph Manderley";
		case "PaulDenton":     return "Paul Denton";
		case "WaltonSimons":   return "Walton Simons";
	}
	return bindName;
}

// Shows a line in the InfoLink window. Returns how many seconds to keep it.
function float Say(string bindName, string text)
{
	local DeusExPlayer P;
	local DeusExRootWindow root;
	local HUDInfoLinkDisplay win;
	local Sound snd;
	local Texture face;

	P = Plr();
	if (P == None)
		return 0;
	if (bHistoryOnly)
	{
		AddInfoHistory(P, bindName, text);
		return 0;
	}

	root = DeusExRootWindow(P.rootWindow);
	if (root == None || root.hud == None)
		return 0;

	win = root.hud.infolink;
	if (win == None)
		win = root.hud.CreateInfoLinkWindow();
	if (win == None)
		return 0;

	class'UCInfoLinkFX'.static.Speaking(Self);     // the "incoming transmission" is over
	win.SetSpeaker(bindName, DisplayName(bindName));
	face = class'UCPortraits'.static.Find(bindName);    // a character of the mod (tools\make_portrait.py)
	if (face != None)
		win.speakerPortrait = face;
	win.ShowPortrait();
	win.ClearScreen();
	win.DisplayText(text);

	// a recorded voice (if there is one): the line lasts as long as the audio
	snd = class'UCVoiceBank'.static.Resolve(Self, bindName, text); // a user dub or original voice reference
	if (snd == None)
		snd = class'UCVoice'.static.Find(text, bindName, bindName != "JCDenton");
	if (snd != None)
	{
		if (!(bindName ~= "EliasHale") || Level.Game.ParseOption(Level.GetLocalURL(), "DeusEdixHaleMuted") != "1")
		{
			infoVoiceId = P.PlaySound(snd, SLOT_Talk, 1.0);
			bInfoVoiceActive = True;
		}
		Log("UCVoice: InfoLink playback" @ snd @ "speaker=" $ bindName);
		return GetSoundDuration(snd) + 0.5;
	}
	return 2.0 + Len(text) * 0.045;
}

// The end of the InfoLink: "END TRANSMISSION..." blinks for a second and the window closes, as in the
// game (UCInfoLinkFX). bCut: closed at once (a call cut short).
function StopInfoVoice()
{
	local DeusExPlayer P;

	P = Plr();
	if (bInfoVoiceActive && P != None)
		P.StopSound(infoVoiceId);
	bInfoVoiceActive = False;
}

function HideInfo(optional bool bCut)
{
	local DeusExPlayer P;
	local DeusExRootWindow root;

	P = Plr();
	if (P == None)
		return;
	root = DeusExRootWindow(P.rootWindow);
	if (root == None || root.hud == None)
		return;
	if (bCut)
	{
		class'UCInfoLinkFX'.static.Speaking(Self);
		root.hud.DestroyInfoLinkWindow();
	}
	else
		class'UCInfoLinkFX'.static.Close(Self);
}

function GoalNew(Name goalName, string text)
{
	local DeusExPlayer P;

	P = Plr();
	if (P != None)
		P.GoalAdd(goalName, text, True);
}

function GoalDone(Name goalName)
{
	local DeusExPlayer P;

	P = Plr();
	if (P != None)
		P.GoalCompleted(goalName);
}

function Msg(string text)
{
	local DeusExPlayer P;

	P = Plr();
	if (P != None)
		P.ClientMessage(text);
}

// Triggers every actor of the map with that Tag. Returns how many there are.
function int FireTag(Name tagName)
{
	local Actor A;
	local int n;

	foreach AllActors(class'Actor', A, tagName)
	{
		A.Trigger(Self, Plr());
		n++;
	}
	Log("DeusEdix: FireTag" @ tagName @ "->" @ n);
	return n;
}

// Writes to the log who has that Tag (to understand what the vanilla events do).
function DumpTag(Name tagName)
{
	local Actor A;

	foreach AllActors(class'Actor', A, tagName)
		Log("DeusEdix: tag" @ tagName @ ":" @ string(A.Class) @ "@" @ int(A.Location.X) $ "," $ int(A.Location.Y) $ "," $ int(A.Location.Z) @ "event:" @ A.Event);
}

// Starts a conversation built with UCCon with the character npc.
// The native mode includes cameras, input lock and conversation music.
// bForcePlay is kept for the ending/intro: it skips all of these systems.
function bool PlayConv(UCCon c, Actor npc)
{
	local DeusExPlayer P;

	P = Plr();
	if (P == None || npc == None || c == None)
		return False;
	// StartConversation checks ConListItems even when passed an explicit con.
	c.AttachTo(npc);
	return P.StartConversation(npc, IM_Other, c.con, False, False);
}

// As PlayConv, but the NPC does not enter the conversation state: it goes on doing
// what it was doing (walking) while it talks.
// NOTE on "overheard" conversations (first person, UCCon.Passive): the game cuts them
// as soon as JC is more than 300 units from who started them, unless they have a radius
// (DeusExPlayer.CheckActiveConversationRadius): always give them a wide UCCon.Radius(...).
// And it does not start them if two NPCs talking to each other are more than 300 units
// apart (Conversation.CheckActorDistances): if they are far apart, the lines must be
// "spoken to" JCDenton, who is left out of that check.
function bool PlayConvMoving(UCCon c, Actor npc)
{
	local DeusExPlayer P;

	P = Plr();
	if (P == None || npc == None || c == None)
		return False;
	c.AttachTo(npc);
	return P.StartConversation(npc, IM_Other, c.con, True, False);
}

// Whoever says (or listens to) a line is put by the game in the conversation state
// until the end of the exchange: it stands still, turned towards the one it talks with
// (ConPlayBase.AddConActor). For one who must keep going while talking: if it stands still in
// the given conversation, it is sent walking towards its goal again. Call it on
// every round of the scene while the conversation lasts.
function KeepWalking(ScriptedPawn sp, name conName)
{
	local DeusExPlayer P;

	P = Plr();
	if (sp == None || P == None || P.conPlay == None || P.conPlay.con == None || P.conPlay.con.conName != conName)
		return;
	if (sp.IsInState('FirstPersonConversation') && sp.OrderActor != None)
	{
		sp.bConversationEndedNormally = True;   // else leaving the state cancels the exchange
		sp.GotoState('GoingTo');
	}
}

// The InfoLink's "incoming transmission" sound.
function InfoSound()
{
	local DeusExPlayer P;

	P = Plr();
	if (P != None)
		P.PlaySound(Sound'DeusExSounds.UserInterface.DataLinkStart', SLOT_None);
}

// --- One-way InfoLink ---------------------------------------------------------
// The InfoLink's lines, one per index (0, 1, 2...; -1 = finished, 0 = skipped).
// The scenes with an InfoLink override it.
function float InfoLine(int i)
{
	return -1;
}

// The start of an InfoLink: as in the game (DataLinkPlay) the window opens on "INCOMING
// TRANSMISSION..." with the DataLink icon blinking for 1.5 s (UCInfoLinkFX): the caller
// waits 1.5 s before the first line. The scenes are transient: if JC changes map halfway, the scene
// is gone. As the original game does (DeusExPlayer.PreTravel ->
// DataLinkPlay.AbortAndSaveHistory) the InfoLink then counts as heard: the caller
// sets its "done" flag and applies its effects BEFORE InfoStart, and here the whole
// text (InfoLine 0, 1, 2...) goes at once into the conversation history (Log).
// So it is not repeated, and it can be read again.
function InfoStart(string ownerBind)
{
	local DeusExPlayer P;
	local ConHistory h;
	local DeusExLevelInfo info;
	local int i;

	InfoSound();
	class'UCInfoLinkFX'.static.Open(Self);
	if (bHushTalks)
		class'UCTalkHush'.static.Hold(Self);
	P = Plr();
	if (P == None)
		return;
	h = P.CreateHistoryObject();
	if (h == None)
		return;
	h.conOwnerName = DisplayName(ownerBind);
	foreach AllActors(class'DeusExLevelInfo', info)
	{
		h.strLocation = info.MissionLocation;
		break;
	}
	h.strDescription = "";
	h.bInfoLink = True;
	h.firstEvent = None;
	h.lastEvent = None;
	h.next = P.conHistory;
	P.conHistory = h;
	bHistoryOnly = True;
	for (i = 0; i < 64; i++)
		if (InfoLine(i) < 0)
			break;
	bHistoryOnly = False;
}

function AddInfoHistory(DeusExPlayer P, string bindName, string text)
{
	local ConHistoryEvent ev;

	if (P.conHistory == None || text == "")
		return;
	ev = P.CreateHistoryEvent();
	if (ev == None)
		return;
	ev.conSpeaker = DisplayName(bindName);
	ev.speech = text;
	ev.soundID = -1;
	ev.next = None;
	P.conHistory.AddEvent(ev);
}

// Large typewriter text (like the start of a mission in Deus Ex).
function TitleCard(string line1, optional string line2, optional string line3)
{
	local DeusExPlayer P;
	local DeusExRootWindow root;

	P = Plr();
	if (P == None)
		return;
	root = DeusExRootWindow(P.rootWindow);
	if (root == None || root.hud == None || root.hud.startDisplay == None)
		return;

	root.hud.startDisplay.message = "";
	root.hud.startDisplay.charIndex = 0;
	root.hud.startDisplay.AddMessage(line1);
	root.hud.startDisplay.AddMessage(line2);
	root.hud.startDisplay.AddMessage(line3);
	root.hud.startDisplay.StartMessage();
}

function BlackHelicopter FindHeli()
{
	local BlackHelicopter heli;

	foreach AllActors(class'BlackHelicopter', heli)
		return heli;
	return None;
}

function UCCam FindCam()
{
	local UCCam cam;

	foreach AllActors(class'UCCam', cam)
		if (cam.Owner == Self && !cam.bDeleteMe)
			return cam;
	return None;
}

// Cutscene: the view becomes cam, the player vanishes and does not move.
function CutsceneStart(vector camPos, Actor lookAt)
{
	local DeusExPlayer P;
	local DeusExRootWindow root;
	local UCCam cam;

	P = Plr();
	if (P == None)
		return;

	cam = Spawn(class'UCCam', Self,, camPos);
	if (cam != None && lookAt != None)
		cam.SetShot(camPos, lookAt.Location + vect(0,0,20));

	P.Velocity = vect(0,0,0);
	P.Acceleration = vect(0,0,0);
	P.SetPhysics(PHYS_None);
	P.SetCollision(False, False, False);
	P.bHidden = True;
	P.ViewTarget = cam;
	P.bBehindView = True;
	if (cam != None)
		cam.ApplyView(P);

	root = DeusExRootWindow(P.rootWindow);
	if (root != None && root.hud != None)
		root.hud.Hide();
}

// The camera follows the actor every frame (UCCam.Track): calling it once is enough, the
// repeated calls from the scenes' loops change nothing.
function CamLookAt(Actor lookAt)
{
	local UCCam cam;

	cam = FindCam();
	if (cam != None && lookAt != None && cam.trackActor != lookAt)
		cam.Track(lookAt, vect(0,0,20));
}

// Puts everything back as it was (call it BEFORE changing map).
function CutsceneEnd()
{
	local DeusExPlayer P;
	local DeusExRootWindow root;
	local UCCam cam;

	P = Plr();
	if (P != None)
	{
		P.ViewTarget = None;
		P.bBehindView = False;
		P.bHidden = False;
		P.SetCollision(True, True, True);
		P.SetPhysics(PHYS_Walking);
		root = DeusExRootWindow(P.rootWindow);
		if (root != None && root.hud != None)
			root.hud.Show();
	}
	cam = FindCam();
	if (cam != None)
		cam.Destroy();
}

// Changes map, taking the player to a given spot.
function TravelTo(string mapName, int arrival)
{
	local DeusExPlayer P;

	P = Plr();
	if (P == None)
		return;
	P.FlagBase.SetInt('UC_DbgArrival', arrival,, 99);
	Level.Game.SendPlayer(P, mapName);
}

// The subclasses override this state with their sequence.
state Playing
{
Begin:
	Destroy();
}

// NB: the initial state must be given with InitialState: a GotoState() in PostBeginPlay
// would be undone by the engine (SetInitialState is called afterwards).
defaultproperties
{
     bHidden=True
     InitialState=Playing
}
