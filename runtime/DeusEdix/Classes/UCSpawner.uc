//=============================================================================
// UCSpawner - reinforcements a rule sends (UCLink spawn): characters of a class appear at a place, all at once, as
// soon as the player cannot see it (looked at every half second), in a circle round it. They take the rule's tag
// (UCObjectTag: rules acting on "objects tagged ..." reach them) and, with Attack, go for the player. Saved with the
// game while it waits.
//=============================================================================
class UCSpawner extends Info;

var string Cls, GroupTag, Rule;
var int Count;
var vector Spot;
var bool bAttack;
var UCLink By;

static function bool Queue(UCLink By, string cls, int n, string tag, vector spot, bool bAttack, string rule)
{
	local UCSpawner S;
	local class<ScriptedPawn> C;

	C = class<ScriptedPawn>(DynamicLoadObject(cls, class'Class', True));
	if (C == None)
	{
		By.Report("fail", "spawn|" $ cls $ "|missing");
		return True;
	}
	S = By.Spawn(class'UCSpawner',,, spot);
	if (S == None)
		return False;
	S.Cls = cls;
	S.Count = n;
	S.GroupTag = tag;
	S.Spot = spot;
	S.bAttack = bAttack;
	S.Rule = rule;
	S.By = By;
	S.SetTimer(0.5, True);
	S.Timer();
	return True;
}

function Timer()
{
	local DeusExPlayer P;
	local class<ScriptedPawn> C;
	local ScriptedPawn sp;
	local int i, made;
	local vector at;

	P = DeusExPlayer(GetPlayerPawn());
	if (P == None)
		return;
	if (FastTrace(Spot, P.Location + vect(0,0,1) * P.BaseEyeHeight))
		return;                                         // the player could see it: later
	C = class<ScriptedPawn>(DynamicLoadObject(Cls, class'Class', True));
	for (i = 0; i < Count && C != None; i++)
	{
		at = Spot;
		if (Count > 1)
			at += (vect(1,0,0) * Cos(i * 6.2832 / Count) + vect(0,1,0) * Sin(i * 6.2832 / Count)) * 72;
		sp = Spawn(C,,, at);
		if (sp == None)
			sp = Spawn(C,,, Spot + vect(0,0,8) * (i + 1));
		if (sp == None)
			continue;
		made++;
		if (GroupTag != "")
			sp.Tag = StringToTag(GroupTag);
		// SetOrders('Attacking') needs the tag of the one to attack (ScriptedPawn.SetOrders), so as the game does it
		// there: the player an enemy of theirs, and after him at once. Their weapons first: a new character gets them
		// in its first look (state StartUp, InitializePawn), which a state set now would skip (unarmed, it fled)
		if (bAttack)
		{
			sp.InitializePawn();
			sp.ReactionLevel = 1.0;
			sp.ChangeAlly(P.Alliance, -1, True);
			if (sp.SetEnemy(P, 0, True))
				sp.SetState('Attacking');
		}
	}
	class'UCEditorStory'.static.LogicLine("act|" $ MapTitle() $ "|" $ Rule $ "|spawned|" $ GroupTag $ "|" $ made);
	Destroy();
}

function name StringToTag(string s)
{
	local DeusExPlayer P;

	P = DeusExPlayer(GetPlayerPawn());
	if (P != None && P.rootWindow != None)
		return P.rootWindow.StringToName(s);
	return '';
}

function string MapTitle()
{
	local DeusExLevelInfo info;

	foreach AllActors(class'DeusExLevelInfo', info)
		return info.mapName;
	return "";
}

defaultproperties
{
     bHidden=True
}
