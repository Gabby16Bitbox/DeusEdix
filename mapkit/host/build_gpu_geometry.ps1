param([string]$OutputDirectory = (Join-Path $PSScriptRoot '..\bin'))
$ErrorActionPreference='Stop'
$vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vsRoot=& $vswhere -latest -products '*' -property installationPath
if(-not $vsRoot) {throw 'Visual Studio C++ build tools are required'}
$msvc=Get-ChildItem -LiteralPath (Join-Path $vsRoot 'VC\Tools\MSVC') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$sdkRoot=Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10'
$sdk=Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'Include') -Directory | Sort-Object Name -Descending | Select-Object -First 1
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$output=(Resolve-Path -LiteralPath $OutputDirectory).Path
$compiler=Join-Path $msvc.FullName 'bin\Hostx64\x64\cl.exe'
$flags=@('/nologo','/O2','/MT','/EHsc','/std:c++17','/LD','/fp:strict','/guard:cf','/sdl','/D_CRT_SECURE_NO_WARNINGS',
    ('/I'+(Join-Path $msvc.FullName 'include')),('/I'+(Join-Path $sdk.FullName 'ucrt')),
    ('/I'+(Join-Path $sdk.FullName 'shared')),('/I'+(Join-Path $sdk.FullName 'um')),('/I'+(Join-Path $sdk.FullName 'winrt')),
    ('/Fo'+(Join-Path $output 'DeusEdixGeometry.obj')),('/Fe'+(Join-Path $output 'DeusEdixGeometry.dll')),
    (Join-Path $PSScriptRoot 'gpu_geometry.cpp'),'/link','/DYNAMICBASE','/NXCOMPAT','/GUARD:CF','/CETCOMPAT',
    ('/LIBPATH:'+(Join-Path $msvc.FullName 'lib\x64')),
    ('/LIBPATH:'+(Join-Path $sdkRoot ('Lib\'+$sdk.Name+'\ucrt\x64'))),
    ('/LIBPATH:'+(Join-Path $sdkRoot ('Lib\'+$sdk.Name+'\um\x64'))),
    'd3d11.lib','dxgi.lib','d3dcompiler.lib','kernel32.lib')
& $compiler @flags
if($LASTEXITCODE -ne 0) {throw 'GPU geometry helper compilation failed'}
