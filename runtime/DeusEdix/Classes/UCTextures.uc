//=============================================================================
// UCTextures - the textures of DeusEdix's own package.
//  UCFade: a strip of greys from 128 (no change) to 0 (black); the cutscene window (UCCutWindow) and
//  the scenes draw it modulated to darken the screen and to draw the black bars.
//=============================================================================
class UCTextures extends Object
	abstract;

#exec TEXTURE IMPORT NAME=UCFade FILE=Textures\UCFade.pcx MIPS=Off
