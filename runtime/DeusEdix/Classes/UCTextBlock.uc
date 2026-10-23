//=============================================================================
// UCTextBlock - un testo scritto nell'editor delle mappe che i computer del gioco leggono:
// la lista delle email di un account, un'email, la lista dei bollettini di un terminale
// pubblico, un bollettino. I computer leggono testi "ExtString" da un pacchetto di testi
// (Computers.TextPackage); UCBoot, quando la mappa parte, crea per ogni blocco l'ExtString
// <TextName> nel pacchetto DeusEdix, e l'editor mette TextPackage=DeusEdix
// nei computer che hanno email o bollettini suoi.
// Il testo e' nel formato dei testi del gioco: <EMAIL=nome,oggetto,da,a,cc> per righe della
// lista delle email, <FILE=nome,titolo> per quella dei bollettini, <P> per i paragrafi.
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
