//=============================================================================
// UCDoorMover - a door that opens away from whoever opens it (the Inspector's Opens: "Away from who opens it").
// The game's doors turn one fixed way, their KeyRot(1), chosen in the map: from the other side such a door swings
// into the player. Each time this one starts opening from shut, of its own swing and its mirror image it takes the
// one that leaves it farther from the pawn that opened it (Instigator: the player's or a character's Frob, or the
// pawn behind a button or a rule). Opened by nobody it keeps the way it last took. A door that slides does as before.
// The mirror image turns about the other face of the door (the editor works it out: MirrorHinge, MirrorPrePivot), so
// it lies against the other face of the wall instead of going into the jamb; shut, the door stays where it is.
// It never turns into a wall: the editor writes the room each way needs (lines through the door's thickness, at a
// third, two thirds and most of its turn); the first time it opens, the level's geometry is traced along them, and a
// way without room is not taken while the other has it (a door between a room and a narrow alley).
//=============================================================================
class UCDoorMover extends DeusExMover;

var vector MirrorHinge;         // how far the hinge goes for the mirror image (world, the door shut)
var vector MirrorPrePivot;      // and the PrePivot, so the door stays where it is
var vector MirrorKeyPos;        // KeyPos(1) of the mirror image
var vector BuiltMiddle;         // where the door's middle ends, open its own way
var vector MirrorMiddle;        // and open the other way
var rotator BuiltTurn;          // KeyRot(1) as the map has it
var vector BuiltKeyPos;
var bool bBuiltTurnKnown;
var bool bMirrored;             // turning about the other hinge now
var vector BuiltRoomFrom[10], BuiltRoomTo[10];     // the room it needs to open its own way (world, a line each)
var vector MirrorRoomFrom[10], MirrorRoomTo[10];   // and the other way
var bool bRoomKnown, bBuiltRoom, bMirrorRoom;

function DoOpen()
{
	// only from shut: a door turned back while it closes goes back the way it came
	if (!bInterpolating && KeyNum == 0)
		TurnAwayFrom(Instigator);
	Super.DoOpen();
}

function TurnAwayFrom(Actor Who)
{
	local vector A, B;

	if (!bBuiltTurnKnown)
	{
		BuiltTurn = KeyRot[1];
		BuiltKeyPos = KeyPos[1];
		bBuiltTurnKnown = True;
	}
	if (BuiltTurn.Yaw == 0 || BuiltMiddle == MirrorMiddle)
		return;
	if (!bRoomKnown)
	{
		bBuiltRoom = HasRoom(False);
		bMirrorRoom = HasRoom(True);
		bRoomKnown = True;
	}
	if (bBuiltRoom != bMirrorRoom)
	{
		UseMirror(bMirrorRoom);       // only one way has room: that one, from either side
		return;
	}
	if (Who == None)
		return;                       // opened by nobody: the way it last took
	A = BuiltMiddle - Who.Location;
	B = MirrorMiddle - Who.Location;
	A.Z = 0;
	B.Z = 0;
	UseMirror(VSize(B) > VSize(A) + 1);
}

// No wall (the level's geometry) across the lines of that way. A door the editor wrote no lines for has room.
function bool HasRoom(bool bOther)
{
	local int i;
	local vector A, B;

	for (i = 0; i < ArrayCount(BuiltRoomFrom); i++)
	{
		if (bOther)
		{
			A = MirrorRoomFrom[i];
			B = MirrorRoomTo[i];
		}
		else
		{
			A = BuiltRoomFrom[i];
			B = BuiltRoomTo[i];
		}
		if (A != B && !FastTrace(B, A))
			return False;
	}
	return True;
}

function UseMirror(bool bOther)
{
	local vector Shift, Pre;

	if (bOther != bMirrored)
	{
		Shift = MirrorHinge;
		Pre = MirrorPrePivot;
		if (!bOther)
		{
			Shift = -Shift;
			Pre = -Pre;
		}
		PrePivot += Pre;
		BasePos += Shift;
		SetLocation(Location + Shift);
		bMirrored = bOther;
	}
	KeyRot[1] = BuiltTurn;
	KeyPos[1] = BuiltKeyPos;
	if (bOther)
	{
		KeyRot[1].Yaw = -BuiltTurn.Yaw;
		KeyPos[1] = MirrorKeyPos;
	}
}

defaultproperties
{
	MoverEncroachType=ME_IgnoreWhenEncroach
}
