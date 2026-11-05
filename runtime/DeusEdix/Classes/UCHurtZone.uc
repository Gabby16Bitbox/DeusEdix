//=============================================================================
// UCHurtZone - an area that hurts whoever is in it, the player too (the rules' "A damaging area"): so much damage a
// second within a radius (less towards its edge: HurtRadius), for some seconds (0: until the map ends), as fire,
// poison, an electric shock or radiation. Saved with the game.
//=============================================================================
class UCHurtZone extends Info;

var float PerSecond, Radius, Left;
var name Kind;
var bool bForever;

static function Start(Actor By, vector spot, float dps, float radius, float secs, string how)
{
	local UCHurtZone Z;

	Z = By.Spawn(class'UCHurtZone',,, spot);
	if (Z == None)
		return;
	Z.PerSecond = FMax(0, dps);
	Z.Radius = FClamp(radius, 16, 4096);
	Z.Left = secs;
	Z.bForever = secs <= 0;
	if (how == "poison")
		Z.Kind = 'Poison';
	else if (how == "shock")
		Z.Kind = 'Shocked';
	else if (how == "radiation")
		Z.Kind = 'Radiation';
	else
		Z.Kind = 'Burned';
	Z.SetTimer(0.5, True);
}

function Timer()
{
	if (!bForever)
	{
		Left -= 0.5;
		if (Left < 0)
		{
			Destroy();
			return;
		}
	}
	if (PerSecond > 0)
		HurtRadius(PerSecond * 0.5, Radius, Kind, 0, Location);
}

defaultproperties
{
     bHidden=True
}
