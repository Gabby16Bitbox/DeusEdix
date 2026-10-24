//=============================================================================
// UCTextBlock - a text written in the map editor that the game's computers read:
// the email list of an account, an email, the bulletin list of a public
// terminal, a bulletin. The computers read "ExtString" texts from a text package
// (Computers.TextPackage); when the map starts, UCBoot makes, for every block, the ExtString
// <TextName> in the DeusEdix package, and the editor sets TextPackage=DeusEdix
// on the computers that have emails or bulletins written in the editor.
// The text is in the format of the game's texts: <EMAIL=name,subject,from,to,cc> for the rows of the
// email list, <FILE=name,title> for the bulletin list, <P> for paragraphs.
//=============================================================================
class UCTextBlock extends Info;

var() name TextName;
var() string Text;
// Continuations keep long books below the native T3D line limit.
var() string TextMore[64];

static function bool RegisterText(UCTextBlock block)
{
     local ExtString s;
     local int i;

     if (block == None || block.TextName == '') return False;
     s = new(class'UCTextBlock'.Outer, block.TextName) class'ExtString';
     if (s == None) return False;
     s.SetText(block.Text);
     for (i = 0; i < ArrayCount(block.TextMore); i++)
          if (block.TextMore[i] != "") s.AppendText(block.TextMore[i]);
     return True;
}

defaultproperties
{
     bHidden=True
}
