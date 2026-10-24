//=============================================================================
// UCVoiceDriver - plays user dubs and referenced voices through the speaking
// character. Only indexed original lines lose their native soundID, in memory.
// Other original lines keep their audio. Playback tracking stores event names.
//=============================================================================
class UCVoiceDriver extends Actor
	transient;

var name lastEvent, lastPlayback, attemptedEvent;
var int attempts;
var float retryAt;
var float originalScan;
var name lastRadioEvent, lastRadioPlay;

// Only indexed user dubs are considered. Untouched native audio retains its soundID.
// Packages are read-only on disk; the index is rebuilt before Apply, with the game closed.
function PatchConversation(Conversation c)
{
	local ConEvent e;
	local ConEventSpeech line;
	local ConChoice choice;
	if (c == None || !class'UCVoiceDubs'.static.Any()) return;
	for (e=c.eventList; e!=None; e=e.nextEvent)
	{
		line=ConEventSpeech(e);
		if (line!=None && line.conSpeech!=None && line.conSpeech.soundID!=-1
			&& class'UCVoiceDubs'.static.Contains(class'UCVoice'.static.Key(line.speakerName $ "|" $ line.conSpeech.speech))
			&& class'UCVoice'.static.Dub(line.speakerName,line.conSpeech.speech)!=None)
		{
			line.conSpeech.soundID=-1;
			Log("UCVoice: original dub enabled" @ c.conName @ line.Name);
		}
		if (ConEventChoice(e)!=None)
			for (choice=ConEventChoice(e).ChoiceList; choice!=None; choice=choice.nextChoice)
				if (choice.soundID!=-1 && class'UCVoiceDubs'.static.Contains(class'UCVoice'.static.Key("JCDenton|" $ choice.choiceText))
					&& class'UCVoice'.static.Dub("JCDenton",choice.choiceText)!=None)
					choice.soundID=-1;
	}
}

function PatchBoundConversations()
{
	local Actor A;
	local ConListItem item;
	if (!class'UCVoiceDubs'.static.Any()) return;
	foreach AllActors(class'Actor',A)
		for (item=ConListItem(A.conListItems); item!=None; item=item.next)
			PatchConversation(item.con);
}

function RadioVoice(DeusExPlayer P)
{
	local DataLinkPlay radio;
	local ConEventSpeech line;
	local Sound snd;
	radio=P.dataLinkPlay;
	if (radio==None) { lastRadioPlay=''; lastRadioEvent=''; return; }
	PatchConversation(radio.con);
	if (lastRadioPlay!=radio.Name) { lastRadioPlay=radio.Name; lastRadioEvent=''; }
	line=ConEventSpeech(radio.currentEvent);
	if (line==None) { lastRadioEvent=''; return; }
	if (line.Name==lastRadioEvent || !radio.IsInState('WaitForSpeech') || radio.bSilent
		|| line.conSpeech==None || line.conSpeech.soundID!=-1) return;
	snd=class'UCVoiceBank'.static.Resolve(Self,line.speakerName,line.conSpeech.speech);
	if (snd==None) return;
	lastRadioEvent=line.Name;
	radio.StopSpeech();
	radio.playingSoundID=P.PlaySound(snd,SLOT_Talk,1.0,,65536.0);
	radio.SetTimer(GetSoundDuration(snd)+0.15,False);
	Log("UCVoice: radio playback" @ snd @ "handle=" $ radio.playingSoundID);
}

function bool OwnsDispatch()
{
	local UCVoiceDriver other;
	foreach AllActors(class'UCVoiceDriver', other)
		if (!other.bDeleteMe)
			return other == Self;
	return False;
}

function PostBeginPlay()
{
	Super.PostBeginPlay();
	if (!OwnsDispatch())
		Destroy();
}

event Tick(float deltaTime)
{
	local DeusExPlayer P;
	local ConEventSpeech ev;
	local Sound snd;
	local Actor spk;
	local float soundRadius;
	local int handle;

	// Save loading can leave orphan helpers from an earlier route manager.
	// Only the first live driver may touch the native speech channel.
	if (!OwnsDispatch())
	{
		Destroy();
		return;
	}

	P = DeusExPlayer(GetPlayerPawn());
	originalScan-=deltaTime;
	if (P!=None)
	{
		if (originalScan<=0) { originalScan=0.5; PatchBoundConversations(); }
		RadioVoice(P);
		if (P.conPlay!=None) PatchConversation(P.conPlay.con);
	}
	if (P == None || P.conPlay == None)
	{
		lastEvent = '';
		lastPlayback = '';
		attemptedEvent = '';
		return;
	}
	if (lastPlayback != P.conPlay.Name)
	{
		lastPlayback = P.conPlay.Name;
		lastEvent = '';
		attemptedEvent = '';
	}
	ev = ConEventSpeech(P.conPlay.currentEvent);
	if (ev == None)
	{
		lastEvent = '';
		return;
	}
	if (ev.Name == lastEvent)
		return;
	// Wait until ConPlay has set up the actors, the text and the camera.
	// currentEvent already exists while the scene turns its actors and gets ready.
	if (!P.conPlay.IsInState('WaitForText') && !P.conPlay.IsInState('WaitForInput')
		&& !P.conPlay.IsInState('WaitForSpeech'))
		return;

	if (ev.conSpeech == None || ev.conSpeech.soundID != -1)
		return;
	// Native BindEvents has already cached both actors by this ready state.
	// A temporary bark name must not break subsequent vanilla conversations.
	// a voice given to this line in the map editor first, then the generated one
	snd = class'UCVoiceBank'.static.Resolve(Self, ev.speakerName, ev.conSpeech.speech);
	if (snd == None)
		snd = class'UCVoice'.static.Find(ev.conSpeech.speech,
			class'UCVoice'.static.Profile(ev.speaker, ev.speakerName));
	if (snd == None)
	{
		lastEvent = ev.Name;
		return;
	}
	if (attemptedEvent != ev.Name)
	{
		attemptedEvent = ev.Name;
		attempts = 0;
		retryAt = 0;
	}
	if (Level.TimeSeconds < retryAt)
		return;

	spk = ev.speaker;
	if (spk == None)
		spk = P;
	// Match ConPlay.PlaySpeech: letterbox conversations stay close/audible;
	// a passive world bark retains the original distance falloff.
	if (P.conPlay.GetForcePlay() || P.conPlay.initialRadius == 0)
	{
		soundRadius = 65536.0;
		if (VSize(P.Location - spk.Location) > 400)
			spk = P;
	}
	else if (P.conPlay.con.bCannotBeInterrupted || !P.conPlay.con.bFirstPerson)
		soundRadius = 65536.0;
	else
		soundRadius = 512.0 + P.conPlay.initialRadius;
	// Store the handle in the native player: skipping/closing a line must
	// stop our voice too, as it does for the original dialogues.
	handle = spk.PlaySound(snd, SLOT_Talk, 1.0,, soundRadius);
	if (handle == 0)
	{
		attempts++;
		retryAt = Level.TimeSeconds + 0.05;
		if (attempts < 3)
			return;
		if (spk != P)
			handle = P.PlaySound(snd, SLOT_Talk, 1.0,, 65536.0);
		if (handle == 0)
			Log("UCVoice: could not start" @ snd @ "event=" $ ev.Name);
	}
	lastEvent = ev.Name;
	P.conPlay.playingSoundID = handle;
	Log("UCVoice: conversation playback" @ snd @ "speaker=" $ spk @ "handle=" $ P.conPlay.playingSoundID);
	P.conPlay.StartSpeakingAnimation();
	// The passive lines of soldiers/MIBs last as long as their audio, so that
	// the text-only timer does not start the next voice too early.
	if (P.conPlay.IsInState('WaitForText') || P.conPlay.IsInState('WaitForSpeech'))
		P.conPlay.SetTimer(GetSoundDuration(snd) + 0.15, False);
}

defaultproperties
{
     bHidden=True
	 bAlwaysTick=True
     bCollideActors=False
     bCollideWorld=False
}
