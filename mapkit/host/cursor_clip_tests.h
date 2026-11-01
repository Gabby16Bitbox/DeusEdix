// UC_CURSOR_CLIP_TEST (build_host.ps1 -BspTests only): the window drivers never free the cursor. Each one loaded
// (WinDrv.dll, and Revision's WinDrvLite.dll, which calls into it) must have its ClipCursor import slot on
// leaveCursorClip (patchDriverCalls): its ClipCursor(NULL), when a viewport lets go of the mouse and when the engine
// stops, would free the cursor that the program in front confines. Only the slots are read: the cursor is not touched.
static int cursorClipTests() {
    int drivers = 0;
    for (const char* name : { "WinDrv.dll", "WinDrvLite.dll" }) {
        HMODULE module = GetModuleHandleA(name);
        ULONG_PTR* slot = module ? importSlot(module, "USER32.dll", "ClipCursor") : NULL;
        if (!slot) continue;
        if (*slot != (ULONG_PTR)leaveCursorClip) {
            say("UCMapKit|cursor test failed|%s calls Windows' ClipCursor", name);
            return 0;
        }
        drivers++;
    }
    if (!drivers) {
        say("UCMapKit|cursor test failed|no window driver that imports ClipCursor is loaded");
        return 0;
    }
    say("UCMapKit|cursor test passed|%d window driver(s) leave the cursor's clip alone", drivers);
    return 1;
}
