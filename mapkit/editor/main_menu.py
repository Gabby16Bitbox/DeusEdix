"""The project's own main menu (File > Main menu... of the editor, static/main-menu.js): what the game shows in place of
its title screen and of its Esc menu when the project is played as a game of its own (its Play from the menu, a mod).

Kept in <project>/main-menu.json (and its picture as main-menu-logo.png, the one the page shows); the game reads it as
UCMenuLook, a class the editor writes here into the project's package (write_runtime, like UCInfoLinkStyle), with the
picture imported into that package (Textures/Menu/UCMenuLogo.pcx). The game's own classes do the rest
(project-template: UCMenuRoot, UCMainMenu, UCMenuButton, UCNewGame, UCMenuStage); only a launch with the menu names
the root window that opens it (apply_ini, on the launch's copy of the game's ini): the player's own game never has it.
"""
import base64
import hashlib
import io
import json
import re

import atomicfile
import settings

FILE_NAME = 'main-menu.json'
LOGO_NAME = 'main-menu-logo.png'
ACTIONS = ('new', 'load', 'save', 'settings', 'back', 'mainmenu', 'exit', 'map')
SHOWS = ('always', 'menu', 'game')
FONTS = ('menu', 'title', 'headers', 'large', 'bold', 'location', 'small')      # UCMainMenu.FontOf, in its order
ALIGNS = ('left', 'centre', 'right')
LOOKS = ('game', 'text')
CAMERAS = ('still', 'sway')
MAX_BUTTONS = 12
MAX_LOGO = 512                     # the picture's longer side in the game, in pixels
MAX_LOGO_UPLOAD = 8 * 1024 * 1024
_MAP = re.compile(r'^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}$')
_COLOUR = re.compile(r'^#[0-9a-fA-F]{6}$')

DEFAULT_BUTTONS = (
    dict(label='New Game', action='new', shows='always', map=''),
    dict(label='Back to Game', action='back', shows='game', map=''),
    dict(label='Save Game', action='save', shows='game', map=''),
    dict(label='Load Game', action='load', shows='always', map=''),
    dict(label='Settings', action='settings', shows='always', map=''),
    dict(label='Main Menu', action='mainmenu', shows='game', map=''),
    dict(label='Exit', action='exit', shows='always', map=''),
)
DEFAULT = dict(enabled=False, menuMap='', startMap='', characterScreens=True, camera='still', title='',
               titleFont='large', titleColor='#ffffff', logo=False, logoScale=1.0, align='left', x=0.08, y=0.35,
               look='game', buttonFont='menu', buttonWidth=245, textColor='#c8c8c8', hoverColor='#ffffff',
               disabledColor='#5a5a5a', shade=True, footer='', buttons=[dict(b) for b in DEFAULT_BUTTONS])


def _paths():
    root = settings.PROJECT
    pkg = root / 'src' / settings.PACKAGE
    return dict(file=root / FILE_NAME, logo=root / LOGO_NAME, classes=pkg / 'Classes',
                pcx=pkg / 'Textures' / 'Menu' / 'UCMenuLogo.pcx')


def available():
    """Only the user's own campaigns have a menu of their own (the original campaign and the tutorial are the game's)."""
    return bool(getattr(settings, 'MANAGED_PROJECT', False)) and getattr(settings, 'PROJECT_KIND', '') == 'custom'


def project_maps():
    """The project's maps that the game can start: those installed (maps\\*.dx of the project)."""
    folder = settings.PROJECT / 'maps'
    return sorted(p.stem for p in folder.glob('*.dx') if p.is_file()) if folder.is_dir() else []


# ------------------------------------------------------------------ checking

def _text(value, limit, what):
    value = str(value if value is not None else '')
    if len(value) > limit or any(ord(c) < 32 for c in value):
        raise ValueError('The %s is too long or has invalid characters.' % what)
    # the game's defaultproperties take a string between double quotes, and no backslash at its end
    return value.replace('"', "'").replace('\\', '/').strip()


def _choice(value, choices, what):
    if value not in choices:
        raise ValueError('Choose a supported %s.' % what)
    return value


def _number(value, low, high, what):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
        raise ValueError('The %s must be from %s to %s.' % (what, low, high))
    return value


def _map(value, what):
    value = str(value or '')
    if value and not _MAP.match(value):
        raise ValueError('The %s is not a map name.' % what)
    return value


def validate(value):
    """main-menu.json as the editor keeps it: every field checked, defaults for those missing, nothing else kept."""
    if not isinstance(value, dict) or set(value) - set(DEFAULT):
        raise ValueError('Invalid main menu settings.')
    out = json.loads(json.dumps(DEFAULT))
    for key, v in value.items():
        if key in ('enabled', 'characterScreens', 'logo', 'shade'):
            if type(v) is not bool:
                raise ValueError('Invalid main menu settings (%s).' % key)
        elif key in ('menuMap', 'startMap'):
            v = _map(v, 'menu\'s map' if key == 'menuMap' else 'first map')
        elif key in ('title', 'footer'):
            v = _text(v, 80, key)
        elif key in ('titleColor', 'textColor', 'hoverColor', 'disabledColor'):
            if not isinstance(v, str) or not _COLOUR.match(v):
                raise ValueError('Colours are #RRGGBB.')
            v = v.lower()
        elif key in ('titleFont', 'buttonFont'):
            v = _choice(v, FONTS, 'font')
        elif key == 'align':
            v = _choice(v, ALIGNS, 'position')
        elif key == 'look':
            v = _choice(v, LOOKS, 'button look')
        elif key == 'camera':
            v = _choice(v, CAMERAS, 'camera')
        elif key == 'logoScale':
            v = round(float(_number(v, 0.1, 4, 'picture size')), 3)
        elif key in ('x', 'y'):
            v = round(float(_number(v, 0, 0.95, 'position')), 3)
        elif key == 'buttonWidth':
            v = int(_number(v, 80, 800, 'button width'))
        elif key == 'buttons':
            if not isinstance(v, list) or len(v) > MAX_BUTTONS:
                raise ValueError('A main menu has up to %d buttons.' % MAX_BUTTONS)
            buttons = []
            for b in v:
                if not isinstance(b, dict) or set(b) - {'label', 'action', 'shows', 'map'}:
                    raise ValueError('Invalid main menu button.')
                button = dict(label=_text(b.get('label', ''), 40, 'button text'),
                              action=_choice(b.get('action'), ACTIONS, 'button action'),
                              shows=_choice(b.get('shows', 'always'), SHOWS, 'button place'),
                              map=_map(b.get('map', ''), 'button\'s map'))
                if not button['label']:
                    raise ValueError('Every button needs its text.')
                if button['action'] != 'map':
                    button['map'] = ''
                buttons.append(button)
            v = buttons
        out[key] = v
    return out


def problems(menu, maps=None):
    """What keeps the menu from working in the game, in words for the page (empty: ready)."""
    maps = project_maps() if maps is None else maps
    out = []
    if not menu['enabled']:
        return out
    for key, what in (('menuMap', 'The map behind the menu'), ('startMap', 'The first map of a new game')):
        if not menu[key]:
            out.append('%s is not chosen.' % what)
        elif menu[key] not in maps:
            out.append('%s (%s) is not installed: Map > Install map first.' % (what, menu[key]))
    for b in menu['buttons']:
        if b['action'] == 'map' and b['map'] not in maps:
            out.append('The button "%s" opens a map that is not installed.' % b['label'])
    if not menu['buttons']:
        out.append('The menu has no buttons.')
    elif not any(b['action'] == 'new' for b in menu['buttons']):
        out.append('No button starts a new game.')
    return out


# ------------------------------------------------------------------ reading and saving

def snapshot():
    p = _paths()
    raw = p['file'].read_bytes() if p['file'].exists() else b''
    try:
        menu = validate(json.loads(raw)) if raw else json.loads(json.dumps(DEFAULT))
    except (ValueError, TypeError) as exc:
        raise ValueError('Cannot read the project\'s main menu. Its saved file was kept.') from exc
    logo = p['logo'].is_file()
    menu['logo'] = bool(menu['logo'] and logo)
    maps = project_maps()
    revision = hashlib.sha256(raw + (p['logo'].read_bytes() if logo else b'')).hexdigest()
    return dict(menu=menu, revision=revision, hasLogo=logo, maps=maps, problems=problems(menu, maps),
                fonts=list(FONTS), actions=list(ACTIONS), available=available(), gameName=settings.GAME_NAME)


def logo_png():
    p = _paths()['logo']
    return p.read_bytes() if p.is_file() else None


def _logo_pcx(png, out_path):
    """The picture as the game's texture: at most MAX_LOGO on its longer side, its own proportions, on a power-of-two
    canvas (the rest see-through: palette colour 0, a masked texture). Returns its size (w, h) in that texture."""
    from PIL import Image
    im = Image.open(io.BytesIO(png)).convert('RGBA')
    im.thumbnail((MAX_LOGO, MAX_LOGO), Image.LANCZOS)
    w, h = im.size

    def pow2(n):
        p = 8
        while p < n:
            p *= 2
        return p
    canvas = Image.new('RGBA', (pow2(w), pow2(h)), (0, 0, 0, 0))
    canvas.paste(im, (0, 0))
    alpha = canvas.getchannel('A').tobytes()
    quant = canvas.convert('RGB').quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    # palette colour 0 is the see-through one (a masked texture): the picture's own colours from 1
    idx = bytes(0 if a < 128 else i + 1 for i, a in zip(quant.tobytes(), alpha))
    palette = [0, 0, 0] + quant.getpalette()[:255 * 3]
    out = Image.frombytes('P', canvas.size, idx)
    out.putpalette(palette + [0] * (768 - len(palette)))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    buf = io.BytesIO()
    out.save(buf, format='PCX')
    if not out_path.exists() or out_path.read_bytes() != buf.getvalue():
        atomicfile.write_bytes(out_path, buf.getvalue())
    return w, h


def _colour(v):
    return '(R=%d,G=%d,B=%d)' % tuple(int(v[i:i + 2], 16) for i in (1, 3, 5))


def class_text(menu, logo_size=None):
    """UCMenuLook.uc for `menu` (validate), with the picture's #exec when it has one (logo_size: its w, h)."""
    lines = ['bEnabled=%s' % menu['enabled'], 'MenuMap="%s"' % menu['menuMap'], 'StartMap="%s"' % menu['startMap'],
             'bCharacterScreens=%s' % menu['characterScreens'], 'CameraMove=%d' % CAMERAS.index(menu['camera']),
             'Title="%s"' % menu['title'], 'TitleFont=%d' % FONTS.index(menu['titleFont']),
             'TitleColor=%s' % _colour(menu['titleColor']), 'bLogo=%s' % bool(logo_size),
             'LogoW=%d' % (logo_size[0] if logo_size else 0), 'LogoH=%d' % (logo_size[1] if logo_size else 0),
             'LogoScale=%.3f' % menu['logoScale'], 'Align=%d' % ALIGNS.index(menu['align']),
             'PosX=%.3f' % menu['x'], 'PosY=%.3f' % menu['y'], 'ButtonLook=%d' % LOOKS.index(menu['look']),
             'ButtonFont=%d' % FONTS.index(menu['buttonFont']), 'ButtonWidth=%d' % menu['buttonWidth'],
             'TextColor=%s' % _colour(menu['textColor']), 'HoverColor=%s' % _colour(menu['hoverColor']),
             'DisabledColor=%s' % _colour(menu['disabledColor']), 'bShade=%s' % menu['shade'],
             'Footer="%s"' % menu['footer'], 'NumButtons=%d' % len(menu['buttons'])]
    for i, b in enumerate(menu['buttons']):
        lines += ['Labels(%d)="%s"' % (i, b['label']), 'Actions(%d)=%d' % (i, ACTIONS.index(b['action'])),
                  'Shows(%d)=%d' % (i, SHOWS.index(b['shows'])), 'Targets(%d)="%s"' % (i, b['map'])]
    head = ['//=============================================================================',
            '// UCMenuLook - the project\'s own main menu. GENERATED by the map editor from main-menu.json',
            '// (File > Main menu...): do not edit by hand. See the template\'s UCMenuLook for what each line means.',
            '//=============================================================================',
            'class UCMenuLook extends Object', '\tabstract;', '']
    if logo_size:
        head += ['#exec TEXTURE IMPORT NAME=UCMenuLogo FILE=Textures\\Menu\\UCMenuLogo.pcx MIPS=Off FLAGS=2', '']
    head += ['var bool   bEnabled;', 'var string MenuMap;', 'var string StartMap;', 'var bool   bCharacterScreens;',
             'var byte   CameraMove;', 'var string Title;', 'var byte   TitleFont;', 'var Color  TitleColor;',
             'var bool   bLogo;', 'var int    LogoW, LogoH;', 'var float  LogoScale;', 'var byte   Align;',
             'var float  PosX, PosY;', 'var byte   ButtonLook;', 'var byte   ButtonFont;', 'var int    ButtonWidth;',
             'var Color  TextColor, HoverColor, DisabledColor;', 'var bool   bShade;', 'var string Footer;',
             'var int    NumButtons;', 'var string Labels[12];', 'var byte   Actions[12];', 'var byte   Shows[12];',
             'var string Targets[12];', '']
    return '\n'.join(head) + '\ndefaultproperties\n{\n' + ''.join('     %s\n' % l for l in lines) + '}\n'


def write_runtime():
    """UCMenuLook.uc (and the picture's texture) in the project's package from what is saved. -> changed"""
    p = _paths()
    menu = snapshot()['menu']
    size = None
    if menu['enabled'] and menu['logo'] and p['logo'].is_file():
        size = _logo_pcx(p['logo'].read_bytes(), p['pcx'])
    elif p['pcx'].exists():
        p['pcx'].unlink()
    text = class_text(menu, size)
    dst = p['classes'] / 'UCMenuLook.uc'
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists() and dst.read_text(encoding='latin1') == text:
        return False
    atomicfile.write_text(dst, text, encoding='latin1')
    return True


def _png(data_url):
    if not isinstance(data_url, str) or not data_url.startswith('data:image/') or ';base64,' not in data_url:
        raise ValueError('The picture must be a PNG or JPEG image.')
    raw = base64.b64decode(data_url.split(',', 1)[1])
    if len(raw) > MAX_LOGO_UPLOAD:
        raise ValueError('The picture is too large (8 MB at most).')
    from PIL import Image
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
    except Exception as exc:
        raise ValueError('The picture could not be read.') from exc
    out = io.BytesIO()
    im.convert('RGBA').save(out, format='PNG')
    return out.getvalue()


def save(value, expected, logo=None):
    """Keep the menu (validate) and, `logo`: a data: URL = a new picture, '' = none, None = as it is. `expected` is the
    revision the page started from (snapshot): another window's save in between is never overwritten."""
    if not available():
        raise ValueError('Only your own campaign projects have a main menu of their own.')
    menu = validate(value)
    if snapshot()['revision'] != expected:
        raise ValueError('The main menu changed elsewhere. Open it again before saving.')
    p = _paths()
    if logo == '':
        p['logo'].unlink(missing_ok=True)
        menu['logo'] = False
    elif logo is not None:
        atomicfile.write_bytes(p['logo'], _png(logo))
        menu['logo'] = True
    atomicfile.write_json(p['file'], menu)
    write_runtime()
    return snapshot()


# ------------------------------------------------------------------ the game's ini for a launch with the menu

def root_class(package=None):
    return '%s.UCMenuRoot' % (package or settings.PACKAGE)


def apply_ini(text, menu_map, package=None):
    """The text of a launch's copy of the game's ini with the project's menu (project_game.menu_ini)."""
    import project_game
    return project_game.menu_ini(text, root_class(package), menu_map)
