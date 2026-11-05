//=============================================================================
// UCOrdersMemory - the orders a character had from the map (Orders, OrderTag), kept before a rule changes them, for
// the rules' "Back to its own orders" (UCLink ownorders). One for each such character, saved with the game.
//=============================================================================
class UCOrdersMemory extends Info;

var name Who;
var name Orders;
var name OrderTag;

static function Keep(ScriptedPawn sp)
{
	local UCOrdersMemory M;

	foreach sp.AllActors(class'UCOrdersMemory', M)
		if (M.Who == sp.Name)
			return;
	M = sp.Spawn(class'UCOrdersMemory');
	if (M == None)
		return;
	M.Who = sp.Name;
	M.Orders = sp.Orders;
	M.OrderTag = sp.OrderTag;
}

static function bool GiveBack(ScriptedPawn sp)
{
	local UCOrdersMemory M;

	if (sp == None || sp.Health <= 0)
		return False;
	foreach sp.AllActors(class'UCOrdersMemory', M)
		if (M.Who == sp.Name)
		{
			class'UCSeatOrder'.static.Cancel(sp);
			sp.SetOrders(M.Orders, M.OrderTag, True);
			return True;
		}
	return False;
}

defaultproperties
{
     bHidden=True
}
