"""Explicit, cancellable screen colour sampling for Windows WebView2 hosts.

Only the chosen RGB value leaves this module. The temporary desktop bitmap is
kept in GDI memory, never saved or returned to the browser.
"""
import ctypes as C
from ctypes import wintypes as W
import sys
import threading
import time
import uuid

_lock = threading.Lock()
_cancel = threading.Event()
_state_lock = threading.Lock()
_active_token = None
_cancelled = {}


def handle(action, body):
    if action not in ('pick', 'cancel'):
        raise ValueError('Unknown screen picker action.')
    token = body.get('token') if isinstance(body, dict) else None
    if (not isinstance(token, str) or len(token) != 32
            or any(c not in '0123456789abcdef' for c in token) or set(body) != {'token'}):
        raise ValueError('Invalid screen picker request.')
    return pick(token) if action == 'pick' else cancel(token)


def color_hex(value):
    if value == 0xFFFFFFFF:
        raise RuntimeError('That screen pixel could not be read. Try another point.')
    return '#%02x%02x%02x' % (value & 255, (value >> 8) & 255, (value >> 16) & 255)


def cancel(token):
    with _state_lock:
        # A cancel may arrive just before its pick request. Remember it briefly;
        # cancelling another tab must not close the currently active picker.
        now = time.monotonic()
        for key, stamp in list(_cancelled.items()):
            if now-stamp > 120: _cancelled.pop(key, None)
        if len(_cancelled) >= 64: _cancelled.pop(next(iter(_cancelled)))
        _cancelled[token] = now
        if _active_token == token: _cancel.set()
    return {'cancelled': True}


class Win:
    """Explicit pointer-sized signatures: works in the packaged 32/64-bit host."""
    def __init__(self):
        self.u = C.WinDLL('user32', use_last_error=True)
        self.g = C.WinDLL('gdi32', use_last_error=True)
        self.k = C.WinDLL('kernel32', use_last_error=True)
        self.PROC = C.WINFUNCTYPE(C.c_ssize_t, W.HWND, W.UINT, W.WPARAM, W.LPARAM)
        class CLASS(C.Structure):
            _fields_ = [('style', W.UINT), ('proc', self.PROC), ('classExtra', C.c_int), ('windowExtra', C.c_int),
                        ('instance', W.HINSTANCE), ('icon', W.HICON), ('cursor', W.HANDLE), ('background', W.HBRUSH),
                        ('menu', W.LPCWSTR), ('name', W.LPCWSTR)]
        class PAINT(C.Structure):
            _fields_ = [('dc', W.HDC), ('erase', W.BOOL), ('rect', W.RECT), ('restore', W.BOOL),
                        ('update', W.BOOL), ('reserved', C.c_byte*32)]
        self.CLASS, self.PAINT = CLASS, PAINT
        defs = {
            'u': {
                'GetDC': (W.HDC, [W.HWND]), 'ReleaseDC': (C.c_int, [W.HWND,W.HDC]),
                'GetSystemMetrics': (C.c_int,[C.c_int]), 'SetThreadDpiAwarenessContext': (W.HANDLE,[W.HANDLE]),
                'GetCursorPos': (W.BOOL,[C.POINTER(W.POINT)]), 'LoadCursorW': (W.HANDLE,[W.HINSTANCE,C.c_void_p]),
                'RegisterClassW': (W.ATOM,[C.POINTER(CLASS)]), 'UnregisterClassW': (W.BOOL,[W.LPCWSTR,W.HINSTANCE]),
                'CreateWindowExW': (W.HWND,[W.DWORD,W.LPCWSTR,W.LPCWSTR,W.DWORD,C.c_int,C.c_int,C.c_int,C.c_int,W.HWND,W.HMENU,W.HINSTANCE,C.c_void_p]),
                'DefWindowProcW': (C.c_ssize_t,[W.HWND,W.UINT,W.WPARAM,W.LPARAM]),
                'DestroyWindow': (W.BOOL,[W.HWND]), 'IsWindow': (W.BOOL,[W.HWND]),
                'ShowWindow': (W.BOOL,[W.HWND,C.c_int]), 'SetForegroundWindow': (W.BOOL,[W.HWND]),
                'SetFocus': (W.HWND,[W.HWND]), 'InvalidateRect': (W.BOOL,[W.HWND,C.POINTER(W.RECT),W.BOOL]),
                'BeginPaint': (W.HDC,[W.HWND,C.POINTER(PAINT)]), 'EndPaint': (W.BOOL,[W.HWND,C.POINTER(PAINT)]),
                'FillRect': (C.c_int,[W.HDC,C.POINTER(W.RECT),W.HBRUSH]),
                'DrawTextW': (C.c_int,[W.HDC,W.LPCWSTR,C.c_int,C.POINTER(W.RECT),W.UINT]),
                'SetTimer': (C.c_size_t,[W.HWND,C.c_size_t,W.UINT,C.c_void_p]), 'KillTimer': (W.BOOL,[W.HWND,C.c_size_t]),
                'GetMessageW': (W.BOOL,[C.POINTER(W.MSG),W.HWND,W.UINT,W.UINT]),
                'TranslateMessage': (W.BOOL,[C.POINTER(W.MSG)]), 'DispatchMessageW': (C.c_ssize_t,[C.POINTER(W.MSG)]),
                'PostQuitMessage': (None,[C.c_int]), 'GetAsyncKeyState': (C.c_short,[C.c_int]),
                'SendMessageW': (C.c_ssize_t,[W.HWND,W.UINT,W.WPARAM,W.LPARAM]),
            },
            'g': {
                'CreateCompatibleDC': (W.HDC,[W.HDC]), 'CreateCompatibleBitmap': (W.HBITMAP,[W.HDC,C.c_int,C.c_int]),
                'SelectObject': (W.HANDLE,[W.HDC,W.HANDLE]), 'DeleteObject': (W.BOOL,[W.HANDLE]), 'DeleteDC': (W.BOOL,[W.HDC]),
                'BitBlt': (W.BOOL,[W.HDC,C.c_int,C.c_int,C.c_int,C.c_int,W.HDC,C.c_int,C.c_int,W.DWORD]),
                'StretchBlt': (W.BOOL,[W.HDC,C.c_int,C.c_int,C.c_int,C.c_int,W.HDC,C.c_int,C.c_int,C.c_int,C.c_int,W.DWORD]),
                'GetPixel': (W.DWORD,[W.HDC,C.c_int,C.c_int]), 'CreateSolidBrush': (W.HBRUSH,[W.DWORD]),
                'SetTextColor': (W.DWORD,[W.HDC,W.DWORD]), 'SetBkMode': (C.c_int,[W.HDC,C.c_int]),
                'GetStockObject': (W.HANDLE,[C.c_int]), 'SetStretchBltMode': (C.c_int,[W.HDC,C.c_int]),
            },
            'k': {'GetModuleHandleW': (W.HINSTANCE,[W.LPCWSTR])},
        }
        for dll, functions in defs.items():
            for name, (result,args) in functions.items():
                f = getattr(getattr(self,dll),name);f.restype=result;f.argtypes=args


class Surface:
    def __init__(self, win, bounds, solid=None):
        self.win, self.bounds = win, bounds
        self.dc=self.bitmap=self.old=None
        x,y,width,height=bounds
        if width<=0 or height<=0 or width>32767 or height>32767 or width*height>64000000:
            raise RuntimeError('The screen size is not supported by the colour picker.')
        screen=win.u.GetDC(None)
        if not screen: raise RuntimeError('Could not access the screen for colour selection.')
        try:
            self.dc=win.g.CreateCompatibleDC(screen)
            self.bitmap=win.g.CreateCompatibleBitmap(screen,width,height)
            if not self.dc or not self.bitmap:raise RuntimeError('Could not prepare the screen picker.')
            self.old=win.g.SelectObject(self.dc,self.bitmap)
            if solid is None:
                if not win.g.BitBlt(self.dc,0,0,width,height,screen,x,y,0x40CC0020):
                    raise RuntimeError('Could not capture the screen for colour selection.')
            else:
                brush=win.g.CreateSolidBrush(solid)
                try:win.u.FillRect(self.dc,C.byref(W.RECT(0,0,width,height)),brush)
                finally:win.g.DeleteObject(brush)
        except Exception:
            self.close();raise
        finally:
            win.u.ReleaseDC(None,screen)

    def close(self):
        if self.old:self.win.g.SelectObject(self.dc,self.old)
        if self.bitmap:self.win.g.DeleteObject(self.bitmap)
        if self.dc:self.win.g.DeleteDC(self.dc)
        self.dc=self.bitmap=self.old=None


def _run(win, surface, *, visible=True, ready=None, timeout=120):
    """The same native window/message loop is tested on an invisible synthetic bitmap."""
    u,g=win.u,win.g
    left,top,width,height=surface.bounds
    cursor=W.POINT();u.GetCursorPos(C.byref(cursor))
    position=[max(0,min(width-1,cursor.x-left)),max(0,min(height-1,cursor.y-top))]
    result={'cancelled':True};failure=[];active=False;pressed=False
    started=time.monotonic();hwnd=None
    name='DeusEdixColour_'+uuid.uuid4().hex
    instance=win.k.GetModuleHandleW(None)
    def pixel(x,y):return g.GetPixel(surface.dc,x,y)
    def fill(dc,rect,color):
        brush=g.CreateSolidBrush(color)
        try:u.FillRect(dc,C.byref(W.RECT(*rect)),brush)
        finally:g.DeleteObject(brush)
    def paint(window):
        ps=win.PAINT();dc=u.BeginPaint(window,C.byref(ps))
        try:
            # Redraw only damaged pixels; the magnifier is never part of the sampled bitmap.
            r=ps.rect;g.BitBlt(dc,r.left,r.top,r.right-r.left,r.bottom-r.top,surface.dc,r.left,r.top,0xCC0020)
            x,y=position
            px=max(0,min(width-210,x+24));py=max(0,min(height-128,y+24))
            fill(dc,(px,py,px+210,py+128),0x232323)
            sx=max(0,min(width-11,x-5));sy=max(0,min(height-11,y-5))
            g.SetStretchBltMode(dc,3)
            g.StretchBlt(dc,px+6,py+6,77,77,surface.dc,sx,sy,11,11,0xCC0020)
            cx,cy=px+6+(x-sx)*7,py+6+(y-sy)*7
            for rect in [(cx,cy,cx+7,cy+1),(cx,cy+6,cx+7,cy+7),(cx,cy,cx+1,cy+7),(cx+6,cy,cx+7,cy+7)]:fill(dc,rect,0xFFFFFF)
            value=pixel(x,y)
            if value!=0xFFFFFFFF:
                fill(dc,(px+94,py+8,px+198,py+44),value)
                g.SetTextColor(dc,0xFFFFFF);g.SetBkMode(dc,1)
                old=g.SelectObject(dc,g.GetStockObject(17))
                try:
                    u.DrawTextW(dc,color_hex(value),-1,C.byref(W.RECT(px+94,py+48,px+204,py+78)),0x24)
                    u.DrawTextW(dc,'Click to pick colour\nEsc / right click to cancel',-1,C.byref(W.RECT(px+8,py+88,px+204,py+126)),0)
                finally:g.SelectObject(dc,old)
        finally:u.EndPaint(window,C.byref(ps))
    @win.PROC
    def proc(window,msg,wp,lp):
        nonlocal active,pressed
        try:
            if msg==0x000F:paint(window);return 0
            if msg==0x0014:return 1
            if msg==0x0200:
                # Client mouse positions are signed 16-bit values (negative monitor origins are in bounds).
                position[:]=[max(0,min(width-1,C.c_short(lp&65535).value)),max(0,min(height-1,C.c_short((lp>>16)&65535).value))]
                u.InvalidateRect(window,None,False);return 0
            if msg==0x0201:
                pressed=time.monotonic()-started>.15;return 0
            if msg==0x0202:
                if pressed:
                    x,y=C.c_short(lp&65535).value,C.c_short((lp>>16)&65535).value
                    if 0<=x<width and 0<=y<height:
                        result.clear();result['sRGBHex']=color_hex(pixel(x,y));u.DestroyWindow(window)
                return 0
            if msg in (0x0204,0x0010) or (msg==0x0100 and wp==27):u.DestroyWindow(window);return 0
            if msg==0x0006:
                if wp&65535:active=True
                elif active:u.DestroyWindow(window)
                return 0
            if msg==0x0113:
                if _cancel.is_set() or time.monotonic()-started>timeout or (visible and u.GetAsyncKeyState(27)&0x8000):u.DestroyWindow(window)
                return 0
            if msg==0x0002:u.PostQuitMessage(0);return 0
            return u.DefWindowProcW(window,msg,wp,lp)
        except Exception as error:
            failure.append(error);u.DestroyWindow(window);return 0
    wc=win.CLASS(0,proc,0,0,instance,None,u.LoadCursorW(None,C.c_void_p(32515)),None,None,name)
    if not u.RegisterClassW(C.byref(wc)):raise C.WinError(C.get_last_error())
    try:
        hwnd=u.CreateWindowExW(0x88,name,'DeusEdix — Pick colour',0x80000000,left,top,width,height,None,None,instance,None)
        if not hwnd:raise C.WinError(C.get_last_error())
        if visible:u.ShowWindow(hwnd,5);u.SetForegroundWindow(hwnd);u.SetFocus(hwnd)
        if not u.SetTimer(hwnd,1,50,None):raise RuntimeError('Could not start the colour picker.')
        if ready:ready(hwnd,proc)
        msg=W.MSG()
        while True:
            code=u.GetMessageW(C.byref(msg),None,0,0)
            if code==0:break
            if code==-1:raise C.WinError(C.get_last_error())
            u.TranslateMessage(C.byref(msg));u.DispatchMessageW(C.byref(msg))
        if failure:raise failure[0]
        return result
    finally:
        if hwnd and u.IsWindow(hwnd):u.KillTimer(hwnd,1);u.DestroyWindow(hwnd)
        u.UnregisterClassW(name,instance)


def pick(token):
    global _active_token
    if sys.platform!='win32':raise ValueError('Screen picking requires a supported browser or the Windows desktop editor.')
    if not _lock.acquire(blocking=False):raise ValueError('A colour picker is already open. Press Esc to close it.')
    win=None;previous=None;surface=None
    try:
        with _state_lock:
            _cancel.clear()
            if _cancelled.pop(token, None) is not None: return {'cancelled': True}
            _active_token = token
        win=Win()
        previous=win.u.SetThreadDpiAwarenessContext(C.c_void_p(-4))
        if not previous:raise RuntimeError('Could not set the screen picker pixel scale.')
        bounds=tuple(win.u.GetSystemMetrics(i) for i in (76,77,78,79))
        surface=Surface(win,bounds)
        if _cancel.is_set(): return {'cancelled': True}
        return _run(win,surface)
    finally:
        if surface:surface.close()
        if win and previous:win.u.SetThreadDpiAwarenessContext(previous)
        with _state_lock:
            _active_token = None
            _cancelled.pop(token, None)
        _lock.release()
