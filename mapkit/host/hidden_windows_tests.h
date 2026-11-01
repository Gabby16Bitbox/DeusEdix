// UC_HIDDEN_WINDOWS_TEST (build_host.ps1 -BspTests only): hideWindows() hides what it must and leaves alone what it
// must, on the host's own thread, the one its hook watches. An ordinary top-level window, as LIGHT APPLY's viewport is,
// gets the hidden window procedure and stays hidden when asked to show. A dialog, the class of a message box, and a
// control on it (a message box's text and buttons are such controls) keep their own procedures and show: an engine
// that asks something must be seen. The windows are tool windows (no taskbar button) that never take the activation,
// shown only off the screen (at -32000, -32000), then destroyed.
static INT_PTR CALLBACK quietDialog(HWND, UINT, WPARAM, LPARAM) {
    return FALSE;                       // the dialog manager's own handling, for every message
}
static int hiddenWindowsTests() {
    // a dialog from a template in memory, as a message box is made, without WS_VISIBLE: shown only when asked
    struct alignas(DWORD) DialogTemplate {
        DLGTEMPLATE dialog;
        WORD menu, windowClass, title;  // all 0: no menu, the dialog class, no title
    } layout = {};
    layout.dialog.style = WS_POPUP;
    layout.dialog.dwExtendedStyle = WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
    layout.dialog.cx = 40;
    layout.dialog.cy = 20;
    HINSTANCE instance = GetModuleHandleW(NULL);
    HWND dialog = CreateDialogIndirectParamW(instance, &layout.dialog, NULL, quietDialog, 0);
    HWND control = dialog ? CreateWindowExW(0, L"BUTTON", L"OK", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 0, 0, 40, 16,
                                            dialog, NULL, instance, NULL) : NULL;
    HWND window = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, L"STATIC", L"", WS_POPUP, 0, 0, 40, 20, NULL,
                                  NULL, instance, NULL);
    const char* failed = NULL;
    if (!dialog || !control || !window) {
        failed = "the test windows could not be made";
    } else if (!GetPropW(window, OwnWindowProc)) {
        failed = "a top-level window has not the hidden window procedure";
    } else if (GetPropW(dialog, OwnWindowProc) || GetPropW(control, OwnWindowProc)) {
        failed = "a dialog or its control has the hidden window procedure";
    } else {
        // asked to show as ShowWindow and SetWindowPos ask (SWP_SHOWWINDOW), off the screen and never activated
        const UINT show = SWP_SHOWWINDOW | SWP_NOACTIVATE | SWP_NOSIZE | SWP_NOZORDER;
        SetWindowPos(window, NULL, -32000, -32000, 0, 0, show);
        SetWindowPos(dialog, NULL, -32000, -32000, 0, 0, show);
        if (IsWindowVisible(window))
            failed = "a top-level window was shown";
        else if (!IsWindowVisible(dialog) || !IsWindowVisible(control))
            failed = "a dialog or its control was kept hidden";
        else
            Sleep(250);                 // long enough for a watcher outside the process to see what is shown
    }
    if (window) DestroyWindow(window);
    if (dialog) DestroyWindow(dialog);  // and its control
    if (failed) {
        say("UCMapKit|windows test failed|%s", failed);
        return 0;
    }
    say("UCMapKit|windows test passed|a top-level window kept hidden|a dialog and its control shown");
    return 1;
}
