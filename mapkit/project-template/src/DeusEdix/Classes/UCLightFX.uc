//=============================================================================
// UCLightFX - a light changed by a rule (UCLink): it flickers for some seconds (0: until a rule turns it on or off),
// takes a colour (hue, saturation) or a brightness. Flickering is LT_Blink with period 32: LT_Flicker gives no light at
// all in Revision (measured 28 Oct 2026), Blink lights the room in both games. The light's own type and period come
// back after the seconds (UCLightMemory keeps the type for "turn on" too). The editor makes these lights non-static.
//=============================================================================
class UCLightFX extends Info;

var Light L;
var ELightType OldType;
var byte OldPeriod;
var float Left;

static function Change(Light L, string verb, string a, string b)
{
	local UCLightFX F;
	local UCLightMemory M, Found;

	if (verb == "lightcolour")
	{
		L.LightHue = Clamp(int(a), 0, 255);
		L.LightSaturation = Clamp(int(b), 0, 255);
		return;
	}
	if (verb == "lightbright")
	{
		L.LightBrightness = Clamp(int(a), 0, 255);
		return;
	}
	foreach L.AllActors(class'UCLightFX', F)          // flickering already: the seconds start again
		if (F.L == L)
		{
			F.Left = float(a);
			return;
		}
	if (L.LightType == LT_None)                         // a light turned off flickers from its own type later
		return;
	foreach L.AllActors(class'UCLightMemory', M)
		if (M.Target == L)
			Found = M;
	if (Found == None)
		Found = L.Spawn(class'UCLightMemory');
	if (Found != None)
	{
		Found.Target = L;
		Found.OriginalType = L.LightType;
	}
	F = L.Spawn(class'UCLightFX');
	if (F == None)
		return;
	F.L = L;
	F.OldType = L.LightType;
	F.OldPeriod = L.LightPeriod;
	F.Left = float(a);
	L.LightType = LT_Blink;
	L.LightPeriod = 32;
	if (F.Left <= 0)
		F.Disable('Tick');                               // until a rule turns it on or off (UCLink.LightSet)
}

event Tick(float dt)
{
	if (L == None)
	{
		Destroy();
		return;
	}
	Left -= dt;
	if (Left <= 0)
		Done();
}

// its own type and period again; turned off meanwhile: it stays off
function Done()
{
	if (L != None && L.LightType == LT_Blink)
	{
		L.LightType = OldType;
		L.LightPeriod = OldPeriod;
	}
	Destroy();
}

defaultproperties
{
     bHidden=True
}
