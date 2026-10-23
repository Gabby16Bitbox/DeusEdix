// Diagnostic-only interception of the single OptGeom call in SDK MAP REBUILD.
// Installed Editor.dll SHA256 is checked by the Python caller. No DLL on disk
// is written. The complete stock command executes, with this one call changed.
static int regionFullHookPrecise=0,regionFullHookCalls=0,regionFullHookFailed=0;
static void __fastcall regionFullOptBridge(UEditorEngine* editor,void*,UModel* model) {
    regionFullHookCalls++;
    if(editor!=GEditor || model!=GEditor->Level->Model) {regionFullHookFailed=1;return;}
    if(regionFullHookPrecise) {
        if(!regionOptimizePrecise(model,1))regionFullHookFailed=1;
    } else editor->UEditorEngine::bspOptGeom(model);
}
static int regionFullMapRebuild(int precise) {
    HMODULE module=GetModuleHandleA("Editor.dll");if(!module)return 0;
    BYTE* image=(BYTE*)module;
    IMAGE_DOS_HEADER* dos=(IMAGE_DOS_HEADER*)image;
    IMAGE_NT_HEADERS* pe=(IMAGE_NT_HEADERS*)(image+dos->e_lfanew);
    if(dos->e_magic!=IMAGE_DOS_SIGNATURE || pe->Signature!=IMAGE_NT_SIGNATURE ||
       pe->FileHeader.TimeDateStamp!=984703280 || pe->OptionalHeader.SizeOfImage!=0x18f000)return 0;
    BYTE* site=image+0x58988;
    const BYTE expected[6]={0xff,0x90,0xec,0x01,0x00,0x00};
    if(memcmp(site,expected,6))return 0;
    // Confirm the slot referenced by the original instruction is OptGeom.
    BYTE* exported=(BYTE*)GetProcAddress(module,"?bspOptGeom@UEditorEngine@@UAEXPAVUModel@@@Z");
    if(!exported)return 0;
    BYTE* target=exported;
    if(*exported==0xe9)target=exported+5+*(LONG*)(exported+1);
    void* slot=(*(void***)GEditor)[0x1ec/sizeof(void*)];
    if(slot!=exported && slot!=target)return 0;
    BYTE replacement[6]={0xe8,0,0,0,0,0x90};
    *(LONG*)(replacement+1)=(LONG)((BYTE*)&regionFullOptBridge-(site+5));
    DWORD oldProtection,ignored;
    if(!VirtualProtect(site,6,PAGE_EXECUTE_READWRITE,&oldProtection))return 0;
    regionFullHookPrecise=precise;regionFullHookCalls=0;regionFullHookFailed=0;
    int success=0;
    __try {
        memcpy(site,replacement,6);FlushInstructionCache(GetCurrentProcess(),site,6);
        success=GEditor->Exec(TEXT("MAP REBUILD"),*GWarn);
    } __finally {
        memcpy(site,expected,6);FlushInstructionCache(GetCurrentProcess(),site,6);
        if(!VirtualProtect(site,6,oldProtection,&ignored) || memcmp(site,expected,6))ExitProcess(83);
    }
    printf("UCMapKit|stock MAP hook|%d precise|%d calls|%d failed|restored\n",
           precise,regionFullHookCalls,regionFullHookFailed);
    return success && regionFullHookCalls==1 && !regionFullHookFailed;
}
