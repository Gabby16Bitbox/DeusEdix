/* bridge.h: the C interface between the headless host (UCMapKitHost.exe) and an engine bridge (a DLL).

   The host reads the commands, runs the session and writes the files; a bridge is the only code that talks to a
   game engine. UCEngineBridge.dll is the bridge for Deus Ex's own engine (Editor.dll of the SDK 1112f); another
   engine (Surreal Engine, or build tools written anew) is another DLL with the same functions, chosen when the host
   starts (--bridge). Plain C on both sides: each can be built by any compiler with its own settings.

   Every function returns 1 when the command worked and 0 when it failed (the host reports the failure). A bridge
   prints its answers ("UCMapKit|..." lines, README.md) and writes its files through the UCHostApi it is given:
   it never opens a file or writes to the console itself. Strings are UTF-8. */
#ifndef UC_BRIDGE_H
#define UC_BRIDGE_H

#include <stddef.h>

#define UC_BRIDGE_VERSION 1
#define UC_BRIDGE_ENTRY "UCBridge_Api"          /* the one function a bridge DLL exports (UCBridgeEntry) */

#ifdef __cplusplus
extern "C" {
#endif

/* An output file the host opened for a bridge. */
typedef struct UCFile UCFile;

/* What the host gives a bridge. */
typedef struct UCHostApi {
    void (*print)(const char* line);                            /* a line on stdout */
    void (*error)(const char* line);                            /* a line on stderr */
    UCFile* (*open)(const char* path, int append);              /* NULL when the file cannot be written */
    void (*row)(UCFile* file, const char* json);                /* one JSON value: a line of the file */
    void (*bytes)(UCFile* file, const void* data, size_t size); /* binary data, after a header row */
    void (*close)(UCFile* file);
} UCHostApi;

/* A new animation of UC_ANIMNEW: its frames follow the ones before it in the frame data. */
typedef struct UCSequence {
    const char* name;
    const char* group;
    int frames;
    float rate;
} UCSequence;

/* UC_SURFACE <brush> <source polygon or *> <mode> [text | x y | set clear]: the words after the mode as text, and as
   numbers when they are two numbers (pan, scale: x y; flags: the bits to set and to clear). */
typedef struct UCSurfaceEdit {
    const char* brush;
    const char* target;
    const char* mode;
    const char* text;
    int hasXY;
    float x, y;
    int hasFlags;
    unsigned long set, clear;
} UCSurfaceEdit;

/* A bridge's functions, the commands of README.md in the same order. */
typedef struct UCBridgeApi {
    int version;                                                /* UC_BRIDGE_VERSION */
    const char* engine;                                         /* what it runs, for the log */
    int (*start)(const UCHostApi* host);                        /* the editor engine, ready for commands */
    void (*stop)(void);
    int (*make)(const UCHostApi* host, const char* ini);        /* the UnrealScript compiler: the process's exit code */
    int (*exec)(const char* line);                              /* an UnrealEd command (MAP LOAD, BSP REBUILD...) */
    int (*actorCount)(void);                                    /* the level's actors, -1 without a level */

    /* level geometry and lighting */
    int (*point)(float x, float y, float z);
    int (*trace)(const float from[3], const float to[3]);
    int (*bspDump)(const char* file);
    int (*brushes)(const char* file);
    int (*unlink)(const char* modelPrefix);
    int (*finishWorld)(void);
    int (*sizes)(const char* file);
    int (*checkActors)(void);
    int (*lightDump)(const char* file);
    int (*lightStats)(void);
    int (*clearCameras)(void);
    /* actors and properties */
    int (*setActor)(const char* name, float x, float y, float z, int pitch, int yaw, int roll);
    int (*deleteActor)(const char* name);
    int (*setProp)(const char* name, const char* property, const char* value);
    int (*scaleActor)(const char* name, float factor);
    int (*setObjProp)(const char* object, const char* property, const char* value);
    int (*mover)(const char* operation, const char* name, float x, float y, float z);
    int (*meshes)(const char* file);
    /* surfaces */
    int (*surfTexture)(const char* brush, const char* oldTexture, const char* newTexture);
    int (*surface)(const UCSurfaceEdit* edit);
    /* AI paths */
    int (*paths)(const char* file);
    int (*navDrop)(const char* const* names, int count);       /* names: "*" for every point */
    int (*navDropTemp)(void);
    int (*navLift)(void);
    int (*keepPaths)(int restore);
    /* game content, read only */
    int (*classes)(const char* file);
    int (*defaults)(const char* file, const char* const* properties, int count);
    int (*classProps)(const char* file, const char* className);
    int (*texDump)(const char* texture, const char* file, int maxSize);
    int (*texFlags)(const char* file);
    int (*sounds)(const char* file);
    int (*meshList)(const char* file);
    int (*animDump)(const char* mesh, const char* file);
    int (*scriptDump)(const char* package, const char* file);
    int (*textDump)(const char* package, const char* file);
    int (*conDump)(const char* file);
    int (*conSound)(const char* conversation, int soundId, const char* file);
    /* packages and models */
    int (*loadPackage)(const char* path);
    int (*meshImport)(const char* package, const char* name, const char* anivFile, const char* dataFile, int oldFormat,
                      int lod);
    int (*savePackage)(const char* package, const char* file);
    int (*animNew)(const char* source, const char* package, const char* name, const UCSequence* sequences, int count,
                   const void* frames, size_t size);
    int (*animSave)(const char* file);
} UCBridgeApi;

/* The export of a bridge DLL: its functions for this version of the interface, NULL when it has no such version. */
typedef const UCBridgeApi* (*UCBridgeEntry)(int version);

#ifdef __cplusplus
}
#endif

#endif
