// UCMapKitHost: the headless host of the map editor. It reads commands (a file, or stdin in a session), hands each
// one to an engine bridge (bridge.h; UCEngineBridge.dll runs Deus Ex's own engine) and writes what the bridge gives
// back: its answers on stdout, its rows in files. No engine header here: standard C++ (README.md).
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <float.h>
#include <string>
#include <vector>
#include "nlohmann/json.hpp"
#include "bridge.h"

typedef nlohmann::json Json;

static const UCBridgeApi* Bridge = NULL;

// ---------------------------------------------------------------- the host's side of bridge.h
// every line flushed: a critical error in the engine ends the process at once
static void print(const char* line) {
    fputs(line, stdout);
    fputc('\n', stdout);
    fflush(stdout);
}
static void error(const char* line) {
    fputs(line, stderr);
    fputc('\n', stderr);
    fflush(stderr);
}

// UTF-8 as the file system's UTF-16 (a path may have any letter)
static std::wstring wide(const char* text) {
    int size = MultiByteToWideChar(CP_UTF8, 0, text, -1, NULL, 0);
    std::wstring out(size > 1 ? size - 1 : 0, L'\0');
    if (size > 1) MultiByteToWideChar(CP_UTF8, 0, text, -1, &out[0], size);
    return out;
}

struct UCFile { FILE* file; };
static UCFile* openFile(const char* path, int append) {
    FILE* f = _wfopen(wide(path).c_str(), append ? L"ab" : L"wb");
    if (!f) return NULL;
    UCFile* file = new UCFile;
    file->file = f;
    return file;
}
static void writeRow(UCFile* file, const char* json) {
    fputs(json, file->file);
    fputc('\n', file->file);
}
static void writeBytes(UCFile* file, const void* data, size_t size) {
    fwrite(data, 1, size, file->file);
}
static void closeFile(UCFile* file) {
    fclose(file->file);
    delete file;
}
static const UCHostApi Host = { print, error, openFile, writeRow, writeBytes, closeFile };

static bool readFile(const char* path, std::string& out) {
    FILE* f = _wfopen(wide(path).c_str(), L"rb");
    if (!f) return false;
    char chunk[65536];
    size_t got;
    out.clear();
    while ((got = fread(chunk, 1, sizeof(chunk), f)) > 0) out.append(chunk, got);
    fclose(f);
    return true;
}

// ---------------------------------------------------------------- the commands
// The words of a command line. Word 0 is the command; a word ends at a space or a tab. rest(i) is the line from
// word i to its end as it was written (a property's value, a path with spaces).
class Args {
public:
    explicit Args(const char* line) : line(line) {
        const char* p = line;
        for (;;) {
            while (*p == ' ' || *p == '\t') p++;
            if (!*p) break;
            const char* start = p;
            while (*p && *p != ' ' && *p != '\t') p++;
            Word word = { std::string(start, p), (size_t)(start - line) };
            words.push_back(word);
        }
    }
    size_t count() const { return words.size(); }
    const char* operator[](size_t i) const { return i < words.size() ? words[i].text.c_str() : ""; }
    const char* rest(size_t i) const { return i < words.size() ? line + words[i].at : ""; }
    bool is(size_t i, const char* text) const { return i < words.size() && words[i].text == text; }
    // a number that is the whole word, finite
    bool number(size_t i, float& out) const {
        const char* text = (*this)[i];
        char* end;
        out = (float)strtod(text, &end);
        return *text && !*end && _finite(out);
    }
    bool number(size_t i, int& out) const {
        const char* text = (*this)[i];
        char* end;
        out = (int)strtol(text, &end, 10);
        return *text && !*end;
    }
    bool number(size_t i, unsigned long& out) const {
        const char* text = (*this)[i];
        char* end;
        out = strtoul(text, &end, 10);
        return *text && *text != '-' && !*end;
    }
    bool numbers(size_t from, float* out, int n) const {
        for (int k = 0; k < n; k++)
            if (!number(from + k, out[k])) return false;
        return true;
    }
    // the words from i on, for a C function (valid while this Args lives)
    std::vector<const char*> list(size_t from) const {
        std::vector<const char*> out;
        for (size_t k = from; k < words.size(); k++) out.push_back(words[k].text.c_str());
        return out;
    }
private:
    struct Word { std::string text; size_t at; };
    const char* line;
    std::vector<Word> words;
};

// UC_TEXTHEX <name> <property> <hex>: a text property given as the hex of its UTF-8. Lossless: T3D has no reliable
// quote escaping, and UC_PROP's words lose leading spaces; the engine reads the text as it is.
static int hexDigit(char c) {
    return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
}
static int setTextHex(const Args& a) {
    if (a.count() != 4) return 0;
    std::string hex = a[3], value;
    if (hex.size() % 2) return 0;
    for (size_t i = 0; i < hex.size(); i += 2) {
        int high = hexDigit(hex[i]), low = hexDigit(hex[i + 1]);
        if (high < 0 || low < 0 || (high == 0 && low == 0)) return 0;
        value += (char)((high << 4) | low);
    }
    return Bridge->setProp(a[1], a[2], value.c_str());
}

// UC_DEFAULTS <file> <prop,prop,...>
static int classDefaults(const Args& a) {
    if (a.count() != 3) return 0;
    std::vector<std::string> names;
    std::string list = a[2];
    for (size_t from = 0, comma; from <= list.size(); from = comma + 1) {
        comma = list.find(',', from);
        if (comma == std::string::npos) comma = list.size();
        if (comma > from) names.push_back(list.substr(from, comma - from));
    }
    std::vector<const char*> pointers;
    for (size_t k = 0; k < names.size(); k++) pointers.push_back(names[k].c_str());
    return Bridge->defaults(a[1], pointers.empty() ? NULL : &pointers[0], (int)pointers.size());
}

// UC_NAVDROP temp, or UC_NAVDROP <* | name name ...>
static int navDrop(const Args& a) {
    if (a.count() == 2 && a.is(1, "temp")) return Bridge->navDropTemp();
    if (a.count() < 2) return 0;
    std::vector<const char*> names = a.list(1);
    return Bridge->navDrop(&names[0], (int)names.size());
}

// UC_SURFACE <brush> <source polygon or *> <mode> [text | x y | set clear]
static int surface(const Args& a) {
    if (a.count() < 4) return 0;
    UCSurfaceEdit edit = {};
    edit.brush = a[1];
    edit.target = a[2];
    edit.mode = a[3];
    edit.text = a[4];
    edit.hasXY = a.count() == 6 && a.number(4, edit.x) && a.number(5, edit.y);
    edit.hasFlags = a.count() == 6 && a.number(4, edit.set) && a.number(5, edit.clear);
    return Bridge->surface(&edit);
}

// UC_ANIMNEW <source model> <package> <name> <file>: the file is a JSON line {sequences: [{name, group, frames,
// rate}]}, the line "data", then the new frames (README.md)
static int animNew(const Args& a) {
    if (a.count() != 5) return 0;
    std::string file;
    if (!readFile(a[4], file)) return 0;
    size_t data = file.find("\ndata\n");
    if (data == std::string::npos) { print("UCMapKit|animnew|no data"); return 0; }
    Json header = Json::parse(file.substr(0, data), NULL, false);
    if (header.is_discarded() || !header.is_object() || !header["sequences"].is_array()) {
        print("UCMapKit|animnew|bad header");
        return 0;
    }
    std::vector<std::string> names, groups;
    for (const Json& s : header["sequences"]) {
        names.push_back(s.value("name", std::string()));
        groups.push_back(s.value("group", std::string("UCAnim")));
    }
    std::vector<UCSequence> sequences;
    size_t k = 0;
    for (const Json& s : header["sequences"]) {
        UCSequence seq = { names[k].c_str(), groups[k].c_str(), s.value("frames", 0), s.value("rate", 0.f) };
        sequences.push_back(seq);
        k++;
    }
    return Bridge->animNew(a[1], a[2], a[3], sequences.empty() ? NULL : &sequences[0], (int)sequences.size(),
                           file.data() + data + 6, file.size() - (data + 6));
}

typedef int (*Command)(const Args& a);
static const struct { const char* name; Command run; } Commands[] = {
    // level geometry and lighting
    { "UC_POINT", [](const Args& a) { float p[3]; return int(a.count() == 4 && a.numbers(1, p, 3) && Bridge->point(p[0], p[1], p[2])); } },
    { "UC_TRACE", [](const Args& a) { float p[6]; return int(a.count() == 7 && a.numbers(1, p, 6) && Bridge->trace(p, p + 3)); } },
    { "UC_BSPDUMP", [](const Args& a) { return int(a.count() == 2 && Bridge->bspDump(a[1])); } },
    { "UC_BRUSHES", [](const Args& a) { return int(a.count() == 2 && Bridge->brushes(a[1])); } },
    { "UC_UNLINK", [](const Args& a) { return int(a.count() == 2 && Bridge->unlink(a[1])); } },
    { "UC_WORLD", [](const Args& a) { return int(a.count() == 2 && a.is(1, "finish") && Bridge->finishWorld()); } },
    { "UC_SIZES", [](const Args& a) { return int(a.count() == 2 && Bridge->sizes(a[1])); } },
    { "UC_ACTORS", [](const Args& a) { return int(a.count() == 2 && a.is(1, "check") && Bridge->checkActors()); } },
    { "UC_LIGHTDUMP", [](const Args& a) { return int(a.count() == 2 && Bridge->lightDump(a[1])); } },
    { "UC_LIGHTSTATS", [](const Args& a) { return int(a.count() == 1 && Bridge->lightStats()); } },
    { "UC_CAMERAS", [](const Args& a) { return int(a.count() == 2 && a.is(1, "clear") && Bridge->clearCameras()); } },
    // actors and properties
    { "UC_SET", [](const Args& a) {
        float p[3];
        int r[3];
        return int(a.count() == 8 && a.numbers(2, p, 3) && a.number(5, r[0]) && a.number(6, r[1]) && a.number(7, r[2])
                   && Bridge->setActor(a[1], p[0], p[1], p[2], r[0], r[1], r[2])); } },
    { "UC_DEL", [](const Args& a) { return int(a.count() == 2 && Bridge->deleteActor(a[1])); } },
    { "UC_PROP", [](const Args& a) { return int(a.count() >= 3 && Bridge->setProp(a[1], a[2], a.rest(3))); } },
    { "UC_TEXTHEX", setTextHex },
    { "UC_SCALE", [](const Args& a) { float f; return int(a.count() == 3 && a.number(2, f) && Bridge->scaleActor(a[1], f)); } },
    { "UC_OBJPROP", [](const Args& a) { return int(a.count() >= 3 && Bridge->setObjProp(a[1], a[2], a.rest(3))); } },
    { "UC_MOVER", [](const Args& a) { float p[3]; return int(a.count() == 6 && a.numbers(3, p, 3) && Bridge->mover(a[1], a[2], p[0], p[1], p[2])); } },
    { "UC_MESHES", [](const Args& a) { return int(a.count() == 2 && Bridge->meshes(a[1])); } },
    // surfaces
    { "UC_SURFTEX", [](const Args& a) { return int(a.count() == 4 && Bridge->surfTexture(a[1], a[2], a[3])); } },
    { "UC_SURFACE", surface },
    // AI paths
    { "UC_PATHS", [](const Args& a) { return int(a.count() == 2 && Bridge->paths(a[1])); } },
    { "UC_NAVDROP", navDrop },
    { "UC_NAVLIFT", [](const Args& a) { return int(a.count() == 1 && Bridge->navLift()); } },
    { "UC_KEEPPATHS", [](const Args& a) { return int(a.count() == 2 && (a.is(1, "save") || a.is(1, "restore")) && Bridge->keepPaths(a.is(1, "restore"))); } },
    // game content, read only
    { "UC_CLASSES", [](const Args& a) { return int(a.count() == 2 && Bridge->classes(a[1])); } },
    { "UC_DEFAULTS", classDefaults },
    { "UC_CLASSPROPS", [](const Args& a) { return int(a.count() == 3 && Bridge->classProps(a[1], a[2])); } },
    { "UC_TEXDUMP", [](const Args& a) {
        int maxSize = 256;                          // UC_TEXDUMP <tex> <file> [largest side]
        return int((a.count() == 3 || (a.count() == 4 && a.number(3, maxSize))) && Bridge->texDump(a[1], a[2], maxSize)); } },
    { "UC_TEXFLAGS", [](const Args& a) { return int(a.count() == 2 && Bridge->texFlags(a[1])); } },
    { "UC_SOUNDS", [](const Args& a) { return int(a.count() == 2 && Bridge->sounds(a[1])); } },
    { "UC_MESHLIST", [](const Args& a) { return int(a.count() == 2 && Bridge->meshList(a[1])); } },
    { "UC_ANIMDUMP", [](const Args& a) { return int(a.count() == 3 && Bridge->animDump(a[1], a[2])); } },
    { "UC_SCRIPTDUMP", [](const Args& a) { return int(a.count() == 3 && Bridge->scriptDump(a[1], a[2])); } },
    { "UC_TEXTDUMP", [](const Args& a) { return int(a.count() == 3 && Bridge->textDump(a[1], a[2])); } },
    { "UC_CONDUMP", [](const Args& a) { return int(a.count() == 2 && Bridge->conDump(a[1])); } },
    { "UC_CONSOUND", [](const Args& a) { int id; return int(a.count() == 4 && a.number(2, id) && Bridge->conSound(a[1], id, a[3])); } },
    // packages and models
    { "UC_LOADPKG", [](const Args& a) { return int(Bridge->loadPackage(a.rest(1))); } },
    { "UC_MESHIMPORT", [](const Args& a) {
        int old = 0, lod = 1;                       // UC_MESHIMPORT <package> <name> <anivfile> <datafile> [old [lod]]
        return int(a.count() >= 5 && a.count() <= 7 && (a.count() < 6 || a.number(5, old)) && (a.count() < 7 || a.number(6, lod))
                   && Bridge->meshImport(a[1], a[2], a[3], a[4], old, lod)); } },
    { "UC_SAVEPKG", [](const Args& a) { return int(a.count() == 3 && Bridge->savePackage(a[1], a[2])); } },
    { "UC_ANIMNEW", animNew },
    { "UC_ANIMSAVE", [](const Args& a) { return int(a.count() == 2 && Bridge->animSave(a[1])); } },
};

// A host command, or else UnrealEd's own (MAP LOAD, BSP REBUILD, LIGHT APPLY...)
static int runCommand(const char* line) {
    Args args(line);
    for (size_t i = 0; i < sizeof(Commands) / sizeof(Commands[0]); i++)
        if (args.is(0, Commands[i].name)) return Commands[i].run(args);
    return Bridge->exec(line);
}

// A crash in the engine fails its command, not the session.
static int guardedCommand(const char* line) {
    __try {
        return runCommand(line);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        printf("UCMapKit|fault|0x%08lx\n", GetExceptionCode());
        fflush(stdout);
        return 0;
    }
}

// ---------------------------------------------------------------- the session
// First-chance access violations on any thread: module + offset in the log (diagnostics).
static LONG CALLBACK reportFault(PEXCEPTION_POINTERS info) {
    if (info->ExceptionRecord->ExceptionCode != EXCEPTION_ACCESS_VIOLATION) return EXCEPTION_CONTINUE_SEARCH;
    void* address = info->ExceptionRecord->ExceptionAddress;
    HMODULE module = NULL;
    char name[MAX_PATH] = "?";
    if (GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                           (LPCSTR)address, &module) && module)
        GetModuleFileNameA(module, name, sizeof(name));
    std::string file = name;
    printf("UCMapKit|av|%s+0x%lx|%s 0x%08lx\n", file.substr(file.find_last_of('\\') + 1).c_str(),
           (unsigned long)((char*)address - (char*)module), info->ExceptionRecord->ExceptionInformation[0] ? "write" : "read",
           (unsigned long)info->ExceptionRecord->ExceptionInformation[1]);
    fflush(stdout);
    return EXCEPTION_CONTINUE_SEARCH;
}

// The host and its engine run in a job of their own: no other process can be started from it, it cannot reach the
// clipboard, the display settings or other desktops, and a crash ends it instead of waiting on an error dialog. A
// map or package made to attack the 2000s engine code that reads it gets that much less to work with (README.md).
static void isolate() {
    HANDLE job = CreateJobObjectW(NULL, NULL);
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
    limits.BasicLimitInformation.ActiveProcessLimit = 1;
    JOBOBJECT_BASIC_UI_RESTRICTIONS ui = { JOB_OBJECT_UILIMIT_DESKTOP | JOB_OBJECT_UILIMIT_DISPLAYSETTINGS
        | JOB_OBJECT_UILIMIT_EXITWINDOWS | JOB_OBJECT_UILIMIT_READCLIPBOARD | JOB_OBJECT_UILIMIT_WRITECLIPBOARD
        | JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS };
    if (!job || !SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))
        || !SetInformationJobObject(job, JobObjectBasicUIRestrictions, &ui, sizeof(ui))
        || !AssignProcessToJobObject(job, GetCurrentProcess()))
        printf("UCMapKit|isolation|failed|%lu\n", GetLastError());
    // the job's handle stays open: the job ends with the process
}

// The engine bridge: by default UCEngineBridge.dll next to the host (loaded by its full path, never searched for)
static bool loadBridge(const std::wstring& path) {
    HMODULE dll = LoadLibraryExW(path.c_str(), NULL, LOAD_WITH_ALTERED_SEARCH_PATH);
    UCBridgeEntry entry = dll ? (UCBridgeEntry)GetProcAddress(dll, UC_BRIDGE_ENTRY) : NULL;
    Bridge = entry ? entry(UC_BRIDGE_VERSION) : NULL;
    return Bridge != NULL;
}
static std::wstring besideHost(const wchar_t* name) {
    std::vector<wchar_t> path(MAX_PATH);
    DWORD n;
    while ((n = GetModuleFileNameW(NULL, &path[0], (DWORD)path.size())) == path.size()) path.resize(path.size() * 2);
    std::wstring exe(&path[0], n);
    return exe.substr(0, exe.find_last_of(L'\\') + 1) + name;
}

// One command a line, of any length.
static bool readLine(FILE* input, std::string& line) {
    char chunk[8192];
    line.clear();
    while (fgets(chunk, sizeof(chunk), input)) {
        line += chunk;
        if (line[line.size() - 1] == '\n') break;
    }
    if (line.empty()) return false;
    line.erase(line.find_last_not_of("\r\n") + 1);
    return true;
}

// UCMapKitHost [--bridge <dll>] <command file | - | --make [ini]>
int main(int argc, char** argv) {
    AddVectoredExceptionHandler(1, reportFault);
    isolate();
    int first = 1;
    std::wstring bridge = besideHost(L"UCEngineBridge.dll");
    if (argc >= 3 && !strcmp(argv[1], "--bridge")) {
        bridge = wide(argv[2]);
        first = 3;
    }
    if (!loadBridge(bridge)) {
        fprintf(stderr, "UCMapKit|failed|no engine bridge (bridge.h version %d)\n", UC_BRIDGE_VERSION);
        return 2;
    }
    if (argc > first && !strcmp(argv[first], "--make")) {
        int result = Bridge->make(&Host, argc > first + 1 ? argv[first + 1] : "DeusEx.ini");
        fflush(stdout);
        return result;
    }
    puts("UCMapKit|initializing SDK"); fflush(stdout);
    if (argc != first + 1) return 2;
    // "-" = interactive: commands from stdin, one reply block per command ending in
    // "UCMapKit|ready"; a failed command is reported and the session goes on.
    int interactive = !strcmp(argv[first], "-");
    FILE* input = interactive ? stdin : _wfopen(wide(argv[first]).c_str(), L"rt");
    if (!input) return 3;
    if (!Bridge->start(&Host)) return 2;
    puts("UCMapKit|ready"); fflush(stdout);
    std::string line;
    while (readLine(input, line)) {
        if (line.empty() || line[0] == '#') { if (interactive) { puts("UCMapKit|ready"); fflush(stdout); } continue; }
        if (interactive && line == "UC_QUIT") break;
        printf("UCMapKit|command|%s\n", line.c_str()); fflush(stdout);
        DWORD start = GetTickCount();
        int success = guardedCommand(line.c_str());
        if (!success) {
            if (!interactive) {
                fprintf(stderr, "UCMapKit|failed|%s\n", line.c_str());
                return 4;
            }
            printf("UCMapKit|failed|%s\n", line.c_str());
        }
        int actors = Bridge->actorCount();
        if (actors >= 0) printf("UCMapKit|actors|%d\n", actors);
        printf("UCMapKit|complete|%lu ms\n", GetTickCount() - start);
        if (interactive) puts("UCMapKit|ready");
        fflush(stdout);
    }
    if (!interactive) fclose(input);
    Bridge->stop();
    puts("UCMapKit|done");
    return 0;
}
