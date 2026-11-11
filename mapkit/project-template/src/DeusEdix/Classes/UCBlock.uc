//=============================================================================
// UCBlock - a logic block of the map editor (Objects > Logic): a small placed helper that remembers something for
// the rules, as a script of Tools > Scripts does (UCScript): the rules call its inputs ("input" actions) and start
// when it says one of its outputs. Its value goes to the logic log ("value|map|block|text"), which the editor's
// Console and Try it show. tools\mapkit\editor\LOGIC.md "Logic blocks": the whole.
//=============================================================================
class UCBlock extends UCScript
	abstract;

// who called an input: the object its rule is on (a lever's "turned on" and "turned off" rules are the same one),
// else the rule's id in the editor (a rule on the start or a signal), else the actor's name
final function string WhoOf(Actor Caller)
{
	local UCLink L;

	L = UCLink(Caller);
	if (L != None && L.Source != "")
		return L.Source;
	if (L != None && L.Rule != "")
		return L.Rule;
	if (Caller != None)
		return string(Caller.Name);
	return "";
}

// How many of them (WhoOf, each counted once) have a rule calling this block's input InputName
final function int RulesCalling(string InputName)
{
	local UCLink L;
	local string Seen[32], Who;
	local int i, j, n;

	foreach AllActors(class'UCLink', L)
		for (i = 0; i < ArrayCount(L.Act); i++)
			if (L.Field(L.Act[i], 1) == "input" && L.Field(L.Act[i], 2) ~= string(Name) && L.Field(L.Act[i], 3) ~= InputName)
			{
				Who = WhoOf(L);
				for (j = 0; j < n; j++)
					if (Seen[j] ~= Who)
						break;
				if (j == n && n < ArrayCount(Seen))
				{
					Seen[n] = Who;
					n++;
				}
				break;
			}
	return n;
}

// a name as the editor writes states, counters and phases (conditions.ident): letters, digits and _ (anything else
// becomes _), never starting with a digit ("X_" before it). Accented letters: the editor drops the accent, this
// makes it _: write names without them.
final function string FlagName(string S)
{
	local string Out, C;
	local int i, A;

	S = Trimmed(S);
	for (i = 0; i < Len(S); i++)
	{
		C = Mid(S, i, 1);
		A = Asc(C);
		if ((A >= 48 && A <= 57) || (A >= 65 && A <= 90) || (A >= 97 && A <= 122) || A == 95)
			Out = Out $ C;
		else
			Out = Out $ "_";
	}
	if (Out != "" && Asc(Out) >= 48 && Asc(Out) <= 57)
		Out = "X_" $ Out;
	return Left(Out, 60);
}

// a text without the spaces at its ends
final function string Trimmed(string S)
{
	while (Left(S, 1) == " ")
		S = Mid(S, 1);
	while (Right(S, 1) == " ")
		S = Left(S, Len(S) - 1);
	return S;
}

// item k (0 first) of a list written "a, b, c"; "" past its end
final function string Item(string List, int k)
{
	local int i;

	for (i = 0; i < k; i++)
	{
		if (InStr(List, ",") < 0)
			return "";
		List = Mid(List, InStr(List, ",") + 1);
	}
	if (InStr(List, ",") >= 0)
		List = Left(List, InStr(List, ","));
	return Trimmed(List);
}

// how many items a list "a, b, c" has (empty ones too, but not a list that is all spaces)
final function int Items(string List)
{
	local int n;

	if (Trimmed(List) == "")
		return 0;
	n = 1;
	while (InStr(List, ",") >= 0)
	{
		List = Mid(List, InStr(List, ",") + 1);
		n++;
	}
	return n;
}

// a text as a name of the game (the flags are found by name)
final function name AsName(string S)
{
	if (Player() == None || Player().rootWindow == None)
		return '';
	return Player().rootWindow.StringToName(S);
}

// the game's flags by their name as a text: a state (bool) and a counter (int)
final function bool GetState(string FlagName)
{
	return FlagName != "" && GetFlag(AsName(FlagName));
}

final function SetState(string FlagName, bool bValue)
{
	if (FlagName != "")
		SetFlag(AsName(FlagName), bValue);
}

// the game's integer flags (the editor's counters)
final function int GetInt(string FlagName)
{
	if (Player() == None || Player().FlagBase == None || FlagName == "")
		return 0;
	return Player().FlagBase.GetInt(AsName(FlagName));
}

final function SetInt(string FlagName, int Value)
{
	if (Player() != None && Player().FlagBase != None && FlagName != "")
		Player().FlagBase.SetInt(AsName(FlagName), Value,, 99);
}

// an action of the block that could not happen, for the logic log ("fail|map|block|verb|what|why")
final function Fail(string Verb, string What, string Why)
{
	class'UCEditorStory'.static.LogicLine("fail|" $ MapTitle() $ "|" $ Name $ "|" $ Verb $ "|" $ What $ "|" $ Why);
}

// what it holds now, for the logic log
final function Value(string Text)
{
	class'UCEditorStory'.static.LogicLine("value|" $ MapTitle() $ "|" $ Name $ "|" $ Text);
}

defaultproperties
{
}
