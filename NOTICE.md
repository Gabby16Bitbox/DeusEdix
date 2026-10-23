# Notice

**DeusEdix is a fan-made tool. It is not affiliated with, endorsed or supported by the Deus Ex:
Revision team (Caustic Creative), Eidos, Square Enix or Ion Storm.** Use it at your own risk.

- **Deus Ex and Deus Ex: Revision.** Nothing of the game or of Revision is distributed here: no
  map, texture, sound, package, source or binary of theirs, nor anything made from them. DeusEdix
  works only on top of the user's own installed copies, read in place on their PC. Names,
  characters and setting belong to their owners.
- **What it makes on the user's PC.** Caches of textures and meshes, references and pieces of the
  original levels, baked animations and built maps are made from the user's own install, on their
  PC, and stay there. None of it belongs in this repository or in a release (see `.gitignore`).
- **The headless host.** `mapkit/host/UCMapKitHost.cpp` is our code. At run time it loads the
  editor engine (`Editor.dll`) from the user's own Deus Ex install; it is built against the
  engine's public headers, which are not included here.
- **The tutorial's music.** "Pondering the Cosmos" by Ruskerdax
  (https://opengameart.org/content/ruskerdax-pondering-the-cosmos-0), released to the public domain
  (CC0); credited with thanks. `mapkit/editor/static/audio/tutorial-music.mp3` is that track,
  re-encoded at 128 kbps with a short fade in and out for the loop.
- **Dr. Elias Hale's voice.** The tutorial guide's lines (`mapkit/tutorial/voices`,
  `mapkit/editor/static/audio/doctor` and their copies in the runtime package) were generated with
  ElevenLabs (https://elevenlabs.io) on a paid plan, with a public voice of its Voice Library. It is
  not the voice of anyone in Deus Ex or Revision, nor a clone of a real person.
- **Third-party libraries** keep their own licences: three.js (MIT, loaded by the page), Pillow
  (MIT-CMU), the MCP Python SDK (MIT).
- **Recast & Detour**, for the walkable area, Fill AI paths and the walkable area in the game:
  - The files: `mapkit/editor/static/recast-navigation-core.js`, `-generators.js` and `-wasm.js` are
    recast-navigation-js 0.43.1 (https://github.com/isaac-mason/recast-navigation-js), unchanged.
  - recast-navigation-js has the MIT licence, Copyright © 2025 Isaac Mason. Permission is hereby
    granted, free of charge, to any person obtaining a copy of this software and associated
    documentation files (the "Software"), to deal in the Software without restriction, including
    without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
    sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
    subject to the following conditions: The above copyright notice and this permission notice shall be
    included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS",
    WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
    MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS
    OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
    CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
    OTHER DEALINGS IN THE SOFTWARE.
  - Recast & Detour (https://github.com/recastnavigation/recastnavigation) are compiled to WebAssembly
    inside `-wasm.js`. They have the zlib licence, Copyright (c) 2009 Mikko Mononen. This software is
    provided 'as-is', without any express or implied warranty. In no event will the authors be held
    liable for any damages arising from the use of this software. Permission is granted to anyone to use
    this software for any purpose, including commercial applications, and to alter it and redistribute
    it freely, subject to the following restrictions: 1. The origin of this software must not be
    misrepresented; you must not claim that you wrote the original software. If you use this software in
    a product, an acknowledgment in the product documentation would be appreciated but is not required.
    2. Altered source versions must be plainly marked as such, and must not be misrepresented as being
    the original software. 3. This notice may not be removed or altered from any source distribution.
- **meshoptimizer**, for Simplify in Import model (a detailed model made light enough for the game):
  - The file `mapkit/editor/static/meshopt_simplifier.js` is meshoptimizer 1.2.0's simplifier
    (https://github.com/zeux/meshoptimizer), unchanged.
  - meshoptimizer has the MIT licence, Copyright (c) 2016-2026 Arseny Kapoulkine. Permission is hereby
    granted, free of charge, to any person obtaining a copy of this software and associated
    documentation files (the "Software"), to deal in the Software without restriction, including
    without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
    sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
    subject to the following conditions: The above copyright notice and this permission notice shall be
    included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS",
    WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
    MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS
    OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
    CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
    OTHER DEALINGS IN THE SOFTWARE.
