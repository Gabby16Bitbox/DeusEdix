//=============================================================================
// UCModStart - the map a new game begins on when an installed mod has no main menu of its own: the game's
// own main menu stays, and its New Game (the character screen, UCNewGame through UCMenuRoot) begins StartMap
// instead of the game's intro and Liberty Island. Only the launch of an installed mod on the original game sets
// it ([<package>.UCModStart] StartMap= in that launch's copy of the game's ini, mods.launch_ini), the way the
// original game's own mods start: no map on the command line, so no -hax0r and no cheats for the player.
// Everywhere else it is empty.
//=============================================================================
class UCModStart extends Object config;

var config string StartMap;

defaultproperties
{
}
