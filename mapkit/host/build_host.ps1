# Builds, 32 bit, into mapkit\bin:
#   UCEngineBridge.dll  the bridge to Deus Ex's engine (UCEngineBridge.cpp), the one part compiled against the engine's
#                       headers: the SDK headers and import libraries made by dev\prepare_sdk.py (build_tools\sdk), read only
#   UCMapKitHost.exe    the host (UCMapKitHost.cpp): standard C++, no engine header (README.md)
param([string]$Lab = (Join-Path $PSScriptRoot '..\..\build_tools\sdk'))
$ErrorActionPreference = 'Stop'
$lab = Resolve-Path $Lab
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vsRoot = & $vswhere -latest -products '*' -property installationPath
if (-not $vsRoot) { throw 'Visual Studio Build Tools required' }
$msvc = Get-ChildItem -LiteralPath (Join-Path $vsRoot 'VC\Tools\MSVC') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$kitRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10'
$kit = Get-ChildItem -LiteralPath (Join-Path $kitRoot 'Include') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$compiler = Join-Path $msvc.FullName 'bin\Hostx64\x86\cl.exe'
$outDir = Join-Path $PSScriptRoot '..\bin'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outDir = Resolve-Path $outDir

# both: C++17, the security checks (/sdl), Control Flow Guard, CET shadow stacks, ASLR, DEP
$compile = @('/nologo', '/O2', '/MT', '/EHsc', '/std:c++17', '/sdl', '/guard:cf', '/D_UNICODE', '/DUNICODE',
    '/DWIN32_LEAN_AND_MEAN', '/D_CRT_SECURE_NO_WARNINGS',
    ('/I' + (Join-Path $PSScriptRoot 'third_party')),          # nlohmann/json
    ('/I' + (Join-Path $msvc.FullName 'include')),
    ('/I' + (Join-Path $kit.FullName 'ucrt')),
    ('/I' + (Join-Path $kit.FullName 'shared')),
    ('/I' + (Join-Path $kit.FullName 'um')))
$link = @('/link', '/DYNAMICBASE', '/NXCOMPAT', '/GUARD:CF', '/CETCOMPAT',
    ('/LIBPATH:' + (Join-Path $msvc.FullName 'lib\x86')),
    ('/LIBPATH:' + (Join-Path $kitRoot ('Lib\' + $kit.Name + '\ucrt\x86'))),
    ('/LIBPATH:' + (Join-Path $kitRoot ('Lib\' + $kit.Name + '\um\x86'))), 'kernel32.lib')

# The bridge. /Zc:wchar_t-: the game's DLLs were built by Visual C++ 6, whose wchar_t was an unsigned short; their
# exports are named with it, and the headers fill TCHAR arrays with wide literals (guard() in every function).
$bridge = $compile + @('/LD', '/Zc:wchar_t-',
    ('/I' + (Join-Path $lab 'headers\Core\Inc')),
    ('/I' + (Join-Path $lab 'headers\Engine\Inc')),
    ('/I' + (Join-Path $lab 'headers\Editor\Inc')),
    ('/I' + (Join-Path $lab 'headers\Window\Inc')),
    ('/I' + (Join-Path $lab 'headers\Extension\Inc')),
    ('/I' + (Join-Path $lab 'headers\ConSys\Inc')),
    ('/Fo' + (Join-Path $outDir 'UCEngineBridge.obj')),
    ('/Fe' + (Join-Path $outDir 'UCEngineBridge.dll')),
    (Join-Path $PSScriptRoot 'UCEngineBridge.cpp')) + $link + @(
    (Join-Path $lab 'Core.lib'), (Join-Path $lab 'Engine.lib'), (Join-Path $lab 'Editor.lib'), (Join-Path $lab 'Window.lib'),
    # Extension.dll and ConSys.dll load at the first call of one of their methods (the text and conversation
    # dumps), when the engine has already loaded them for their packages: the bridge starts the same without them
    (Join-Path $lab 'Extension.lib'), (Join-Path $lab 'ConSys.lib'), 'delayimp.lib',
    '/DELAYLOAD:Extension.dll', '/DELAYLOAD:ConSys.dll')
& $compiler @bridge
if ($LASTEXITCODE -ne 0) { throw 'UCEngineBridge compilation failed' }

# The host. Large address aware: 4 GB of address space on 64-bit Windows instead of 2. With a large map loaded, the
# NVIDIA OpenGL driver ran out of room creating the hidden viewport of LIGHT APPLY and crashed (nvoglv32.dll).
$hostArgs = $compile + @(
    ('/Fo' + (Join-Path $outDir 'UCMapKitHost.obj')),
    ('/Fe' + (Join-Path $outDir 'UCMapKitHost.exe')),
    (Join-Path $PSScriptRoot 'UCMapKitHost.cpp')) + $link + @('/LARGEADDRESSAWARE')
& $compiler @hostArgs
if ($LASTEXITCODE -ne 0) { throw 'UCMapKitHost compilation failed' }
"built " + (Join-Path $outDir 'UCEngineBridge.dll') + ", " + (Join-Path $outDir 'UCMapKitHost.exe')
