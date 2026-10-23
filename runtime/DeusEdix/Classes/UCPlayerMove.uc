//=============================================================================
// UCPlayerMove - how JC moves in this map, chosen in the map editor (the player start's Inspector, Player
// movement: editor/behaviours.py): his air control, and other values while an aug is on or a skill is high
// enough (Run Silent on: air control 0.75, jumps 1.3 times as high...).
// Values below 0 (and a jump of 1) leave the game's as they are.
//=============================================================================
class UCPlayerMove extends Info;

var() float AirControlNormal;
var() float AirControlIf;          // while the condition holds
var() float JumpIf;                // the jump times this while the condition holds
var() string AugName;              // an aug of the game (AugStealth): the condition is "it is on"
var() string SkillName;            // or a skill of the game (SkillSwimming) at least SkillLevel
var() int SkillLevel;              // 0 untrained, 1 trained, 2 advanced, 3 master

var class<Augmentation> AugClass;
var class<Skill> SkillClass;
var bool bOn, bLogged;

function PostBeginPlay()
{
	Super.PostBeginPlay();
	if (AugName != "")
		AugClass = class<Augmentation>(DynamicLoadObject("DeusEx." $ AugName, class'Class', True));
	if (SkillName != "")
		SkillClass = class<Skill>(DynamicLoadObject("DeusEx." $ SkillName, class'Class', True));
	SetTimer(0.2, True);
}

function bool Holds(DeusExPlayer P)
{
	if (AugClass != None && P.AugmentationSystem != None && P.AugmentationSystem.GetAugLevelValue(AugClass) >= 0)
		return True;
	if (SkillClass != None && P.SkillSystem != None && P.SkillSystem.GetSkillLevel(SkillClass) >= SkillLevel)
		return True;
	return False;
}

function Timer()
{
	local DeusExPlayer P;
	local bool now;

	P = DeusExPlayer(GetPlayerPawn());
	if (P == None)
		return;
	now = Holds(P);
	if (now && AirControlIf >= 0)
		P.AirControl = AirControlIf;
	else if (AirControlNormal >= 0)
		P.AirControl = AirControlNormal;
	else if (bOn && !now)
		P.AirControl = P.Default.AirControl;
	// the jump as a ratio, so an aug that changes it too (Speed Enhancement) keeps its part
	if (JumpIf > 0 && JumpIf != 1 && now != bOn)
	{
		if (now)
			P.JumpZ *= JumpIf;
		else
			P.JumpZ /= JumpIf;
	}
	if (now != bOn || !bLogged)
		Log("UCPlayerMove: " $ AugName $ SkillName $ " " $ now $ ", air control " $ P.AirControl $ ", JumpZ " $ P.JumpZ);
	bLogged = True;
	bOn = now;
}

defaultproperties
{
     AirControlNormal=-1.000000
     AirControlIf=-1.000000
     JumpIf=1.000000
     SkillLevel=1
     bHidden=True
}
