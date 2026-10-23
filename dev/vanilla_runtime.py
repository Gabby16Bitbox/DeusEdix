"""The runtime classes for projects made for the original Deus Ex (GOTY 1112fm), from DeusEdix's own.

DeusEdix's runtime (runtime\\DeusEdix) is written for Deus Ex: Revision and a few of its classes use what
only Revision has: InformationDevices.SpecialText, ConWindowActive.KeyboardButtonActivated,
DeusExPlayer.BuildOptionString, the second parameter of GivePlayerAugmentation, DeusExCarcass.AttemptPickup.
UnrealScript has no conditional compilation, so a project for the original game gets these files instead
(runtime\\vanilla\\Classes, made from the Revision ones by the changes below: every change must find its
text, or the generation stops). Revision's own files stay exactly as they are.

    python dev\\vanilla_runtime.py <runtime Classes folder> <output folder>
"""
import hashlib
import re
import sys
from pathlib import Path


def _function(name, body, was):
    """Replace the whole function `name` (with the comment lines right above it) by `body`. `was`: the
    start of the SHA-1 of the Revision function it was written against; a changed one stops the
    generation (its new logic would be lost for the original game: write the change here too)."""
    pattern = re.compile(r'(?:^//[^\n]*\n)*^(?:simulated )?function [^\n(]*\b%s\(.*?^\}\n' % re.escape(name), re.M | re.S)

    def change(text):
        found = pattern.findall(text)
        if len(found) != 1:
            raise ValueError('function %s: found %d times' % (name, len(found)))
        if not hashlib.sha1(found[0].encode('latin1')).hexdigest().startswith(was):
            raise ValueError('function %s changed in the Revision version: update its version for the original '
                             'game here (and the hash)' % name)
        return pattern.sub(lambda m: body, text)
    return change


def _exact(old, new):
    def change(text):
        if text.count(old) != 1:
            raise ValueError('text not found once: %r' % old[:80])
        return text.replace(old, new)
    return change


CHANGES = {
    'UCBoot': [
        _function('PrepareEditorTexts', """// Books, newspapers and datacubes written in the editor: the original game has no SpecialText (Revision's
// own text of an object); there the editor gives them their text through textTag and TextPackage, read by
// the game's own text parser (DataVault included). Nothing to prepare.
function PrepareEditorTexts()
{
}
""", '3923275682ef'),
    ],
    'UCShotRunner': [
        # a choice of a conversation: the button itself (Revision's KeyboardButtonActivated does the same)
        _exact('P.conPlay.conWinThird.KeyboardButtonActivated(int(fields[2]) - 1);',
               'P.conPlay.conWinThird.ButtonActivated(P.conPlay.conWinThird.conChoices[int(fields[2]) - 1]);'),
        # travel: the original game keeps the difficulty with the player (no BuildOptionString)
        _exact('Level.Game.SendPlayer(P, fields[2] $ P.BuildOptionString());',
               'Level.Game.SendPlayer(P, fields[2]);'),
        # no SpecialText: the "text" step sets what the DataVault shows only
        _exact('\t\t\tA.SpecialText = text;\n', ''),
        _exact('\n\t\t\t\t\t@ "window" @ InformationDevices(A).infoWindow @ "text" @ InformationDevices(A).SpecialText);',
               '\n\t\t\t\t\t@ "window" @ InformationDevices(A).infoWindow);'),
        # the original game's GivePlayerAugmentation has one parameter (Revision's second one only
        # matters when JC has the augmentation already, never here)
        _exact("GivePlayerAugmentation(class'AugLight', True);", "GivePlayerAugmentation(class'AugLight');"),
    ],
    'UCCustomCarcass': [
        _function('AttemptPickup', """// picked up: the original game's Frob puts a carried body (POVCorpse) in JC's hands and destroys this
// one; the carried body keeps only this class, JC keeps its look
function Frob(Actor Frobber, Inventory frobWith)
{
	local string look;

	look = class'UCCustomLook'.static.LookOf(self);
	Super.Frob(Frobber, frobWith);
	if (bDeleteMe && DeusExPlayer(Frobber) != None && POVCorpse(DeusExPlayer(Frobber).inHand) != None)
		class'UCCustomLook'.static.KeepLook(Pawn(Frobber), look);
}
""", '9cd14e8a87ea'),
    ],
}


def make(classes, out):
    """Write the original game's versions of the changed classes of `classes` into `out`."""
    classes, out = Path(classes), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    for name, changes in CHANGES.items():
        raw = (classes / (name + '.uc')).read_bytes()
        crlf = raw.count(b'\r\n') == raw.count(b'\n') and b'\r\n' in raw
        text = raw.decode('latin1').replace('\r\n', '\n')
        for change in changes:
            try:
                text = change(text)
            except ValueError as e:
                raise SystemExit('%s.uc for the original game: %s' % (name, e))
        text = '// Made by DeusEdix from its Revision version for the original Deus Ex (dev\\vanilla_runtime.py).\n' + text
        if crlf:
            text = text.replace('\n', '\r\n')
        (out / (name + '.uc')).write_bytes(text.encode('latin1'))
    return sorted(CHANGES)


if __name__ == '__main__':
    print('made', make(sys.argv[1], sys.argv[2]))
