//=============================================================================
// UCMark - an invisible marker with a Tag, used as the destination of the
// characters' orders (e.g. SetOrders('RunningTo', 'UCJCMark')).
//=============================================================================
class UCMark extends Actor
	transient;

defaultproperties
{
     bHidden=True
     bCollideActors=False
     bCollideWorld=False
     bBlockActors=False
     bBlockPlayers=False
}
