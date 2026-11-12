// A configured key reward, using the game's own keyring on Original and Revision.
// Conversation helpers belong to the level, so save/load preserves their IDs.
class UCKeyGrant extends Info;

var name KeyID;
var string KeyText;

static function bool Grant(DeusExPlayer player, name id, string description)
{
	if (player == None || player.KeyRing == None || id == '') return False;
	if (player.KeyRing.HasKey(id)) return True;
	if (description == "") description = "Key " $ string(id);
	player.KeyRing.GiveKey(id, description);
	player.ClientMessage("Key received: " $ description);
	return True;
}

function Trigger(Actor other, Pawn instigator)
{
	local DeusExPlayer player;
	player = DeusExPlayer(instigator);
	if (player == None) player = DeusExPlayer(other);
	if (player == None)
		foreach AllActors(class'DeusExPlayer', player)
			break;
	Grant(player, KeyID, KeyText);
}

defaultproperties
{
	bHidden=True
	bCollideActors=False
}
