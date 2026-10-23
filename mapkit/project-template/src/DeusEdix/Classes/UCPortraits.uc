//=============================================================================
// UCPortraits - the InfoLink portraits of the user's own characters (64x64 like the game's
// InfoPortraits). The editor rewrites this class when a portrait is added: one #exec TEXTURE IMPORT
// per picture in Textures\Portraits. UCScene.Say asks Find(bindName) after the window has taken the
// game's portrait (InfoPortraits.<bind name>).
//=============================================================================
class UCPortraits extends Object
	abstract;

static function Texture Find(string bindName)
{
	if (bindName == "")
		return None;
	return Texture(DynamicLoadObject(string(class'UCPortraits'.Outer.Name) $ ".UCPortrait_" $ bindName, class'Texture', True));
}
