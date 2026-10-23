//=============================================================================
// UCCustomCarcass - the dead body of a Character Creator character. Its meshes are set by
// UCCustomLook.PrepareCarcass right before it is spawned, its clothes by DressCarcass.
// Picked up and put down, it is a new one of this class: JC keeps its look while he carries it
// (UCCorpseLook) and it gets it back.
//=============================================================================
class UCCustomCarcass extends DeusExCarcass;

var bool bFromPawn;     // spawned by a dying character (dressed by UCCustomLook.DressCarcass)
var bool bDressed;      // got back the look of the body JC put down

// keep the meshes and clothes it was given (no HDTP swap)
function bool Facelift(bool bOn)
{
	return false;
}

// picked up: the carried body (POVCorpse) keeps only this class, JC keeps its look
function bool AttemptPickup(Actor Frobber)
{
	local string look;

	look = class'UCCustomLook'.static.LookOf(self);
	if (!Super.AttemptPickup(Frobber))
		return false;
	class'UCCustomLook'.static.KeepLook(Pawn(Frobber), look);
	return true;
}

// put down (DeusExPlayer.DropItem spawns a new one): the look it had
function PostBeginPlay()
{
	Super.PostBeginPlay();
	if (!bFromPawn && !bDressed)
		bDressed = class'UCCustomLook'.static.DressDropped(self);
}

defaultproperties
{
	Mesh=LodMesh'DeusExCharacters.GM_DressShirt_F_Carcass'
	Mesh2=LodMesh'DeusExCharacters.GM_DressShirt_F_CarcassB'
	Mesh3=LodMesh'DeusExCharacters.GM_DressShirt_F_CarcassC'
}
