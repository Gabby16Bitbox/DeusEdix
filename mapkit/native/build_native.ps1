# Builds, 32 bit, the native part of the package DeusEdixNav into mapkit\bin:
#   DeusEdixNav.dll  the routes on the walkable area (DeusEdixNav.cpp, NavRoute.h), loaded by the game with DeusEdixNav.u:
#                    compiled against the Deus Ex SDK headers and import libraries, like the editor's engine bridge
#   nav_test.exe     NavRoute.h alone, for check_routes.py
# Then build_package.py compiles DeusEdixNav.u (it needs the DLL: the engine binds the native function at once).
# -Lab: the SDK headers and libraries (DeusEdix: build_tools\sdk, made by dev\prepare_sdk.py; the mod: editor_lab).
param([string]$Lab)
$ErrorActionPreference = 'Stop'
if (-not $Lab) {
    $Lab = @((Join-Path $PSScriptRoot '..\..\..\build_tools\sdk'), (Join-Path $PSScriptRoot '..\..\editor_bridge\editor_lab')) |
        Where-Object { Test-Path -LiteralPath (Join-Path $_ 'Core.lib') } | Select-Object -First 1
    if (-not $Lab) { throw 'The SDK headers and libraries were not found: pass -Lab' }
}
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

# C++17, the security checks (/sdl), Control Flow Guard, CET shadow stacks, ASLR, DEP, the C runtime linked in (/MT)
$compile = @('/nologo', '/O2', '/MT', '/EHsc', '/std:c++17', '/sdl', '/guard:cf', '/D_UNICODE', '/DUNICODE',
    '/DWIN32_LEAN_AND_MEAN', '/D_CRT_SECURE_NO_WARNINGS',
    ('/I' + (Join-Path $msvc.FullName 'include')),
    ('/I' + (Join-Path $kit.FullName 'ucrt')),
    ('/I' + (Join-Path $kit.FullName 'shared')),
    ('/I' + (Join-Path $kit.FullName 'um')))
$link = @('/link', '/DYNAMICBASE', '/NXCOMPAT', '/GUARD:CF', '/CETCOMPAT',
    ('/LIBPATH:' + (Join-Path $msvc.FullName 'lib\x86')),
    ('/LIBPATH:' + (Join-Path $kitRoot ('Lib\' + $kit.Name + '\ucrt\x86'))),
    ('/LIBPATH:' + (Join-Path $kitRoot ('Lib\' + $kit.Name + '\um\x86'))), 'kernel32.lib')

# The DLL. /Zc:wchar_t-: the game's DLLs were built by Visual C++ 6, whose wchar_t was an unsigned short; their exports
# are named with it. Only Core.lib: nothing of Engine (Revision rebuilt it).
$dll = $compile + @('/LD', '/Zc:wchar_t-', ('/I' + (Join-Path $lab 'headers\Core\Inc')),
    ('/Fo' + (Join-Path $outDir 'DeusEdixNav.obj')),
    ('/Fe' + (Join-Path $outDir 'DeusEdixNav.dll')),
    (Join-Path $PSScriptRoot 'DeusEdixNav.cpp')) + $link + @((Join-Path $lab 'Core.lib'))
& $compiler @dll
if ($LASTEXITCODE -ne 0) { throw 'DeusEdixNav compilation failed' }

$test = $compile + @(('/Fo' + (Join-Path $outDir 'nav_test.obj')), ('/Fe' + (Join-Path $outDir 'nav_test.exe')),
    (Join-Path $PSScriptRoot 'nav_test.cpp')) + $link
& $compiler @test
if ($LASTEXITCODE -ne 0) { throw 'nav_test compilation failed' }
"built " + (Join-Path $outDir 'DeusEdixNav.dll') + ", " + (Join-Path $outDir 'nav_test.exe')
